/**
 * GeoMars V1.3 enhanced 3D engine (three.js).
 *
 * Scientific foundation (unchanged, from the same local NASA/USGS products as the 2D map):
 * CTX DEM 20 m + MOLA 463 m elevation, CTX 5 m orthomosaic, Viking colour, scientific layers,
 * the calculated route (coordinates, distance, time and safety untouched).
 * Synthetic visual enhancement (disclosed in the UI): micro-relief, procedural materials, rocks,
 * pebbles, lighting, sky and atmosphere. None of it is visible to the routing engine.
 *
 * MapLibre stays the source of truth for application camera commands (fitBounds, search flyTo,
 * zoom buttons…): its camera moves are mirrored here; user gestures in 3D are synced back to it.
 */
import * as THREE from 'three';
import type { Map as MlMap } from 'maplibre-gl';
import { useStore } from '../state/store';
import { positionAtTime } from '../navigation/simulator';
import { angleDelta, type LngLat } from '../geo/mars';
import { JEZERO_CENTER } from '../config/constants';
import { destinationMarkerEl, inspectMarkerEl, originMarkerEl, poiMarkerEl } from '../map/markers';
import type { Poi } from '../data/loaders';
import { latToZ, lonToX, xToLon, zToLat } from './frame';
import { OrbitCamera, type MapView } from './camera';
import { createNoiseTexture, createRockMaterial, createSky, shared, sunDir, HORIZON } from './materials';
import { QUALITY, type QualityId, type QualityPreset } from './quality';
import { RockField } from './rocks';
import { Route3D } from './route3d';
import { Terrain } from './terrain';
import { emitHover, navClock, type CameraPreset, type ImmersiveApi } from './state';

export interface EngineCallbacks {
  click: (p: LngLat) => void;
  poiClick: (p: Poi) => void;
}

const D2R = Math.PI / 180;
const tmpV = new THREE.Vector3();

// ------------------------------------------------------------------ navigation puck (3D)
function navPuck(mode: 'rover' | 'walking') {
  const g = new THREE.Group();
  const copper = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8a3d'), depthTest: false, toneMapped: false, transparent: true });
  const white = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4ea'), depthTest: false, toneMapped: false, transparent: true });
  const halo = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a2e'), depthTest: false, toneMapped: false, transparent: true, opacity: 0.22 });
  const flat = (geo: THREE.BufferGeometry) => geo.rotateX(-Math.PI / 2);
  if (mode === 'rover') {
    const shape = (s: number) => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 2.2 * s);
      sh.lineTo(1.55 * s, -1.5 * s);
      sh.lineTo(0, -0.75 * s);
      sh.lineTo(-1.55 * s, -1.5 * s);
      sh.closePath();
      return flat(new THREE.ShapeGeometry(sh));
    };
    const rim = new THREE.Mesh(shape(1.28), white);
    const body = new THREE.Mesh(shape(1), copper);
    body.position.y = 0.02;
    rim.renderOrder = 20;
    body.renderOrder = 21;
    g.add(new THREE.Mesh(flat(new THREE.CircleGeometry(3.4, 40)), halo), rim, body);
  } else {
    const beam = new THREE.Shape();
    beam.moveTo(0, 0);
    beam.absarc(0, 0, 3.2, Math.PI / 2 - 0.5, Math.PI / 2 + 0.5, false);
    beam.closePath();
    const b = new THREE.Mesh(flat(new THREE.ShapeGeometry(beam)), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc496'), depthTest: false, toneMapped: false, transparent: true, opacity: 0.35 }));
    const rim = new THREE.Mesh(flat(new THREE.CircleGeometry(0.62, 32)), white);
    const core = new THREE.Mesh(flat(new THREE.CircleGeometry(0.46, 32)), copper);
    core.position.y = 0.02;
    rim.renderOrder = 20;
    core.renderOrder = 21;
    g.add(new THREE.Mesh(flat(new THREE.CircleGeometry(1.5, 32)), halo), b, rim, core);
  }
  g.children.forEach((c) => ((c as THREE.Mesh).renderOrder ||= 19));
  return g;
}

