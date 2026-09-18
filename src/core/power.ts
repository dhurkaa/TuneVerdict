/**
 * The road-load power model.
 *
 * P_wheel = (m·λ·a + ½·ρ·CdA·v² + m·g·Crr + m·g·s) · v
 * P_engine = P_wheel / η
 *
 * where λ is the rotational inertia factor, s the road gradient and η the
 * drivetrain efficiency.
 *
 * The model is kept in *component* form rather than evaluated to a single number,
 * because power is linear in every vehicle parameter. Storing the four normalised
 * coefficients per sample turns each Monte Carlo draw into a matrix multiply
 * instead of a re-run of the model — which is what makes 4000 draws over a full
 * power curve cost milliseconds in a browser.
 */

import { PHYSICS } from './constants';
import type { PowerComponents, VehicleParameters } from './types';

/**
 * The four coefficients at one sample.
 *
 * Multiply by the parameter vector to get watts at the wheels:
 *   inertia     × (m · λ)
 *   aerodynamic × CdA
 *   rolling     × (m · Crr)
 *   gradient    × (m · s)
 */
export function componentsAt(
  speedMs: number,
  accelMs2: number,
  airDensityKgM3: number,
): PowerComponents {
  const v = speedMs;
  return {
    inertia: accelMs2 * v,
    aerodynamic: 0.5 * airDensityKgM3 * v * v * v,
    rolling: PHYSICS.gravity * v,
    gradient: PHYSICS.gravity * v,
  };
}

/** The parameter vector that multiplies the component basis, in draw order. */
export interface ParameterDraw {
  /** m · λ, effective mass in kg. */
  readonly effectiveMass: number;
  /** CdA in m². */
  readonly dragArea: number;
  /** m · Crr, in kg. */
  readonly rollingProduct: number;
  /** m · s, in kg. */
  readonly gradientProduct: number;
  /** Drivetrain efficiency, applied as a division at the end. */
  readonly efficiency: number;
}

/** Build the nominal parameter vector from the user's vehicle description. */
export function nominalDraw(vehicle: VehicleParameters, gradient: number): ParameterDraw {
  return {
    effectiveMass: vehicle.massKg * vehicle.rotationalInertiaFactor,
    dragArea: vehicle.dragAreaM2,
    rollingProduct: vehicle.massKg * vehicle.rollingResistance,
    gradientProduct: vehicle.massKg * gradient,
    efficiency: vehicle.drivetrainEfficiency,
  };
}

/** Engine power in watts, from one component sample and one parameter draw. */
export function powerWatts(components: PowerComponents, draw: ParameterDraw): number {
  const wheel =
    components.inertia * draw.effectiveMass +
    components.aerodynamic * draw.dragArea +
    components.rolling * draw.rollingProduct +
    components.gradient * draw.gradientProduct;
  return wheel / draw.efficiency;
}

/**
 * Evaluate a whole curve in one pass: `basis` is K samples of four coefficients
 * laid out as a flat K×4 array, in the order (inertia, aerodynamic, rolling,
 * gradient). This is the matrix multiply the Monte Carlo runs 4000 times.
 */
export function powerCurveWatts(
  basis: Float64Array,
  draw: ParameterDraw,
  out: Float64Array,
): Float64Array {
  const k = out.length;
  const invEta = 1 / draw.efficiency;
  for (let i = 0; i < k; i++) {
    const o = i * 4;
    const inertia = basis[o] as number;
    if (!Number.isFinite(inertia)) {
      out[i] = NaN;
      continue;
    }
    out[i] =
      (inertia * draw.effectiveMass +
        (basis[o + 1] as number) * draw.dragArea +
        (basis[o + 2] as number) * draw.rollingProduct +
        (basis[o + 3] as number) * draw.gradientProduct) *
      invEta;
  }
  return out;
}

/** Flatten a list of component samples into the K×4 basis the curve code expects. */
export function packBasis(components: readonly PowerComponents[]): Float64Array {
  const basis = new Float64Array(components.length * 4);
  components.forEach((c, i) => {
    const o = i * 4;
    basis[o] = c.inertia;
    basis[o + 1] = c.aerodynamic;
    basis[o + 2] = c.rolling;
    basis[o + 3] = c.gradient;
  });
  return basis;
}

export const wattsToHp = (w: number): number => w / PHYSICS.wattsPerHp;
export const wattsToPs = (w: number): number => w / PHYSICS.wattsPerPs;
export const hpToWatts = (hp: number): number => hp * PHYSICS.wattsPerHp;

/** Torque at the crank, N·m, from power and engine speed. */
export function torqueNm(watts: number, rpm: number): number {
  if (!Number.isFinite(watts) || !Number.isFinite(rpm) || rpm <= 0) return NaN;
  const omega = (rpm * 2 * Math.PI) / 60;
  return watts / omega;
}
