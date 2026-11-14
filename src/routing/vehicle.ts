/**
 * Mobility profiles for surface route planning (GeoMars V1.2).
 *
 * One shared route engine (A* on the CTX-DEM routing grid) is driven by a per-mode
 * MobilityProfile. Universal data-validity constraints — no-data cells, unobserved terrain,
 * coordinates outside the DEM — are enforced by the engine for every mode. Everything that
 * depends on HOW the surface is crossed (slope limits, speed response, energy, hazard
 * sensitivity) lives in the profile.
 *
 * STATUS: ESTIMATED. No crewed Mars rover exists and no certified Mars EVA traversability limits
 * are published. Every number below is a documented, configurable planning assumption — never a
 * vehicle specification or a NASA spacesuit operating limit.
 */

export type TravelMode = 'rover' | 'walking';

/** Wheeled-vehicle traction model (only meaningful for motorised modes). */
export interface TractionModel {
  /** Loaded vehicle mass (kg). */
  massKg: number;
  /** Rolling-resistance coefficient on Martian regolith (dimensionless). */
  rollingResistance: number;
  /** Battery-to-wheel drivetrain efficiency (0..1). */
  drivetrainEfficiency: number;
}

export interface MobilityProfile {
  mode: TravelMode;
  /** Short UI label ("Rover", "Walking"). */
  label: string;
  /** Descriptive name of the modelled traveller. */
  name: string;
  /** Nominal speed on flat, firm terrain (m/s). Effective speed is lower on slopes. */
  nominalSpeedMs: number;
  /** Maximum traversable terrain slope (deg). Steeper cells are REMOVED from the graph. */
  maxSlopeDeg: number;
  /** Slope above which terrain is flagged "caution" and penalised (deg). */
  cautionSlopeDeg: number;
  /** Lower bound of the terrain-slope speed factor at the slope limit. */
  minSpeedFactor: number;
  /**
   * Along-track grade response. 'none': speed depends only on terrain slope (wheeled vehicle).
   * 'tobler': pedestrian response shaped like Tobler's hiking function (fastest on a slight
   * downhill, slower uphill and on steep downhill), normalised so it never exceeds nominal speed.
   */
  gradeResponse: 'none' | 'tobler';
  /** Traction-energy model; null when no motor energy applies (walking). */
  traction: TractionModel | null;
  /** Routing-cost weights, all expressed in "equivalent seconds". */
  weights: {
    /** seconds of cost per watt-hour of estimated traction energy */
    energyPerWh: number;
    /** extra multiplier on travel time across the caution slope band (scaled 0..1 across the band) */
    caution: number;
    /** extra multiplier on travel time for cells next to DEM data gaps (lower confidence) */
    lowConfidence: number;
  };
  /** Estimated travel time above which the UI shows an advisory (s); null = none. */
  advisoryDurationS: number | null;
}

/** Mode A — motorised surface exploration. Baseline: the V1.0/V1.1 vehicle model, unchanged. */
export const ROVER_PROFILE: MobilityProfile = {
  mode: 'rover',
  label: 'Rover',
  name: 'Pressurised exploration rover (generic concept)',
  nominalSpeedMs: 10 / 3.6, // 10 km/h
  // Conservative assumption, below the 25° slope capability quoted for the Apollo LRV.
  maxSlopeDeg: 20,
  cautionSlopeDeg: 15,
  minSpeedFactor: 0.35,
  gradeResponse: 'none',
  traction: {
    massKg: 3000,
    rollingResistance: 0.15, // loose, sandy regolith assumption
    drivetrainEfficiency: 0.75,
  },
  weights: { energyPerWh: 0.3, caution: 1.5, lowConfidence: 0.75 },
  advisoryDurationS: null,
};

/**
 * Mode B — an astronaut on foot. Independent planning assumptions (NOT certified EVA limits):
 * - 3 km/h nominal: conservative pace for a suited walker on firm, level ground.
 * - 25° hard limit / 12° caution: a walker can negotiate steeper ground than a 3 t wheeled vehicle
 *   on loose regolith, but footing risk and fatigue rise quickly, so the caution band starts earlier
 *   and is penalised more strongly. The 40 m routing cells smooth local slopes, so real local
 *   slopes can be steeper than the cell value.
 * - No vehicle mass, rolling resistance or motor energy.
 * - Stronger avoidance of cells next to DEM gaps (lower-confidence ground).
 * - Advisory above 4 h of estimated walking time (long single-sortie walking traverse).
 */
export const WALKING_PROFILE: MobilityProfile = {
  mode: 'walking',
  label: 'Walking',
  name: 'Suited astronaut on foot (planning assumptions)',
  nominalSpeedMs: 3 / 3.6, // 3 km/h
  maxSlopeDeg: 25,
  cautionSlopeDeg: 12,
  minSpeedFactor: 0.3,
  gradeResponse: 'tobler',
  traction: null,
  weights: { energyPerWh: 0, caution: 2.5, lowConfidence: 1.0 },
  advisoryDurationS: 4 * 3600,
};

export const MOBILITY_PROFILES: Record<TravelMode, MobilityProfile> = {
  rover: ROVER_PROFILE,
  walking: WALKING_PROFILE,
};

export function profileFor(mode: TravelMode): MobilityProfile {
  return MOBILITY_PROFILES[mode];
}

/** Back-compat alias: the rover profile was the only vehicle model before V1.2. */
export const DEFAULT_VEHICLE = ROVER_PROFILE;
export type VehicleModel = MobilityProfile;

/** Lowest pedestrian grade factor (very steep along-track grade). */
const MIN_GRADE_FACTOR = 0.15;

/**
 * Speed factor (0..1] relative to nominal speed.
 * - Terrain slope (worst cell slope crossed): smooth decline to `minSpeedFactor` at the hard limit.
 * - Walking only: along-track grade response (Tobler-shaped, normalised to ≤ 1).
 * The factor never exceeds 1, which keeps the A* heuristic (distance / nominal speed) admissible.
 */
export function speedFactor(slopeDeg: number, p: MobilityProfile, gradeRad = 0): number {
  const r = Math.min(1, Math.max(0, slopeDeg / p.maxSlopeDeg));
  const terrain = Math.max(p.minSpeedFactor, 1 - (1 - p.minSpeedFactor) * r ** 1.5);
  if (p.gradeResponse !== 'tobler') return terrain;
  return Math.min(terrain, gradeFactor(gradeRad));
}

/** Tobler-shaped pedestrian grade factor, normalised so flat ground = 1 and clamped to [0.15, 1]. */
export function gradeFactor(gradeRad: number): number {
  const m = Math.tan(gradeRad);
  const f = Math.exp(-3.5 * (Math.abs(m + 0.05) - 0.05));
  return Math.min(1, Math.max(MIN_GRADE_FACTOR, f));
}

/**
 * Estimated traction energy (Wh) to drive a straight segment; 0 for modes without traction.
 * F = m g (Crr cosθ + sinθ), clamped at 0 (no regenerative braking credited), E = F L / η.
 * θ is the signed grade of the segment (uphill positive).
 */
export function segmentEnergyWh(lengthM: number, gradeRad: number, p: MobilityProfile, g: number): number {
  const t = p.traction;
  if (!t) return 0;
  const f = t.massKg * g * (t.rollingResistance * Math.cos(gradeRad) + Math.sin(gradeRad));
  return (Math.max(0, f) * lengthM) / t.drivetrainEfficiency / 3600;
}

/** Nominal speed in km/h for display. */
export function nominalKmh(p: MobilityProfile): number {
  return Math.round(p.nominalSpeedMs * 3.6 * 10) / 10;
}
