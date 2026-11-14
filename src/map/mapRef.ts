import type { Map as MlMap } from 'maplibre-gl';
import { MARS_RADIUS_M } from '../config/constants';

let map: MlMap | null = null;
const waiters: ((m: MlMap) => void)[] = [];

export function setMap(m: MlMap | null) {
  map = m;
  if (m) while (waiters.length) waiters.shift()!(m);
}
export function getMap() {
  return map;
}
export function withMap(fn: (m: MlMap) => void) {
  if (map) fn(map);
  else waiters.push(fn);
}

/** Mars metres per CSS pixel at the given zoom and latitude (MapLibre world = 512·2^z px). */
export function marsMetersPerPixel(zoom: number, lat: number) {
  return (2 * Math.PI * MARS_RADIUS_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}
