/**
 * Chunked quadtree terrain (CDLOD-style) over Web-Mercator tiles.
 *   - Roots: 4×4 z7 tiles (~650 km) around Jezero — MOLA context to the horizon.
 *   - Refinement by screen-space size (chunk width / distance > lodFactor), down to z15–z17 inside
 *     the CTX DEM footprint (z8 beyond it, where only MOLA exists).
 *   - A node is replaced by its children only once all four are ready (no holes while streaming).
 *   - Geometry is built in Web Workers; textures are composited from the local tile pyramids.
 *   - Least-recently-used chunks are disposed (geometry + textures) beyond a fixed budget.
 * heightAt() returns the height of the DISPLAYED surface (same triangulation as the mesh), used to
 * drape the route, markers and to keep the camera above ground.
 */
import * as THREE from 'three';
import { CTX_BOUNDS, DATA_BASE, MOLA_WINDOW_BOUNDS } from '../config/constants';
import type { LayerState, MapStyleId } from '../state/store';
import { latToMy, latToZ, lonToMx, lonToX, tileBounds, xToLon, zToLat } from './frame';
import { createTerrainMaterial, setOverlay } from './materials';
import { overlaySignature } from './textures';
import { TextureClient } from './textureClient';
import type { QualityPreset } from './quality';
import type { BuildRequest, BuildResult } from './terrainWorker';
import type { RockField } from './rocks';

const CTX_CORE = [CTX_BOUNDS[0] - 0.35, CTX_BOUNDS[1] - 0.35, CTX_BOUNDS[2] + 0.35, CTX_BOUNDS[3] + 0.35];
const ROOT_Z = 7;

type NodeState = 'empty' | 'loading' | 'ready';

class Node {
  key: string;
  children: Node[] | null = null;
  state: NodeState = 'empty';
  mesh: THREE.Mesh | null = null;
  heights: Float32Array | null = null;
  segs = 0;
  box = new THREE.Box3();
  sizeM: number;
  lastUsed = 0;
  displayed = false;
  overlaySig = '';
  overlayTex: THREE.Texture | null = null;
  albedoTex: THREE.Texture | null = null;
  overlayJob = 0;
  rocks?: Float32Array;
  pebbles?: Float32Array;
  center = new THREE.Vector3();
  generation = 0;
  inCtx: boolean;
  constructor(public z: number, public x: number, public y: number, public parent: Node | null) {
    this.key = `${z}/${x}/${y}`;
    const [w, s, e, n] = tileBounds(z, x, y);
    const x0 = lonToX(w), x1 = lonToX(e), z0 = latToZ(n), z1 = latToZ(s);
    const py = parent?.box ?? null;
    const y0 = py && py.min.y < py.max.y ? py.min.y : -9000;
    const y1 = py && py.min.y < py.max.y ? py.max.y : 6000;
    this.box.set(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    this.sizeM = x1 - x0;
    this.inCtx = w < CTX_BOUNDS[2] && e > CTX_BOUNDS[0] && s < CTX_BOUNDS[3] && n > CTX_BOUNDS[1];
  }
}

interface Pending {
  node: Node;
  resolve: (r: BuildResult) => void;
}

export class Terrain {
  readonly group = new THREE.Group();
  private roots: Node[] = [];
  private workers: Worker[] = [];
  private nextWorker = 0;
  private jobs = new Map<number, Pending>();
  private jobId = 1;
  private loading = new Set<Node>();
  private wanted: Node[] = [];
  private ready = new Set<Node>();
  private frame = 0;
  private displayed: Node[] = [];
  private generation = 0;
  private indexCache = new Map<number, Uint16Array | Uint32Array>();
  private maxCached = 260;
  private overlayCtx = { layers: null as LayerState | null, style: 'satellite' as MapStyleId };
  private curSig = '';
  /** dynamic LOD multiplier set by the adaptive-quality controller (≤ 1) */
  lodScale = 1;
  exaggeration = 1;
  /** GPU upload hook (renderer.initTexture) so uploads are spread over frames */
  uploader: ((t: THREE.Texture) => void) | null = null;
  private finalizeQueue: (() => void)[] = [];
  private tex = new TextureClient(2);
  stats = { displayed: 0, loading: 0, cached: 0, triangles: 0 };

