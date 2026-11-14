import { describe, expect, it } from 'vitest';
import { computeRoute, prepareGrid, searchCells, lngLatToCell, type TerrainGrid } from '../src/routing/astar';
import { DEFAULT_VEHICLE } from '../src/routing/vehicle';

/** Synthetic 60x60 grid near Jezero latitude, 40 m cells, flat unless modified. */
function synth(mod?: (c: number, r: number) => { slope?: number; nodata?: boolean; elev?: number } | undefined): TerrainGrid {
  const w = 60;
  const h = 60;
  const elev = new Int16Array(w * h).fill(-2500);
  const slope = new Uint8Array(w * h).fill(4); // 1°
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const m = mod?.(c, r);
      if (!m) continue;
      const i = r * w + c;
      if (m.slope !== undefined) slope[i] = Math.round(m.slope * 4);
      if (m.elev !== undefined) elev[i] = m.elev;
      if (m.nodata) {
        slope[i] = 255;
        elev[i] = -32768;
      }
    }
  const R = 3396190;
  const dlat = (40 / R) * (180 / Math.PI);
  return {
    width: w, height: h, lon0: 77.4, lat0: 18.5, dlat, dlon: dlat / Math.cos((18.4663 * Math.PI) / 180),
    radius: R, elev, elevNodata: -32768, slope, slopeScale: 0.25, gravity: 3.71,
  };
}

const cellLL = (g: TerrainGrid, c: number, r: number): [number, number] => [g.lon0 + c * g.dlon, g.lat0 - r * g.dlat];

describe('surface routing', () => {
  it('routes on a flat plain with near straight-line length', () => {
    const g = prepareGrid(synth());
    const res = computeRoute(g, DEFAULT_VEHICLE, cellLL(g, 10, 30), cellLL(g, 50, 30));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.distanceM).toBeGreaterThan(1590);
      expect(res.distanceM).toBeLessThan(1640);
      expect(res.timeS).toBeGreaterThan(0);
    }
  });

  it('never crosses cells above the slope limit: wall with a known gap', () => {
    // vertical wall at column 30 (35°), gap at rows 50..52
    const g = prepareGrid(synth((c, r) => (c === 30 && (r < 50 || r > 52) ? { slope: 35 } : undefined)));
    const res = computeRoute(g, DEFAULT_VEHICLE, cellLL(g, 10, 10), cellLL(g, 50, 10), { simplify: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      for (const p of res.coordinates) {
        const { c, r } = lngLatToCell(g, p[0], p[1]);
        if (c === 30) expect(r >= 50 && r <= 52).toBe(true);
      }
      expect(res.maxSlopeDeg).toBeLessThanOrEqual(DEFAULT_VEHICLE.maxSlopeDeg);
    }
  });

  it('simplified route still respects the wall', () => {
    const g = prepareGrid(synth((c, r) => (c === 30 && (r < 50 || r > 52) ? { slope: 35 } : undefined)));
    const res = computeRoute(g, DEFAULT_VEHICLE, cellLL(g, 10, 10), cellLL(g, 50, 10));
    expect(res.ok).toBe(true);
    if (res.ok) {
      for (const p of res.coordinates) {
        const { c, r } = lngLatToCell(g, p[0], p[1]);
        if (c === 30) expect(r >= 50 && r <= 52).toBe(true);
      }
    }
  });

  it('reports blocked_by_slope when a wall has no gap', () => {
    const g = prepareGrid(synth((c) => (c === 30 ? { slope: 35 } : undefined)));
    const res = computeRoute(g, DEFAULT_VEHICLE, cellLL(g, 10, 10), cellLL(g, 50, 10));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('blocked_by_slope');
  });

  it('never treats missing data as traversable', () => {
    const g = prepareGrid(synth((c) => (c >= 28 && c <= 32 ? { nodata: true } : undefined)));
    const res = computeRoute(g, DEFAULT_VEHICLE, cellLL(g, 10, 10), cellLL(g, 50, 10));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('blocked_by_coverage');
  });

  it('routes around a data gap rather than through it', () => {
    const g = prepareGrid(synth((c, r) => (c >= 28 && c <= 32 && r < 45 ? { nodata: true } : undefined)));
    const res = computeRoute(g, DEFAULT_VEHICLE, cellLL(g, 10, 10), cellLL(g, 50, 10), { simplify: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      for (const p of res.coordinates) {
        const { c, r } = lngLatToCell(g, p[0], p[1]);
        expect(g.confidence[r * g.width + c]).not.toBe(0);
      }
    }
  });

  it('rejects endpoints outside coverage', () => {
    const g = prepareGrid(synth());
    const res = computeRoute(g, DEFAULT_VEHICLE, [70, 10], cellLL(g, 10, 10));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('outside_coverage');
  });

  it('A* matches Dijkstra optimum (admissible heuristic) and is deterministic', () => {
    const g = prepareGrid(
      synth((c, r) => {
        const s = (Math.sin(c * 0.37) * Math.cos(r * 0.23) + 1) * 11; // 0..22°
        return { slope: s, elev: -2500 + Math.round(Math.sin(c * 0.1) * 40 + Math.cos(r * 0.13) * 30) };
      }),
    );
    for (const [a, b] of [
      [5 * 60 + 3, 55 * 60 + 57],
      [2 * 60 + 50, 58 * 60 + 4],
      [30 * 60 + 1, 31 * 60 + 58],
    ]) {
      const astar = searchCells(g, DEFAULT_VEHICLE, a, b);
      const dijk = searchCells(g, DEFAULT_VEHICLE, a, b, { heuristic: false });
      if (dijk.path === null) {
        expect(astar.path).toBeNull();
        continue;
      }
      expect(astar.cost).toBeCloseTo(dijk.cost, 6);
      expect(astar.expanded).toBeLessThanOrEqual(dijk.expanded);
      const again = searchCells(g, DEFAULT_VEHICLE, a, b);
      expect(again.path).toEqual(astar.path);
    }
  });
});
