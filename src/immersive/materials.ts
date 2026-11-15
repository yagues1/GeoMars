/**
 * Materials of the enhanced 3D renderer (three.js MeshStandardMaterial extended via
 * onBeforeCompile, so lighting, shadows and tone mapping stay physically based):
 *   - terrain: Mars palette driven by the real imagery brightness, slope and cavity; multi-scale
 *     procedural detail (non-repeating: incommensurate scales + rotations), aeolian ripples, slope
 *     strata, gravel speckle, detail normals; draped scientific overlay; aerial-perspective fog;
 *   - rocks: instanced, triplanar noise albedo, dust settling on upward faces;
 *   - sky: static butterscotch Mars sky gradient with sun glow.
 * All of this is SYNTHETIC visual enhancement; none of it is observed data.
 */
import * as THREE from 'three';
import { fbm, ridged, valueNoise } from './noise';

// ------------------------------------------------------------------ shared uniforms
export const sunDir = new THREE.Vector3();
{
  // Afternoon sun from the west-south-west, as in the CTX imagery (illumination from the west),
  // 26° above the horizon: long, readable shadows without hiding the terrain.
  const az = (255 * Math.PI) / 180;
  const el = (26 * Math.PI) / 180;
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

export const HORIZON = new THREE.Color(0.62, 0.36, 0.2);
export const ZENITH = new THREE.Color(0.2, 0.11, 0.07);

export const shared = {
  uGmSunDir: { value: sunDir },
  uGmFogColor: { value: HORIZON.clone() },
  uGmFogSunColor: { value: new THREE.Color(1.05, 0.78, 0.52) },
  uGmFogDensity: { value: 1.15e-5 },
  uGmFogScaleH: { value: 11000 }, // Mars atmospheric scale height ≈ 11 km
  uGmFogBase: { value: -2600 },
  uGmNoise: { value: null as THREE.Texture | null },
  uGmDetail: { value: 1 },
  uGmStyle: { value: 0 }, // 0 satellite/hybrid, 1 topographic (keep hypsometric colours)
};

// ------------------------------------------------------------------ noise texture
/**
 * 256² tileable noise. R,G: gradient of a rocky height field (fbm + ridged), B: smooth fbm,
 * A: pebble/cell field. Periodic sampling (wrapped lattice) makes it tile seamlessly; the shader
 * samples it at several incommensurate scales and rotations so no repeat is visible.
 */
export function createNoiseTexture() {
  const S = 256;
  const P = 16; // lattice period
  const per = (fn: (x: number, y: number) => number) => (x: number, y: number) => {
    // periodic blend of 4 shifted copies (seamless tiling)
    const u = x / S, v = y / S;
    const a = fn(u * P, v * P), b = fn((u - 1) * P, v * P), c = fn(u * P, (v - 1) * P), d = fn((u - 1) * P, (v - 1) * P);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  const rock = per((x, y) => fbm(x, y, 4, 3) * 0.6 + ridged(x * 0.9, y * 0.9, 3, 7) * 0.4);
  const smooth = per((x, y) => fbm(x * 0.5, y * 0.5, 4, 13));
  const cells = per((x, y) => {
    // pebble field: bright cores of jittered cells
    const s = 3.2;
    const xi = Math.floor(x * s), yi = Math.floor(y * s);
    let best = 9;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const cx = xi + i + valueNoise(xi + i, yi + j, 41) * 0.9;
        const cy = yi + j + valueNoise(xi + i, yi + j, 43) * 0.9;
        best = Math.min(best, Math.hypot(x * s - cx, y * s - cy));
      }
    return 1 - Math.min(1, best);
  });
  const H = new Float32Array(S * S);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) H[y * S + x] = rock(x, y);
  const G = 40; // gradient encoding range (dH/du in texture units)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const dx = (H[y * S + ((x + 1) % S)] - H[y * S + ((x + S - 1) % S)]) * (S / 2);
      const dy = (H[((y + 1) % S) * S + x] - H[((y + S - 1) % S) * S + x]) * (S / 2);
      data[i * 4] = Math.max(0, Math.min(255, 128 + (dx / G) * 127));
      data[i * 4 + 1] = Math.max(0, Math.min(255, 128 + (dy / G) * 127));
      data[i * 4 + 2] = Math.max(0, Math.min(255, smooth(x, y) * 255));
      data[i * 4 + 3] = Math.max(0, Math.min(255, cells(x, y) * 255));
    }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ GLSL
