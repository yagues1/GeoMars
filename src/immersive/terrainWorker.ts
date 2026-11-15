/// <reference lib="webworker" />
/**
 * Terrain chunk builder (Web Worker). For a quadtree node (Web-Mercator tile z/x/y) it:
 *   1. loads the terrain-RGB (terrarium) tiles produced from the USGS CTX DEM (20 m) and MOLA
 *      (463 m) — the REAL elevation foundation — with seamless sampling across tile borders and
 *      fallback to coarser zooms where finer data do not exist;
 *   2. samples them on the chunk grid (bicubic when the grid is finer than the DEM);
 *   3. adds SYNTHETIC micro-relief (visual only, bounded ±1.1 m) on fine chunks;
 *   4. computes normals, a cavity/ambient-occlusion term and skirts;
 *   5. scatters SYNTHETIC rocks/pebbles deterministically (seeded by tile id).
 * Nothing here feeds the routing engine, which runs on its own grid in routing/worker.ts.
 */
import { curvatureDrop, latToZ, lonToX, myToLat, mxToLon } from './frame';
import { fbm, hash2, microRelief, rng } from './noise';

export interface BuildRequest {
  type: 'build';
  id: number;
  z: number;
  x: number;
  y: number;
  segs: number;
  exag: number;
  micro: number;
  rocks: number;
  pebbles: number;
}
export interface InitRequest {
  type: 'init';
  base: string;
  ctxCore: number[];
  mola: number[];
}
export interface BuildResult {
  type: 'built';
  id: number;
  ok: boolean;
  error?: string;
  center?: [number, number, number];
  positions?: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  ao?: Float32Array;
  /** final world heights of the (segs+1)² grid — used for camera/route/marker draping */
  heights?: Float32Array;
  minY?: number;
  maxY?: number;
  /** rock instances, stride 8: x y z (local) size yaw tiltX tiltZ variant+tone */
  rocks?: Float32Array;
  pebbles?: Float32Array;
  demZoom?: number;
}

let BASE = '';
let CTX_CORE = [0, 0, 0, 0];
let MOLA = [0, 0, 0, 0];

// ---------------------------------------------------------------- DEM tile cache
type Grid = Float32Array | null;
const tiles = new Map<string, Grid>();
const pending = new Map<string, Promise<Grid>>();
const order: string[] = [];
/** tiles containing no-data pixels (need a coarser fallback) */
const holes = new Set<string>();
const MAX_TILES = 160;

function available(z: number, x: number, y: number) {
  const n = 2 ** z;
  const w = mxToLon(x / n);
  const e = mxToLon((x + 1) / n);
  const north = myToLat(y / n);
  const s = myToLat((y + 1) / n);
  const b = z <= 8 ? MOLA : CTX_CORE;
  if (z < 3 || z > 12) return false;
  return w < b[2] && e > b[0] && s < b[3] && north > b[1];
}

let decodeCanvas: OffscreenCanvas | null = null;
let decodeCtx: OffscreenCanvasRenderingContext2D | null = null;

async function loadTile(z: number, x: number, y: number): Promise<Grid> {
  const id = `${z}/${x}/${y}`;
  if (tiles.has(id)) return tiles.get(id)!;
  if (pending.has(id)) return pending.get(id)!;
  const p = (async (): Promise<Grid> => {
    if (!available(z, x, y)) return null;
    try {
      const r = await fetch(`${BASE}/tiles/terrain/${id}.webp`);
      if (r.status !== 200) return null;
      const blob = await r.blob();
      if (!blob.size) return null;
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      decodeCanvas ??= new OffscreenCanvas(256, 256);
      decodeCtx ??= decodeCanvas.getContext('2d', { willReadFrequently: true })!;
      decodeCtx.clearRect(0, 0, 256, 256);
      decodeCtx.drawImage(bmp, 0, 0);
      bmp.close();
      const d = decodeCtx.getImageData(0, 0, 256, 256).data;
      const g = new Float32Array(256 * 256);
      let hole = false;
      for (let i = 0, j = 0; i < g.length; i++, j += 4) {
        const v = d[j] * 256 + d[j + 1] + d[j + 2] / 256 - 32768;
        // -32768 sentinel (or transparent pixel) = no data
        if (v <= -32767 || d[j + 3] === 0) {
          g[i] = NaN;
          hole = true;
        } else g[i] = v;
      }
      if (hole) holes.add(id);
      return g;
    } catch {
      return null;
    }
  })();
  pending.set(id, p);
  const g = await p;
  pending.delete(id);
  tiles.set(id, g);
  order.push(id);
  while (order.length > MAX_TILES) {
    const old = order.shift()!;
    tiles.delete(old);
    holes.delete(old);
  }
  return g;
}

