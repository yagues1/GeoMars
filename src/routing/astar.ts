/**
 * Terrain-aware route optimisation on the CTX-DEM-derived routing grid.
 *
 * Graph: one node per 40 m grid cell, 8-connected. A cell is a node only if it has observed
 * elevation + slope (no data → never a node) and its slope is ≤ the vehicle limit (hard
 * constraint → edge removed, not penalised). Diagonal moves additionally require both
 * orthogonal neighbours to be traversable (no corner cutting through excluded cells).
 *
 * Cost (non-negative, "equivalent seconds"):
 *   cost = t + w_E·E + t·w_c·caution(s) + t·w_u·[low-confidence]
 * where t = L3D / (v_nom·speedFactor(s)), E = estimated traction energy.
 *
 * Algorithm: A* with heuristic h = straight-line planar distance / v_nom using the *smallest*
 * east-west cell spacing in the grid. Every edge costs ≥ its horizontal length / v_nom, so h is
 * admissible and consistent → A* returns the same optimum as Dijkstra (verified in tests).
 * Ties are broken deterministically by node index.
 */
import { COST_WEIGHTS, segmentEnergyWh, speedFactor, type VehicleModel } from './vehicle';

export interface TerrainGrid {
  width: number;
  height: number;
  /** lon/lat of the centre of cell (0,0) — top-left, degrees planetocentric east-positive */
  lon0: number;
  lat0: number;
  dlon: number;
  dlat: number;
  radius: number;
  /** elevation metres (Int16), `elevNodata` = no data */
  elev: Int16Array;
  elevNodata: number;
  /** slope in `slopeScale` degrees (Uint8), 255 = no data */
  slope: Uint8Array;
  slopeScale: number;
  gravity: number;
}

export interface PreparedGrid extends TerrainGrid {
  /** 0 = no data, 1 = observed but adjacent (≤2 cells) to a DEM gap, 2 = observed */
  confidence: Uint8Array;
  cellDx: Float64Array; // east-west spacing per row (m)
  cellDy: number; // north-south spacing (m)
  minCellDx: number;
}

export type RouteFailureReason =
  | 'outside_coverage'
  | 'no_data'
  | 'too_steep_endpoint'
  | 'blocked_by_slope'
  | 'blocked_by_coverage'
  | 'same_point';

export interface RouteSuccess {
  ok: true;
  coordinates: [number, number][];
  elevations: number[];
  cumDist: number[];
  cumTime: number[];
  segSlope: number[];
  distanceM: number;
  timeS: number;
  energyKWh: number;
  maxSlopeDeg: number;
  meanSlopeDeg: number;
  ascentM: number;
  descentM: number;
  cautionFraction: number;
  lowConfidenceFraction: number;
  straightLineM: number;
  expanded: number;
  computeMs: number;
  snappedStartM: number;
  snappedEndM: number;
}

export interface RouteFailure {
  ok: false;
  reason: RouteFailureReason;
  message: string;
  computeMs: number;
}

export type RouteResult = RouteSuccess | RouteFailure;

const D2R = Math.PI / 180;
const DC = [1, -1, 0, 0, 1, 1, -1, -1];
const DR = [0, 0, 1, -1, 1, -1, 1, -1];

export function prepareGrid(g: TerrainGrid): PreparedGrid {
  const { width: w, height: h } = g;
  const n = w * h;
  const conf = new Uint8Array(n);
  for (let i = 0; i < n; i++) conf[i] = g.slope[i] === 255 || g.elev[i] === g.elevNodata ? 0 : 2;
  // two dilation passes of the no-data mask → "low confidence" ring
  for (let pass = 0; pass < 2; pass++) {
    const src = conf.slice();
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        if (src[i] !== 2) continue;
        for (let k = 0; k < 8; k++) {
          const cc = c + DC[k];
          const rr = r + DR[k];
          if (cc < 0 || rr < 0 || cc >= w || rr >= h || src[rr * w + cc] === 0) {
            conf[i] = 1;
            break;
          }
        }
      }
    }
  }
  const cellDx = new Float64Array(h);
  let minCellDx = Infinity;
  for (let r = 0; r < h; r++) {
    const lat = g.lat0 - r * g.dlat;
    cellDx[r] = g.radius * Math.cos(lat * D2R) * g.dlon * D2R;
    minCellDx = Math.min(minCellDx, cellDx[r]);
  }
  return { ...g, confidence: conf, cellDx, cellDy: g.radius * g.dlat * D2R, minCellDx };
}

