import type { StyleSpecification } from 'maplibre-gl';
import { CTX_BOUNDS, DATA_BASE, MOLA_WINDOW_BOUNDS, THEMIS_BOUNDS } from '../config/constants';
import { GEO_UNITS } from '../data/geology';

/**
 * MapLibre style for Mars. All sources are LOCAL assets produced by scripts/prepare_data.py.
 * The Web-Mercator tiling scheme is applied to Mars planetocentric lon/lat; GeoMars never uses
 * MapLibre's (Earth) metric for physical quantities.
 */
// NB: build absolute URLs by concatenation — `new URL()` would percent-encode the {z}/{x}/{y} placeholders.
const abs = (p: string) => `${window.location.origin}${DATA_BASE}/${p}`;

const tiles = (name: string, ext: string) => [abs(`tiles/${name}/{z}/{x}/{y}.${ext}`)];

const geologyColor: unknown[] = ['match', ['get', 'unit']];
for (const [k, u] of Object.entries(GEO_UNITS)) geologyColor.push(k, u.color);
geologyColor.push('#888888');

export const ROUTE_COLORS = {
  core: '#ffd2a8',
  mid: '#ff8a3d',
  glow: '#ff6a1a',
};

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    projection: { type: 'globe' },
    sky: {
      'sky-color': '#000000',
      'horizon-color': '#c9875a',
      'fog-color': '#b97a52',
      'fog-ground-blend': 0.85,
      'horizon-fog-blend': 0.6,
      'sky-horizon-blend': 0.6,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 5, 0.45, 8, 0.15, 10, 0],
    },
    sources: {
      globe: { type: 'raster', tiles: tiles('globe', 'jpg'), tileSize: 256, minzoom: 0, maxzoom: 8, attribution: 'Viking MDIM2.1 · NASA Mars Trek' },
      globe_mola: { type: 'raster', tiles: tiles('globe_mola', 'jpg'), tileSize: 256, minzoom: 0, maxzoom: 5, attribution: 'MOLA shaded relief · NASA Mars Trek' },
      ortho: { type: 'raster', tiles: tiles('ortho', 'webp'), tileSize: 256, minzoom: 8, maxzoom: 14, bounds: CTX_BOUNDS, attribution: 'CTX orthomosaic · USGS/NASA JPL' },
      topo: { type: 'raster', tiles: tiles('topo', 'webp'), tileSize: 256, minzoom: 3, maxzoom: 13, bounds: MOLA_WINDOW_BOUNDS, attribution: 'CTX DEM · MOLA DEM · USGS' },
      terrain: { type: 'raster-dem', tiles: tiles('terrain', 'webp'), tileSize: 256, minzoom: 3, maxzoom: 12, encoding: 'terrarium', bounds: MOLA_WINDOW_BOUNDS },
      hillshade: { type: 'raster-dem', tiles: tiles('terrain', 'webp'), tileSize: 256, minzoom: 3, maxzoom: 12, encoding: 'terrarium', bounds: MOLA_WINDOW_BOUNDS },
      slope: { type: 'raster', tiles: tiles('slope', 'webp'), tileSize: 256, minzoom: 9, maxzoom: 12, bounds: CTX_BOUNDS },
      hazard: { type: 'raster', tiles: tiles('hazard', 'png'), tileSize: 256, minzoom: 9, maxzoom: 12, bounds: CTX_BOUNDS },
      themis_night: { type: 'raster', tiles: tiles('themis_nightir', 'webp'), tileSize: 256, minzoom: 7, maxzoom: 11, bounds: THEMIS_BOUNDS, attribution: 'THEMIS IR · USGS' },
      themis_day: { type: 'raster', tiles: tiles('themis_dayir', 'webp'), tileSize: 256, minzoom: 7, maxzoom: 11, bounds: THEMIS_BOUNDS },
      geology: { type: 'geojson', data: abs('vector/geology.geojson'), attribution: 'USGS SIM 3464 (Sun & Stack 2020)' },
      geology_boundary: { type: 'geojson', data: abs('vector/geology_boundary.geojson') },
      landing_ellipse: { type: 'geojson', data: abs('vector/landing_ellipse.geojson') },
      contours: { type: 'geojson', data: abs('vector/contours.geojson') },
      traverse: { type: 'geojson', data: abs('vector/traverse.geojson'), attribution: 'Perseverance traverse · NASA/JPL MMGIS' },
      coverage: {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [CTX_BOUNDS[0], CTX_BOUNDS[1]], [CTX_BOUNDS[2], CTX_BOUNDS[1]], [CTX_BOUNDS[2], CTX_BOUNDS[3]],
              [CTX_BOUNDS[0], CTX_BOUNDS[3]], [CTX_BOUNDS[0], CTX_BOUNDS[1]],
            ]],
          },
        },
      },
      route: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true },
      route_done: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'space', type: 'background', paint: { 'background-color': '#0b0705' } },
      { id: 'globe', type: 'raster', source: 'globe', paint: { 'raster-fade-duration': 250, 'raster-saturation': 0.05 } },
      { id: 'globe-mola', type: 'raster', source: 'globe_mola', layout: { visibility: 'none' } },
      { id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 200 } },
      {
        id: 'ortho', type: 'raster', source: 'ortho', minzoom: 7.5,
        paint: {
          'raster-fade-duration': 200,
          // Grayscale CTX over the colour Viking mosaic: at <1 opacity the regional Viking colour
          // shows through as a subtle natural tint (visual only; CTX DN untouched in the tiles).
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 0, 8.6, 0.8],
          'raster-contrast': 0.08,
        },
      },
      {
        id: 'hillshade', type: 'hillshade', source: 'hillshade', layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#1a0c06', 'hillshade-highlight-color': '#ffe2c4', 'hillshade-accent-color': '#3a1c10' },
      },
      { id: 'themis-day', type: 'raster', source: 'themis_day', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.72 } },
      { id: 'themis-night', type: 'raster', source: 'themis_night', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.72 } },
      {
        id: 'geology-fill', type: 'fill', source: 'geology', layout: { visibility: 'none' },
        paint: { 'fill-color': geologyColor as never, 'fill-opacity': 0.42, 'fill-antialias': true },
      },
      { id: 'geology-line', type: 'line', source: 'geology', layout: { visibility: 'none' }, paint: { 'line-color': '#1a0f0a', 'line-opacity': 0.45, 'line-width': 0.6 } },
      { id: 'geology-boundary', type: 'line', source: 'geology_boundary', layout: { visibility: 'none' }, paint: { 'line-color': '#f3d9c0', 'line-width': 1, 'line-dasharray': [3, 2], 'line-opacity': 0.7 } },
      { id: 'slope', type: 'raster', source: 'slope', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.8 } },
      { id: 'hazard', type: 'raster', source: 'hazard', paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 0.55, 15, 0.35], 'raster-resampling': 'linear' } },
      {
        id: 'contours', type: 'line', source: 'contours', layout: { visibility: 'none', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['get', 'major'], '#ffe7cf', '#f6d2b0'],
          'line-opacity': ['case', ['get', 'major'], 0.6, 0.3],
          'line-width': ['case', ['get', 'major'], 1.1, 0.55],
        },
      },
      { id: 'coverage', type: 'line', source: 'coverage', layout: { visibility: 'none' }, paint: { 'line-color': '#ff9d5c', 'line-width': 1.4, 'line-dasharray': [4, 3], 'line-opacity': 0.8 } },
      { id: 'landing-ellipse', type: 'line', source: 'landing_ellipse', layout: { visibility: 'none' }, paint: { 'line-color': '#fff1e3', 'line-width': 1.4, 'line-opacity': 0.7 } },
      {
        id: 'traverse', type: 'line', source: 'traverse', layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#e9f4ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 2.4], 'line-opacity': 0.55, 'line-dasharray': [1, 1.6] },
      },
      // Route: layered glow (copper/orange identity)
      {
        id: 'route-glow', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ROUTE_COLORS.glow, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 10, 16, 26], 'line-blur': ['interpolate', ['linear'], ['zoom'], 9, 8, 16, 18], 'line-opacity': 0.45 },
      },
      {
        id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#3a1406', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4.5, 16, 10], 'line-opacity': 0.75 },
      },
      {
        id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 16, 7],
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#ffb070', 0.5, ROUTE_COLORS.mid, 1, '#ff6d2a'],
        },
      },
      {
        id: 'route-core', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ROUTE_COLORS.core, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 16, 2], 'line-opacity': 0.85 },
      },
      {
        id: 'route-done', type: 'line', source: 'route_done', layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#2b211c', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3.4, 16, 7.4], 'line-opacity': 0.82 },
      },
    ],
  };
}

export const STYLE_LAYERS: Record<'satellite' | 'topographic' | 'hybrid', { show: string[]; hide: string[] }> = {
  satellite: { show: ['globe', 'ortho'], hide: ['globe-mola', 'topo', 'hillshade'] },
  topographic: { show: ['globe-mola', 'topo'], hide: ['globe', 'ortho', 'hillshade'] },
  hybrid: { show: ['globe', 'ortho', 'hillshade'], hide: ['globe-mola', 'topo'] },
};