const FOG_GLSL = /* glsl */ `
uniform vec3 uGmSunDir;
uniform vec3 uGmFogColor;
uniform vec3 uGmFogSunColor;
uniform float uGmFogDensity;
uniform float uGmFogScaleH;
uniform float uGmFogBase;
vec3 gmApplyFog(vec3 col, vec3 wp) {
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-3);
  // exponential height fog: thinner air above the crater floor (11 km scale height)
  float hm = 0.5 * (wp.y + cameraPosition.y) - uGmFogBase;
  float dens = uGmFogDensity * exp(-max(hm, 0.0) / uGmFogScaleH);
  float f = 1.0 - exp(-dist * dens);
  float sun = pow(max(dot(dir, uGmSunDir), 0.0), 7.0);
  vec3 fc = mix(uGmFogColor, uGmFogSunColor, sun * 0.8);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(l) * vec3(1.06, 0.95, 0.84), f * 0.4); // aerial desaturation
  return mix(col, fc, f);
}
`;

const TERRAIN_VERT_PARS = /* glsl */ `
attribute float aAo;
varying vec3 vGmWorld;
varying vec3 vGmNormal;
varying float vGmAo;
`;
const TERRAIN_VERT_MAIN = /* glsl */ `
vGmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vGmNormal = normalize(mat3(modelMatrix) * objectNormal);
vGmAo = aAo;
`;

const TERRAIN_FRAG_PARS = /* glsl */ `
varying vec3 vGmWorld;
varying vec3 vGmNormal;
varying float vGmAo;
uniform sampler2D uGmNoise;
uniform sampler2D uGmOverlay;
uniform float uGmOverlayOn;
uniform float uGmMeanLod;
uniform float uGmDetail;
uniform float uGmStyle;
const mat2 GM_R1 = mat2(0.8, -0.6, 0.6, 0.8);
const mat2 GM_R2 = mat2(-0.28, 0.96, -0.96, -0.28);
const mat2 GM_R3 = mat2(0.53, 0.848, -0.848, 0.53);
vec2 gmGrad(vec4 t) { return (t.rg * 2.0 - 1.0) * 40.0; }
// explicit-gradient lookup: valid inside distance branches (no implicit derivatives needed)
vec4 gmNz(mat2 R, float inv, vec2 p, vec2 dx, vec2 dy) { return textureGrad(uGmNoise, (R * p) * inv, (R * dx) * inv, (R * dy) * inv); }
const mat2 GM_I = mat2(1.0, 0.0, 0.0, 1.0);
${FOG_GLSL}
`;