export function lngLatToCell(g: TerrainGrid, lon: number, lat: number) {
  return { c: Math.round((lon - g.lon0) / g.dlon), r: Math.round((g.lat0 - lat) / g.dlat) };
}
export function cellToLngLat(g: TerrainGrid, c: number, r: number): [number, number] {
  return [g.lon0 + c * g.dlon, g.lat0 - r * g.dlat];
}

export function slopeAt(g: TerrainGrid, i: number) {
  return g.slope[i] === 255 ? NaN : g.slope[i] * g.slopeScale;
}

/** Bilinear elevation (m) at fractional cell coords; NaN if any contributing cell lacks data. */
export function elevationAt(g: TerrainGrid, lon: number, lat: number): number {
  const fc = (lon - g.lon0) / g.dlon;
  const fr = (g.lat0 - lat) / g.dlat;
  const c0 = Math.floor(fc);
  const r0 = Math.floor(fr);
  if (c0 < 0 || r0 < 0 || c0 + 1 >= g.width || r0 + 1 >= g.height) return NaN;
  const tx = fc - c0;
  const ty = fr - r0;
  const i = r0 * g.width + c0;
  const e = [g.elev[i], g.elev[i + 1], g.elev[i + g.width], g.elev[i + g.width + 1]];
  if (e.some((v) => v === g.elevNodata)) return NaN;
  return (e[0] * (1 - tx) + e[1] * tx) * (1 - ty) + (e[2] * (1 - tx) + e[3] * tx) * ty;
}

function traversable(g: PreparedGrid, i: number, maxSlopeQ: number) {
  return g.confidence[i] !== 0 && g.slope[i] <= maxSlopeQ;
}

/** Binary min-heap keyed by f, ties broken by node id for determinism. */
class Heap {
  ids = new Int32Array(1 << 16);
  keys = new Float64Array(1 << 16);
  size = 0;
  push(id: number, key: number) {
    if (this.size === this.ids.length) {
      const ni = new Int32Array(this.size * 2);
      ni.set(this.ids);
      const nk = new Float64Array(this.size * 2);
      nk.set(this.keys);
      this.ids = ni;
      this.keys = nk;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(id, key, this.ids[p], this.keys[p])) {
        this.ids[i] = this.ids[p];
        this.keys[i] = this.keys[p];
        i = p;
      } else break;
    }
    this.ids[i] = id;
    this.keys[i] = key;
  }
  private less(ia: number, ka: number, ib: number, kb: number) {
    return ka < kb || (ka === kb && ia < ib);
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size];
    const lastKey = this.keys[this.size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const m = r < this.size && this.less(this.ids[r], this.keys[r], this.ids[l], this.keys[l]) ? r : l;
      if (this.less(this.ids[m], this.keys[m], lastId, lastKey)) {
        this.ids[i] = this.ids[m];
        this.keys[i] = this.keys[m];
        i = m;
      } else break;
    }
    this.ids[i] = lastId;
    this.keys[i] = lastKey;
    return top;
  }
}

interface EdgeCtx {
  g: PreparedGrid;
  v: VehicleModel;
}

/** Cost and physical terms of moving between adjacent cells a → b. */
function edgeCost(ctx: EdgeCtx, a: number, b: number, dc: number, dr: number) {
  const { g, v } = ctx;
  const ra = (a / g.width) | 0;
  const dx = dc * (g.cellDx[ra] + g.cellDx[(b / g.width) | 0]) * 0.5;
  const dy = dr * g.cellDy;
  const dh = Math.hypot(dx, dy);
  const dz = g.elev[b] - g.elev[a];
  const l3 = Math.hypot(dh, dz);
  const s = Math.max(g.slope[a], g.slope[b]) * g.slopeScale;
  const t = l3 / (v.nominalSpeedMs * speedFactor(s, v));
  const e = segmentEnergyWh(l3, Math.atan2(dz, dh), v, g.gravity);
  let cost = t + e * COST_WEIGHTS.energyPerWh;
  if (s > v.cautionSlopeDeg) cost += t * COST_WEIGHTS.caution * ((s - v.cautionSlopeDeg) / (v.maxSlopeDeg - v.cautionSlopeDeg));
  if (g.confidence[a] === 1 || g.confidence[b] === 1) cost += t * COST_WEIGHTS.lowConfidence;
  return cost;
}

