import { create } from 'zustand';
import type { LngLat } from '../geo/mars';
import type { RouteFailure, RouteSuccess } from '../routing/astar';
import type { Poi } from '../data/loaders';
import type { TerrainSample } from '../routing/client';

export type AppMode = 'planning' | 'navigation';
export type Tool = 'explore' | 'route';
export type MapStyleId = 'satellite' | 'topographic' | 'hybrid';
export type NavStatus = 'idle' | 'running' | 'paused' | 'arrived';

export interface LayerState {
  pois: boolean;
  hazard: boolean;
  slope: boolean;
  traverse: boolean;
  geology: boolean;
  themisNight: boolean;
  themisDay: boolean;
  contours: boolean;
  coverage: boolean;
  landingEllipse: boolean;
}

export interface InspectInfo {
  lngLat: LngLat;
  terrain: TerrainSample | null;
  geologyUnit: string | null;
  themisNight: number | null;
  themisDay: number | null;
  nearestPoi: { poi: Poi; distanceM: number } | null;
}

interface State {
  phase: 'intro' | 'ready';
  dataReady: boolean;
  routingReady: boolean;
  appMode: AppMode;
  tool: Tool;
  mapStyle: MapStyleId;
  view3d: boolean;
  exaggeration: 1 | 2;
  layers: LayerState;
  pois: Poi[];
  origin: LngLat | null;
  destination: LngLat | null;
  originLabel: string | null;
  destinationLabel: string | null;
  routeStatus: 'idle' | 'computing' | 'done' | 'failed';
  route: RouteSuccess | null;
  routeError: RouteFailure | null;
  navStatus: NavStatus;
  /** simulated elapsed seconds along the route (vehicle time, not wall time) */
  navSimTime: number;
  inspect: InspectInfo | null;
  selectedPoi: Poi | null;
  arrivalOpen: boolean;
  panelsHidden: boolean;
  layersOpen: boolean;
  sourcesOpen: boolean;
  toast: string | null;
  set: (p: Partial<State>) => void;
  toggleLayer: (k: keyof LayerState) => void;
  clearRoute: () => void;
  setPoint: (p: LngLat, label?: string | null) => void;
}

export const useStore = create<State>((set, get) => ({
  phase: 'intro',
  dataReady: false,
  routingReady: false,
  appMode: 'planning',
  tool: 'explore',
  mapStyle: 'satellite',
  view3d: false,
  exaggeration: 1,
  layers: {
    pois: true,
    hazard: true,
    slope: false,
    traverse: true,
    geology: false,
    themisNight: false,
    themisDay: false,
    contours: false,
    coverage: false,
    landingEllipse: false,
  },
  pois: [],
  origin: null,
  destination: null,
  originLabel: null,
  destinationLabel: null,
  routeStatus: 'idle',
  route: null,
  routeError: null,
  navStatus: 'idle',
  navSimTime: 0,
  inspect: null,
  selectedPoi: null,
  arrivalOpen: false,
  panelsHidden: false,
  layersOpen: false,
  sourcesOpen: false,
  toast: null,
  set: (p) => set(p),
  toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
  clearRoute: () =>
    set({
      origin: null,
      destination: null,
      originLabel: null,
      destinationLabel: null,
      route: null,
      routeError: null,
      routeStatus: 'idle',
      navStatus: 'idle',
      navSimTime: 0,
      arrivalOpen: false,
      appMode: 'planning',
    }),
  /** Route-mode click: first sets origin, second destination, third restarts with a new origin. */
  setPoint: (p, label = null) => {
    const s = get();
    const reset = { route: null, routeError: null, routeStatus: 'idle' as const, navStatus: 'idle' as NavStatus, navSimTime: 0 };
    if (!s.origin || (s.origin && s.destination)) {
      set({ origin: p, originLabel: label, destination: null, destinationLabel: null, ...reset });
    } else {
      set({ destination: p, destinationLabel: label, ...reset });
    }
  },
}));

// Verification hook (read/write store from the browser console / automated checks).
(globalThis as unknown as { __geomarsStore: typeof useStore }).__geomarsStore = useStore;
