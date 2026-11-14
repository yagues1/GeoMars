import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeRoute, prepareGrid, searchCells, lngLatToCell, type PreparedGrid, type TerrainGrid } from '../src/routing/astar';
import { filletCorners, maxTurnDeg, polylineValid, stringPull, type CellPt } from '../src/routing/geometry';
import { DEFAULT_VEHICLE } from '../src/routing/vehicle';

const R = 3396190;
function synth(w: number, h: number, mod?: (c: number, r: number) => { slope?: number; nodata?: boolean } | undefined): TerrainGrid {
  const elev = new Int16Array(w * h).fill(-2500);
  const slope = new Uint8Array(w * h).fill(4);
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const m = mod?.(c, r);
      if (!m) continue;
      const i = r * w + c;
      if (m.slope !== undefined) slope[i] = Math.round(m.slope * 4);
      if (m.nodata) {
        slope[i] = 255;
        elev[i] = -32768;
      }
    }
  const dlat = (40 / R) * (180 / Math.PI);
  return { width: w, height: h, lon0: 77.4, lat0: 18.5, dlat, dlon: dlat / Math.cos((18.47 * Math.PI) / 180), radius: R, elev, elevNodata: -32768, slope, slopeScale: 0.25, gravity: 3.71 };
}
const ll = (g: TerrainGrid, c: number, r: number): [number, number] => [g.lon0 + c * g.dlon, g.lat0 - r * g.dlat];
const maxQ = (g: PreparedGrid) => Math.floor(DEFAULT_VEHICLE.maxSlopeDeg / g.slopeScale + 1e-9);

/** Every displayed coordinate (densified ≤ 1 cell) must fall on an observed, allowed cell. */
function allOnAllowedCells(g: PreparedGrid, coords: [number, number][]) {
  for (const p of coords) {
    const { c, r } = lngLatToCell(g, p[0], p[1]);
    const i = r * g.width + c;
    if (g.confidence[i] === 0 || g.slope[i] > maxQ(g)) return false;
  }
  return true;
}

describe('route geometry refinement', () => {
  it('removes the grid staircase on open terrain (long diagonal-ish route becomes nearly straight)', () => {
    const g = prepareGrid(synth(120, 120));
    const res = searchCells(g, DEFAULT_VEHICLE, 10 * 120 + 5, 100 * 120 + 70);
    const pulled = stringPull(g, res.path!, maxQ(g));
    expect(pulled.length).toBeLessThanOrEqual(4);
  });

  it('rounds corners around an obstacle without touching excluded cells', () => {
    // 35° block in the middle forces a detour
    const g = prepareGrid(synth(80, 80, (c, r) => (c >= 30 && c <= 50 && r >= 20 && r <= 60 ? { slope: 35 } : undefined)));
    const res = computeRoute(g, DEFAULT_VEHICLE, ll(g, 10, 40), ll(g, 70, 40));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(allOnAllowedCells(g, res.coordinates)).toBe(true);
    // smoothness: no abrupt heading change between consecutive displayed segments
    const sx = g.cellDx[40];
    const pts: CellPt[] = res.coordinates.map((p) => [(p[0] - g.lon0) / g.dlon, (g.lat0 - p[1]) / g.dlat]);
    expect(maxTurnDeg(pts, sx, g.cellDy)).toBeLessThan(35);
    expect(res.maxSlopeDeg).toBeLessThanOrEqual(DEFAULT_VEHICLE.maxSlopeDeg);
  });

  it('fillets are rejected locally where they would cut through a no-data gap', () => {
    // a corner hugging a no-data notch: the arc must not cut the notch
    const g = prepareGrid(synth(60, 60, (c, r) => (c >= 20 && c <= 40 && r >= 20 && r <= 40 ? { nodata: true } : undefined)));
    const corner: CellPt[] = [[10, 18], [42, 18], [42, 50]];
    const out = filletCorners(g, corner, maxQ(g), g.cellDx[30], g.cellDy);
    expect(polylineValid(g, out, maxQ(g))).toBe(true);
    expect(out.length).toBeGreaterThan(3); // still rounded, just tighter
  });

  it('keeps the wall gap constraint with smoothing enabled', () => {
    const g = prepareGrid(synth(60, 60, (c, r) => (c === 30 && (r < 50 || r > 52) ? { slope: 35 } : undefined)));
    const res = computeRoute(g, DEFAULT_VEHICLE, ll(g, 10, 10), ll(g, 50, 10));
    expect(res.ok).toBe(true);
    if (res.ok) expect(allOnAllowedCells(g, res.coordinates)).toBe(true);
  });

  it('starts and ends exactly at selected points inside their cells', () => {
    const g = prepareGrid(synth(60, 60));
    const from: [number, number] = [ll(g, 10, 10)[0] + g.dlon * 0.3, ll(g, 10, 10)[1] - g.dlat * 0.2];
    const to: [number, number] = [ll(g, 50, 45)[0] - g.dlon * 0.25, ll(g, 50, 45)[1]];
    const res = computeRoute(g, DEFAULT_VEHICLE, from, to);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.coordinates[0][0]).toBeCloseTo(from[0], 9);
    expect(res.coordinates[res.coordinates.length - 1][1]).toBeCloseTo(to[1], 9);
  });
});

// Real Jezero routing grid (skipped if the prepared data are not present).
const gridDir = path.resolve('public/data/grids');
const hasGrid = fs.existsSync(path.join(gridDir, 'routing.json'));
describe.skipIf(!hasGrid)('Jezero CTX grid — smoothed routes stay on allowed terrain', () => {
  let g: PreparedGrid;
  const load = () => {
    if (g) return g;
    const meta = JSON.parse(fs.readFileSync(path.join(gridDir, 'routing.json'), 'utf8'));
    const e = fs.readFileSync(path.join(gridDir, 'routing_elev.i16'));
    const s = fs.readFileSync(path.join(gridDir, 'routing_slope.u8'));
    g = prepareGrid({
      width: meta.width, height: meta.height, lon0: meta.lon0_center, lat0: meta.lat0_center, dlon: meta.dlon, dlat: meta.dlat,
      radius: meta.radius_m, elev: new Int16Array(e.buffer, e.byteOffset, e.byteLength / 2), elevNodata: meta.elev_nodata,
      slope: new Uint8Array(s.buffer, s.byteOffset, s.byteLength), slopeScale: meta.slope_scale, gravity: 3.71,
    });
    return g;
  };
  const pairs: [[number, number], [number, number]][] = [
    [[77.4509, 18.4446], [77.3052, 18.4975]], // landing → Cheyava Falls (crosses the fan front)
    [[77.4509, 18.4446], [77.2647, 18.4606]], // landing → Shallow Bay (crater rim side)
    [[77.4078, 18.4526], [77.3959, 18.4988]], // Three Forks → western fan
    [[77.52, 18.38], [77.36, 18.52]],
  ];
  it.each(pairs)('route %j → %j', (from, to) => {
    const grid = load();
    const res = computeRoute(grid, DEFAULT_VEHICLE, from, to);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(allOnAllowedCells(grid, res.coordinates)).toBe(true);
    expect(res.maxSlopeDeg).toBeLessThanOrEqual(DEFAULT_VEHICLE.maxSlopeDeg);
    // compared with the unsmoothed optimum the displayed route is never much longer
    const raw = computeRoute(grid, DEFAULT_VEHICLE, from, to, { simplify: false });
    if (raw.ok) expect(res.distanceM).toBeLessThan(raw.distanceM * 1.02);
  }, 60000);
});
