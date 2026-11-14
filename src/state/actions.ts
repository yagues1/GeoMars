import { useStore } from './store';
import { routing } from '../routing/client';
import { getMap } from '../map/mapRef';
import { easeInOutCubic } from '../map/easing';
import { profileFor, type TravelMode } from '../routing/vehicle';

/** Bounding box [[w, s], [e, n]] of a coordinate list. */
export function boundsOf(coords: [number, number][]): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [[w, s], [e, n]];
}

/**
 * Monotonic token of the latest route request. A result is applied only if it belongs to the
 * newest request AND the inputs (origin, destination, travel mode) are still the same — so a
 * Rover result can never overwrite a newer Walking result, or vice versa.
 */
let routeSeq = 0;

/** Map padding that keeps a fitted route clear of the floating panels. */
export function routePadding() {
  if (window.innerWidth > 820) return { top: 90, bottom: 90, left: 420, right: 100 };
  return { top: 80, bottom: Math.round(window.innerHeight * 0.5), left: 40, right: 76 };
}

export async function calculateRoute() {
  const s = useStore.getState();
  if (!s.origin || !s.destination) return;
  const req = ++routeSeq;
  const mode = s.travelMode;
  const stale = () => {
    const now = useStore.getState();
    return req !== routeSeq || now.origin !== s.origin || now.destination !== s.destination || now.travelMode !== mode;
  };
  useStore.setState({ routeStatus: 'computing', routeError: null, route: null, inspect: null });
  try {
    await routing().ready;
    const res = await routing().route(s.origin, s.destination, profileFor(mode));
    // ignore stale results: newer request, changed points or changed travel mode
    if (stale()) return;
    if (res.ok) {
      useStore.setState({ route: res, routeStatus: 'done', navStatus: 'idle', navSimTime: 0 });
      const map = getMap();
      if (map) {
        map.fitBounds(boundsOf(res.coordinates), {
          padding: routePadding(),
          maxZoom: 15,
          duration: 1500,
          easing: easeInOutCubic,
          pitch: s.view3d ? 50 : 0,
        });
      }
    } else {
      useStore.setState({ routeError: res, routeStatus: 'failed' });
    }
  } catch (e) {
    if (stale()) return;
    useStore.setState({
      routeStatus: 'failed',
      routeError: { ok: false, reason: 'no_data', message: `Routing engine error: ${String(e)}`, computeMs: 0 },
    });
  }
}

/**
 * Change the travel mode. Origin/destination are kept; any result computed under the previous
 * mobility profile is invalidated (never displayed as if it belonged to the new mode). An active
 * navigation is NOT switched mid-journey: it is stopped and the app returns to planning, where the
 * route is recomputed with the new profile and navigation must be restarted.
 */
export function setTravelMode(mode: TravelMode) {
  const s = useStore.getState();
  if (s.travelMode === mode) return;
  const hadResult = s.routeStatus !== 'idle';
  useStore.setState({
    travelMode: mode,
    route: null,
    routeError: null,
    routeStatus: 'idle',
    navStatus: 'idle',
    navSimTime: 0,
    arrivalOpen: false,
    appMode: 'planning',
  });
  routeSeq++; // any in-flight request now belongs to the old profile
  if (hadResult && s.origin && s.destination) void calculateRoute();
}

export function startNavigation() {
  const s = useStore.getState();
  if (!s.route) return;
  useStore.setState({ appMode: 'navigation', arrivalOpen: false, inspect: null, selectedPoi: null, layersOpen: false });
  window.setTimeout(() => useStore.setState({ navStatus: 'running' }), 1900);
}

export function enterNavigationPaused() {
  const s = useStore.getState();
  if (!s.route) return;
  useStore.setState({ appMode: 'navigation', arrivalOpen: false, inspect: null, selectedPoi: null, layersOpen: false });
}

export function restartNavigation() {
  useStore.setState({ navSimTime: 0, navStatus: 'running', arrivalOpen: false });
}

export function backToPlanning() {
  const s = useStore.getState();
  useStore.setState({
    appMode: 'planning',
    navStatus: s.navStatus === 'running' ? 'paused' : s.navStatus,
    arrivalOpen: false,
  });
}

/** After arrival: destination becomes the next origin. */
export function continueFromDestination() {
  const s = useStore.getState();
  if (!s.route) return;
  const end = s.route.coordinates[s.route.coordinates.length - 1];
  useStore.setState({
    appMode: 'planning',
    tool: 'route',
    origin: end,
    originLabel: s.destinationLabel,
    destination: null,
    destinationLabel: null,
    route: null,
    routeStatus: 'idle',
    routeError: null,
    navStatus: 'idle',
    navSimTime: 0,
    arrivalOpen: false,
  });
  getMap()?.easeTo({ pitch: s.view3d ? 50 : 0, zoom: 13, duration: 1400, easing: easeInOutCubic });
}

export function flyTo(lngLat: [number, number], zoom = 13.5) {
  getMap()?.flyTo({ center: lngLat, zoom, speed: 1.1, curve: 1.4, essential: true });
}
