/**
 * Per-chunk textures composited from the SAME local tile pyramids the 2D map uses:
 *   - albedo: Viking MDIM2.1 colour (regional hue) with the CTX 5 m orthomosaic as luminance
 *     (Satellite/Hybrid), or the MOLA/CTX hypsometric tiles (Topographic);
 *   - overlay: scientific layers (hazard, slope, THEMIS, geology, contours, traverse, coverage,
 *     landing ellipse) rasterised in the chunk's own tile space, so they drape exactly on terrain.
 * Runs inside texture Web Workers (textureWorker.ts): decoding, compositing and vector drawing
 * never block the main thread; results are transferred as ImageBitmaps (no copy).
 */
import { CTX_BOUNDS, DATA_BASE, MOLA_WINDOW_BOUNDS, THEMIS_BOUNDS } from '../config/constants';
import { GEO_UNITS } from '../data/geology';
import type { LayerState, MapStyleId } from '../state/store';
import { latToMy, lonToMx, tileBounds } from './frame';

const WORLD = [-180, -85, 180, 85];
const VIKING_WINDOW = [63.28125, 4.21875, 91.40625, 32.34375];
const CTX_CORE = [CTX_BOUNDS[0] - 0.35, CTX_BOUNDS[1] - 0.35, CTX_BOUNDS[2] + 0.35, CTX_BOUNDS[3] + 0.35];

interface Source {
  path: string;
  ext: string;
  min: number;
  max: number;
  bounds: (z: number) => number[];
}
const SRC: Record<string, Source> = {
  globe: { path: 'globe', ext: 'jpg', min: 0, max: 8, bounds: (z) => (z <= 5 ? WORLD : VIKING_WINDOW) },
  globe_mola: { path: 'globe_mola', ext: 'jpg', min: 0, max: 5, bounds: () => WORLD },
  ortho: { path: 'ortho', ext: 'webp', min: 8, max: 14, bounds: () => CTX_BOUNDS },
  topo: { path: 'topo', ext: 'webp', min: 3, max: 13, bounds: (z) => (z <= 8 ? MOLA_WINDOW_BOUNDS : CTX_CORE) },
  hazard: { path: 'hazard', ext: 'png', min: 9, max: 12, bounds: () => CTX_BOUNDS },
  slope: { path: 'slope', ext: 'webp', min: 9, max: 12, bounds: () => CTX_BOUNDS },
  themis_day: { path: 'themis_dayir', ext: 'webp', min: 7, max: 11, bounds: () => THEMIS_BOUNDS },
  themis_night: { path: 'themis_nightir', ext: 'webp', min: 7, max: 11, bounds: () => THEMIS_BOUNDS },
};

// ------------------------------------------------------------------ image cache (LRU)
const images = new Map<string, Promise<ImageBitmap | null>>();
const MAX_IMAGES = 420;

function intersects(z: number, x: number, y: number, b: number[]) {
  const t = tileBounds(z, x, y);
  return t[0] < b[2] && t[2] > b[0] && t[1] < b[3] && t[3] > b[1];
}

function loadImage(src: Source, z: number, x: number, y: number): Promise<ImageBitmap | null> {
  const url = `${DATA_BASE}/tiles/${src.path}/${z}/${x}/${y}.${src.ext}`;
  const hit = images.get(url);
  if (hit) {
    images.delete(url);
    images.set(url, hit); // refresh LRU position
    return hit;
  }
  const p = (async () => {
    if (!intersects(z, x, y, src.bounds(z))) return null;
    try {
      const r = await fetch(url);
      if (r.status !== 200) return null;
      const b = await r.blob();
      if (!b.size) return null;
      return await createImageBitmap(b);
    } catch {
      return null;
    }
  })();
  images.set(url, p);
  if (images.size > MAX_IMAGES) images.delete(images.keys().next().value!);
  return p;
}

interface Placed {
  img: ImageBitmap;
  sx: number;
  sy: number;
  sw: number;
  dx: number;
  dy: number;
  dw: number;
}