  constructor(
    private q: QualityPreset,
    private anisotropy: number,
    private rocks: RockField,
  ) {
    const n = 2 ** ROOT_Z;
    const x0 = Math.floor(lonToMx(77.5) * n) - 1;
    const y0 = Math.floor(latToMy(18.45) * n) - 1;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) this.roots.push(new Node(ROOT_Z, x0 + i, y0 + j, null));
    const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
      w.postMessage({ type: 'init', base: `${window.location.origin}${DATA_BASE}`, ctxCore: CTX_CORE, mola: MOLA_WINDOW_BOUNDS });
      w.onmessage = (e: MessageEvent<BuildResult>) => {
        const p = this.jobs.get(e.data.id);
        if (!p) return;
        this.jobs.delete(e.data.id);
        p.resolve(e.data);
      };
      this.workers.push(w);
    }
  }

  setQuality(q: QualityPreset, anisotropy: number) {
    const rebuild = q.segments !== this.q.segments || q.texSize !== this.q.texSize || q.micro !== this.q.micro || q.rocks !== this.q.rocks || q.pebbles !== this.q.pebbles;
    this.q = q;
    this.anisotropy = anisotropy;
    if (rebuild) this.invalidate();
  }

  setExaggeration(ex: number) {
    if (ex === this.exaggeration) return;
    this.exaggeration = ex;
    this.invalidate();
  }

  /** Visual layers changed: re-compose overlays (and albedo if the base style changed). */
  setLayers(layers: LayerState, style: MapStyleId) {
    const styleChanged = style !== this.overlayCtx.style;
    this.overlayCtx = { layers, style };
    this.curSig = overlaySignature(layers, style);
    if (styleChanged) this.invalidate();
  }

  /** Drop every chunk (keeps workers/caches): used for quality / exaggeration / style changes. */
  invalidate() {
    this.generation++;
    const pending = this.finalizeQueue.splice(0);
    pending.forEach((f) => f());
    for (const n of [...this.ready]) this.disposeNode(n);
    for (const n of this.loading) n.state = 'empty';
    this.loading.clear();
    for (const r of this.roots) r.children = null;
    this.rocks.clear();
    this.displayed = [];
    this.wanted = [];
    this.stats = { displayed: 0, loading: 0, cached: 0, triangles: 0 };
  }

  private canSplit(n: Node) {
    if (n.inCtx) return n.z < Math.max(12, this.q.maxZoom - (this.lodScale < 0.8 ? 1 : 0));
    return n.z < 8;
  }

  private ensureChildren(n: Node) {
    if (!n.children) {
      n.children = [];
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) n.children.push(new Node(n.z + 1, n.x * 2 + i, n.y * 2 + j, n));
    }
    return n.children;
  }

  /** LOD selection for this frame + streaming requests. */
  update(camera: THREE.PerspectiveCamera, frustum: THREE.Frustum, keepRadius: number) {
    this.frame++;
    // finish at most two streamed chunks per frame: texture uploads never pile up in one frame
    for (let i = 0; i < 2 && this.finalizeQueue.length; i++) this.finalizeQueue.shift()!();
    const cam = camera.position;
    const k = this.q.lodFactor * this.lodScale * (camera.fov > 0 ? 50 / camera.fov : 1);
    const show = new Set<Node>();
    const want: { n: Node; prio: number }[] = [];
    const visit = (n: Node) => {
      const d = Math.max(1, n.box.distanceToPoint(cam));
      if (!frustum.intersectsBox(n.box) && d > keepRadius && n.z > ROOT_Z) return;
      n.lastUsed = this.frame;
      const split = this.canSplit(n) && n.sizeM / d > k;
      if (split) {
        const ch = this.ensureChildren(n);
        let allReady = true;
        for (const c of ch) {
          c.lastUsed = this.frame;
          if (c.state !== 'ready') {
            allReady = false;
            if (c.state === 'empty') want.push({ n: c, prio: c.z * 1e7 + d });
          }
        }
        if (allReady) {
          ch.forEach(visit);
          return;
        }
      }
      if (n.state === 'ready') show.add(n);
      else if (n.state === 'empty') want.push({ n, prio: n.z * 1e7 + d });
    };
    this.roots.forEach(visit);

    // update display flags
    for (const n of this.displayed) if (!show.has(n)) {
      n.displayed = false;
      if (n.mesh) n.mesh.visible = false;
    }
    let tris = 0;
    const rockKeys = new Set<string>();
    for (const n of show) {
      n.displayed = true;
      if (n.mesh) {
        n.mesh.visible = true;
        tris += (n.mesh.geometry.index?.count ?? 0) / 3;
      }
      if (n.rocks || n.pebbles) {
        rockKeys.add(n.key);
        this.rocks.add({ key: n.key, center: n.center, rocks: n.rocks, pebbles: n.pebbles, box: n.box });
      }
      if (n.overlaySig !== this.curSig) void this.refreshOverlay(n);
    }
    this.rocks.setActive(rockKeys);
    this.displayed = [...show];

    // streaming: coarse levels first, then nearest
    want.sort((a, b) => a.prio - b.prio);
    this.wanted = want.map((w) => w.n);
    for (const w of this.wanted) {
      if (this.loading.size >= this.q.concurrency) break;
      this.load(w);
    }
    this.evict();
    this.stats = { displayed: show.size, loading: this.loading.size + this.wanted.length, cached: this.ready.size, triangles: tris };
  }

  /** True when nothing visible is waiting for data. */
  isIdle() {
    return this.loading.size === 0 && this.wanted.length === 0 && this.finalizeQueue.length === 0;
  }

  private index(segs: number) {
    let idx = this.indexCache.get(segs);
    if (!idx) {
      const N = segs;
      const V = (N + 1) * (N + 1);
      const arr: number[] = [];
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
          arr.push(a, c, b, b, c, d);
        }
      // skirts (both windings: visible from either side)
      const S = 4 * (N + 1);
      for (let s = 0; s < S - 1; s++) {
        const border = (k: number) => {
          const side = Math.floor(k / (N + 1));
          const t = k % (N + 1);
          if (side === 0) return t;
          if (side === 1) return t * (N + 1) + N;
          if (side === 2) return N * (N + 1) + (N - t);
          return (N - t) * (N + 1);
        };
        if ((s + 1) % (N + 1) === 0) continue;
        const t0 = border(s), t1 = border(s + 1), s0 = V + s, s1 = V + s + 1;
        arr.push(t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0);
      }
      idx = V + S > 65535 ? new Uint32Array(arr) : new Uint16Array(arr);
      this.indexCache.set(segs, idx);
    }
    return idx.slice();
  }

  private build(n: Node): Promise<BuildResult> {
    const id = this.jobId++;
    const strength = n.z >= 15 ? this.q.micro : n.z === 14 ? this.q.micro * 0.5 : 0;
    const req: BuildRequest = {
      type: 'build', id, z: n.z, x: n.x, y: n.y, segs: this.q.segments, exag: this.exaggeration,
      micro: strength, rocks: this.q.rocks, pebbles: n.z >= this.q.maxZoom - 1 ? this.q.pebbles : 0,
    };
    return new Promise((resolve) => {
      this.jobs.set(id, { node: n, resolve });
      this.workers[this.nextWorker++ % this.workers.length].postMessage(req);
    });
  }

  private async load(n: Node) {
    n.state = 'loading';
    this.loading.add(n);
    const gen = this.generation;
    const size = this.texSize(n.z);
    const { layers, style } = this.overlayCtx;
    try {
      const [res, albedo, overlay] = await Promise.all([
        this.build(n),
        this.tex.albedo(n.z, n.x, n.y, size, style),
        layers && this.curSig ? this.tex.overlay(n.z, n.x, n.y, size, layers, style) : Promise.resolve(null),
      ]);
      if (gen !== this.generation || !res.ok || !albedo) {
        albedo?.close();
        overlay?.close();
        n.state = 'empty';
        return;
      }
      await new Promise<void>((resolve) => this.finalizeQueue.push(resolve));
      if (gen !== this.generation) {
        albedo.close();
        overlay?.close();
        n.state = 'empty';
        return;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(res.positions!, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(res.normals!, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(res.uvs!, 2));
      geo.setAttribute('aAo', new THREE.BufferAttribute(res.ao!, 1));
      geo.setIndex(new THREE.BufferAttribute(this.index(this.q.segments), 1));
      geo.computeBoundingSphere();
      const tex = this.makeTexture(albedo, true);
      const texelM = n.sizeM / this.texSize(n.z);
      const mat = createTerrainMaterial(tex, this.q.pbrTerrain, Math.min(8, Math.max(0, Math.log2(40 / texelM))));
      const mesh = new THREE.Mesh(geo, mat);
      const [cx, cy, cz] = res.center!;
      mesh.position.set(cx, cy, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      n.center.set(cx, cy, cz);
      n.mesh = mesh;
      n.albedoTex = tex;
      n.heights = res.heights!;
      n.segs = this.q.segments;
      n.rocks = res.rocks;
      n.pebbles = res.pebbles;
      n.box.min.y = res.minY! - 2;
      n.box.max.y = res.maxY! + 2;
      n.overlaySig = layers ? overlaySignature(layers, style) : '';
      if (overlay) {
        n.overlayTex = this.makeTexture(overlay, true);
        setOverlay(mat, n.overlayTex);
        this.uploader?.(n.overlayTex);
      }
      this.uploader?.(tex);
      this.group.add(mesh);
      n.state = 'ready';
      n.generation = gen;
      this.ready.add(n);
    } catch {
      n.state = 'empty';
    } finally {
      this.loading.delete(n);
    }
  }

  /** 512 px only where it is seen up close (z13–15); coarser chunks use 256 px */
  private texSize(z: number) {
    return z >= 13 && z <= 15 ? this.q.texSize : 256;
  }

  private makeTexture(img: ImageBitmap, srgb: boolean) {
    const t = new THREE.Texture(img as unknown as HTMLImageElement);
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = this.anisotropy;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.premultiplyAlpha = false;
    t.needsUpdate = true;
    // free the decoded bitmap once it lives on the GPU
    t.onUpdate = () => {
      (img as ImageBitmap).close?.();
    };
    return t;
  }

  private async refreshOverlay(n: Node) {
    const { layers, style } = this.overlayCtx;
    n.overlaySig = this.curSig;
    const job = ++n.overlayJob;
    const img = layers && this.curSig ? await this.tex.overlay(n.z, n.x, n.y, this.texSize(n.z), layers, style) : null;
    if (job !== n.overlayJob || !n.mesh) {
      img?.close();
      return;
    }
    n.overlayTex?.dispose();
    n.overlayTex = img ? this.makeTexture(img, true) : null;
    if (n.overlayTex) this.uploader?.(n.overlayTex);
    setOverlay(n.mesh.material as THREE.Material, n.overlayTex);
  }

  private disposeNode(n: Node) {
    if (n.mesh) {
      this.group.remove(n.mesh);
      n.mesh.geometry.dispose();
      (n.mesh.material as THREE.Material).dispose();
    }
    n.albedoTex?.dispose();
    n.overlayTex?.dispose();
    n.mesh = null;
    n.albedoTex = null;
    n.overlayTex = null;
    n.heights = null;
    n.rocks = undefined;
    n.pebbles = undefined;
    n.state = 'empty';
    n.displayed = false;
    this.rocks.remove(n.key);
    this.ready.delete(n);
  }

  private evict() {
    if (this.ready.size <= this.maxCached) return;
    const cands = [...this.ready].filter((n) => !n.displayed && n.z > ROOT_Z).sort((a, b) => a.lastUsed - b.lastUsed);
    let excess = this.ready.size - this.maxCached;
    for (const n of cands) {
      if (excess <= 0) break;
      if (this.frame - n.lastUsed < 2) continue;
      this.disposeNode(n);
      excess--;
    }
  }

  /** Height of the displayed surface at world (x, z); NaN if no chunk covers it yet. */
  heightAt(x: number, z: number): number {
    const lon = xToLon(x);
    const lat = zToLat(z);
    const mx = lonToMx(lon);
    const my = latToMy(lat);
    let node: Node | null = null;
    const n0 = 2 ** ROOT_Z;
    const rx = Math.floor(mx * n0), ry = Math.floor(my * n0);
    let cur = this.roots.find((r) => r.x === rx && r.y === ry) ?? null;
    while (cur) {
      if (cur.state === 'ready') node = cur;
      if (cur.displayed) break;
      if (!cur.children) break;
      const cz = cur.z + 1;
      const nn = 2 ** cz;
      const cx = Math.floor(mx * nn), cy = Math.floor(my * nn);
      cur = cur.children.find((c) => c.x === cx && c.y === cy) ?? null;
      if (cur && cur.state !== 'ready' && !cur.children) break;
    }
    if (!node || !node.heights) return NaN;
    const N = node.segs;
    const nn = 2 ** node.z;
    const fu = Math.min(N - 1e-6, Math.max(0, (mx * nn - node.x) * N));
    const fv = Math.min(N - 1e-6, Math.max(0, (my * nn - node.y) * N));
    const i = Math.floor(fu), j = Math.floor(fv);
    const a = fu - i, b = fv - j;
    const h = node.heights;
    const k = j * (N + 1) + i;
    const h00 = h[k], h10 = h[k + 1], h01 = h[k + N + 1], h11 = h[k + N + 2];
    return a + b <= 1 ? h00 + (h10 - h00) * a + (h01 - h00) * b : h11 + (h01 - h11) * (1 - a) + (h10 - h11) * (1 - b);
  }

  /** Version counter that changes whenever the displayed surface changes (for re-draping). */
  surfaceVersion() {
    let v = this.displayed.length;
    for (const n of this.displayed) v = (v * 31 + n.z * 7 + n.x + n.y * 3) | 0;
    return v;
  }

  dispose() {
    for (const n of [...this.ready]) this.disposeNode(n);
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.tex.dispose();
    this.jobs.clear();
  }
}
