/**
 * Visual quality presets of the enhanced 3D renderer. They change real rendering work (geometry
 * density, LOD distance, texture size, shadow map, rock/pebble counts, shader detail) — never the
 * scientific data or the routing engine's resolution.
 */
export type QualityId = 'performance' | 'balanced' | 'cinematic';

export interface QualityPreset {
  id: QualityId;
  label: string;
  /** chunk grid resolution (vertices per side − 1) */
  segments: number;
  /** screen-space LOD factor: higher = finer chunks further away */
  lodFactor: number;
  /** finest chunk zoom inside the CTX DEM footprint */
  maxZoom: number;
  /** albedo texture size of fine chunks (px) */
  texSize: number;
  /** max device-pixel-ratio */
  maxPixelRatio: number;
  /** shadow map size (0 = no shadows) */
  shadowMap: number;
  /** rock density multiplier (0 = no rocks) */
  rocks: number;
  /** pebble/gravel density multiplier (0 = none) */
  pebbles: number;
  /** rocks cast shadows */
  rockShadows: boolean;
  /** shader detail level: 0 basic, 1 full, 2 full + extra octave */
  shaderDetail: 0 | 1 | 2;
  /** MSAA */
  antialias: boolean;
  anisotropy: number;
  /** micro-relief strength on fine chunks */
  micro: number;
  /** max chunks loading at once */
  concurrency: number;
  /** physically based (GGX) terrain shading; Lambert otherwise */
  pbrTerrain: boolean;
}

export const QUALITY: Record<QualityId, QualityPreset> = {
  performance: {
    id: 'performance', label: 'Performance', segments: 32, lodFactor: 1.15, maxZoom: 15, texSize: 256, maxPixelRatio: 1,
    shadowMap: 0, rocks: 0.35, pebbles: 0, rockShadows: false, shaderDetail: 0, antialias: false, anisotropy: 2, micro: 0.7, concurrency: 4, pbrTerrain: false,
  },
  balanced: {
    id: 'balanced', label: 'Balanced', segments: 48, lodFactor: 1.35, maxZoom: 16, texSize: 512, maxPixelRatio: 1.5,
    shadowMap: 2048, rocks: 1, pebbles: 0.6, rockShadows: true, shaderDetail: 1, antialias: true, anisotropy: 4, micro: 1, concurrency: 6, pbrTerrain: false,
  },
  cinematic: {
    id: 'cinematic', label: 'Cinematic', segments: 64, lodFactor: 2.0, maxZoom: 17, texSize: 512, maxPixelRatio: 2,
    shadowMap: 4096, rocks: 1.6, pebbles: 1, rockShadows: true, shaderDetail: 2, antialias: true, anisotropy: 8, micro: 1, concurrency: 8, pbrTerrain: true,
  },
};

const KEY = 'geomars.quality3d';
export function loadQuality(): QualityId {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'performance' || v === 'balanced' || v === 'cinematic') return v;
  } catch {
    /* storage unavailable */
  }
  return 'balanced';
}
export function saveQuality(q: QualityId) {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    /* storage unavailable */
  }
}
