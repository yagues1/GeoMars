/**
 * Deterministic procedural noise for SYNTHETIC visual detail (micro-relief, rock placement).
 * Pure functions of world position and integer seeds: the generated environment is identical on
 * every session and every machine. Never used by the routing engine.
 */

/** 32-bit integer hash of two ints and a seed → [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D value noise in [0, 1], C2-smooth. */
export function valueNoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = fade(x - xi);
  const fy = fade(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal value noise, normalised to roughly [0, 1]. */
export function fbm(x: number, y: number, octaves: number, seed = 0): number {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    // rotate each octave by ~37° to avoid axis-aligned artefacts
    const rx = x * f * 0.8 - y * f * 0.6;
    const ry = x * f * 0.6 + y * f * 0.8;
    s += valueNoise(rx + o * 17.3, ry - o * 9.1, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return s / norm;
}

/** Ridged noise in [0, 1] — sharp crests, used for rocky protrusions and erosion grooves. */
export function ridged(x: number, y: number, octaves: number, seed = 0): number {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(valueNoise(x * f + o * 31.7, y * f - o * 11.3, seed + o * 57) * 2 - 1);
    s += n * n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.11;
  }
  return s / norm;
}

/** Maximum absolute amplitude (m) of the synthetic micro-relief at full strength. */
export const MICRO_MAX_AMPLITUDE_M = 1.1;

/**
 * Synthetic micro-relief (metres) at scene position (x, z), for a surface of the given slope
 * (0 = flat, 1 = vertical). Flat ground gets gentle undulations; slopes get ridged, rocky
 * protrusions and grooves. Bounded by ±MICRO_MAX_AMPLITUDE_M · strength.
 */
export function microRelief(x: number, z: number, slope: number, strength: number): number {
  if (strength <= 0) return 0;
  const gentle = fbm(x / 23, z / 23, 3, 11) - 0.5; // ±0.5
  const rocky = ridged(x / 9.5, z / 9.5, 3, 23) - 0.45; // ≈ ±0.5
  const r = Math.min(1, Math.max(0, (slope - 0.06) / 0.3));
  const v = gentle * 0.9 * (1 - r) + rocky * 1.3 * r + (fbm(x / 4.1, z / 4.1, 2, 37) - 0.5) * 0.35;
  const out = v * strength * MICRO_MAX_AMPLITUDE_M;
  return Math.max(-MICRO_MAX_AMPLITUDE_M * strength, Math.min(MICRO_MAX_AMPLITUDE_M * strength, out));
}
