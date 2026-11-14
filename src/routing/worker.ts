/// <reference lib="webworker" />
/**
 * Background worker owning the routing grid. Keeps the 5.6 M-cell graph and A* search off the
 * React/map thread. Messages: init → ready, route → result, inspect → terrain sample.
 */
import { computeRoute, lngLatToCell, prepareGrid, elevationAt, type PreparedGrid } from './astar';
import { ROVER_PROFILE, type MobilityProfile } from './vehicle';
import { MARS_GRAVITY } from '../config/constants';

interface GridMeta {
  width: number;
  height: number;
  lon0_center: number;
  lat0_center: number;
  dlon: number;
  dlat: number;
  radius_m: number;
  elev_nodata: number;
  slope_scale: number;
}

let grid: PreparedGrid | null = null;
let loading: Promise<void> | null = null;

async function load(base: string) {
  const [meta, e, s] = await Promise.all([
    fetch(`${base}/grids/routing.json`).then((r) => r.json() as Promise<GridMeta>),
    fetch(`${base}/grids/routing_elev.i16`).then((r) => r.arrayBuffer()),
    fetch(`${base}/grids/routing_slope.u8`).then((r) => r.arrayBuffer()),
  ]);
  grid = prepareGrid({
    width: meta.width,
    height: meta.height,
    lon0: meta.lon0_center,
    lat0: meta.lat0_center,
    dlon: meta.dlon,
    dlat: meta.dlat,
    radius: meta.radius_m,
    elev: new Int16Array(e),
    elevNodata: meta.elev_nodata,
    slope: new Uint8Array(s),
    slopeScale: meta.slope_scale,
    gravity: MARS_GRAVITY,
  });
}

type Msg =
  | { type: 'init'; base: string }
  | { type: 'route'; id: number; from: [number, number]; to: [number, number]; profile?: MobilityProfile }
  | { type: 'inspect'; id: number; lngLat: [number, number] };

self.onmessage = async (ev: MessageEvent<Msg>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    loading ??= load(msg.base);
    try {
      await loading;
      self.postMessage({ type: 'ready', width: grid!.width, height: grid!.height });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
    return;
  }
  await loading;
  if (!grid) return;
  if (msg.type === 'route') {
    const result = computeRoute(grid, msg.profile ?? ROVER_PROFILE, msg.from, msg.to);
    self.postMessage({ type: 'route', id: msg.id, result });
  } else if (msg.type === 'inspect') {
    const [lon, lat] = msg.lngLat;
    const { c, r } = lngLatToCell(grid, lon, lat);
    let out: { covered: boolean; elevation?: number; slope?: number; lowConfidence?: boolean } = { covered: false };
    if (c >= 0 && r >= 0 && c < grid.width && r < grid.height) {
      const i = r * grid.width + c;
      if (grid.confidence[i] !== 0) {
        const e = elevationAt(grid, lon, lat);
        out = {
          covered: true,
          elevation: Number.isFinite(e) ? e : grid.elev[i],
          slope: grid.slope[i] * grid.slopeScale,
          lowConfidence: grid.confidence[i] === 1,
        };
      }
    }
    self.postMessage({ type: 'inspect', id: msg.id, result: out });
  }
};
