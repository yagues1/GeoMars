/**
 * Estimated vehicle model for a crewed surface exploration vehicle.
 *
 * STATUS: ESTIMATED. None of these numbers are published specifications of a real Mars vehicle
 * (no crewed Mars rover exists). They are documented, configurable assumptions so that the
 * route optimiser and the travel-time / energy estimates are transparent and reproducible.
 */
export interface VehicleModel {
  name: string;
  /** Maximum traversable terrain slope (deg). Cells steeper than this are REMOVED from the graph. */
  maxSlopeDeg: number;
  /** Slope above which terrain is flagged "caution" and penalised (deg). */
  cautionSlopeDeg: number;
  /** Nominal speed on flat, firm terrain (m/s). */
  nominalSpeedMs: number;
  /** Minimum speed factor applied on the steepest allowed slopes. */
  minSpeedFactor: number;
  /** Loaded vehicle mass (kg). */
  massKg: number;
  /** Rolling-resistance coefficient on Martian regolith (dimensionless). */
  rollingResistance: number;
  /** Battery-to-wheel drivetrain efficiency (0..1). */
  drivetrainEfficiency: number;
}

export const DEFAULT_VEHICLE: VehicleModel = {
  name: 'Pressurised exploration rover (generic concept)',
  // Conservative assumption, below the 25° slope capability quoted for the Apollo LRV.
  maxSlopeDeg: 20,
  cautionSlopeDeg: 12,  // Updated to match spec (caution threshold)
  nominalSpeedMs: 10 / 3.6, // 10 km/h (~2.78 m/s)
  minSpeedFactor: 0.35,
  massKg: 3000,
  rollingResistance: 0.15, // loose, sandy regolith assumption
  drivetrainEfficiency: 0.75,
};

/** Weights of the routing cost (all terms expressed in "equivalent seconds"). Documented in README. */
export const COST_WEIGHTS = {
  /** seconds of cost per watt-hour of estimated traction energy */
  energyPerWh: 0.3,
  /** extra cost multiplier on travel time when slope is in the caution band (scaled 0..1 across the band) */
  caution: 1.5,
  /** extra cost multiplier on travel time for cells next to DEM data gaps (lower confidence) */
  lowConfidence: 0.75,
};

/** Speed factor as a function of terrain slope: smooth decline to `minSpeedFactor` at the limit. */
export function speedFactor(slopeDeg: number, v: VehicleModel): number {
  const r = Math.min(1, Math.max(0, slopeDeg / v.maxSlopeDeg));
  return Math.max(v.minSpeedFactor, 1 - (1 - v.minSpeedFactor) * r ** 1.5);
}

/**
 * Estimated traction energy (Wh) to drive a straight segment.
 * F = m g (Crr cosθ + sinθ), clamped at 0 (no regenerative braking credited), E = F L / η.
 * θ is the signed grade of the segment (uphill positive).
 */
export function segmentEnergyWh(lengthM: number, gradeRad: number, v: VehicleModel, g: number): number {
  const f = v.massKg * g * (v.rollingResistance * Math.cos(gradeRad) + Math.sin(gradeRad));
  return (Math.max(0, f) * lengthM) / v.drivetrainEfficiency / 3600;
}
