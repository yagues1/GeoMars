import { describe, expect, it } from 'vitest';
import { computeRoute, prepareGrid, searchCells, type TerrainGrid } from '../src/routing/astar';
import { gradeFactor, MOBILITY_PROFILES, profileFor, ROVER_PROFILE, speedFactor, WALKING_PROFILE } from '../src/routing/vehicle';
import { playbackWarp } from '../src/navigation/simulator';

/** Synthetic 60x60 grid near Jezero latitude, 40 m cells, flat (1°) unless modified. */
function synth(mod?: (c: number, r: number) => { slope?: number; nodata?: boolean; elev?: number } | undefined): TerrainGrid {
  const w = 60;
  const h = 60;
  const elev = new Int16Array(w * h).fill(-2500);
  const slope = new Uint8Array(w * h).fill(4);
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

describe('mobility profiles', () => {
  it('exposes Rover at 10 km/h and Walking at 3 km/h', () => {
    expect(profileFor('rover')).toBe(ROVER_PROFILE);
    expect(profileFor('walking')).toBe(WALKING_PROFILE);
    expect(ROVER_PROFILE.nominalSpeedMs * 3.6).toBeCloseTo(10, 9);
    expect(WALKING_PROFILE.nominalSpeedMs * 3.6).toBeCloseTo(3, 9);
    expect(Object.keys(MOBILITY_PROFILES)).toEqual(['rover', 'walking']);
  });

  it('keeps the V1.1 rover baseline unchanged', () => {
    expect(ROVER_PROFILE.maxSlopeDeg).toBe(20);
    expect(ROVER_PROFILE.cautionSlopeDeg).toBe(15);
    expect(ROVER_PROFILE.traction).toEqual({ massKg: 3000, rollingResistance: 0.15, drivetrainEfficiency: 0.75 });
    expect(ROVER_PROFILE.weights).toEqual({ energyPerWh: 0.3, caution: 1.5, lowConfidence: 0.75 });
  });

  it('walking is an independent profile: no vehicle mass, rolling resistance or motor energy', () => {
    expect(WALKING_PROFILE.traction).toBeNull();
    expect(WALKING_PROFILE.weights.energyPerWh).toBe(0);
    expect(WALKING_PROFILE.maxSlopeDeg).not.toBe(ROVER_PROFILE.maxSlopeDeg);
    expect(WALKING_PROFILE.cautionSlopeDeg).not.toBe(ROVER_PROFILE.cautionSlopeDeg);
    expect(WALKING_PROFILE.gradeResponse).toBe('tobler');
  });

  it('speed factor never exceeds 1 (keeps the A* heuristic admissible) for both modes', () => {
    for (const p of [ROVER_PROFILE, WALKING_PROFILE]) {
      for (let s = 0; s <= 30; s += 0.5) {
        for (let gdeg = -30; gdeg <= 30; gdeg += 1) {
          const f = speedFactor(s, p, (gdeg * Math.PI) / 180);
          expect(f).toBeGreaterThan(0);
          expect(f).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('walking slows on uphill grades; rover speed ignores along-track grade', () => {
    const up = (10 * Math.PI) / 180;
    expect(gradeFactor(0)).toBeCloseTo(1, 9);
    expect(gradeFactor(up)).toBeLessThan(0.75);
    expect(speedFactor(2, WALKING_PROFILE, up)).toBeLessThan(speedFactor(2, WALKING_PROFILE, 0));
    expect(speedFactor(2, ROVER_PROFILE, up)).toBe(speedFactor(2, ROVER_PROFILE, 0));
  });
});

describe('route engine with mobility profiles', () => {
  it('time estimates follow each nominal speed on flat terrain', () => {
    const g = prepareGrid(synth());
    const a = cellLL(g, 10, 30);
    const b = cellLL(g, 50, 30);
    const rover = computeRoute(g, ROVER_PROFILE, a, b);
    const walk = computeRoute(g, WALKING_PROFILE, a, b);
    expect(rover.ok && walk.ok).toBe(true);
    if (!rover.ok || !walk.ok) return;
    expect(rover.mode).toBe('rover');
    expect(walk.mode).toBe('walking');
    // same geometry on a featureless plain
    expect(walk.distanceM).toBeCloseTo(rover.distanceM, 0);
    // 1° terrain → effective speed within a few % of nominal
    const roverKmh = (rover.distanceM / rover.timeS) * 3.6;
    const walkKmh = (walk.distanceM / walk.timeS) * 3.6;
    expect(roverKmh).toBeGreaterThan(9.5);
    expect(roverKmh).toBeLessThanOrEqual(10);
    expect(walkKmh).toBeGreaterThan(2.85);
    expect(walkKmh).toBeLessThanOrEqual(3);
    expect(walk.timeS / rover.timeS).toBeCloseTo(10 / 3, 1);
  });

  it('reports rover traction energy but no energy for walking', () => {
    const g = prepareGrid(synth());
    const rover = computeRoute(g, ROVER_PROFILE, cellLL(g, 10, 30), cellLL(g, 50, 30));
    const walk = computeRoute(g, WALKING_PROFILE, cellLL(g, 10, 30), cellLL(g, 50, 30));
    if (!rover.ok || !walk.ok) throw new Error('route expected');
    expect(rover.energyKWh).toBeGreaterThan(0);
    expect(walk.energyKWh).toBeNull();
  });

  it('applies mode-specific slope limits: a 22° ridge blocks the rover but not the walker', () => {
    // 22° ridge across column 30 with a gap at rows 52..54; endpoints at row 10
    const g = prepareGrid(synth((c, r) => (c === 30 && (r < 52 || r > 54) ? { slope: 22 } : undefined)));
    const a = cellLL(g, 10, 10);
    const b = cellLL(g, 50, 10);
    const rover = computeRoute(g, ROVER_PROFILE, a, b);
    const walk = computeRoute(g, WALKING_PROFILE, a, b);
    if (!rover.ok || !walk.ok) throw new Error('route expected');
    expect(rover.maxSlopeDeg).toBeLessThanOrEqual(20);
    expect(rover.distanceM).toBeGreaterThan(2500); // detour through the gap
    expect(walk.maxSlopeDeg).toBeGreaterThan(20); // crosses the ridge on foot (≤ 25° limit)
    expect(walk.maxSlopeDeg).toBeLessThanOrEqual(25);
    expect(walk.distanceM).toBeLessThan(1700);
  });

  it('a 27° wall blocks both modes, with mode-specific wording', () => {
    const g = prepareGrid(synth((c) => (c === 30 ? { slope: 27 } : undefined)));
    const walk = computeRoute(g, WALKING_PROFILE, cellLL(g, 10, 10), cellLL(g, 50, 10));
    const rover = computeRoute(g, ROVER_PROFILE, cellLL(g, 10, 10), cellLL(g, 50, 10));
    expect(walk.ok).toBe(false);
    expect(rover.ok).toBe(false);
    if (!walk.ok) {
      expect(walk.reason).toBe('blocked_by_slope');
      expect(walk.mode).toBe('walking');
      expect(walk.message).toMatch(/walking/);
    }
  });

  it('missing DEM data is a universal constraint: never crossed in any mode', () => {
    const g = prepareGrid(synth((c) => (c >= 28 && c <= 32 ? { nodata: true } : undefined)));
    for (const p of [ROVER_PROFILE, WALKING_PROFILE]) {
      const res = computeRoute(g, p, cellLL(g, 10, 10), cellLL(g, 50, 10));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe('blocked_by_coverage');
    }
  });

  it('outside coverage is rejected in both modes', () => {
    const g = prepareGrid(synth());
    for (const p of [ROVER_PROFILE, WALKING_PROFILE]) {
      const res = computeRoute(g, p, [70, 10], cellLL(g, 10, 10));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe('outside_coverage');
    }
  });

  it('walking A* matches the Dijkstra optimum and is deterministic', () => {
    const g = prepareGrid(
      synth((c, r) => ({
        slope: (Math.sin(c * 0.37) * Math.cos(r * 0.23) + 1) * 13, // 0..26°
        elev: -2500 + Math.round(Math.sin(c * 0.1) * 60 + Math.cos(r * 0.13) * 45),
      })),
    );
    for (const [a, b] of [
      [5 * 60 + 3, 55 * 60 + 57],
      [2 * 60 + 50, 58 * 60 + 4],
    ]) {
      const astar = searchCells(g, WALKING_PROFILE, a, b);
      const dijk = searchCells(g, WALKING_PROFILE, a, b, { heuristic: false });
      if (dijk.path === null) {
        expect(astar.path).toBeNull();
        continue;
      }
      expect(astar.cost).toBeCloseTo(dijk.cost, 6);
      expect(searchCells(g, WALKING_PROFILE, a, b).path).toEqual(astar.path);
    }
  });
});

describe('navigation playback', () => {
  it('uses practical playback multipliers without changing mission time', () => {
    expect(playbackWarp({ mode: 'rover', timeS: 600 })).toBe(60);
    expect(playbackWarp({ mode: 'walking', timeS: 1800 })).toBe(120);
    // a 5 h walk must still play back in ≤ 90 s of wall time
    const w = playbackWarp({ mode: 'walking', timeS: 5 * 3600 });
    expect((5 * 3600) / w).toBeLessThanOrEqual(90);
  });
});
