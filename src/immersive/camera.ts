/**
 * Map-like camera for the enhanced 3D view: grab-pan, rotate/tilt (right drag or Ctrl/Shift+drag,
 * two-finger touch), zoom to cursor, double-click to approach, smooth damping, terrain collision,
 * and eased "flights" between views. The state is expressed like MapLibre's camera
 * (center, zoom, pitch, bearing) so both renderers hand over the same geographic context.
 */
import * as THREE from 'three';
import { latToZ, lonToX, metersPerPixel, xToLon, zToLat } from './frame';

export interface MapView {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

const D2R = Math.PI / 180;
const MAX_DIST = 420_000;
const MIN_DIST = 2.5;
const MAX_PITCH = 88;

interface Orbit {
  tx: number;
  ty: number;
  tz: number;
  dist: number;
  bearing: number;
  pitch: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const angleLerp = (a: number, b: number, t: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

export class OrbitCamera {
  cur: Orbit = { tx: 0, ty: -2500, tz: 0, dist: 20000, bearing: 0, pitch: 55 };
  goal: Orbit = { ...this.cur };
  private flight: { from: Orbit; to: Orbit; t0: number; dur: number; arc: number } | null = null;
  /** set while the user drags / scrolls (no mirroring from MapLibre) */
  interacting = false;
  lastUserInput = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private mode: 'pan' | 'rotate' | 'touch' | null = null;
  private grab: THREE.Vector3 | null = null;
  private downAt = { x: 0, y: 0, t: 0, moved: 0 };
  private pinch = { d: 0, a: 0, cx: 0, cy: 0 };
  private disposers: (() => void)[] = [];

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private el: HTMLElement,
    private ground: (x: number, z: number) => number,
    private pick: (sx: number, sy: number) => THREE.Vector3 | null,
    private handlers: { click: (p: THREE.Vector3) => void; hover: (p: THREE.Vector3 | null) => void; input: () => void },
  ) {
    const on = <K extends keyof HTMLElementEventMap>(t: K, fn: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      el.addEventListener(t, fn as EventListener, o);
      this.disposers.push(() => el.removeEventListener(t, fn as EventListener, o));
    };
    on('pointerdown', this.onDown);
    on('pointermove', this.onMove);
    on('pointerup', this.onUp);
    on('pointercancel', this.onUp);
    on('pointerleave', () => this.handlers.hover(null));
    on('wheel', this.onWheel, { passive: false });
    on('dblclick', this.onDbl);
    on('contextmenu', (e) => e.preventDefault());
  }

  dispose() {
    this.disposers.forEach((d) => d());
  }

  // ------------------------------------------------------------ view conversion
  private focal() {
    return this.el.clientHeight / 2 / Math.tan((this.camera.fov * D2R) / 2);
  }
  toOrbit(v: MapView): Orbit {
    const tx = lonToX(v.center[0]);
    const tz = latToZ(v.center[1]);
    const g = this.ground(tx, tz);
    const dist = this.focal() * metersPerPixel(v.zoom, v.center[1]);
    return { tx, tz, ty: Number.isNaN(g) ? this.cur.ty : g, dist: Math.min(MAX_DIST, Math.max(MIN_DIST, dist)), bearing: v.bearing, pitch: Math.min(MAX_PITCH, Math.max(0, v.pitch)) };
  }
  getView(o: Orbit = this.cur): MapView {
    const lat = zToLat(o.tz);
    const mpp = o.dist / this.focal();
    const zoom = Math.log2((2 * Math.PI * 3_396_190 * Math.cos(lat * D2R)) / (512 * mpp));
    return { center: [xToLon(o.tx), lat], zoom, pitch: Math.min(85, o.pitch), bearing: ((o.bearing % 360) + 540) % 360 - 180 };
  }
  jumpTo(v: MapView) {
    this.flight = null;
    this.cur = this.toOrbit(v);
    this.goal = { ...this.cur };
  }
  /** Follow an external (MapLibre) camera animation frame by frame. */
  mirror(v: MapView) {
    this.flight = null;
    this.goal = this.toOrbit(v);
    this.cur = { ...this.goal };
  }
  flyTo(v: Partial<MapView> & { dist?: number }, durationMs = 1600) {
    const to = { ...this.goal };
    if (v.center) {
      to.tx = lonToX(v.center[0]);
      to.tz = latToZ(v.center[1]);
      const g = this.ground(to.tx, to.tz);
      if (!Number.isNaN(g)) to.ty = g;
    }
    if (v.zoom !== undefined && v.center) to.dist = this.toOrbit(v as MapView).dist;
    else if (v.zoom !== undefined) to.dist = this.toOrbit({ ...this.getView(), zoom: v.zoom }).dist;
    if (v.dist !== undefined) to.dist = v.dist;
    if (v.pitch !== undefined) to.pitch = Math.min(MAX_PITCH, v.pitch);
    if (v.bearing !== undefined) to.bearing = v.bearing;
    const travel = Math.hypot(to.tx - this.cur.tx, to.tz - this.cur.tz);
    const arc = Math.max(0, travel * 0.35 - Math.max(this.cur.dist, to.dist) * 0.5);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || durationMs <= 0) {
      this.cur = { ...to };
      this.goal = { ...to };
      this.flight = null;
      return;
    }
    this.flight = { from: { ...this.cur }, to, t0: performance.now(), dur: durationMs, arc };
    this.goal = { ...to };
  }
  isFlying() {
    return !!this.flight;
  }
  /** damping has converged on the goal */
  settled() {
    const c = this.cur, g = this.goal;
    return Math.abs(c.tx - g.tx) + Math.abs(c.tz - g.tz) < c.dist * 0.002 && Math.abs(Math.log(c.dist / g.dist)) < 0.002 && Math.abs(c.pitch - g.pitch) < 0.05 && Math.abs(((g.bearing - c.bearing + 540) % 360) - 180) < 0.05;
  }