/** Load every DEM tile at zoom dz covering the mercator box (± margin); recurse to coarser zooms if any is missing. */
async function prepare(dz: number, mx0: number, my0: number, mx1: number, my1: number): Promise<void> {
  const n = 2 ** dz;
  const m = 3 / (256 * n);
  const tx0 = Math.floor((mx0 - m) * n);
  const tx1 = Math.floor((mx1 + m) * n);
  const ty0 = Math.floor((my0 - m) * n);
  const ty1 = Math.floor((my1 + m) * n);
  const jobs: Promise<Grid>[] = [];
  const ids: string[] = [];
  for (let tx = tx0; tx <= tx1; tx++)
    for (let ty = ty0; ty <= ty1; ty++) {
      jobs.push(loadTile(dz, tx, ty));
      ids.push(`${dz}/${tx}/${ty}`);
    }
  const res = await Promise.all(jobs);
  if (dz > 3 && res.some((g, i) => g === null || holes.has(ids[i]))) await prepare(dz - 1, mx0, my0, mx1, my1);
}

function pixel(z: number, gx: number, gy: number): number {
  const tx = Math.floor(gx / 256);
  const ty = Math.floor(gy / 256);
  const g = tiles.get(`${z}/${tx}/${ty}`);
  if (!g) return NaN;
  return g[(gy - ty * 256) * 256 + (gx - tx * 256)];
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

/** Elevation (m) at normalised mercator (mx, my), from zoom dz (bicubic or bilinear), falling back to coarser zooms. */
function sampleDem(dz: number, mx: number, my: number, bicubic: boolean): number {
  for (let z = dz; z >= 3; z--) {
    const w = 256 * 2 ** z;
    const gx = mx * w - 0.5;
    const gy = my * w - 0.5;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    let v: number;
    if (bicubic) {
      const rows = [0, 0, 0, 0];
      let bad = false;
      for (let r = 0; r < 4 && !bad; r++) {
        const yy = iy - 1 + r;
        const a = pixel(z, ix - 1, yy), b = pixel(z, ix, yy), c = pixel(z, ix + 1, yy), d = pixel(z, ix + 2, yy);
        if (Number.isNaN(a + b + c + d)) bad = true;
        else rows[r] = cubic(a, b, c, d, fx);
      }
      v = bad ? NaN : cubic(rows[0], rows[1], rows[2], rows[3], fy);
      if (Number.isNaN(v)) {
        // bicubic footprint touches missing data: bilinear
        const a = pixel(z, ix, iy), b = pixel(z, ix + 1, iy), c = pixel(z, ix, iy + 1), d = pixel(z, ix + 1, iy + 1);
        v = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      }
    } else {
      const a = pixel(z, ix, iy), b = pixel(z, ix + 1, iy), c = pixel(z, ix, iy + 1), d = pixel(z, ix + 1, iy + 1);
      v = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    if (!Number.isNaN(v)) return v;
  }
  return -2500;
}

// ---------------------------------------------------------------- chunk builder
function build(req: BuildRequest): BuildResult {
  const { z, x, y, segs: N, exag, micro } = req;
  const n = 2 ** z;
  // DEM zoom: about one DEM pixel per grid cell, capped at the finest available (z12 ≈ 19 m/px)
  const dz = Math.min(12, z + Math.max(0, Math.round(Math.log2(256 / N))));
  const bicubic = dz < z + Math.log2(256 / N) - 0.01;
  const E = N + 3; // extended grid with a 1-vertex border for seamless normals
  const wx = new Float64Array(E * E);
  const wz = new Float64Array(E * E);
  const hb = new Float64Array(E * E); // base (DEM) world height
  for (let j = 0; j < E; j++) {
    const my = (y + (j - 1) / N) / n;
    const lat = myToLat(my);
    const zz = latToZ(lat);
    for (let i = 0; i < E; i++) {
      const mx = (x + (i - 1) / N) / n;
      const xx = lonToX(mxToLon(mx));
      const k = j * E + i;
      wx[k] = xx;
      wz[k] = zz;
      hb[k] = sampleDem(dz, mx, my, bicubic) * exag - curvatureDrop(xx, zz);
    }
  }
  // spacing (m) between grid vertices, used for slope/cavity
  const sp = Math.max(0.5, Math.abs(wx[E + 2] - wx[E + 1]));
  // synthetic micro-relief, scaled by local slope
  const h = new Float64Array(E * E);
  for (let j = 0; j < E; j++)
    for (let i = 0; i < E; i++) {
      const k = j * E + i;
      if (micro > 0) {
        const il = Math.max(0, i - 1), ir = Math.min(E - 1, i + 1);
        const jt = Math.max(0, j - 1), jb = Math.min(E - 1, j + 1);
        const gx = (hb[j * E + ir] - hb[j * E + il]) / ((ir - il) * sp);
        const gz = (hb[jb * E + i] - hb[jt * E + i]) / ((jb - jt) * sp);
        const slope = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
        h[k] = hb[k] + microRelief(wx[k], wz[k], slope, micro);
      } else h[k] = hb[k];
    }

  const V = (N + 1) * (N + 1);
  const S = 4 * (N + 1); // skirt vertices
  const positions = new Float32Array((V + S) * 3);
  const normals = new Float32Array((V + S) * 3);
  const uvs = new Float32Array((V + S) * 2);
  const ao = new Float32Array(V + S);
  const heights = new Float32Array(V);
  const ci = ((N >> 1) + 1) * E + (N >> 1) + 1;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let j = 1; j <= N + 1; j++)
    for (let i = 1; i <= N + 1; i++) {
      const v = h[j * E + i];
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
    }
  const cx = wx[ci];
  const cz = wz[ci];
  const cy = minY;
  const H = (i: number, j: number) => h[Math.min(E - 1, Math.max(0, j)) * E + Math.min(E - 1, Math.max(0, i))];
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const v = j * (N + 1) + i;
      const k = (j + 1) * E + (i + 1);
      positions[v * 3] = wx[k] - cx;
      positions[v * 3 + 1] = h[k] - cy;
      positions[v * 3 + 2] = wz[k] - cz;
      heights[v] = h[k];
      // normal = cross(B, A); A along +i (east), B along +j (south)
      const ax = wx[k + 1] - wx[k - 1], ay = h[k + 1] - h[k - 1], az = wz[k + 1] - wz[k - 1];
      const bx = wx[k + E] - wx[k - E], by = h[k + E] - h[k - E], bz = wz[k + E] - wz[k - E];
      let nx = by * az - bz * ay;
      let ny = bz * ax - bx * az;
      let nz = bx * ay - by * ax;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      normals[v * 3] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;
      uvs[v * 2] = i / N;
      uvs[v * 2 + 1] = j / N;
      // cavity / ambient occlusion: how far the vertex sits below its neighbourhood (2 radii)
      const ii = i + 1, jj = j + 1;
      let occ = 0;
      for (const r of [1, 3]) {
        const avg = (H(ii - r, jj) + H(ii + r, jj) + H(ii, jj - r) + H(ii, jj + r)) / 4;
        occ += Math.max(0, (avg - h[k]) / (sp * r)) * (r === 1 ? 1.2 : 0.8);
      }
      ao[v] = 1 - Math.min(0.55, occ * 1.6);
    }
  // skirts: duplicate the border, pushed down, to hide cracks between LOD levels
  const depth = Math.max(4, sp * 1.5 + (maxY - minY) * 0.02);
  const border: number[] = [];
  for (let i = 0; i <= N; i++) border.push(i); // north edge
  for (let j = 0; j <= N; j++) border.push(j * (N + 1) + N); // east
  for (let i = N; i >= 0; i--) border.push(N * (N + 1) + i); // south
  for (let j = N; j >= 0; j--) border.push(j * (N + 1)); // west
  border.forEach((src, s) => {
    const d = V + s;
    positions[d * 3] = positions[src * 3];
    positions[d * 3 + 1] = positions[src * 3 + 1] - depth;
    positions[d * 3 + 2] = positions[src * 3 + 2];
    normals.set(normals.subarray(src * 3, src * 3 + 3), d * 3);
    uvs[d * 2] = uvs[src * 2];
    uvs[d * 2 + 1] = uvs[src * 2 + 1];
    ao[d] = ao[src] * 0.8;
  });

  const out: BuildResult = { type: 'built', id: req.id, ok: true, center: [cx, cy, cz], positions, normals, uvs, ao, heights, minY, maxY, demZoom: dz };
  if (req.rocks > 0 && z >= 15) out.rocks = scatter(req, N, heights, normals, cx, cy, cz, false);
  if (req.pebbles > 0 && z >= 16) out.pebbles = scatter(req, N, heights, normals, cx, cy, cz, true);
  return out;
}

