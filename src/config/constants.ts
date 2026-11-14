/**
 * Planetary and application constants.
 * Values are taken from the product labels of the datasets actually used (see README §Data).
 */

/** Mars 2000 sphere radius used by every raster/vector product integrated in GeoMars (GeoTIFF WKT). */
export const MARS_RADIUS_M = 3_396_190;

/** Mars surface gravity, NASA Mars Fact Sheet (3.71 m/s²). Used only for *estimated* energy. */
export const MARS_GRAVITY = 3.71;

/** Equatorial radius of the Web-Mercator Earth sphere used internally by MapLibre's tile maths. */
export const MAPLIBRE_EARTH_RADIUS_M = 6_378_137;

/**
 * MapLibre measures horizontal distance with the Earth sphere while our elevation values are Mars
 * metres. Exaggeration = R_earth / R_mars renders relief at TRUE 1:1 proportion on the Mars map.
 * Purely visual — never used in any physical calculation.
 */
export const TRUE_SCALE_EXAGGERATION = MAPLIBRE_EARTH_RADIUS_M / MARS_RADIUS_M;

export const DATA_BASE = `${import.meta.env.BASE_URL}data`;

/** Jezero crater centre — IAU / USGS Gazetteer of Planetary Nomenclature (planetocentric, +East). */
export const JEZERO_CENTER: [number, number] = [77.69, 18.41];

/** Initial local view after the intro (crater floor & western fan, Perseverance operations area). */
export const LOCAL_VIEW = { center: [77.48, 18.45] as [number, number], zoom: 11.3 };

/** CTX DEM footprint (lon0, lat0, lon1, lat1), computed by scripts/prepare_data.py from the GeoTIFF. */
export const CTX_BOUNDS: [number, number, number, number] = [76.99744, 17.58052, 78.58256, 19.29019];
export const MOLA_WINDOW_BOUNDS: [number, number, number, number] = [63.99356, 5.00011, 90.99415, 32.00069];
export const THEMIS_BOUNDS: [number, number, number, number] = [76.79597, 17.69795, 77.80227, 18.70106];