const TERRAIN_FRAG_ALBEDO = /* glsl */ `
#include <map_fragment>
float gmDist = distance(vGmWorld, cameraPosition);
vec3 gmN = normalize(vGmNormal);
float gmSlope = 1.0 - clamp(gmN.y, 0.0, 1.0);
vec2 gmP = vGmWorld.xz;
float fFine = 1.0 - smoothstep(18.0, 240.0, gmDist);
float fMed = 1.0 - smoothstep(120.0, 3200.0, gmDist);
float fFar = 1.0 - smoothstep(1500.0, 42000.0, gmDist);
vec2 gmDx = dFdx(gmP), gmDy = dFdy(gmP);
vec4 t3 = gmNz(GM_R2, 1.0 / 53.0, gmP, gmDx, gmDy);
vec4 t4 = gmNz(GM_R3, 1.0 / 389.0, gmP, gmDx, gmDy);
// fine octaves are only fetched where they are visible (most of the screen is far terrain)
vec4 t2 = vec4(0.5, 0.5, 0.5, 0.0);
vec4 t1 = vec4(0.5, 0.5, 0.5, 0.0);
if (gmDist < 3200.0 && uGmDetail > 0.5) t2 = gmNz(GM_R1, 1.0 / 11.7, gmP, gmDx, gmDy);
if (gmDist < 240.0 && uGmDetail > 0.5) t1 = gmNz(GM_I, 1.0 / 2.3, gmP, gmDx, gmDy);
vec3 gmImg = diffuseColor.rgb;
vec3 gmMean = textureLod(map, vMapUv, uGmMeanLod).rgb; // ≈ 40 m neighbourhood, same on every LOD
float gL = dot(gmImg, vec3(0.2126, 0.7152, 0.0722));
float gLm = max(dot(gmMean, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
// imagery-driven context: dark ground = basaltic sand / rock, bright = dust-mantled
float gDark = 1.0 - smoothstep(0.045, 0.16, gLm);
float gRock = smoothstep(0.09, 0.40, gmSlope + (t3.b - 0.5) * 0.16 + (1.0 - vGmAo) * 0.5);
vec3 cDust = vec3(0.46, 0.215, 0.10);
vec3 cOchre = vec3(0.54, 0.31, 0.135);
vec3 cRust = vec3(0.36, 0.13, 0.055);
vec3 cBasalt = vec3(0.085, 0.066, 0.055);
vec3 cGrey = vec3(0.21, 0.165, 0.14);
vec3 pal = mix(cDust, cOchre, smoothstep(0.32, 0.72, t4.b));
pal = mix(pal, cRust, smoothstep(0.5, 0.78, t3.b) * 0.45);
pal = mix(pal, cGrey, gRock * 0.55);
pal = mix(pal, cBasalt, gDark * 0.72);
float gBright = clamp(gLm / 0.13, 0.45, 1.7);
float gDetailRatio = clamp(gL / gLm, 0.25, 2.6);
vec3 gmAlb = pal * mix(1.0, gBright, 0.55) * mix(1.0, gDetailRatio, 0.9);
gmAlb = mix(gmAlb, gmImg, 0.22);
if (uGmDetail > 0.5) {
  gmAlb *= mix(1.0, 0.8 + 0.4 * t4.b, fFar * 0.5);
  gmAlb *= mix(1.0, 0.8 + 0.4 * t3.b, fMed * 0.55);
  gmAlb *= mix(1.0, 0.74 + 0.52 * t2.b, fMed * 0.65);
  gmAlb *= mix(1.0, 0.8 + 0.4 * t1.b, fFine * 0.8);
  // patchy wind-blown dust vs darker coarse sand at metre scale
  float gPatch = smoothstep(0.55, 0.8, t2.b * 0.6 + t3.b * 0.4);
  gmAlb = mix(gmAlb, gmAlb * vec3(1.22, 1.08, 0.94), gPatch * fMed * 0.55);
  // layered outcrops on steep slopes
  float band = 0.5 + 0.5 * sin(vGmWorld.y * 0.62 + (t3.b - 0.5) * 8.0 + t4.b * 5.0);
  gmAlb *= mix(1.0, 0.78 + 0.38 * band, smoothstep(0.24, 0.55, gmSlope) * fMed * 0.75);
}
// gravel speckle: dark clasts with lighter dusty rims
float gGravel = smoothstep(0.52, 0.84, t1.a) * (1.0 - gRock * 0.4) * fFine * uGmDetail;
gmAlb = mix(gmAlb, gmAlb * vec3(0.52, 0.5, 0.5), gGravel * 0.75);
// aeolian ripples on flat dark sand
float gRipple = (1.0 - smoothstep(0.02, 0.1, gmSlope)) * smoothstep(0.25, 0.75, gDark + (t4.a - 0.5) * 0.6) * (1.0 - smoothstep(60.0, 900.0, gmDist)) * min(uGmDetail, 1.0);
vec2 gRDir = normalize(vec2(0.83, 0.56) + (vec2(t3.b, t4.b) - 0.5) * 0.7);
float gPh = dot(gmP, gRDir) * (6.2831 / 3.4) + t2.b * 6.0;
gmAlb *= 1.0 + sin(gPh) * 0.08 * gRipple;
// dust settles on gentle, up-facing ground
gmAlb = mix(gmAlb, gmAlb * vec3(1.14, 1.04, 0.94), (1.0 - gRock) * (1.0 - gDark) * 0.35);
diffuseColor.rgb = mix(gmAlb, gmImg, uGmStyle);
vec3 gmOverlayEmissive = vec3(0.0);
if (uGmOverlayOn > 0.5) {
  vec4 ov = texture2D(uGmOverlay, vMapUv);
  diffuseColor.rgb = mix(diffuseColor.rgb, ov.rgb, ov.a);
  gmOverlayEmissive = ov.rgb * ov.a * 0.28;
}
`;

