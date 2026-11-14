import maplibregl from 'maplibre-gl';
import { useStore } from './store';
import { routing } from '../routing/client';
import { getMap } from '../map/mapRef';
import { easeInOutCubic } from '../navigation/controller';

function leftPad() {
  return window.innerWidth > 900 ? 430 : 40;
}

export async function calculateRoute() {
  const s = useStore.getState();
  if (!s.origin || !s.destination) return;
  useStore.setState({ routeStatus: 'computing', routeError: null, route: null, inspect: null });
  try {
    await routing().ready;
    const res = await routing().route(s.origin, s.destination);
    // ignore stale results if the user changed the points meanwhile
    const now = useStore.getState();
    if (now.origin !== s.origin || now.destination !== s.destination) return;
    if (res.ok) {
      useStore.setState({ route: res, routeStatus: 'done', navStatus: 'idle', navSimTime: 0 });
      const map = getMap();
      if (map) {
        const b = new maplibregl.LngLatBounds();
        res.coordinates.forEach((c) => b.extend(c));
        map.fitBounds(b, {
          padding: { top: 100, bottom: 120, left: leftPad(), right: 100 },
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
    useStore.setState({
      routeStatus: 'failed',
      routeError: { ok: false, reason: 'no_data', message: `Routing engine error: ${String(e)}`, computeMs: 0 },
    });
  }
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
