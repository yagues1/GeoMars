/**
 * Route geometry refinement: turns the 8-connected A* cell path into a smooth, terrain-validated
 * polyline.
 *
 * Pipeline (all in fractional grid-cell coordinates, distances in metres):
 *   1. Any-angle string pulling: greedy line-of-sight shortcuts over the optimal cell path. A
 *      shortcut is accepted only if every sampled cell along it is observed, within the vehicle
 *      slope limit, no steeper than the steepest cell the optimiser itself accepted on that stretch,
 *      and not newly entering low-confidence ground. Removes the 45°/90° grid staircase.
 *   2. Corner fillets: every remaining vertex is replaced by a quadratic Bézier arc tangent to both
 *      adjoining segments (G1 continuous, adaptively sampled by turn angle). Each arc is validated
 *      against the same terrain mask; if it would touch an excluded / steeper / unobserved cell the
 *      fillet radius is halved, down to the original sharp corner.
 *
 * Nothing here can move the route onto terrain the optimiser was not allowed to use: smoothing is
 * rejected locally where it would. The refinement is geometric — it does not add positional
 * accuracy beyond the 40 m routing grid.
 */
import type { PreparedGrid } from './astar';

export type CellPt = [number, number]; // [fractional column, fractional row]

export function traversable(g: PreparedGrid, i: number, maxQ: number) {
  return g.confidence[i] !== 0 && g.slope[i] <= maxQ;
}

/** Constraint applied to every sampled cell of a candidate shortcut / arc. */
interface Rule {
  maxQ: number; // vehicle hard limit (quantised)
  allowedQ: number; // steepest slope already accepted on the replaced stretch
  allowLow: boolean; // replaced stretch already touched low-confidence cells
}

function cellOk(g: PreparedGrid, c: number, r: number, rule: Rule) {
  if (c < 0 || r < 0 || c >= g.width || r >= g.height) return false;
  const i = r * g.width + c;
  if (!traversable(g, i, rule.maxQ) || g.slope[i] > rule.allowedQ) return false;
  return rule.allowLow || g.confidence[i] === 2;
}

/**
 * True if the straight segment a→b only crosses acceptable cells. Sampled every ¼ cell; when a step
 * changes both row and column, both orthogonal neighbours must be acceptable too (no corner cutting,
 * mirroring the A* graph's diagonal rule).
 */
export function segmentClear(g: PreparedGrid, a: CellPt, b: CellPt, rule: Rule) {
  const span = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  const steps = Math.max(1, Math.ceil(span * 4));
  let pc = Math.round(a[0]);
  let pr = Math.round(a[1]);
  if (!cellOk(g, pc, pr, rule)) return false;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const c = Math.round(a[0] + (b[0] - a[0]) * t);
    const r = Math.round(a[1] + (b[1] - a[1]) * t);
    if (c === pc && r === pr) continue;
    if (!cellOk(g, c, r, rule)) return false;
    if (c !== pc && r !== pr && (!cellOk(g, c, pr, rule) || !cellOk(g, pc, r, rule))) return false;
    pc = c;
    pr = r;
  }
  return true;
}

/** Max slope (quantised) and low-confidence presence over the cells of a polyline. */
function stretchProfile(g: PreparedGrid, pts: CellPt[]) {
  let maxQ = 0;
  let low = false;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const c = Math.round(a[0] + (b[0] - a[0]) * t);
      const r = Math.round(a[1] + (b[1] - a[1]) * t);
      if (c < 0 || r < 0 || c >= g.width || r >= g.height) continue;
      const i = r * g.width + c;
      if (g.slope[i] !== 255) maxQ = Math.max(maxQ, g.slope[i]);
      if (g.confidence[i] === 1) low = true;
    }
  }
  return { maxQ, low };
}

const toPt = (g: PreparedGrid, i: number): CellPt => [i % g.width, (i / g.width) | 0];

