import type { RouteSuccess } from '../routing/astar';
import { bearing, type LngLat } from '../geo/mars';

/** Simulation clock multiplier: 1 s of wall time = 60 s of estimated vehicle time. */
export const TIME_WARP = 60;

export interface NavPosition {
  lngLat: LngLat;
  /** index of the segment the vehicle is on */
  seg: number;
  distanceM: number;
  remainingM: number;
  remainingS: number;
  /** camera heading: looks ~120 m ahead for a calm, comfortable view */
  heading: number;
  /** local route tangent (±15 m) — the vehicle arrow's orientation */
  tangent: number;
  done: boolean;
}

/** Find segment k with cumTime[k] <= t < cumTime[k+1] (binary search). */
function segmentAtTime(cumTime: number[], t: number) {
  let lo = 0;
  let hi = cumTime.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumTime[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

function pointAtDistance(route: RouteSuccess, d: number): LngLat {
  const { cumDist, coordinates } = route;
  if (d <= 0) return coordinates[0];
  if (d >= cumDist[cumDist.length - 1]) return coordinates[coordinates.length - 1];
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
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/**
 * Vehicle state at simulated time t (s). Progress advances along the computed geometry at the
 * per-segment estimated speed, so distance travelled — not animation frames — drives the state.
 */
export function positionAtTime(route: RouteSuccess, t: number): NavPosition {
  const total = route.timeS;
  const tt = Math.min(Math.max(t, 0), total);
  const k = Math.min(segmentAtTime(route.cumTime, tt), route.coordinates.length - 2);
  const t0 = route.cumTime[k];
  const t1 = route.cumTime[k + 1];
  const f = t1 > t0 ? (tt - t0) / (t1 - t0) : 1;
  const d = route.cumDist[k] + (route.cumDist[k + 1] - route.cumDist[k]) * f;
  const pos = pointAtDistance(route, d);
  // heading looks ~120 m ahead for a stable, comfortable camera
  const ahead = pointAtDistance(route, d + 120);
  const behind = pointAtDistance(route, Math.max(0, d - 10));
  const heading = d + 1 >= route.distanceM ? bearing(behind, pos) : bearing(pos, ahead);
  const t0p = pointAtDistance(route, Math.max(0, Math.min(d, route.distanceM - 30) - 15));
  const t1p = pointAtDistance(route, Math.max(30, d) + 15);
  const tangent = bearing(t0p, t1p);
  return {
    lngLat: pos,
    seg: k,
    distanceM: d,
    remainingM: Math.max(0, route.distanceM - d),
    remainingS: Math.max(0, total - tt),
    heading,
    tangent,
    done: tt >= total,
  };
}