  // ------------------------------------------------------------ per-frame
  update(dt: number) {
    if (this.flight) {
      const f = this.flight;
      const t = Math.min(1, (performance.now() - f.t0) / f.dur);
      const e = easeInOut(t);
      const lerp = (a: number, b: number) => a + (b - a) * e;
      // distance in log space plus a gentle arc for long hops ("flyTo" feel)
      const ld = Math.exp(Math.log(f.from.dist) + (Math.log(f.to.dist) - Math.log(f.from.dist)) * e) + f.arc * Math.sin(Math.PI * e);
      this.cur = { tx: lerp(f.from.tx, f.to.tx), ty: lerp(f.from.ty, f.to.ty), tz: lerp(f.from.tz, f.to.tz), dist: ld, bearing: angleLerp(f.from.bearing, f.to.bearing, e), pitch: lerp(f.from.pitch, f.to.pitch) };
      if (t >= 1) {
        this.flight = null;
        this.goal = { ...this.cur };
      }
    } else {
      // critically damped approach to the goal (cinematic smoothing of every input)
      const k = 1 - Math.exp(-dt * 11);
      const c = this.cur, g = this.goal;
      c.tx += (g.tx - c.tx) * k;
      c.tz += (g.tz - c.tz) * k;
      c.dist = Math.exp(Math.log(c.dist) + (Math.log(g.dist) - Math.log(c.dist)) * k);
      c.bearing = angleLerp(c.bearing, g.bearing, k);
      c.pitch += (g.pitch - c.pitch) * k;
    }
    // keep the orbit target on the displayed ground
    const gh = this.ground(this.cur.tx, this.cur.tz);
    if (!Number.isNaN(gh)) {
      const k = 1 - Math.exp(-dt * 6);
      this.cur.ty += (gh - this.cur.ty) * (this.flight ? 1 : k);
      this.goal.ty = this.cur.ty;
    }
    this.apply();
  }

