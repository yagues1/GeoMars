/**
 * Route ribbon for the enhanced 3D view.
 * The calculated route coordinates are used UNCHANGED: segments are only subdivided (collinear
 * points) so the ribbon can follow the displayed relief; distance/time/safety values stay those of
 * the routing engine. Vertices are draped on the displayed surface (Terrain.heightAt) and re-draped
 * when finer terrain streams in. Width is in screen pixels; vertices are pulled slightly toward the
 * camera (a depth bias that does not move them on screen) so the line never hides under the relief
 * nor z-fights with it.
 */
import * as THREE from 'three';
import type { RouteSuccess } from '../routing/astar';
import { latToZ, lonToX } from './frame';
import { shared } from './materials';

const VERT = /* glsl */ `
attribute float aSide;
attribute float aDist;
attribute vec2 aTan;
uniform float uPx;       // half width in px
uniform float uPxToM;    // metres per px at distance 1
uniform float uLift;
uniform float uMinM;     // minimum half width in metres (close-up navigation)
varying float vSide;
varying float vDist;
varying vec3 vWorld;
void main() {
  vec3 p = position;
  float d = max(distance(p, cameraPosition), 1.0);
  vec2 perp = vec2(-aTan.y, aTan.x);
  float hw = max(uPx * uPxToM * d, uMinM);
  p.xz += perp * aSide * hw;
  p.y += uLift + hw * 0.15;
  // depth bias: move along the view ray (no screen-space displacement)
  vec3 toCam = normalize(cameraPosition - p);
  p += toCam * min(d * 0.012, 80.0);
  vSide = aSide;
  vDist = aDist;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uCore; uniform vec3 uMid; uniform vec3 uCasing; uniform vec3 uDone;
uniform float uProgress; uniform float uReveal; uniform float uGlow; uniform float uOpacity;
uniform vec3 uGmFogColor; uniform float uGmFogDensity; uniform float uGmFogScaleH; uniform float uGmFogBase;
varying float vSide; varying float vDist; varying vec3 vWorld;
#include <common>
void main() {
  if (vDist > uReveal) discard;
  float a = abs(vSide);
  vec3 col;
  float alpha;
  if (uGlow > 0.5) {
    col = uMid;
    alpha = pow(1.0 - a, 2.0) * 0.55;
  } else {
    // analytic antialiasing: transitions are one screen pixel wide whatever the ribbon width
    float aa = max(fwidth(vSide) * 1.25, 0.02);
    float body = 1.0 - smoothstep(1.0 - aa, 1.0, a);
    col = mix(uCasing, uMid, 1.0 - smoothstep(0.66 - aa, 0.66 + aa, a));
    float core = max(0.3, aa * 1.5);
    col = mix(col, uCore, (1.0 - smoothstep(core - aa, core + aa, a)) * 0.8);
    alpha = body;
  }
  // travelled part is dimmed (navigation)
  if (vDist < uProgress) { col = mix(col, uDone, 0.82); alpha *= uGlow > 0.5 ? 0.15 : 0.95; }
  // reveal tip glow
  float tip = smoothstep(60.0, 0.0, uReveal - vDist) * step(uReveal, 1e8);
  col += vec3(1.0, 0.8, 0.6) * tip * 0.8;
  // light aerial perspective so far segments sit in the scene
  float dist = distance(vWorld, cameraPosition);
  float hm = 0.5 * (vWorld.y + cameraPosition.y) - uGmFogBase;
  float f = 1.0 - exp(-dist * uGmFogDensity * 0.6 * exp(-max(hm, 0.0) / uGmFogScaleH));
  col = mix(col, uGmFogColor, f);
  gl_FragColor = vec4(col, alpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Route3D {
  readonly group = new THREE.Group();
  private body: THREE.Mesh | null = null;
  private glow: THREE.Mesh | null = null;
  private points: { x: number; z: number; d: number; tx: number; tz: number }[] = [];
  private posAttr: THREE.BufferAttribute | null = null;
  private uniforms = {
    uPx: { value: 3.2 },
    uPxToM: { value: 0.001 },
    uLift: { value: 0.25 },
    uMinM: { value: 0.9 },
    uCore: { value: new THREE.Color('#ffe2c8').convertSRGBToLinear() },
    uMid: { value: new THREE.Color('#ff8b3e').convertSRGBToLinear() },
    uCasing: { value: new THREE.Color('#5a2109').convertSRGBToLinear() },
    uDone: { value: new THREE.Color('#5b4a42').convertSRGBToLinear() },
    uProgress: { value: -1 },
    uReveal: { value: 1e9 },
    uGlow: { value: 0 },
    uOpacity: { value: 1 },
    uGmFogColor: shared.uGmFogColor,
    uGmFogDensity: shared.uGmFogDensity,
    uGmFogScaleH: shared.uGmFogScaleH,
    uGmFogBase: shared.uGmFogBase,
  };
  private glowUniforms = { ...this.uniforms, uPx: { value: 9 }, uGlow: { value: 1 }, uMinM: { value: 2.4 } };
  private drapedVersion = -1;
  route: RouteSuccess | null = null;
  totalM = 0;
  private revealT0 = 0;
  private revealDur = 0;

  setRoute(route: RouteSuccess | null, animate: boolean) {
    this.clear();
    this.route = route;
    if (!route || route.coordinates.length < 2) return;
    const pts: typeof this.points = [];
    const c = route.coordinates;
    const MAX_STEP = 6; // m
    for (let i = 0; i < c.length - 1; i++) {
      const x0 = lonToX(c[i][0]), z0 = latToZ(c[i][1]);
      const x1 = lonToX(c[i + 1][0]), z1 = latToZ(c[i + 1][1]);
      const len = Math.hypot(x1 - x0, z1 - z0);
      const steps = Math.max(1, Math.ceil(len / MAX_STEP));
      const d0 = route.cumDist[i], d1 = route.cumDist[i + 1];
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        pts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, d: d0 + (d1 - d0) * t, tx: 0, tz: 0 });
      }
    }
    const last = c[c.length - 1];
    pts.push({ x: lonToX(last[0]), z: latToZ(last[1]), d: route.cumDist[route.cumDist.length - 1], tx: 0, tz: 0 });
    // tangents (smoothed over ±2 samples so joins are round, not spiky)
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      pts[i].tx = (b.x - a.x) / l;
      pts[i].tz = (b.z - a.z) / l;
    }
    this.points = pts;
    this.totalM = route.distanceM;
    // close-range width follows the travel mode: rover track vs. footpath
    const walking = route.mode === 'walking';
    this.uniforms.uMinM.value = walking ? 0.35 : 0.9;
    this.glowUniforms.uMinM.value = walking ? 0.9 : 2.4;
    const n = pts.length;
    const pos = new Float32Array(n * 2 * 3);
    const side = new Float32Array(n * 2);
    const dist = new Float32Array(n * 2);
    const tan = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    pts.forEach((p, i) => {
      for (let s = 0; s < 2; s++) {
        const v = i * 2 + s;
        pos[v * 3] = p.x;
        pos[v * 3 + 2] = p.z;
        side[v] = s ? 1 : -1;
        dist[v] = p.d;
        tan[v * 2] = p.tx;
        tan[v * 2 + 1] = p.tz;
      }
      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    });
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
    geo.setAttribute('aTan', new THREE.BufferAttribute(tan, 2));
    geo.setIndex(idx);
    const mk = (u: Record<string, THREE.IUniform>, additive: boolean) =>
      new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
    this.glow = new THREE.Mesh(geo, mk(this.glowUniforms, true));
    this.body = new THREE.Mesh(geo, mk(this.uniforms, false));
    this.glow.frustumCulled = this.body.frustumCulled = false;
    this.glow.renderOrder = 5;
    this.body.renderOrder = 6;
    this.group.add(this.glow, this.body);
    this.drapedVersion = -1;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animate && !reduce) {
      this.revealT0 = performance.now() + 250;
      this.revealDur = Math.min(2200, 1100 + (route.distanceM / 1000) * 110);
      this.uniforms.uReveal.value = 0;
    } else this.uniforms.uReveal.value = 1e9;
  }

  /** Re-drape on the displayed surface when it changed. */
  drape(heightAt: (x: number, z: number) => number, version: number) {
    if (!this.posAttr || version === this.drapedVersion) return;
    this.drapedVersion = version;
    const a = this.posAttr.array as Float32Array;
    let lastH = NaN;
    for (let i = 0; i < this.points.length; i++) {
      let h = heightAt(this.points[i].x, this.points[i].z);
      if (Number.isNaN(h)) h = Number.isNaN(lastH) ? -2500 : lastH;
      lastH = h;
      a[i * 6 + 1] = h;
      a[i * 6 + 4] = h;
    }
    this.posAttr.needsUpdate = true;
  }

  update(camera: THREE.PerspectiveCamera, viewportH: number, progressM: number) {
    this.uniforms.uPxToM.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, viewportH);
    this.uniforms.uProgress.value = progressM;
    if (this.uniforms.uReveal.value < 1e9) {
      const t = Math.min(1, Math.max(0, (performance.now() - this.revealT0) / this.revealDur));
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      this.uniforms.uReveal.value = t >= 1 ? 1e9 : e * this.totalM;
    }
  }

  isAnimating() {
    return this.uniforms.uReveal.value < 1e9;
  }

  clear() {
    for (const m of [this.body, this.glow]) {
      if (!m) continue;
      this.group.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.body?.geometry.dispose();
    this.body = this.glow = null;
    this.posAttr = null;
    this.points = [];
    this.route = null;
  }
}
