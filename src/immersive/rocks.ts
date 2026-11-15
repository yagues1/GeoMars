/**
 * Procedural rock system (SYNTHETIC visual detail — never an obstacle for routing).
 * Six angular rock shapes (noise-displaced icosahedra cut by random planes, flattened), each in a
 * high (near) and low (far) version, plus a tiny pebble mesh. All instances of all visible chunks
 * are merged into one InstancedMesh per shape/LOD: ~13 draw calls regardless of rock count.
 * Instances are re-selected (distance + frustum culled) only when the camera moved noticeably.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm, rng } from './noise';

const VARIANTS = 6;

function rockGeometry(seed: number, detail: number) {
  const base = new THREE.IcosahedronGeometry(1, detail);
  const g = mergeVertices(base.deleteAttribute('normal').deleteAttribute('uv'));
  base.dispose();
  const r = rng(seed * 7919 + 13);
  const planes: { n: THREE.Vector3; d: number }[] = [];
  const cuts = 4 + Math.floor(r() * 4);
  for (let i = 0; i < cuts; i++) {
    const n = new THREE.Vector3(r() * 2 - 1, r() * 1.6 - 0.4, r() * 2 - 1).normalize();
    planes.push({ n, d: 0.62 + r() * 0.3 });
  }
  // flat-ish base: rocks rest on the ground
  planes.push({ n: new THREE.Vector3(0, -1, 0), d: 0.45 + r() * 0.2 });
  const sx = 0.8 + r() * 0.5, sy = 0.5 + r() * 0.35, sz = 0.75 + r() * 0.45;
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm(v.x * 1.7 + seed * 3.1, v.z * 1.7 + v.y * 1.3, 3, seed);
    v.multiplyScalar(0.82 + n * 0.42);
    for (const pl of planes) {
      const dist = v.dot(pl.n) - pl.d;
      if (dist > 0) v.addScaledVector(pl.n, -dist * 0.92);
    }
    v.set(v.x * sx, v.y * sy, v.z * sz);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  // faceted (flat) normals: fractured, angular basalt-like blocks rather than smooth pebbles
  const faceted = g.toNonIndexed();
  g.dispose();
  faceted.computeVertexNormals();
  faceted.computeBoundingSphere();
  return faceted;
}

export interface RockChunk {
  key: string;
  /** chunk centre in world space */
  center: THREE.Vector3;
  rocks?: Float32Array;
  pebbles?: Float32Array;
  box: THREE.Box3;
}

const TONES = [
  new THREE.Color(0.2, 0.15, 0.125), // dark basalt
  new THREE.Color(0.33, 0.2, 0.13), // weathered red-brown
  new THREE.Color(0.27, 0.23, 0.2), // muted grey
  new THREE.Color(0.4, 0.24, 0.14), // rust
];

export class RockField {
  readonly group = new THREE.Group();
  private hi: THREE.InstancedMesh[] = [];
  private lo: THREE.InstancedMesh[] = [];
  private pebble: THREE.InstancedMesh;
  private chunks = new Map<string, RockChunk>();
  private dirty = true;
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  private lastQuat = new THREE.Quaternion();
  private capacity: number;
  private pebbleCap: number;
  counts = { rocks: 0, pebbles: 0 };
  /** increments whenever the instance set changes (shadow map invalidation) */
  version = 0;
  private lastHash = 0;
  /** distances (m): high detail / max rock / max pebble */
  near = 40;
  far = 900;
  pebbleFar = 90;

  constructor(material: THREE.Material, capacity = 6000, pebbleCap = 6000) {
    this.capacity = capacity;
    this.pebbleCap = pebbleCap;
    for (let i = 0; i < VARIANTS; i++) {
      const hi = new THREE.InstancedMesh(rockGeometry(i + 1, 2), material, Math.ceil(capacity / 3));
      const lo = new THREE.InstancedMesh(rockGeometry(i + 1, 1), material, Math.ceil(capacity / 2));
      for (const m of [hi, lo]) {
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = true;
        m.receiveShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.setColorAt(0, TONES[0]);
        this.group.add(m);
      }
      this.hi.push(hi);
      this.lo.push(lo);
    }
    this.pebble = new THREE.InstancedMesh(rockGeometry(99, 0), material, pebbleCap);
    this.pebble.count = 0;
    this.pebble.frustumCulled = false;
    this.pebble.receiveShadow = true;
    this.pebble.setColorAt(0, TONES[0]);
    this.group.add(this.pebble);
  }

  setShadows(on: boolean) {
    for (const m of [...this.hi, ...this.lo]) m.castShadow = on;
  }

  add(c: RockChunk) {
    this.chunks.set(c.key, c);
    this.dirty = true;
  }
  remove(key: string) {
    if (this.chunks.delete(key)) this.dirty = true;
  }
  setActive(keys: Set<string>) {
    // rocks only for currently displayed chunks
    for (const k of [...this.chunks.keys()]) if (!keys.has(k)) this.chunks.delete(k);
  }
  markDirty() {
    this.dirty = true;
  }

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();

