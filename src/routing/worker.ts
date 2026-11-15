/// <reference lib="webworker" />
/**
 * Background worker for A* routing with terrain-aware cost factors.
 * Load 8 grid layers: elevation, slope, magnetism, wind (exposure), ice (thermal inertia).
 */
import { computeRoute, lngLatToCell, prepareGrid, elevationAt, type PreparedGrid } from './astar';
import { DEFAULT_VEHICLE, type VehicleModel } from './vehicle';
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

interface EvaConstants {
  pressure_pa: { value: number; n: number };
  t_base_c: { value: string };
  uv_radiation: { value: string };
  wind?: { value: string; direction_deg: number };
}

let grid: PreparedGrid | null = null;
let evaConst: EvaConstants | null = null;
let loading: Promise<void> | null = null;

async function load(base: string) {
  const [meta, e, s, m, w, i, constData] = await Promise.all([
    fetch(`${base}/grids/routing.json`).then((r) => r.json() as Promise<GridMeta>),
    fetch(`${base}/grids/routing_elev.i16`).then((r) => r.arrayBuffer()),
    fetch(`${base}/grids/routing_slope.u8`).then((r) => r.arrayBuffer()),
    fetch(`${base}/grids/routing_magnet.f32`).then((r) => r.arrayBuffer()),  // Magnetic field nT
    fetch(`${base}/grids/routing_wind.f32`).then((r) => r.arrayBuffer()),  // Wind exposure factor
    fetch(`${base}/grids/themis_dayir.u8`).then((r) => r.arrayBuffer()),   // THEMIS TI (thermal inertia)
    fetch(`${base}/grids/eva_constants.json`).then((r) => r.json() as Promise<EvaConstants>),
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

  // Load magnetic field as Float32Array for cost calculation
  grid.magnet = new Float32Array(m);

  // Load wind exposure factor 
  grid.windExposure = new Float32Array(w);

  // Load THEMIS thermal inertia (Uint8, scale by 16 to approximate J m^-2 K^-1 s^-1/2)
  grid.thermalInertia = new Uint16Array(i).map(v => v * 16);

  evaConst = constData;
}

type Msg =
  | { type: 'init'; base: string }
  | { type: 'route'; id: number; from: [number, number]; to: [number, number]; vehicle?: VehicleModel }
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
    const result = computeRoute(grid, msg.vehicle ?? DEFAULT_VEHICLE, msg.from, msg.to);
    self.postMessage({ type: 'route', id: msg.id, result });
  } else if (msg.type === 'inspect') {
    const [lng, lat] = msg.lngLat;
    const { c, r } = lngLatToCell(grid, lng, lat);
    let out: { covered: boolean; elevation?: number; slope?: number; magnetic_nT?: number; wind_exposure?: number; thermal_inertia?: number } = { covered: false };
    if (c >= 0 && r >= 0 && c < grid.width && r < grid.height) {
      const i = r * grid.width + c;
      if (grid.confidence[i] !== 0) {
        const e = elevationAt(grid, lng, lat);
        out = {
          covered: true,
          elevation: Number.isFinite(e) ? e : grid.elev[i],
          slope: grid.slope[i] * grid.slopeScale,
          magnetic_nT: Number.isFinite(grid.magnet![i]) ? grid.magnet![i] : undefined,
          wind_exposure: Number.isFinite(grid.windExposure![i]) ? grid.windExposure![i] : undefined,
          thermal_inertia: grid.thermalInertia![i] || undefined,
        };
      }
    }
    self.postMessage({ type: 'inspect', id: msg.id, result: out });
  }
};