/** Fetch the tiles of a raster source covering node z/x/y at about `size` px, without drawing. */
async function gather(src: Source, z: number, x: number, y: number, size: number): Promise<Placed[]> {
  let dz = Math.round(z + Math.log2(size / 256));
  dz = Math.max(src.min, Math.min(src.max, dz));
  const out: Placed[] = [];
  if (dz >= z) {
    const k = 2 ** (dz - z);
    if (k > 8) return out; // never assemble more than 64 tiles for one chunk
    const jobs: Promise<void>[] = [];
    for (let j = 0; j < k; j++)
      for (let i = 0; i < k; i++)
        jobs.push(
          loadImage(src, dz, x * k + i, y * k + j).then((img) => {
            if (img) out.push({ img, sx: 0, sy: 0, sw: img.width, dx: (i * size) / k, dy: (j * size) / k, dw: size / k });
          }),
        );
    await Promise.all(jobs);
  } else {
    const f = 2 ** (z - dz);
    const ax = Math.floor(x / f);
    const ay = Math.floor(y / f);
    const img = await loadImage(src, dz, ax, ay);
    if (img) {
      const sw = img.width / f;
      out.push({ img, sx: (x - ax * f) * sw, sy: (y - ay * f) * sw, sw, dx: 0, dy: 0, dw: size });
    }
  }
  return out;
}

function draw(ctx: Ctx, parts: Placed[]) {
  // 0.5 px overdraw hides seams between neighbouring tiles
  for (const p of parts) ctx.drawImage(p.img, p.sx, p.sy, p.sw, p.sw, p.dx - 0.25, p.dy - 0.25, p.dw + 0.5, p.dw + 0.5);
}

type Ctx = OffscreenCanvasRenderingContext2D;
let scratch: OffscreenCanvas | null = null;
function canvas(size: number) {
  scratch ??= new OffscreenCanvas(size, size);
  if (scratch.width !== size) {
    scratch.width = size;
    scratch.height = size;
  }
  const ctx = scratch.getContext('2d')!;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { cv: scratch, ctx };
}

/** Albedo of a node. Returns an ImageBitmap (caller owns it). */
export async function composeAlbedo(z: number, x: number, y: number, size: number, style: MapStyleId): Promise<ImageBitmap> {
  if (style === 'topographic') {
    const [base, topo] = await Promise.all([gather(SRC.globe_mola, z, x, y, size), gather(SRC.topo, z, x, y, size)]);
    const { cv, ctx } = canvas(size);
    ctx.fillStyle = '#7a5a46';
    ctx.fillRect(0, 0, size, size);
    draw(ctx, base);
    draw(ctx, topo);
    return cv.transferToImageBitmap();
  }
  const inCtx = intersects(z, x, y, CTX_BOUNDS) && z >= 7;
  const [base, ortho] = await Promise.all([gather(SRC.globe, z, x, y, size), inCtx ? gather(SRC.ortho, z, x, y, size) : Promise.resolve([])]);
  const { cv, ctx } = canvas(size);
  ctx.fillStyle = '#8a5a3e';
  ctx.fillRect(0, 0, size, size);
  draw(ctx, base);
  if (ortho.length) {
    // CTX (grayscale, 5 m) provides the luminance; Viking provides the regional colour
    ctx.globalCompositeOperation = 'luminosity';
    draw(ctx, ortho);
    ctx.globalCompositeOperation = 'source-over';
  }
  return cv.transferToImageBitmap();
}

// ------------------------------------------------------------------ vector data for overlays
type Ring = number[][];
interface VFeature {
  bbox: [number, number, number, number];
  rings: Ring[]; // polygons: rings; lines: each line as a "ring"
  props: Record<string, unknown>;
  poly: boolean;
}
const vectors = new Map<string, Promise<VFeature[]>>();