  apply() {
    const c = this.cur;
    const b = c.bearing * D2R;
    const p = c.pitch * D2R;
    const cam = this.camera;
    cam.position.set(c.tx - Math.sin(b) * Math.sin(p) * c.dist, c.ty + Math.cos(p) * c.dist, c.tz + Math.cos(b) * Math.sin(p) * c.dist);
    cam.quaternion.setFromEuler(new THREE.Euler(-(Math.PI / 2 - p), -b, 0, 'YXZ'));
    // terrain collision: never below the surface (clearance grows with distance)
    const g = this.ground(cam.position.x, cam.position.z);
    const clearance = Math.max(1.7, c.dist * 0.03);
    if (!Number.isNaN(g) && cam.position.y < g + clearance) {
      cam.position.y = g + clearance;
      cam.lookAt(c.tx, c.ty + Math.min(1.5, c.dist * 0.05), c.tz);
    }
    // adaptive clip planes: precise depth near the ground, far horizon when high
    const h = Math.max(1, cam.position.y - (Number.isNaN(g) ? c.ty : g));
    cam.near = Math.min(60, Math.max(0.25, h * 0.08));
    cam.far = 900_000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  // ------------------------------------------------------------ input
  private rayPlane(sx: number, sy: number, planeY: number) {
    const r = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const t = (planeY - ray.ray.origin.y) / ray.ray.direction.y;
    if (!(t > 0) || t > MAX_DIST * 3) return null;
    return ray.ray.at(t, new THREE.Vector3());
  }

  private onDown = (e: PointerEvent) => {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.downAt = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    this.flight = null;
    this.interacting = true;
    this.handlers.input();
    if (this.pointers.size === 2) {
      this.mode = 'touch';
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (e.button === 2 || e.ctrlKey || e.shiftKey || e.metaKey) this.mode = 'rotate';
    else {
      this.mode = 'pan';
      this.grab = this.pick(e.clientX, e.clientY);
    }
  };

  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse') this.handlers.hover(this.pick(e.clientX, e.clientY));
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.downAt.moved += Math.abs(dx) + Math.abs(dy);
    this.lastUserInput = performance.now();
    if (this.mode === 'rotate') {
      this.goal.bearing += dx * 0.32;
      this.goal.pitch = Math.min(MAX_PITCH, Math.max(0, this.goal.pitch - dy * 0.28));
      document.body.classList.add('gm-interacting');
    } else if (this.mode === 'pan' && this.grab) {
      const p = this.rayPlane(e.clientX, e.clientY, this.grab.y);
      if (p) {
        const ox = this.grab.x - p.x;
        const oz = this.grab.z - p.z;
        this.goal.tx += ox;
        this.goal.tz += oz;
        this.cur.tx += ox;
        this.cur.tz += oz;
        this.apply();
      }
      if (this.downAt.moved > 4) document.body.classList.add('gm-interacting');
    } else if (this.mode === 'touch' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (this.pinch.d > 0) this.goal.dist = Math.min(MAX_DIST, Math.max(MIN_DIST, this.goal.dist * (this.pinch.d / d)));
      this.goal.bearing -= ((ang - this.pinch.a) * 180) / Math.PI;
      this.goal.pitch = Math.min(MAX_PITCH, Math.max(0, this.goal.pitch - (cy - this.pinch.cy) * 0.3));
      this.pinch = { d, a: ang, cx, cy };
    }
  };

  private onUp = (e: PointerEvent) => {
    const had = this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      const click = had && this.downAt.moved < 6 && performance.now() - this.downAt.t < 500 && e.button === 0 && this.mode === 'pan';
      this.mode = null;
      this.grab = null;
      this.interacting = false;
      this.lastUserInput = performance.now();
      window.setTimeout(() => document.body.classList.remove('gm-interacting'), 450);
      if (click) {
        const p = this.pick(e.clientX, e.clientY);
        if (p) this.handlers.click(p);
      }
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.flight = null;
    this.handlers.input();
    this.lastUserInput = performance.now();
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const f = Math.exp(Math.max(-0.6, Math.min(0.6, delta * 0.0016)));
    const p = this.pick(e.clientX, e.clientY);
    const nd = Math.min(MAX_DIST, Math.max(MIN_DIST, this.goal.dist * f));
    const k = 1 - nd / this.goal.dist;
    if (p && k > 0) {
      // zoom toward the cursor
      this.goal.tx += (p.x - this.goal.tx) * k;
      this.goal.tz += (p.z - this.goal.tz) * k;
    } else if (p && k < 0) {
      this.goal.tx += (p.x - this.goal.tx) * k * 0.3;
      this.goal.tz += (p.z - this.goal.tz) * k * 0.3;
    }
    this.goal.dist = nd;
  };

  private onDbl = (e: MouseEvent) => {
    const p = this.pick(e.clientX, e.clientY);
    if (!p) return;
    this.handlers.input();
    this.flyTo({ center: [xToLon(p.x), zToLat(p.z)], dist: Math.max(40, this.goal.dist * 0.35) }, 1300);
  };
}
