/**
 * Lightweight bridge between the app and the (lazily loaded) enhanced 3D engine.
 * Contains no three.js code, so the 2D bundle stays small.
 */
import type { LngLat } from '../geo/mars';
import type { MapView } from './camera';
import type { QualityId } from './quality';

export type CameraPreset = 'overview' | 'terrain' | 'ground';

export interface ImmersiveApi {
  isActive(): boolean;
  isIdle(): boolean;
  setView(v: MapView): void;
  getView(): MapView;
  mirror(v: MapView): void;
  preset(p: CameraPreset): void;
  flyTo(center: LngLat, zoom?: number): void;
  stats(): Record<string, unknown>;
  quality(): QualityId;
}

export const immersive = {
  active: false,
  api: null as ImmersiveApi | null,
};

/** Simulated navigation clock (seconds along the route); the NavigationController publishes it. */
export const navClock = { get: (): number | null => null };

type HoverFn = (p: LngLat | null) => void;
export const hoverListeners = new Set<HoverFn>();
export function emitHover(p: LngLat | null) {
  hoverListeners.forEach((fn) => fn(p));
}

/** Disclosure shown with every enhanced 3D view (and in Data & sources). */
export const ENHANCED_3D_DISCLOSURE = 'Enhanced 3D visualization — terrain based on NASA/USGS elevation data with synthetic surface detail.';