const TERRAIN_FRAG_ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = clamp(mix(0.96, 0.84, gRock) - gGravel * 0.06 + (t2.b - 0.5) * 0.06, 0.6, 1.0);
`;

const TERRAIN_FRAG_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  vec2 gGr = vec2(0.0);
  if (uGmDetail > 0.5) {
    gGr += gmGrad(t1) * (0.1 / 2.3) * fFine;
    gGr += (transpose(GM_R1) * gmGrad(t2)) * (0.45 / 11.7) * fMed;
    gGr += (transpose(GM_R2) * gmGrad(t3)) * (1.6 / 53.0) * fMed;
    gGr += (transpose(GM_R3) * gmGrad(t4)) * (5.0 / 389.0) * fFar * (1.0 - fMed * 0.5);
    gGr += gRDir * cos(gPh) * (6.2831 / 3.4) * 0.05 * gRipple;
    gGr *= 1.0 + gRock * 0.9;
  }
  if (uGmDetail > 1.5 && gmDist < 60.0) {
    vec4 t0 = gmNz(GM_R3, 1.0 / 0.61, gmP, gmDx, gmDy);
    gGr += (transpose(GM_R3) * gmGrad(t0)) * (0.012 / 0.61) * (1.0 - smoothstep(6.0, 60.0, gmDist));
  }
  vec3 nW = normalize(gmN + vec3(-gGr.x, 0.0, -gGr.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
`;

const TERRAIN_FRAG_LIGHT = /* glsl */ `
#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= vGmAo;
reflectedLight.directDiffuse *= mix(1.0, vGmAo, 0.3);
`;

const FRAG_FOG_OUT = /* glsl */ `
outgoingLight = gmApplyFog(outgoingLight, vGmWorld);
#include <opaque_fragment>
`;

const EMPTY_TEX = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
EMPTY_TEX.needsUpdate = true;

/**
 * Terrain material. `pbr` = MeshStandardMaterial (GGX); otherwise MeshLambertMaterial — on very
 * rough Martian ground (roughness 0.85–0.97) the specular lobe is negligible, and Lambert costs far
 * less fragment work on integrated GPUs. Both share the same procedural surface code.
 */
export function createTerrainMaterial(map: THREE.Texture, pbr = true, meanLod = 3) {
  const m = pbr ? new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 }) : new THREE.MeshLambertMaterial({ map });
  const own = { uGmOverlay: { value: EMPTY_TEX as THREE.Texture }, uGmOverlayOn: { value: 0 }, uGmMeanLod: { value: meanLod } };
  m.userData.gm = own;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, shared, own);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${TERRAIN_VERT_MAIN}`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_FRAG_PARS}`)
      .replace('#include <map_fragment>', TERRAIN_FRAG_ALBEDO)
      .replace('#include <roughnessmap_fragment>', TERRAIN_FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', TERRAIN_FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gmOverlayEmissive;')
      .replace('#include <lights_fragment_end>', TERRAIN_FRAG_LIGHT)
      .replace('#include <opaque_fragment>', FRAG_FOG_OUT);
  };
  m.customProgramCacheKey = () => (pbr ? 'gm-terrain-pbr-v1' : 'gm-terrain-lambert-v1');
  return m;
}

export function setOverlay(m: THREE.Material, tex: THREE.Texture | null) {
  const u = m.userData.gm as { uGmOverlay: { value: THREE.Texture }; uGmOverlayOn: { value: number } };
  u.uGmOverlay.value = tex ?? EMPTY_TEX;
  u.uGmOverlayOn.value = tex ? 1 : 0;
}