/** Deterministic rock / pebble placement on the chunk surface (synthetic visual detail only). */
function scatter(req: BuildRequest, N: number, heights: Float32Array, normals: Float32Array, cx: number, cy: number, cz: number, pebbles: boolean): Float32Array {
  const { z, x, y } = req;
  const n = 2 ** z;
  const seed = (z * 73856093) ^ (x * 19349663) ^ (y * 83492791) ^ (pebbles ? 0x5bd1e995 : 0);
  const rand = rng(seed);
  const mx0 = x / n;
  const my0 = y / n;
  const lon0 = mxToLon(mx0), lon1 = mxToLon((x + 1) / n);
  const widthM = Math.abs(lonToX(lon1) - lonToX(lon0));
  const cell = pebbles ? 1.5 : 4.2; // candidate spacing (m)
  const cells = Math.max(1, Math.floor(widthM / cell));
  const density = pebbles ? req.pebbles : req.rocks;
  const out: number[] = [];
  const at = (u: number, v: number) => {
    const fu = u * N, fv = v * N;
    const i = Math.min(N - 1, Math.floor(fu)), j = Math.min(N - 1, Math.floor(fv));
    const a = fu - i, b = fv - j;
    const k = j * (N + 1) + i;
    const h00 = heights[k], h10 = heights[k + 1], h01 = heights[k + N + 1], h11 = heights[k + N + 2];
    const hh = a + b <= 1 ? h00 + (h10 - h00) * a + (h01 - h00) * b : h11 + (h01 - h11) * (1 - a) + (h10 - h11) * (1 - b);
    const ny = normals[k * 3 + 1];
    return { h: hh, ny, k };
  };
  for (let cj = 0; cj < cells; cj++)
    for (let cI = 0; cI < cells; cI++) {
      const u = (cI + rand()) / cells;
      const v = (cj + rand()) / cells;
      const s = at(u, v);
      const wxp = lonToX(mxToLon(mx0 + u / n));
      const wzp = latToZ(myToLat(my0 + v / n));
      const slope = 1 - s.ny;
      // clustered fields: rocks gather in patches (talus, ejecta-like scatter), sparse elsewhere
      const cl = fbm(wxp / 160, wzp / 160, 3, pebbles ? 9 : 5);
      let p = Math.max(0, (cl - 0.36) / 0.34) * 0.6 + 0.1;
      if (slope < 0.04) p *= pebbles ? 0.9 : 0.6; // smooth floor: fewer boulders
      else if (slope < 0.5) p *= 1 + slope * 3; // talus / slope debris
      else p *= 0.35; // cliff faces
      p *= density * (pebbles ? 1.0 : 0.85);
      if (rand() > p) continue;
      // power-law size distribution: many small, few large (all below the 5 m CTX pixel)
      const r = rand();
      const size = pebbles ? 0.04 + 0.16 * r * r : Math.min(2.4, 0.16 * Math.pow(1 - r * 0.99, -1 / 1.55));
      const yaw = rand() * Math.PI * 2;
      const tx = (rand() - 0.5) * 0.5;
      const tz = (rand() - 0.5) * 0.5;
      const variant = Math.floor(hash2(cI, cj, seed) * 6);
      const tone = rand() * 0.999;
      out.push(wxp - cx, s.h - cy - size * (pebbles ? 0.25 : 0.3), wzp - cz, size, yaw, tx, tz, variant + tone);
    }
  return new Float32Array(out);
}