export interface SearchOptions {
  heuristic?: boolean; // false → Dijkstra (reference implementation)
  maxSlopeOverride?: number; // diagnostic only
}

/** Core search. Returns the list of cell indices from start to goal, or null. */
export function searchCells(
  g: PreparedGrid,
  v: VehicleModel,
  start: number,
  goal: number,
  opts: SearchOptions = {},
): { path: number[] | null; expanded: number; cost: number } {
  const n = g.width * g.height;
  const maxQ = Math.floor((opts.maxSlopeOverride ?? v.maxSlopeDeg) / g.slopeScale + 1e-9);
  const gScore = new Float64Array(n).fill(Infinity);
  const parent = new Uint8Array(n).fill(255);
  const closed = new Uint8Array(n);
  const useH = opts.heuristic !== false;
  const gc = goal % g.width;
  const gr = (goal / g.width) | 0;
  const hScale = 1 / v.nominalSpeedMs;
  const H = (i: number) => {
    if (!useH) return 0;
    const c = i % g.width;
    const r = (i / g.width) | 0;
    return Math.hypot((c - gc) * g.minCellDx, (r - gr) * g.cellDy) * hScale;
  };
  const ctx: EdgeCtx = { g, v };
  const heap = new Heap();
  gScore[start] = 0;
  heap.push(start, H(start));
  let expanded = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    if (cur === goal) break;
    const c = cur % g.width;
    const r = (cur / g.width) | 0;
    for (let k = 0; k < 8; k++) {
      const cc = c + DC[k];
      const rr = r + DR[k];
      if (cc < 0 || rr < 0 || cc >= g.width || rr >= g.height) continue;
      const nb = rr * g.width + cc;
      if (closed[nb] || !traversable(g, nb, maxQ)) continue;
      if (k >= 4 && (!traversable(g, r * g.width + cc, maxQ) || !traversable(g, rr * g.width + c, maxQ))) continue;
      const ng = gScore[cur] + edgeCost(ctx, cur, nb, DC[k], DR[k]);
      if (ng < gScore[nb]) {
        gScore[nb] = ng;
        parent[nb] = k;
        heap.push(nb, ng + H(nb));
      }
    }
  }
  if (!closed[goal]) return { path: null, expanded, cost: Infinity };
  const path: number[] = [];
  let cur = goal;
  while (cur !== start) {
    path.push(cur);
    const k = parent[cur];
    cur = (((cur / g.width) | 0) - DR[k]) * g.width + ((cur % g.width) - DC[k]);
  }
  path.push(start);
  path.reverse();
  return { path, expanded, cost: gScore[goal] };
}

/** Breadth-first reachability on observed cells, optionally ignoring the slope limit (diagnostics). */
function reachable(g: PreparedGrid, start: number, goal: number, maxQ: number) {
  const seen = new Uint8Array(g.width * g.height);
  const q = new Int32Array(g.width * g.height);
  let h = 0;
  let t = 0;
  q[t++] = start;
  seen[start] = 1;
  while (h < t) {
    const cur = q[h++];
    if (cur === goal) return true;
    const c = cur % g.width;
    const r = (cur / g.width) | 0;
    for (let k = 0; k < 8; k++) {
      const cc = c + DC[k];
      const rr = r + DR[k];
      if (cc < 0 || rr < 0 || cc >= g.width || rr >= g.height) continue;
      const nb = rr * g.width + cc;
      if (seen[nb] || !traversable(g, nb, maxQ)) continue;
      seen[nb] = 1;
      q[t++] = nb;
    }
  }
  return false;
}

/** Nearest traversable cell within `radius` cells (deterministic scan order). */
function snapCell(g: PreparedGrid, c: number, r: number, maxQ: number, radius: number) {
  let best = -1;
  let bestD = Infinity;
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= g.width || rr >= g.height) continue;
      const i = rr * g.width + cc;
      if (!traversable(g, i, maxQ)) continue;
      const d = Math.hypot(dc * g.cellDx[rr], dr * g.cellDy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return { index: best, distM: bestD };
}