// ------------------------------------------------------------------ rocks
const ROCK_VERT_PARS = /* glsl */ `
varying vec3 vGmWorld;
varying vec3 vGmNormal;
varying vec3 vGmLocal;
`;
const ROCK_VERT_MAIN = /* glsl */ `
{
  vec4 gwp = vec4(transformed, 1.0);
  vec3 gwn = objectNormal;
  #ifdef USE_INSTANCING
    gwp = instanceMatrix * gwp;
    gwn = mat3(instanceMatrix) * gwn;
  #endif
  vGmWorld = (modelMatrix * gwp).xyz;
  vGmNormal = normalize(mat3(modelMatrix) * gwn);
  vGmLocal = position * 1.7;
}
`;
const ROCK_FRAG_PARS = /* glsl */ `
varying vec3 vGmWorld;
varying vec3 vGmNormal;
varying vec3 vGmLocal;
uniform sampler2D uGmNoise;
${FOG_GLSL}
float gmTri(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  return texture2D(uGmNoise, p.yz).b * w.x + texture2D(uGmNoise, p.xz).b * w.y + texture2D(uGmNoise, p.xy).b * w.z;
}
`;
const ROCK_FRAG_ALBEDO = /* glsl */ `
#include <color_fragment>
vec3 gmRn = normalize(vGmNormal);
float gmH = gmTri(vGmLocal * 0.9, gmRn);
float gmH2 = gmTri(vGmLocal * 3.1 + 7.0, gmRn);
// mottled weathering: pits, lichen-free desert varnish-like streaks, lighter clasts
diffuseColor.rgb *= 0.62 + 0.7 * gmH + 0.3 * (gmH2 - 0.5);
diffuseColor.rgb *= 1.0 - 0.25 * smoothstep(0.62, 0.8, gmH2);
// fine wind-blown dust settles on up-facing surfaces
float gmDust = smoothstep(0.45, 0.92, gmRn.y + (gmH2 - 0.5) * 0.4);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.43, 0.2, 0.095), gmDust * 0.62);
`;
// rocks: shape comes from the faceted geometry; no screen-derivative bump (it aliases on small rocks)

export function createRockMaterial(noise: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, flatShading: false });
  m.onBeforeCompile = (s) => {
    s.uniforms.uGmNoise = { value: noise };
    Object.assign(s.uniforms, {
      uGmSunDir: shared.uGmSunDir, uGmFogColor: shared.uGmFogColor, uGmFogSunColor: shared.uGmFogSunColor,
      uGmFogDensity: shared.uGmFogDensity, uGmFogScaleH: shared.uGmFogScaleH, uGmFogBase: shared.uGmFogBase,
    });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${ROCK_VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${ROCK_VERT_MAIN}`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${ROCK_FRAG_PARS}`)
      .replace('#include <color_fragment>', ROCK_FRAG_ALBEDO)
      .replace('#include <opaque_fragment>', FRAG_FOG_OUT);
  };
  m.customProgramCacheKey = () => 'gm-rock-v2';
  return m;
}

// ------------------------------------------------------------------ sky
export function createSky() {
  const geo = new THREE.SphereGeometry(1, 48, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: shared.uGmSunDir,
      uHorizon: { value: HORIZON },
      uZenith: { value: ZENITH },
      uFog: shared.uGmFogColor,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uFog;
      varying vec3 vDir;
      #include <common>
      void main() {
        vec3 d = normalize(vDir);
        float e = d.y;
        vec3 col = mix(uHorizon * 1.08, uZenith, pow(clamp(e + 0.02, 0.0, 1.0), 0.55));
        float s = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.72, 0.46) * pow(s, 10.0) * 0.55;            // forward-scattered dust glow
        col += vec3(0.62, 0.72, 0.85) * pow(s, 160.0) * 0.9;           // bluish aureole around the sun (Mars dust optics)
        col += vec3(1.0, 0.96, 0.9) * smoothstep(0.99994, 0.99998, s) * 40.0; // sun disc (~0.35°)
        col = mix(col, uFog, smoothstep(0.01, -0.06, e));            // below horizon: haze
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  // drawn after the terrain: pixels already covered by the ground are rejected by the depth test
  mesh.renderOrder = 1000;
  return mesh;
}