/** Step 1 — greedy any-angle line-of-sight simplification of the optimal cell path. */
export function stringPull(g: PreparedGrid, path: number[], maxQ: number, maxSpan = 80): CellPt[] {
  if (path.length < 3) return path.map((i) => toPt(g, i));
  const out: CellPt[] = [toPt(g, path[0])];
  let i = 0;
  while (i < path.length - 1) {
    let best = i + 1;
    let allowed = Math.max(g.slope[path[i]], g.slope[path[i + 1]]);
    let low = g.confidence[path[i]] === 1 || g.confidence[path[i + 1]] === 1;
    for (let j = i + 2; j < path.length && j - i <= maxSpan; j++) {
      allowed = Math.max(allowed, g.slope[path[j]]);
      low ||= g.confidence[path[j]] === 1;
      if (segmentClear(g, toPt(g, path[i]), toPt(g, path[j]), { maxQ, allowedQ: allowed, allowLow: low })) best = j;
    }
    out.push(toPt(g, path[best]));
    i = best;
  }
  return out;
}

export interface FilletOptions {
  /** cells up to this quantised slope are always acceptable for smoothing (below the caution band) */
  softQ?: number;
  /** Upper bound of the tangent length of each corner arc (m). */
  maxRadiusM?: number;
  /** Fraction of each adjoining segment a single arc may use (≤ 0.5 so arcs never overlap). */
  segmentShare?: number;
}

/** Step 2 — replace each corner with a terrain-validated quadratic Bézier arc. */
export function filletCorners(g: PreparedGrid, pts: CellPt[], maxQ: number, sx: number, sy: number, opts: FilletOptions = {}): CellPt[] {
  if (pts.length < 3) return pts.slice();
  const maxR = opts.maxRadiusM ?? 240;
  const share = opts.segmentShare ?? 0.5;
  const len = (a: CellPt, b: CellPt) => Math.hypot((b[0] - a[0]) * sx, (b[1] - a[1]) * sy);
  const out: CellPt[] = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) {
    const A = pts[k - 1];
    const V = pts[k];
    const B = pts[k + 1];
    const la = len(A, V);
    const lb = len(V, B);
    const ua: CellPt = [(A[0] - V[0]) / la, (A[1] - V[1]) / la];
    const ub: CellPt = [(B[0] - V[0]) / lb, (B[1] - V[1]) / lb];
    // turn angle in metric space
    const ax = ua[0] * sx;
    const ay = ua[1] * sy;
    const bx = ub[0] * sx;
    const by = ub[1] * sy;
    const cosI = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
    const turnDeg = 180 - (Math.acos(Math.max(-1, Math.min(1, cosI))) * 180) / Math.PI;
    if (turnDeg < 0.5 || la < 1e-6 || lb < 1e-6) {
      out.push(V);
      continue;
    }
    const prof = stretchProfile(g, [A, V, B]);
    const rule: Rule = { maxQ, allowedQ: Math.max(prof.maxQ, opts.softQ ?? 0), allowLow: prof.low };
    let r = Math.min(maxR, la * share, lb * share);
    let arc: CellPt[] | null = null;
    const minR = 0.35 * Math.min(sx, sy);
    while (r >= minR) {
      const P1: CellPt = [V[0] + ua[0] * r, V[1] + ua[1] * r];
      const P2: CellPt = [V[0] + ub[0] * r, V[1] + ub[1] * r];
      // adaptive sampling: denser for sharper and larger arcs
      const n = Math.min(24, Math.max(3, Math.ceil(turnDeg / 6), Math.ceil(r / 18)));
      const cand: CellPt[] = [P1];
      for (let s = 1; s < n; s++) {
        const t = s / n;
        const w0 = (1 - t) * (1 - t);
        const w1 = 2 * (1 - t) * t;
        const w2 = t * t;
        cand.push([w0 * P1[0] + w1 * V[0] + w2 * P2[0], w0 * P1[1] + w1 * V[1] + w2 * P2[1]]);
      }
      cand.push(P2);
      let ok = true;
      for (let s = 0; s < cand.length - 1 && ok; s++) ok = segmentClear(g, cand[s], cand[s + 1], rule);
      if (ok) {
        arc = cand;
        break;
      }
      r *= 0.5;
    }
    if (arc) out.push(...arc);
    else out.push(V);
  }
  out.push(pts[pts.length - 1]);
  // drop exact duplicates (arcs meeting at a shared segment midpoint)
  return out.filter((p, i) => i === 0 || Math.abs(p[0] - out[i - 1][0]) > 1e-9 || Math.abs(p[1] - out[i - 1][1]) > 1e-9);
}

