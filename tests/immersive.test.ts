import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { curvatureDrop, latToMy, latToZ, lonToMx, lonToX, metersPerPixel, myToLat, mxToLon, tileBounds, xToLon, zToLat } from '../src/immersive/frame';
import { fbm, hash2, MICRO_MAX_AMPLITUDE_M, microRelief, rng } from '../src/immersive/noise';
import { QUALITY } from '../src/immersive/quality';
import { marsDistance } from '../src/geo/mars';

describe('enhanced 3D scene frame', () => {
  it('round-trips lon/lat ↔ scene metres', () => {
    for (const [lon, lat] of [[77.4509, 18.4447], [77.0, 17.6], [78.5, 19.2], [74, 15]]) {
      expect(xToLon(lonToX(lon))).toBeCloseTo(lon, 9);
      expect(zToLat(latToZ(lat))).toBeCloseTo(lat, 9);
    }
  });
  it('keeps horizontal scale within 0.5 % of Mars great-circle distances across Jezero', () => {
    const a: [number, number] = [77.4, 18.5];
    const b: [number, number] = [77.9, 18.3];
    const scene = Math.hypot(lonToX(b[0]) - lonToX(a[0]), latToZ(b[1]) - latToZ(a[1]));
    expect(Math.abs(scene / marsDistance(a, b) - 1)).toBeLessThan(0.005);
  });
  it('round-trips Web-Mercator coordinates and tile bounds', () => {
    expect(mxToLon(lonToMx(77.45))).toBeCloseTo(77.45, 9);
    expect(myToLat(latToMy(18.44))).toBeCloseTo(18.44, 9);
    const [w, s, e, n] = tileBounds(12, 2929, 1834);
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
  });
  it('applies the sphere curvature drop d²/2R (visual horizon only)', () => {
    expect(curvatureDrop(0, 0)).toBe(0);
    expect(curvatureDrop(10_000, 0)).toBeCloseTo(14.72, 1);
  });
  it('matches the 2D map scale (metres per pixel)', () => {
    expect(metersPerPixel(12, 18.45)).toBeGreaterThan(9);
    expect(metersPerPixel(12, 18.45)).toBeLessThan(10);
  });
});

describe('synthetic detail is deterministic and bounded', () => {
  it('hash, rng and fbm are deterministic', () => {
    expect(hash2(12, -7, 3)).toBe(hash2(12, -7, 3));
    const a = rng(42), b = rng(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
    expect(fbm(1.3, 2.7, 4, 9)).toBe(fbm(1.3, 2.7, 4, 9));
  });
  it('micro-relief never exceeds its documented amplitude', () => {
    let max = 0;
    for (let i = 0; i < 4000; i++) {
      const x = (i * 37.1) % 5000, z = (i * 91.7) % 5000, slope = (i % 10) / 10;
      max = Math.max(max, Math.abs(microRelief(x, z, slope, 1)));
    }
    expect(max).toBeLessThanOrEqual(MICRO_MAX_AMPLITUDE_M + 1e-9);
    expect(max).toBeGreaterThan(0.1);
    expect(microRelief(100, 200, 0.3, 0)).toBe(0);
  });
});

describe('quality presets', () => {
  it('scale real rendering work from performance to cinematic', () => {
    const p = QUALITY.performance, b = QUALITY.balanced, c = QUALITY.cinematic;
    expect(p.segments).toBeLessThan(b.segments);
    expect(b.segments).toBeLessThan(c.segments);
    expect(p.shadowMap).toBe(0);
    expect(b.shadowMap).toBeLessThan(c.shadowMap);
    expect(p.rocks).toBeLessThan(b.rocks);
    expect(b.rocks).toBeLessThan(c.rocks);
    expect(p.maxZoom).toBeLessThan(c.maxZoom);
  });
});

describe('scientific integrity', () => {
  it('the routing engine never imports the synthetic 3D renderer', () => {
    const dir = path.resolve(__dirname, '../src/routing');
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/immersive/);
    }
  });
});
