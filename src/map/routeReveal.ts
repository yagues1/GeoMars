/**
 * Directional "drawing" reveal of a freshly calculated route: the line grows from origin to
 * destination along the actual geometry (distance-parameterised, so the speed is uniform along
 * curves), led by a small warm tip. Cancels cleanly on recalculation; instant with reduced motion.
 */
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { RouteSuccess } from '../routing/astar';

let raf = 0;
let finishFn: (() => void) | null = null;

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

function setLine(map: MlMap, coords: [number, number][] | null) {
  (map.getSource('route') as GeoJSONSource | undefined)?.setData(
    coords && coords.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : EMPTY,
  );
}
function setTip(map: MlMap, p: [number, number] | null) {
  (map.getSource('route_tip') as GeoJSONSource | undefined)?.setData(
    p ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } } : EMPTY,
  );
}

/** Coordinates of the route up to distance d (m), with an interpolated end point. */
export function sliceByDistance(route: RouteSuccess, d: number): [number, number][] {
  const { cumDist, coordinates } = route;
  if (d >= cumDist[cumDist.length - 1]) return coordinates;
  let lo = 0;
  let hi = cumDist.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid] <= d) lo = mid;
    else hi = mid;
  }
  const f = (d - cumDist[lo]) / Math.max(1e-9, cumDist[lo + 1] - cumDist[lo]);
  const a = coordinates[lo];
  const b = coordinates[lo + 1];
  const out = coordinates.slice(0, lo + 1);
  out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  return out;
}

// gentle start, long soft landing — reads as "drawing", never as a jump
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2) * 0.35 + (1 - (1 - t) ** 4) * 0.65;

export function cancelReveal() {
  cancelAnimationFrame(raf);
  raf = 0;
  finishFn?.();
  finishFn = null;
}

export function showRoute(map: MlMap, route: RouteSuccess | null, animate: boolean) {
  cancelAnimationFrame(raf);
  raf = 0;
  finishFn = null;
  setTip(map, null);
  if (!route) {
    setLine(map, null);
    return;
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || reduce) {
    setLine(map, route.coordinates);
    return;
  }
  const total = route.distanceM;
  const duration = Math.min(1900, 950 + (total / 1000) * 90);
  const delay = 180;
  const t0 = performance.now() + delay;
  finishFn = () => {
    setLine(map, route.coordinates);
    setTip(map, null);
  };
  setLine(map, null);
  const step = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - t0) / duration));
    const d = ease(t) * total;
    const part = sliceByDistance(route, d);
    setLine(map, part);
    setTip(map, t < 1 ? part[part.length - 1] : null);
    if (t < 1) raf = requestAnimationFrame(step);
    else {
      raf = 0;
      finishFn = null;
    }
  };
  raf = requestAnimationFrame(step);
}
