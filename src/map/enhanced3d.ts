/**
 * Switching between the 2D MapLibre map and the enhanced 3D renderer (lazy-loaded three.js).
 * The geographic context (centre, zoom, bearing, pitch) and the application state (route,
 * endpoints, layers, navigation) are shared; nothing is recomputed when switching.
 */
import type { Map as MlMap } from 'maplibre-gl';
import { useStore } from '../state/store';
import { immersive } from '../immersive/state';
import { saveQuality } from '../immersive/quality';
import type { Engine, EngineCallbacks } from '../immersive/engine';

let engine: Engine | null = null;
let engineQuality: string | null = null;
let seq = 0;

export function webgl2Supported() {
  // ?renderer=legacy forces the V1.2 MapLibre terrain (comparison / troubleshooting)
  if (new URLSearchParams(window.location.search).get('renderer') === 'legacy') return false;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/** Activate the enhanced renderer at the current map view. Resolves false if unavailable. */
export async function enter3d(map: MlMap, mapEl: HTMLElement, cb: EngineCallbacks): Promise<boolean> {
  const my = ++seq;
  if (!webgl2Supported()) {
    useStore.setState({ render3d: 'fallback' });
    return false;
  }
  if (immersive.active) return true;
  useStore.setState({ render3d: 'loading' });
  const q = useStore.getState().quality3d;
  try {
    if (engine && engineQuality !== q) {
      engine.dispose();
      engine = null;
    }
    if (!engine) {
      const { Engine } = await import('../immersive/engine');
      if (my !== seq || !useStore.getState().view3d) {
        useStore.setState({ render3d: 'off' });
        return false;
      }
      engine = new Engine(mapEl.parentElement!, map, q, cb);
      engineQuality = q;
      (window as unknown as { __geomars3d: Engine }).__geomars3d = engine; // verification / benchmark hook
    }
  } catch (e) {
    console.error('Enhanced 3D unavailable, using MapLibre terrain', e);
    useStore.setState({ render3d: 'fallback' });
    return false;
  }
  const c = map.getCenter();
  engine.activate({ center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() });
  immersive.active = true;
  immersive.api = engine;
  mapEl.classList.add('gm-map-hidden');
  useStore.setState({ render3d: 'on' });
  return true;
}

/** Return to the 2D map at the 3D camera's geographic context; releases the 3D scene's GPU resources. */
export function exit3d(map: MlMap, mapEl: HTMLElement) {
  seq++;
  if (!engine || !immersive.active) {
    if (useStore.getState().render3d !== 'fallback') useStore.setState({ render3d: 'off' });
    return;
  }
  const v = engine.deactivate();
  immersive.active = false;
  mapEl.classList.remove('gm-map-hidden');
  map.jumpTo({ center: v.center, zoom: Math.max(0.8, Math.min(17.5, v.zoom)), pitch: Math.min(78, v.pitch), bearing: v.bearing });
  useStore.setState({ render3d: 'off' });
}

/** Re-create the renderer with a new quality preset (antialiasing and shadow maps are fixed at creation). */
export async function changeQuality(map: MlMap, mapEl: HTMLElement, cb: EngineCallbacks) {
  saveQuality(useStore.getState().quality3d);
  if (!immersive.active) return;
  engine?.syncMap();
  exit3d(map, mapEl);
  await enter3d(map, mapEl, cb);
}

export function syncMapFrom3d() {
  if (immersive.active) engine?.syncMap();
}

export function dispose3d() {
  engine?.dispose();
  engine = null;
  immersive.active = false;
  immersive.api = null;
}