/** Line-of-sight test used for path simplification: every sampled cell must be traversable, observed
 * and no steeper than `maxAllowedQ` (the steepest cell the optimiser itself accepted on that stretch). */
function lineClear(g: PreparedGrid, a: number, b: number, maxAllowedQ: number, maxQ: number) {
  const ac = a % g.width;
  const ar = (a / g.width) | 0;
  const bc = b % g.width;
  const br = (b / g.width) | 0;
  const steps = Math.ceil(Math.max(Math.abs(bc - ac), Math.abs(br - ar)) * 4);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const i = Math.round(ar + (br - ar) * t) * g.width + Math.round(ac + (bc - ac) * t);
    if (!traversable(g, i, maxQ) || g.slope[i] > maxAllowedQ || g.confidence[i] === 1) return false;
  }
  return true;
}

function simplifyPath(g: PreparedGrid, path: number[], maxQ: number, maxSpan = 15): number[] {
  if (path.length < 3) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let best = i + 1;
    let maxAllowed = Math.max(g.slope[path[i]], g.slope[path[i + 1]]);
    for (let j = i + 2; j < path.length && j - i <= maxSpan; j++) {
      maxAllowed = Math.max(maxAllowed, g.slope[path[j]]);
      if (lineClear(g, path[i], path[j], maxAllowed, maxQ)) best = j;
    }
    out.push(path[best]);
    i = best;
  }
  return out;
}