// ---------------------------------------------------------------- message loop
const queue: BuildRequest[] = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const req = queue.shift()!;
    try {
      const n = 2 ** req.z;
      const dz = Math.min(12, req.z + Math.max(0, Math.round(Math.log2(256 / req.segs))));
      await prepare(dz, req.x / n, req.y / n, (req.x + 1) / n, (req.y + 1) / n);
      const res = build(req);
      const transfer = [res.positions!.buffer, res.normals!.buffer, res.uvs!.buffer, res.ao!.buffer, res.heights!.buffer] as ArrayBuffer[];
      if (res.rocks) transfer.push(res.rocks.buffer as ArrayBuffer);
      if (res.pebbles) transfer.push(res.pebbles.buffer as ArrayBuffer);
      (self as unknown as Worker).postMessage(res, transfer);
    } catch (e) {
      (self as unknown as Worker).postMessage({ type: 'built', id: req.id, ok: false, error: String(e) } satisfies BuildResult);
    }
  }
  busy = false;
}

self.onmessage = (e: MessageEvent<BuildRequest | InitRequest | { type: 'cancel'; ids: number[] }>) => {
  const m = e.data;
  if (m.type === 'init') {
    BASE = m.base;
    CTX_CORE = m.ctxCore;
    MOLA = m.mola;
  } else if (m.type === 'build') {
    queue.push(m);
    void pump();
  } else if (m.type === 'cancel') {
    const s = new Set(m.ids);
    for (let i = queue.length - 1; i >= 0; i--) if (s.has(queue[i].id)) queue.splice(i, 1);
  }
};