function loadVector(name: string): Promise<VFeature[]> {
  let p = vectors.get(name);
  if (p) return p;
  p = fetch(`${DATA_BASE}/vector/${name}.geojson`)
    .then((r) => r.json())
    .then((gj: { type: string; features?: { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }[]; geometry?: unknown }) => {
      const feats = gj.type === 'FeatureCollection' ? gj.features! : [gj as never];
      const out: VFeature[] = [];
      for (const f of feats) {
        if (!f.geometry) continue;
        const g = f.geometry;
        let rings: Ring[] = [];
        let poly = false;
        if (g.type === 'Polygon') {
          rings = g.coordinates as Ring[];
          poly = true;
        } else if (g.type === 'MultiPolygon') {
          rings = (g.coordinates as Ring[][]).flat();
          poly = true;
        } else if (g.type === 'LineString') rings = [g.coordinates as Ring];
        else if (g.type === 'MultiLineString') rings = g.coordinates as Ring[];
        else continue;
        const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const r of rings)
          for (const c of r) {
            if (c[0] < bbox[0]) bbox[0] = c[0];
            if (c[1] < bbox[1]) bbox[1] = c[1];
            if (c[0] > bbox[2]) bbox[2] = c[0];
            if (c[1] > bbox[3]) bbox[3] = c[1];
          }
        out.push({ bbox, rings, props: f.properties ?? {}, poly });
      }
      return out;
    })
    .catch(() => []);
  vectors.set(name, p);
  return p;
}

function project(z: number, x: number, y: number, size: number) {
  const n = 2 ** z;
  return (lon: number, lat: number): [number, number] => [(lonToMx(lon) * n - x) * size, (latToMy(lat) * n - y) * size];
}

function pathOf(ctx: Ctx, f: VFeature, pr: (lon: number, lat: number) => [number, number], minSeg: number) {
  ctx.beginPath();
  for (const r of f.rings) {
    let lx = Infinity, ly = Infinity;
    r.forEach((c, i) => {
      const [px, py] = pr(c[0], c[1]);
      if (i === 0) ctx.moveTo(px, py);
      else if (Math.abs(px - lx) + Math.abs(py - ly) >= minSeg || i === r.length - 1) ctx.lineTo(px, py);
      else return;
      lx = px;
      ly = py;
    });
    if (f.poly) ctx.closePath();
  }
}

const OVERLAY_KEYS: (keyof LayerState)[] = ['hazard', 'slope', 'themisNight', 'themisDay', 'geology', 'contours', 'traverse', 'coverage', 'landingEllipse'];
export function overlaySignature(layers: LayerState, style: MapStyleId) {
  const on = OVERLAY_KEYS.filter((k) => layers[k]);
  if (style === 'topographic') on.push('contours');
  return [...new Set(on)].join(',');
}