  update(camera: THREE.PerspectiveCamera, frustum: THREE.Frustum) {
    const moved = camera.position.distanceTo(this.lastCam);
    const turned = 1 - Math.abs(camera.quaternion.dot(this.lastQuat));
    if (!this.dirty && moved < Math.max(2, this.near * 0.08) && turned < 0.0015) return;
    this.dirty = false;
    this.lastCam.copy(camera.position);
    this.lastQuat.copy(camera.quaternion);
    const counts = new Array(VARIANTS * 2).fill(0);
    let pc = 0;
    const cam = camera.position;
    const capHi = this.hi[0].instanceMatrix.count;
    const capLo = this.lo[0].instanceMatrix.count;
    let hash = 0;
    for (const ch of this.chunks.values()) {
      if (!frustum.intersectsBox(ch.box)) continue;
      const dBox = ch.box.distanceToPoint(cam);
      if (ch.rocks && dBox < this.far) {
        const a = ch.rocks;
        for (let i = 0; i < a.length; i += 8) {
          this.p.set(a[i] + ch.center.x, a[i + 1] + ch.center.y, a[i + 2] + ch.center.z);
          const size = a[i + 3];
          const d = this.p.distanceTo(cam);
          // screen-size culling: a rock is drawn only while it covers a few pixels
          if (d > this.far * Math.min(1, 0.06 + size * 0.32)) continue;
          const variant = Math.floor(a[i + 7]);
          const tone = a[i + 7] - variant;
          const near = d < this.near * (0.5 + size * 0.5);
          const slot = near ? variant : VARIANTS + variant;
          const mesh = near ? this.hi[variant] : this.lo[variant];
          const cap = near ? capHi : capLo;
          if (counts[slot] >= cap) continue;
          this.e.set(a[i + 5], a[i + 4], a[i + 6]);
          this.q.setFromEuler(this.e);
          this.s.setScalar(size);
          this.m.compose(this.p, this.q, this.s);
          mesh.setMatrixAt(counts[slot], this.m);
          const t0 = TONES[Math.floor(tone * TONES.length) % TONES.length];
          this.c.copy(t0).multiplyScalar(0.85 + ((tone * 7.31) % 1) * 0.3);
          mesh.setColorAt(counts[slot], this.c);
          counts[slot]++;
          hash = (hash * 31 + i * 7 + slot) | 0;
        }
      }
      if (ch.pebbles && dBox < this.pebbleFar) {
        const a = ch.pebbles;
        for (let i = 0; i < a.length && pc < this.pebbleCap; i += 8) {
          this.p.set(a[i] + ch.center.x, a[i + 1] + ch.center.y, a[i + 2] + ch.center.z);
          const d = this.p.distanceTo(cam);
          if (d > this.pebbleFar) continue;
          this.e.set(a[i + 5], a[i + 4], a[i + 6]);
          this.q.setFromEuler(this.e);
          this.s.setScalar(a[i + 3]);
          this.m.compose(this.p, this.q, this.s);
          this.pebble.setMatrixAt(pc, this.m);
          const tone = a[i + 7] % 1;
          this.c.copy(TONES[Math.floor(tone * TONES.length) % TONES.length]).multiplyScalar(0.9 + tone * 0.25);
          this.pebble.setColorAt(pc, this.c);
          pc++;
          hash = (hash * 17 + i) | 0;
        }
      }
    }
    let total = 0;
    for (let v = 0; v < VARIANTS; v++) {
      for (const [mesh, n] of [[this.hi[v], counts[v]], [this.lo[v], counts[VARIANTS + v]]] as const) {
        mesh.count = n;
        mesh.visible = n > 0;
        total += n;
        if (n) {
          mesh.instanceMatrix.clearUpdateRanges();
          mesh.instanceMatrix.addUpdateRange(0, n * 16);
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) {
            mesh.instanceColor.clearUpdateRanges();
            mesh.instanceColor.addUpdateRange(0, n * 3);
            mesh.instanceColor.needsUpdate = true;
          }
        }
      }
    }
    this.pebble.count = pc;
    this.pebble.visible = pc > 0;
    if (pc) {
      this.pebble.instanceMatrix.needsUpdate = true;
      if (this.pebble.instanceColor) this.pebble.instanceColor.needsUpdate = true;
    }
    if (hash !== this.lastHash) this.version++; // shadow map only re-renders if the set changed
    this.lastHash = hash;
    this.counts = { rocks: total, pebbles: pc };
    void this.capacity;
  }

  clear() {
    this.chunks.clear();
    this.dirty = true;
    for (const m of [...this.hi, ...this.lo, this.pebble]) {
      m.count = 0;
      m.visible = false;
    }
  }

  dispose() {
    for (const m of [...this.hi, ...this.lo, this.pebble]) {
      m.geometry.dispose();
      m.dispose();
    }
  }
}
