/**
 * Scene frame of the enhanced 3D renderer.
 *
 * A local metric frame centred on Jezero: x = east (m), z = south (m), y = up (m).
 * Horizontal position: equirectangular on the Mars 2000 sphere (exact at the origin latitude,
 * < 0.6 % scale error at the edge of the rendered region). Vertical: DEM elevation (Mars metres,
 * optionally exaggerated) minus the sphere's curvature drop d²/2R, so the horizon sits where it
 * would on Mars. This frame is VISUAL ONLY: routing, distances and hazards never use it.
 */
import { MARS_RADIUS_M } from '../config/constants';

export const ORIGIN_LON = 77.5;
export const ORIGIN_LAT = 18.45;
const D2R = Math.PI / 180;
const R = MARS_RADIUS_M;
const COS0 = Math.cos(ORIGIN_LAT * D2R);
const MX = R * COS0 * D2R; // metres per degree of longitude
const MZ = R * D2R; // metres per degree of latitude

export function lonToX(lon: number) {
  return (lon - ORIGIN_LON) * MX;
}
export function latToZ(lat: number) {
  return -(lat - ORIGIN_LAT) * MZ;
}
export function xToLon(x: number) {
  return ORIGIN_LON + x / MX;
}
export function zToLat(z: number) {
  return ORIGIN_LAT - z / MZ;
}
/** Curvature drop of the sphere at horizontal offset (x, z) from the frame origin. */
export function curvatureDrop(x: number, z: number) {
  return (x * x + z * z) / (2 * R);
}

// ------------------------------------------------------------------ Web-Mercator tile maths
// The tile pyramids produced by scripts/prepare_data.py use the XYZ Web-Mercator scheme applied to
// planetocentric lon/lat (as MapLibre does). Mercator coordinates here are normalised to [0, 1].
export function lonToMx(lon: number) {
  return (lon + 180) / 360;
}
export function latToMy(lat: number) {
  const s = Math.sin(lat * D2R);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
export function mxToLon(mx: number) {
  return mx * 360 - 180;
}
export function myToLat(my: number) {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) / D2R;
}

export interface TileKey {
  z: number;
  x: number;
  y: number;
}
export const tileId = (z: number, x: number, y: number) => `${z}/${x}/${y}`;

/** lon/lat bounds of a tile: [west, south, east, north]. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  return [mxToLon(x / n), myToLat((y + 1) / n), mxToLon((x + 1) / n), myToLat(y / n)];
}

/** Intersection test between a tile and a lon/lat box [w, s, e, n]. */
export function tileIntersects(z: number, x: number, y: number, b: readonly number[]) {
  const t = tileBounds(z, x, y);
  return t[0] < b[2] && t[2] > b[0] && t[1] < b[3] && t[3] > b[1];
}
export function tileInside(z: number, x: number, y: number, b: readonly number[]) {
  const t = tileBounds(z, x, y);
  return t[0] >= b[0] && t[2] <= b[2] && t[1] >= b[1] && t[3] <= b[3];
}

/** Mars metres per pixel at the given MapLibre zoom (512-px world) and latitude. */
export function metersPerPixel(zoom: number, lat: number) {
  return (2 * Math.PI * R * Math.cos(lat * D2R)) / (512 * 2 ** zoom);
}