/** Scientific overlay of a node, or null when no draped layer is active or none touches the node. */
export async function composeOverlay(z: number, x: number, y: number, size: number, layers: LayerState, style: MapStyleId): Promise<ImageBitmap | null> {
  const sig = overlaySignature(layers, style);
  if (!sig) return null;
  const on = new Set(sig.split(','));
  const [w, s, e, n] = tileBounds(z, x, y);
  const active = ['slope', 'geology', 'themisNight', 'themisDay'].filter((k) => on.has(k)).length;
  const f = active <= 1 ? 1 : active === 2 ? 0.78 : 0.62; // same legibility rule as the 2D map
  const rasters: [Source, number][] = [];
  if (on.has('themisDay')) rasters.push([SRC.themis_day, 0.72 * f]);
  if (on.has('themisNight')) rasters.push([SRC.themis_night, 0.72 * f]);
  const late: [Source, number][] = [];
  if (on.has('slope')) late.push([SRC.slope, 0.8 * f]);
  if (on.has('hazard')) late.push([SRC.hazard, 0.6]);
  const vnames = ['geology', 'geology_boundary', 'contours', 'traverse', 'landing_ellipse'];
  const wantV: Record<string, boolean> = {
    geology: on.has('geology'),
    geology_boundary: on.has('geology'),
    contours: on.has('contours'),
    traverse: on.has('traverse'),
    landing_ellipse: on.has('landingEllipse'),
  };
  const [rParts, lParts, vecs] = await Promise.all([
    Promise.all(rasters.map(([src]) => gather(src, z, x, y, size))),
    Promise.all(late.map(([src]) => gather(src, z, x, y, size))),
    Promise.all(vnames.map((v) => (wantV[v] ? loadVector(v) : Promise.resolve([] as VFeature[])))),
  ]);
  const touches = (b: number[]) => b[0] < e && b[2] > w && b[1] < n && b[3] > s;
  const any = rParts.some((p) => p.length) || lParts.some((p) => p.length) || vecs.some((v) => v.some((ft) => touches(ft.bbox))) || (on.has('coverage') && touches(CTX_BOUNDS));
  if (!any) return null;
  const { cv, ctx } = canvas(size);
  ctx.clearRect(0, 0, size, size);
  const pr = project(z, x, y, size);
  const lw = size / 512; // ≈ constant on-screen width: chunk size follows distance (LOD)
  rParts.forEach((parts, i) => {
    ctx.globalAlpha = rasters[i][1];
    draw(ctx, parts);
  });
  ctx.globalAlpha = 1;
  const [geo, geoB, contours, traverse, ellipse] = vecs;
  if (geo.length) {
    for (const ft of geo) {
      if (!touches(ft.bbox)) continue;
      const unit = String(ft.props.unit ?? '');
      pathOf(ctx, ft, pr, 0.6);
      ctx.globalAlpha = 0.42 * f;
      ctx.fillStyle = GEO_UNITS[unit as keyof typeof GEO_UNITS]?.color ?? '#888888';
      ctx.fill('evenodd');
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = '#1a0f0a';
      ctx.lineWidth = 0.8 * lw;
      ctx.stroke();
    }
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#f3d9c0';
    ctx.lineWidth = 1.4 * lw;
    ctx.setLineDash([4 * lw, 3 * lw]);
    for (const ft of geoB) if (touches(ft.bbox)) (pathOf(ctx, ft, pr, 0.6), ctx.stroke());
    ctx.setLineDash([]);
  }
  lParts.forEach((parts, i) => {
    ctx.globalAlpha = late[i][1];
    draw(ctx, parts);
  });
  if (contours.length) {
    for (const ft of contours) {
      if (!touches(ft.bbox)) continue;
      const major = !!ft.props.major;
      ctx.globalAlpha = major ? 0.7 : 0.38;
      ctx.strokeStyle = major ? '#ffe7cf' : '#f6d2b0';
      ctx.lineWidth = (major ? 1.6 : 0.9) * lw;
      pathOf(ctx, ft, pr, 0.8);
      ctx.stroke();
    }
  }
  if (on.has('coverage') && touches(CTX_BOUNDS)) {
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#ff9d5c';
    ctx.lineWidth = 2 * lw;
    ctx.setLineDash([6 * lw, 4 * lw]);
    const [a, b] = pr(CTX_BOUNDS[0], CTX_BOUNDS[3]);
    const [c, d] = pr(CTX_BOUNDS[2], CTX_BOUNDS[1]);
    ctx.strokeRect(a, b, c - a, d - b);
    ctx.setLineDash([]);
  }
  if (ellipse.length) {
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = '#fff1e3';
    ctx.lineWidth = 2 * lw;
    for (const ft of ellipse) if (touches(ft.bbox)) (pathOf(ctx, ft, pr, 0.5), ctx.stroke());
  }
  if (traverse.length) {
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#e9f4ff';
    ctx.lineWidth = Math.max(1, 2 * lw);
    ctx.setLineDash([2 * lw, 3 * lw]);
    ctx.lineCap = 'round';
    for (const ft of traverse) if (touches(ft.bbox)) (pathOf(ctx, ft, pr, 0.5), ctx.stroke());
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
  return createImageBitmap(cv, { premultiplyAlpha: 'none' });
}
