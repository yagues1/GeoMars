import { DATA_BASE } from '../config/constants';
import { indexGeology } from './geology';

export interface Poi {
  id: string;
  name: string;
  category: 'sample' | 'landmark';
  lon: number;
  lat: number;
  elev_geoid_m?: number;
  description: string;
  samples?: { no: number; name: string; sol: number; date: string; type: string; rock: string }[];
  status: 'observed' | 'derived';
  location_method: string;
  sources: string[];
}

export async function loadPois(): Promise<Poi[]> {
  const r = await fetch(`${DATA_BASE}/vector/pois.json`);
  return (await r.json()).pois as Poi[];
}

export async function loadGeologyIndex() {
  const r = await fetch(`${DATA_BASE}/vector/geology.geojson`);
  indexGeology(await r.json());
}

interface ByteGrid {
  width: number;
  height: number;
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
  data: Uint8Array;
}

const grids: Record<string, ByteGrid> = {};

export async function loadThemis() {
  for (const k of ['themis_nightir', 'themis_dayir']) {
    const [meta, buf] = await Promise.all([
      fetch(`${DATA_BASE}/grids/${k}.json`).then((r) => r.json()),
      fetch(`${DATA_BASE}/grids/${k}.u8`).then((r) => r.arrayBuffer()),
    ]);
    grids[k] = { ...meta, data: new Uint8Array(buf) };
  }
}

/** THEMIS 8-bit DN at a point (0 / null = no coverage). Relative brightness only. */
export function themisAt(kind: 'themis_nightir' | 'themis_dayir', [lon, lat]: [number, number]): number | null {
  const g = grids[kind];
  if (!g) return null;
  const c = Math.round(((lon - g.lon0) / (g.lon1 - g.lon0)) * (g.width - 1));
  const r = Math.round(((g.lat0 - lat) / (g.lat0 - g.lat1)) * (g.height - 1));
  if (c < 0 || r < 0 || c >= g.width || r >= g.height) return null;
  const v = g.data[r * g.width + c];
  return v === 0 ? null : v;
}
