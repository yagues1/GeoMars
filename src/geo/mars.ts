import { MARS_RADIUS_M } from '../config/constants';

export type LngLat = [number, number];

const D2R = Math.PI / 180;

/** Great-circle distance on the Mars sphere (metres). Planetocentric lon/lat in degrees. */
export function marsDistance(a: LngLat, b: LngLat): number {
  const p1 = a[1] * D2R;
  const p2 = b[1] * D2R;
  const dp = p2 - p1;
  const dl = (b[0] - a[0]) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing a→b in degrees clockwise from north (sphere). */
export function bearing(a: LngLat, b: LngLat): number {
  const p1 = a[1] * D2R;
  const p2 = b[1] * D2R;
  const dl = (b[0] - a[0]) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

export function lerpLngLat(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Shortest signed angular difference b - a in degrees (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

export function formatLat(lat: number, digits = 4) {
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? 'N' : 'S'}`;
}
export function formatLon(lon: number, digits = 4) {
  return `${Math.abs(lon).toFixed(digits)}° ${lon >= 0 ? 'E' : 'W'}`;
}
export function formatCoord([lon, lat]: LngLat, digits = 4) {
  return `${formatLat(lat, digits)}, ${formatLon(lon, digits)}`;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(2)} km`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const mins = Math.round(s / 60);
  if (mins < 1) return '< 1 min';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Parse a Martian coordinate typed by the user. Accepts:
 *   "18.44, 77.45"  (lat, lon — east-positive)     "18.44N 77.45E"   "77.45E 18.44N"
 *   "18.44 N, 282.55 W" (west longitudes converted to east-positive)
 * Returns [lon, lat] planetocentric east-positive in -180..180, or null.
 */
export function parseCoordinate(input: string): LngLat | null {
  const s = input.trim().toUpperCase().replace(/°/g, ' ');
  const re = /(-?\d+(?:\.\d+)?)\s*([NSEW])?/g;
  const parts: { v: number; h?: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) parts.push({ v: parseFloat(m[1]), h: m[2] });
  if (parts.length !== 2) return null;
  let lat: number | null = null;
  let lon: number | null = null;
  for (const [i, p] of parts.entries()) {
    if (p.h === 'N' || p.h === 'S') lat = p.h === 'S' ? -Math.abs(p.v) : p.v;
    else if (p.h === 'E' || p.h === 'W') lon = p.h === 'W' ? -Math.abs(p.v) : p.v;
    else if (i === 0 && lat === null) lat = p.v;
    else lon = p.v;
  }
  if (lat === null || lon === null) return null;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}