/** Every sampled cell of a polyline is observed and within the hard slope limit. */
export function polylineValid(g: PreparedGrid, pts: CellPt[], maxQ: number) {
  const rule: Rule = { maxQ, allowedQ: maxQ, allowLow: true };
  for (let k = 0; k < pts.length - 1; k++) if (!segmentClear(g, pts[k], pts[k + 1], rule)) return false;
  return true;
}

/** Largest heading change (deg) between consecutive segments — a smoothness metric used in tests. */
export function maxTurnDeg(pts: CellPt[], sx: number, sy: number) {
  let worst = 0;
  for (let k = 1; k < pts.length - 1; k++) {
    const a = Math.atan2((pts[k][1] - pts[k - 1][1]) * sy, (pts[k][0] - pts[k - 1][0]) * sx);
    const b = Math.atan2((pts[k + 1][1] - pts[k][1]) * sy, (pts[k + 1][0] - pts[k][0]) * sx);
    let d = Math.abs(b - a) * (180 / Math.PI);
    if (d > 180) d = 360 - d;
    worst = Math.max(worst, d);
  }
  return worst;
}

/** Resample a polyline at a roughly uniform spacing (in cells). Keeps the exact end points. */
export function densify(pts: CellPt[], stepCells: number): CellPt[] {
  const out: CellPt[] = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / stepCells));
    for (let s = 1; s <= n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]);
  }
  return out;
}

export interface RelaxOptions {
  iterations?: number;
  /** move fraction toward the neighbour average per iteration */
  lambda?: number;
  /** half-width (in points) of the window whose terrain the point may move onto */
  window?: number;
  /** cells up to this quantised slope are always acceptable (below the caution band) */
  softQ?: number;
}

/**
 * Step 3 — constrained elastic relaxation (Laplacian smoothing). Each interior point moves toward
 * the midpoint of its neighbours, spreading curvature along the route so turns read as long natural
 * curves instead of rounded kinks. A move is accepted only if both adjoining segments stay on cells
 * that are observed, within the vehicle limit, no steeper than the steepest cell already crossed in
 * the point's neighbourhood (±window points) and not newly entering low-confidence ground.
 */
export function relax(g: PreparedGrid, input: CellPt[], maxQ: number, opts: RelaxOptions = {}): CellPt[] {
  const n = input.length;
  if (n < 3) return input.slice();
  const iters = opts.iterations ?? 60;
  const lambda = opts.lambda ?? 0.45;
  const win = opts.window ?? 4;
  // per-point local rule from the validated input geometry
  const slopeAt: number[] = [];
  const lowAt: boolean[] = [];
  for (const p of input) {
    const c = Math.round(p[0]);
    const r = Math.round(p[1]);
    const i = r * g.width + c;
    const inside = c >= 0 && r >= 0 && c < g.width && r < g.height;
    slopeAt.push(inside && g.slope[i] !== 255 ? g.slope[i] : 0);
    lowAt.push(inside && g.confidence[i] === 1);
  }
  const rules: Rule[] = input.map((_, k) => {
    let q = 0;
    let low = false;
    for (let j = Math.max(0, k - win); j <= Math.min(n - 1, k + win); j++) {
      q = Math.max(q, slopeAt[j]);
      low ||= lowAt[j];
    }
    return { maxQ, allowedQ: Math.max(q, opts.softQ ?? 0), allowLow: low };
  });
  const pts = input.map((p) => [p[0], p[1]] as CellPt);
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    // alternate sweep direction to avoid drift
    const fwd = it % 2 === 0;
    for (let s = 1; s < n - 1; s++) {
      const k = fwd ? s : n - 1 - s;
      const a = pts[k - 1];
      const b = pts[k + 1];
      const cur = pts[k];
      const tx = cur[0] + ((a[0] + b[0]) / 2 - cur[0]) * lambda;
      const ty = cur[1] + ((a[1] + b[1]) / 2 - cur[1]) * lambda;
      if (Math.abs(tx - cur[0]) + Math.abs(ty - cur[1]) < 1e-4) continue;
      const cand: CellPt = [tx, ty];
      const rule = rules[k];
      if (segmentClear(g, a, cand, rule) && segmentClear(g, cand, b, rule)) {
        pts[k] = cand;
        moved++;
      }
    }
    if (!moved) break;
  }
  return pts;
}