/** Evaluate distance/time/energy on the FINAL displayed geometry, densified at ≤ cell spacing. */
function measure(g: PreparedGrid, v: VehicleModel, cells: number[]) {
  const coords: [number, number][] = [];
  const elev: number[] = [];
  const cellIdx: number[] = [];
  for (let k = 0; k < cells.length - 1; k++) {
    const a = cells[k];
    const b = cells[k + 1];
    const pa = cellToLngLat(g, a % g.width, (a / g.width) | 0);
    const pb = cellToLngLat(g, b % g.width, (b / g.width) | 0);
    const span = Math.max(Math.abs((b % g.width) - (a % g.width)), Math.abs(((b / g.width) | 0) - ((a / g.width) | 0)));
    const steps = Math.max(1, span);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const p: [number, number] = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
      coords.push(p);
      const ci = lngLatToCell(g, p[0], p[1]);
      cellIdx.push(ci.r * g.width + ci.c);
    }
  }
  const last = cells[cells.length - 1];
  coords.push(cellToLngLat(g, last % g.width, (last / g.width) | 0));
  cellIdx.push(last);
  for (let k = 0; k < coords.length; k++) {
    const e = elevationAt(g, coords[k][0], coords[k][1]);
    elev.push(Number.isFinite(e) ? e : g.elev[cellIdx[k]]);
  }
  const cumDist = [0];
  const cumTime = [0];
  const segSlope: number[] = [];
  let energy = 0;
  let ascent = 0;
  let descent = 0;
  let maxSlope = 0;
  let slopeSum = 0;
  let cautionLen = 0;
  let lowConfLen = 0;
  for (let k = 1; k < coords.length; k++) {
    const latm = ((coords[k][1] + coords[k - 1][1]) / 2) * D2R;
    const dx = (coords[k][0] - coords[k - 1][0]) * D2R * g.radius * Math.cos(latm);
    const dy = (coords[k][1] - coords[k - 1][1]) * D2R * g.radius;
    const dh = Math.hypot(dx, dy);
    const dz = elev[k] - elev[k - 1];
    const l3 = Math.hypot(dh, dz);
    const s = Math.max(g.slope[cellIdx[k]], g.slope[cellIdx[k - 1]]) * g.slopeScale;
    segSlope.push(s);
    const t = l3 / (v.nominalSpeedMs * speedFactor(s, v));
    energy += segmentEnergyWh(l3, Math.atan2(dz, dh), v, g.gravity);
    if (dz > 0) ascent += dz;
    else descent -= dz;
    maxSlope = Math.max(maxSlope, s);
    slopeSum += s * l3;
    if (s > v.cautionSlopeDeg) cautionLen += l3;
    if (g.confidence[cellIdx[k]] === 1 || g.confidence[cellIdx[k - 1]] === 1) lowConfLen += l3;
    cumDist.push(cumDist[k - 1] + l3);
    cumTime.push(cumTime[k - 1] + t);
  }
  const D = cumDist[cumDist.length - 1];
  return {
    coordinates: coords,
    elevations: elev.map((e) => Math.round(e * 10) / 10),
    cumDist,
    cumTime,
    segSlope,
    distanceM: D,
    timeS: cumTime[cumTime.length - 1],
    energyKWh: energy / 1000,
    maxSlopeDeg: maxSlope,
    meanSlopeDeg: D > 0 ? slopeSum / D : 0,
    ascentM: ascent,
    descentM: descent,
    cautionFraction: D > 0 ? cautionLen / D : 0,
    lowConfidenceFraction: D > 0 ? lowConfLen / D : 0,
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function computeRoute(
  g: PreparedGrid,
  v: VehicleModel,
  from: [number, number],
  to: [number, number],
  opts: { simplify?: boolean; heuristic?: boolean } = {},
): RouteResult {
  const t0 = now();
  const fail = (reason: RouteFailureReason, message: string): RouteFailure => ({ ok: false, reason, message, computeMs: now() - t0 });
  const maxQ = Math.floor(v.maxSlopeDeg / g.slopeScale + 1e-9);
  const ends: { index: number; distM: number }[] = [];
  for (const [label, p] of [['Origin', from], ['Destination', to]] as const) {
    const { c, r } = lngLatToCell(g, p[0], p[1]);
    if (c < 0 || r < 0 || c >= g.width || r >= g.height) {
      return fail('outside_coverage', `${label} is outside the CTX elevation model that supports routing.`);
    }
    const i = r * g.width + c;
    if (g.confidence[i] === 0) {
      const snapped = snapCell(g, c, r, maxQ, 2);
      if (snapped.index < 0) return fail('no_data', `${label} falls in a gap of the elevation model (no observed terrain).`);
      ends.push(snapped);
      continue;
    }
    if (g.slope[i] > maxQ) {
      const snapped = snapCell(g, c, r, maxQ, 3);
      if (snapped.index < 0) {
        return fail(
          'too_steep_endpoint',
          `${label} lies on terrain steeper than the ${v.maxSlopeDeg}° vehicle limit (${(g.slope[i] * g.slopeScale).toFixed(1)}°) with no safe ground within 120 m.`,
        );
      }
      ends.push(snapped);
      continue;
    }
    ends.push({ index: i, distM: 0 });
  }
  const [s, e] = ends;
  if (s.index === e.index) return fail('same_point', 'Origin and destination are in the same 40 m terrain cell.');
  const res = searchCells(g, v, s.index, e.index, { heuristic: opts.heuristic });
  if (!res.path) {
    // Diagnose — never returns a route.
    const slopeOnly = reachable(g, s.index, e.index, 254);
    return fail(
      slopeOnly ? 'blocked_by_slope' : 'blocked_by_coverage',
      slopeOnly
        ? `No route keeps every slope ≤ ${v.maxSlopeDeg}°. The two points are separated by terrain steeper than the vehicle limit (e.g. crater walls or scarps).`
        : 'No route exists through observed terrain: the points are separated by gaps in the elevation model, and GeoMars never routes over unobserved ground.',
    );
  }
  const cells = opts.simplify === false ? res.path : simplifyPath(g, res.path, maxQ);
  const m = measure(g, v, cells);
  const sp = cellToLngLat(g, s.index % g.width, (s.index / g.width) | 0);
  const ep = cellToLngLat(g, e.index % g.width, (e.index / g.width) | 0);
  const straight = Math.hypot(
    (ep[0] - sp[0]) * D2R * g.radius * Math.cos(((sp[1] + ep[1]) / 2) * D2R),
    (ep[1] - sp[1]) * D2R * g.radius,
  );
  return {
    ok: true,
    ...m,
    straightLineM: straight,
    expanded: res.expanded,
    computeMs: now() - t0,
    snappedStartM: s.distM,
    snappedEndM: e.distM,
  };
}