// ------------------------------------------------------------------ HTML markers projected over the canvas
interface Mk {
  el: HTMLElement;
  lngLat: LngLat;
  world: THREE.Vector3 | null;
  kind: 'poi' | 'origin' | 'dest' | 'inspect';
  poi?: Poi;
  anchorBottom?: boolean;
}

export class Engine implements ImmersiveApi {
  readonly root: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.5, 900_000);
  private orbit: OrbitCamera;
  private terrain: Terrain;
  private rocks: RockField;
  private route = new Route3D();
  private sky: THREE.Mesh;
  private sun = new THREE.DirectionalLight(0xffffff, 3.7);
  private hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6);
  private noise: THREE.Texture;
  private overlay: HTMLDivElement;
  private markers: Mk[] = [];
  private q: QualityPreset;
  private active = false;
  private raf = 0;
  private last = 0;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private unsub: () => void;
  private map: MlMap;
  private syncing = false;
  private syncTimer = 0;
  private lastSig = '';
  private forceFrames = 2;
  private puck: THREE.Group | null = null;
  private puckMode: 'rover' | 'walking' | null = null;
  private nav = { init: false, pos: new THREE.Vector3(), look: new THREE.Vector3(), heading: 0, zoom: 1, arrivedAt: 0, fov: 50 };
  private adaptive = { level: 0, frames: 0, t0: 0, good: 0, bad: 0, fps: 0, frameMs: 0 };
  private perf = { frames: 0, t0: performance.now(), fps: 0, cpuMs: 0 };
  private ro: ResizeObserver;
  private disposed = false;
  private lastMarkerUpdate = 0;
  private shadowKey = '';

  constructor(parent: HTMLElement, map: MlMap, qualityId: QualityId, private cb: EngineCallbacks) {
    this.map = map;
    this.q = QUALITY[qualityId];
    this.root = document.createElement('div');
    this.root.className = 'gm-3d';
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', 'Enhanced 3D view of Jezero Crater, Mars');
    parent.insertBefore(this.root, parent.firstChild?.nextSibling ?? null);

    this.renderer = new THREE.WebGLRenderer({ antialias: this.q.antialias, powerPreference: 'high-performance', stencil: false, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = this.q.shadowMap > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // the sun and the terrain are static: the shadow map is re-rendered only when it changes
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(HORIZON);
    this.renderer.domElement.className = 'gm-3d-canvas';
    this.renderer.domElement.tabIndex = 0;
    this.root.appendChild(this.renderer.domElement);
    this.overlay = document.createElement('div');
    this.overlay.className = 'gm-3d-overlay';
    this.root.appendChild(this.overlay);

    const aniso = Math.min(this.q.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    this.noise = createNoiseTexture();
    shared.uGmNoise.value = this.noise;
    shared.uGmDetail.value = this.q.shaderDetail;
    this.rocks = new RockField(createRockMaterial(this.noise), Math.round(4000 * Math.max(0.5, this.q.rocks)), Math.round(5000 * Math.max(0.3, this.q.pebbles)));
    this.rocks.setShadows(this.q.rockShadows && this.q.shadowMap > 0);
    this.rocks.far = 300 + 500 * this.q.rocks;
    this.rocks.pebbleFar = 40 + 60 * this.q.pebbles;
    this.terrain = new Terrain(this.q, aniso, this.rocks);
    this.terrain.uploader = (t) => this.renderer.initTexture(t);
    this.sky = createSky();
    this.scene.add(this.sky, this.terrain.group, this.rocks.group, this.route.group);

    // lighting: one sun + sky/ground ambient (no studio lights)
    this.sun.color.setRGB(1.0, 0.9, 0.78);
    this.sun.position.copy(sunDir).multiplyScalar(10000);
    this.sun.castShadow = this.q.shadowMap > 0;
    if (this.sun.castShadow) {
      this.sun.shadow.mapSize.set(this.q.shadowMap, this.q.shadowMap);
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.radius = 3;
    }
    this.hemi.color.setRGB(0.95, 0.66, 0.46);
    this.hemi.groundColor.setRGB(0.36, 0.2, 0.12);
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.orbit = new OrbitCamera(this.camera, this.renderer.domElement, (x, z) => this.terrain.heightAt(x, z), (sx, sy) => this.pick(sx, sy), {
      click: (p) => this.cb.click([xToLon(p.x), zToLat(p.z)]),
      hover: (p) => emitHover(p ? [xToLon(p.x), zToLat(p.z)] : null),
      input: () => {
        this.forceFrames = 2;
        window.clearTimeout(this.syncTimer);
      },
    });
    this.renderer.domElement.addEventListener('wheel', this.onNavWheel, { passive: true });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.root);
    this.resize();

    map.on('move', this.onMapMove);
    this.unsub = useStore.subscribe((s, p) => {
      if (!this.active) return;
      if (s.layers !== p.layers || s.mapStyle !== p.mapStyle) this.terrain.setLayers(s.layers, s.mapStyle);
      if (s.exaggeration !== p.exaggeration) this.terrain.setExaggeration(s.exaggeration);
      if (s.route !== p.route) this.setRoute(true);
      if (s.origin !== p.origin || s.destination !== p.destination || s.inspect !== p.inspect || s.tool !== p.tool || s.appMode !== p.appMode || s.pois !== p.pois || s.selectedPoi !== p.selectedPoi) this.buildMarkers();
      if (s.appMode !== p.appMode) {
        this.overlay.classList.toggle('nav-mode', s.appMode === 'navigation');
        if (s.appMode === 'navigation') this.nav.init = false;
      }
      if (s.navStatus !== p.navStatus && s.navStatus === 'arrived') this.nav.arrivedAt = performance.now();
      this.forceFrames = 3;
    });
  }

  // ------------------------------------------------------------ API
  isActive() {
    return this.active;
  }
  isIdle() {
    return this.forceFrames <= 0 && this.terrain.isIdle() && !this.orbit.isFlying() && this.orbit.settled();
  }
  quality() {
    return this.q.id;
  }
  getView(): MapView {
    if (useStore.getState().appMode === 'navigation' && this.nav.init) return this.viewFromCamera();
    return this.orbit.getView();
  }
  setView(v: MapView) {
    this.orbit.jumpTo(v);
    this.forceFrames = 2;
  }
  mirror(v: MapView) {
    this.orbit.mirror(v);
    this.forceFrames = 2;
  }
  flyTo(center: LngLat, zoom = 13.5) {
    this.orbit.flyTo({ center, zoom }, 1800);
  }
  preset(p: CameraPreset) {
    const v = this.orbit.getView();
    if (p === 'overview') this.orbit.flyTo({ center: [JEZERO_CENTER[0] - 0.06, JEZERO_CENTER[1] - 0.05], dist: 62000, pitch: 52, bearing: v.bearing }, 2600);
    else if (p === 'terrain') this.orbit.flyTo({ center: v.center, dist: 2400, pitch: 66 }, 2000);
    else this.orbit.flyTo({ center: v.center, dist: 24, pitch: 84 }, 2200);
    this.scheduleSync(2700);
  }
  stats() {
    const info = this.renderer.info;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      quality: this.q.id,
      fps: +this.perf.fps.toFixed(1),
      cpuMsPerFrame: +this.perf.cpuMs.toFixed(2),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      chunksDisplayed: this.terrain.stats.displayed,
      chunksCached: this.terrain.stats.cached,
      chunksLoading: this.terrain.stats.loading,
      rocks: this.rocks.counts.rocks,
      pebbles: this.rocks.counts.pebbles,
      adaptiveLevel: this.adaptive.level,
      pixelRatio: +this.renderer.getPixelRatio().toFixed(2),
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    };
  }

  activate(view: MapView) {
    if (this.active) return;
    this.active = true;
    this.root.classList.add('on');
    const s = useStore.getState();
    this.terrain.setExaggeration(s.exaggeration);
    this.terrain.setLayers(s.layers, s.mapStyle);
    this.orbit.jumpTo(view);
    this.overlay.classList.toggle('nav-mode', s.appMode === 'navigation');
    this.setRoute(false);
    this.buildMarkers();
    this.nav.init = false;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Stop rendering and release every GPU resource of the scene (chunks, textures, rocks, route). */
  deactivate(): MapView {
    const v = this.getView();
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.root.classList.remove('on');
    this.terrain.invalidate();
    this.route.clear();
    this.clearMarkers();
    this.removePuck();
    this.renderer.renderLists.dispose();
    return v;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.active) this.deactivate();
    this.unsub();
    this.map.off('move', this.onMapMove);
    this.ro.disconnect();
    this.orbit.dispose();
    this.renderer.domElement.removeEventListener('wheel', this.onNavWheel);
    this.terrain.dispose();
    this.rocks.dispose();
    this.noise.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.root.remove();
  }

  /** Put MapLibre (hidden) on the current 3D camera, so 2D/3D share the same context. */
  syncMap() {
    const v = this.getView();
    this.syncing = true;
    try {
      this.map.jumpTo({ center: v.center, zoom: Math.max(0.8, Math.min(17.5, v.zoom)), pitch: Math.min(78, v.pitch), bearing: v.bearing });
    } finally {
      this.syncing = false;
    }
  }

  // ------------------------------------------------------------ internals
  private scheduleSync(ms = 350) {
    window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => {
      if (this.active && !this.orbit.interacting && !this.orbit.isFlying()) this.syncMap();
      else if (this.active) this.scheduleSync(300);
    }, ms);
  }

  private onMapMove = (e: { originalEvent?: unknown }) => {
    if (!this.active || this.syncing || e.originalEvent) return;
    if (useStore.getState().appMode === 'navigation') return;
    const c = this.map.getCenter();
    this.orbit.mirror({ center: [c.lng, c.lat], zoom: this.map.getZoom(), pitch: this.map.getPitch(), bearing: this.map.getBearing() });
    this.forceFrames = 2;
  };

  private onNavWheel = (e: WheelEvent) => {
    if (useStore.getState().appMode !== 'navigation') return;
    this.nav.zoom = Math.min(4, Math.max(0.45, this.nav.zoom * Math.exp(e.deltaY * 0.0012)));
  };

  private viewFromCamera(): MapView {
    const dir = this.camera.getWorldDirection(tmpV.clone());
    const hit = this.pick(window.innerWidth / 2, window.innerHeight / 2);
    const target = hit ?? this.camera.position.clone().addScaledVector(dir, 300);
    const dist = Math.max(10, this.camera.position.distanceTo(target));
    const pitch = Math.acos(Math.min(1, Math.max(-1, -dir.y))) / D2R;
    const bearing = Math.atan2(dir.x, -dir.z) / D2R;
    const o = { tx: target.x, ty: target.y, tz: target.z, dist, bearing, pitch: Math.min(85, pitch) };
    return this.orbit.getView(o);
  }

  private resize() {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyPixelRatio();
    this.renderer.setSize(w, h, false);
    this.forceFrames = 2;
  }

  /** Adaptive levels: 1 = coarser LOD, 2 = + 0.85× resolution & no rock shadows, 3 = + 0.75× resolution & coarser LOD. */
  private applyAdaptive() {
    const l = this.adaptive.level;
    this.terrain.lodScale = [1, 0.8, 0.8, 0.65][l];
    this.rocks.setShadows(l < 2 && this.q.rockShadows && this.q.shadowMap > 0);
    this.applyPixelRatio();
  }

  private applyPixelRatio() {
    const scale = [1, 1, 0.85, 0.75][this.adaptive.level];
    const pr = Math.min(window.devicePixelRatio || 1, this.q.maxPixelRatio) * scale;
    this.renderer.setPixelRatio(Math.max(0.5, pr));
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
  }

  /** Ray-march the displayed surface under a screen point. */
  pick(sx: number, sy: number): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = 0, prev = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < 500; i++) {
      p.copy(o).addScaledVector(d, t);
      const h = this.terrain.heightAt(p.x, p.z);
      const gap = Number.isNaN(h) ? 1e4 : p.y - h;
      if (gap < 0) {
        let a = prev, b = t;
        for (let k = 0; k < 24; k++) {
          const m = (a + b) / 2;
          p.copy(o).addScaledVector(d, m);
          const hh = this.terrain.heightAt(p.x, p.z);
          if (p.y - hh < 0) b = m;
          else a = m;
        }
        p.copy(o).addScaledVector(d, (a + b) / 2);
        return p;
      }
      prev = t;
      t += Math.min(5000, Math.max(0.25, gap * 0.5));
      if (t > 700_000) break;
    }
    return null;
  }

  private setRoute(animate: boolean) {
    const { route, appMode } = useStore.getState();
    this.route.setRoute(route, animate && appMode === 'planning');
    this.removePuck();
    this.forceFrames = 3;
  }

  private removePuck() {
    if (this.puck) {
      this.scene.remove(this.puck);
      this.puck.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (m.material as THREE.Material).dispose();
      });
    }
    this.puck = null;
    this.puckMode = null;
  }

  private clearMarkers() {
    this.markers.forEach((m) => m.el.remove());
    this.markers = [];
  }

  private buildMarkers() {
    this.clearMarkers();
    const s = useStore.getState();
    const add = (m: Omit<Mk, 'world'>) => {
      m.el.style.position = 'absolute';
      m.el.style.left = '0';
      m.el.style.top = '0';
      m.el.style.willChange = 'transform';
      this.overlay.appendChild(m.el);
      this.markers.push({ ...m, world: null });
    };
    if (s.layers.pois)
      for (const p of s.pois) {
        const el = poiMarkerEl(p.name, p.category);
        el.classList.toggle('is-selected', s.selectedPoi?.id === p.id);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.cb.poiClick(p);
        });
        add({ el, lngLat: [p.lon, p.lat], kind: 'poi', poi: p });
      }
    if (s.origin) add({ el: originMarkerEl(), lngLat: s.origin, kind: 'origin' });
    if (s.destination) add({ el: destinationMarkerEl(), lngLat: s.destination, kind: 'dest', anchorBottom: true });
    if (s.inspect && s.tool === 'explore' && s.appMode === 'planning') add({ el: inspectMarkerEl(), lngLat: s.inspect.lngLat, kind: 'inspect' });
    this.lastMarkerUpdate = 0;
  }

  private updateMarkers(now: number) {
    if (!this.markers.length) return;
    const w = this.root.clientWidth, h = this.root.clientHeight;
    const placed: [number, number, number, number][] = [];
    const nav = useStore.getState().appMode === 'navigation';
    const camPos = this.camera.position;
    const occlusionCheck = now - this.lastMarkerUpdate > 120;
    if (occlusionCheck) this.lastMarkerUpdate = now;
    // POIs: landmarks first, then nearest samples
    const order = [...this.markers].sort((a, b) => {
      const pa = a.kind !== 'poi' ? 0 : a.poi!.category === 'landmark' ? 1 : 2;
      const pb = b.kind !== 'poi' ? 0 : b.poi!.category === 'landmark' ? 1 : 2;
      return pa - pb;
    });
    for (const m of order) {
      const x = lonToX(m.lngLat[0]), z = latToZ(m.lngLat[1]);
      const gh = this.terrain.heightAt(x, z);
      if (Number.isNaN(gh)) {
        m.el.style.display = 'none';
        continue;
      }
      m.world = (m.world ?? new THREE.Vector3()).set(x, gh + (m.kind === 'poi' ? 1.5 : 0.5), z);
      const v = tmpV.copy(m.world).project(this.camera);
      const dist = m.world.distanceTo(camPos);
      const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15 && (m.kind !== 'poi' || dist < 80_000);
      if (!visible) {
        m.el.style.display = 'none';
        continue;
      }
      if (m.kind === 'poi' && occlusionCheck) {
        // hidden behind relief? sample the terrain along the line of sight
        let hidden = false;
        for (let i = 1; i < 10 && !hidden; i++) {
          const f = i / 10;
          const px = camPos.x + (m.world.x - camPos.x) * f, pz = camPos.z + (m.world.z - camPos.z) * f;
          const py = camPos.y + (m.world.y + 6 - camPos.y) * f;
          const th = this.terrain.heightAt(px, pz);
          if (!Number.isNaN(th) && th > py) hidden = true;
        }
        m.el.dataset.hidden = hidden ? '1' : '';
      }
      if (m.el.dataset.hidden === '1') {
        m.el.style.display = 'none';
        continue;
      }
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h;
      m.el.style.display = '';
      m.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, ${m.anchorBottom ? '-100%' : '-50%'})`;
      if (m.kind === 'poi') {
        const lbl = m.el.querySelector('.gm-poi-label') as HTMLElement | null;
        const lw = Math.min(136, (m.poi!.name.length || 1) * 6.6) + 6;
        const box: [number, number, number, number] = [sx + 10, sy - 9, sx + 14 + lw, sy + 9];
        const far = dist > (m.poi!.category === 'landmark' ? 70_000 : 9_000);
        const free = !nav && !far && box[2] < w - 8 && !placed.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1]);
        m.el.classList.toggle('lbl-on', free);
        m.el.dataset.side = 'right';
        if (free) placed.push(box);
        if (lbl) lbl.style.opacity = free || m.el.classList.contains('is-selected') ? '' : '0';
        m.el.style.opacity = dist > 40_000 ? String(Math.max(0.35, 1 - (dist - 40_000) / 40_000)) : '';
      }
    }
  }

  private updateNavigation(dt: number) {
    const s = useStore.getState();
    const route = s.route;
    if (!route) return false;
    const simT = navClock.get() ?? s.navSimTime;
    const p = positionAtTime(route, simT);
    const walking = route.mode === 'walking';
    const vx = lonToX(p.lngLat[0]), vz = latToZ(p.lngLat[1]);
    let vy = this.terrain.heightAt(vx, vz);
    if (Number.isNaN(vy)) vy = this.camera.position.y - 30;
    const n = this.nav;
    if (!n.init) {
      n.heading = p.heading;
      n.pos.copy(this.camera.position);
      const dir = this.camera.getWorldDirection(tmpV.clone());
      n.look.copy(this.camera.position).addScaledVector(dir, 200);
      n.fov = this.camera.fov;
      n.init = true;
    }
    n.heading = (n.heading + angleDelta(n.heading, p.heading) * (1 - Math.exp(-dt * 2.0)) + 360) % 360;
    const h = n.heading * D2R;
    const fx = Math.sin(h), fz = -Math.cos(h);
    const zf = n.zoom;
    const back = (walking ? 7.5 : 32) * zf;
    const up = (walking ? 2.9 : 10.5) * zf;
    const ahead = walking ? 26 : 42;
    const desired = new THREE.Vector3(vx - fx * back, vy + up, vz - fz * back);
    // arrival: slow cinematic orbit around the destination
    if (s.navStatus === 'arrived' && n.arrivedAt) {
      const k = Math.min(1, (performance.now() - n.arrivedAt) / 4200);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const ang = h + e * 1.9;
      const r = back * 1.25 + 14 * e;
      desired.set(vx - Math.sin(ang) * r, vy + up * 1.3 + 10 * e, vz + Math.cos(ang) * r);
    }
    // stay above the relief at the camera and between camera and vehicle
    const clear = walking ? 1.8 : 3;
    for (const f of [0, 0.35, 0.7]) {
      const qx = desired.x + (vx - desired.x) * f, qz = desired.z + (vz - desired.z) * f;
      const g = this.terrain.heightAt(qx, qz);
      if (!Number.isNaN(g)) desired.y = Math.max(desired.y, g + clear + (walking ? 0 : 2) * (1 - f));
    }
    const lx = vx + fx * ahead, lz = vz + fz * ahead;
    let lg = this.terrain.heightAt(lx, lz);
    if (Number.isNaN(lg)) lg = vy;
    const look = new THREE.Vector3(lx, Math.max(lg, vy - 4) + (walking ? 1.4 : 1.8), lz);
    if (s.navStatus === 'arrived') look.set(vx, vy + 1.5, vz);
    const kp = 1 - Math.exp(-dt * (walking ? 5 : 3.6));
    const kl = 1 - Math.exp(-dt * 6);
    n.pos.lerp(desired, kp);
    n.look.lerp(look, kl);
    this.camera.position.copy(n.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(n.look);
    const targetFov = walking ? 64 : 56;
    n.fov += (targetFov - n.fov) * (1 - Math.exp(-dt * 2));
    this.camera.fov = n.fov;
    const g = this.terrain.heightAt(this.camera.position.x, this.camera.position.z);
    const hh = Math.max(1, this.camera.position.y - (Number.isNaN(g) ? vy : g));
    this.camera.near = Math.min(10, Math.max(0.2, hh * 0.08));
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // puck
    const mode = walking ? 'walking' : 'rover';
    if (this.puckMode !== mode) {
      this.removePuck();
      this.puck = navPuck(mode);
      this.puckMode = mode;
      this.scene.add(this.puck);
    }
    const pk = this.puck!;
    const tan = p.tangent * D2R;
    // align to the local slope (sampled ±2 m)
    const e = 2;
    const hF = this.terrain.heightAt(vx + Math.sin(tan) * e, vz - Math.cos(tan) * e);
    const hB = this.terrain.heightAt(vx - Math.sin(tan) * e, vz + Math.cos(tan) * e);
    const pitch = Number.isNaN(hF + hB) ? 0 : Math.atan2(hF - hB, 2 * e);
    pk.position.set(vx, vy + 0.25, vz);
    pk.rotation.set(0, 0, 0);
    pk.rotateY(-tan);
    // follow the slope, and tilt the flat mark slightly toward the follow camera so it stays legible
    pk.rotateX(pitch + (walking ? 0.15 : 0.42));
    const dist = this.camera.position.distanceTo(pk.position);
    pk.scale.setScalar(Math.max(1, dist / (walking ? 14 : 40)));
    pk.visible = true;
    this.route.update(this.camera, this.root.clientHeight, p.distanceM);
    return true;
  }

  private fitShadow(focus: THREE.Vector3, L: number) {
    if (!this.sun.castShadow) return;
    const cam = this.sun.shadow.camera;
    const size = this.q.shadowMap;
    const texel = (2 * L) / size;
    const fwd = sunDir.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const upL = new THREE.Vector3().crossVectors(right, fwd);
    const a = focus.dot(right), b = focus.dot(upL);
    const f = focus.clone().addScaledVector(right, Math.round(a / texel) * texel - a).addScaledVector(upL, Math.round(b / texel) * texel - b);
    const back = 2 * L + 6000;
    const key = `${f.x.toFixed(1)},${f.y.toFixed(1)},${f.z.toFixed(1)},${L.toFixed(0)},${this.terrain.surfaceVersion()},${this.rocks.version}`;
    if (key !== this.shadowKey) {
      this.shadowKey = key;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.sun.position.copy(f).addScaledVector(sunDir, back);
    this.sun.target.position.copy(f);
    this.sun.target.updateMatrixWorld();
    if (cam.right !== L) {
      cam.left = -L;
      cam.right = L;
      cam.top = L;
      cam.bottom = -L;
    }
    cam.near = 1;
    cam.far = back + 2 * L + 6000;
    cam.updateProjectionMatrix();
    this.sun.shadow.normalBias = texel * 1.4;
  }

  private loop = (now: number) => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();
    const s = useStore.getState();
    const navMode = s.appMode === 'navigation' && !!s.route;
    let focus: THREE.Vector3;
    let shadowL: number;
    if (navMode && this.updateNavigation(dt)) {
      focus = this.puck ? this.puck.position.clone() : this.camera.position.clone();
      shadowL = s.route?.mode === 'walking' ? 70 : 180;
      shadowL *= this.nav.zoom;
    } else {
      if (this.nav.init) {
        // leaving navigation: continue from the follow camera pose without a jump
        this.nav.init = false;
        this.removePuck();
        this.camera.fov = 50;
        this.orbit.jumpTo(this.viewFromCamera());
      }
      if (this.camera.fov !== 50) {
        this.camera.fov = 50;
        this.camera.updateProjectionMatrix();
      }
      this.orbit.update(dt);
      const c = this.orbit.cur;
      focus = new THREE.Vector3(c.tx, c.ty, c.tz);
      shadowL = Math.min(45000, Math.max(70, Math.pow(2, Math.ceil(Math.log2(c.dist * 1.15) * 4) / 4)));
      this.route.update(this.camera, this.root.clientHeight, -1);
      if (!this.orbit.interacting && now - this.orbit.lastUserInput < 400 && now - this.orbit.lastUserInput > 300) this.scheduleSync(200);
    }
    this.sky.position.copy(this.camera.position);
    this.sky.scale.setScalar(1000);
    this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    this.terrain.update(this.camera, this.frustum, Math.min(12000, shadowL * 0.6));
    this.route.drape((x, z) => this.terrain.heightAt(x, z), this.terrain.surfaceVersion());
    this.rocks.update(this.camera, this.frustum);
    this.fitShadow(focus, shadowL);

    // render only when something changed (static scene costs no GPU)
    const e = this.camera.matrixWorld.elements;
    const sig = `${e[12].toFixed(2)},${e[13].toFixed(2)},${e[14].toFixed(2)},${e[8].toFixed(4)},${e[9].toFixed(4)},${e[10].toFixed(4)},${this.terrain.stats.displayed},${this.terrain.stats.cached},${this.terrain.surfaceVersion()}`;
    const busy = (navMode && s.navStatus === 'running') || (navMode && s.navStatus === 'arrived' && now - this.nav.arrivedAt < 4600) || this.orbit.isFlying() || this.route.isAnimating() || !this.terrain.isIdle();
    if (sig === this.lastSig && this.forceFrames <= 0 && !busy) return;
    this.lastSig = sig;
    this.forceFrames = Math.max(0, this.forceFrames - 1);
    this.updateMarkers(now);
    this.renderer.render(this.scene, this.camera);
    const cpu = performance.now() - t0;
    this.perf.cpuMs = this.perf.cpuMs * 0.9 + cpu * 0.1;
    this.perf.frames++;
    if (now - this.perf.t0 > 1000) {
      this.perf.fps = (this.perf.frames * 1000) / (now - this.perf.t0);
      this.perf.frames = 0;
      this.perf.t0 = now;
    }
    this.adapt(now, dt);
  };

  /** Adaptive quality: lower resolution / LOD on sustained low frame rates, restore when there is headroom. */
  private adapt(now: number, dt: number) {
    const a = this.adaptive;
    if (!a.t0) a.t0 = now;
    a.frames++;
    a.frameMs = a.frameMs * 0.9 + dt * 1000 * 0.1;
    if (now - a.t0 < 1500) return;
    const fps = (a.frames * 1000) / (now - a.t0);
    a.fps = fps;
    a.frames = 0;
    a.t0 = now;
    // only judge windows of continuous rendering (camera motion), not idle on-demand frames,
    // and never while chunks stream in (texture uploads are transient hitches, not sustained load)
    const streaming = !this.terrain.isIdle();
    if (fps < 12 || streaming) {
      a.good = 0;
      return;
    }
    if (fps < 30 && a.level < 3) {
      if (++a.bad >= 2) {
        a.level++;
        a.bad = 0;
        a.good = 0;
        this.applyAdaptive();
      }
    } else if (fps > 55 && a.level > 0) {
      a.bad = 0;
      if (++a.good >= 3) {
        a.level--;
        a.good = 0;
        this.applyAdaptive();
      }
    } else a.good = 0;
  }
}
