/**
 * USGS SIM 3464 map units (Sun & Stack, 2020). Short descriptions paraphrase the map pamphlet;
 * interpretations belong to the map authors. Colours are GeoMars styling (blue for fan units,
 * following the pamphlet's stated convention), not the official USGS symbology.
 */
export interface GeoUnit {
  name: string;
  color: string;
  summary: string;
}

export const GEO_UNITS: Record<string, GeoUnit> = {
  NHjf1: { name: 'Jezero fan 1 unit', color: '#3f7fb3', summary: 'Older, topographically lower fan deposit inside Jezero, interpreted by the authors as sourced from Neretva Vallis.' },
  NHjf2: { name: 'Jezero fan 2 unit', color: '#5fa8d6', summary: 'Younger fan (delta) deposit inside Jezero, stratigraphically above fan unit 1.' },
  Njf: { name: 'Jezero floor unit', color: '#b77a54', summary: 'Crater-floor unit; the authors interpret it, like unit Nnp2, as an airfall (ash or eolian) deposit draping older topography.' },
  Nle: { name: 'Lower etched unit', color: '#8e9a5a', summary: 'Olivine-rich etched unit within Jezero, stratigraphically below the upper etched unit; may have been altered by lake processes.' },
  Nue: { name: 'Upper etched unit', color: '#a9a25f', summary: 'Widespread olivine-rich unit with ridged (yardang), cratered, and light-toned rugged textures.' },
  Nnp1: { name: 'Nili Planum 1 unit', color: '#8a5b45', summary: 'Older Nili Planum unit with mound-forming, rugged, and smooth dark-toned surfaces.' },
  Nnp2: { name: 'Nili Planum 2 unit', color: '#a8694b', summary: 'Flat-topped, boulder-shedding capping unit with lobate margins in Nili Planum.' },
  Hnpf: { name: 'Nili Planum fan unit', color: '#7fb4c9', summary: 'Fan deposits in and around Neretva and Una Valles, recording waning fluvial input (Early Hesperian).' },
  Nrb: { name: 'Rugged bright unit', color: '#d9b48a', summary: 'Light-toned mounds lying stratigraphically above the upper etched unit, implying tens of metres of erosion.' },
  su: { name: 'Smooth unit, undivided', color: '#7d6d63', summary: 'Smooth, intermediate- to dark-toned mantling deposit thick enough to hide the underlying unit.' },
  Aeb: { name: 'Eolian bedform unit', color: '#e3c27d', summary: 'Wind-formed bedforms (dunes and ripples).' },
  cr: { name: 'Crater rim unit', color: '#6e4a3a', summary: 'Crater rim material, including collapsed terraces of the Jezero rim with megabreccia.' },
  ce: { name: 'Crater ejecta unit', color: '#9c7c6a', summary: 'Ejecta of impact craters within the map area.' },
  ci: { name: 'Crater interior unit', color: '#5b4a44', summary: 'Interior (floor and central) material of impact craters.' },
};

export const GEOLOGY_CITATION =
  'Sun, V., and Stack, K., 2020, Geologic map of Jezero crater and the Nili Planum region, Mars: USGS SIM 3464, https://doi.org/10.3133/sim3464';

type Ring = [number, number][];
interface GeoFeature {
  properties: { unit: string; name: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] };
  bbox: [number, number, number, number];
}

let features: GeoFeature[] | null = null;

function pointInRing(p: [number, number], ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function indexGeology(fc: { features: Omit<GeoFeature, 'bbox'>[] }) {
  features = fc.features.map((f) => {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polys) for (const [x, y] of poly[0]) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { ...f, bbox: [x0, y0, x1, y1] as [number, number, number, number] };
  });
}

/** Geologic unit at a point (USGS SIM 3464), or null if outside the mapped polygons. */
export function geologyAt(p: [number, number]): string | null {
  if (!features) return null;
  for (const f of features) {
    const b = f.bbox;
    if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][];
    for (const poly of polys) {
      if (pointInRing(p, poly[0]) && !poly.slice(1).some((h) => pointInRing(p, h))) return f.properties.unit;
    }
  }
  return null;
}
