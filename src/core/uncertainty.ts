/**
 * Stage 9: uncertainty propagation by Monte Carlo.
 *
 * Two quite different uncertainties are combined here, and keeping them apart is
 * what makes the result honest:
 *
 *   1. Parameter uncertainty — the car's mass, drag area, rolling resistance,
 *      drivetrain efficiency and the road's gradient are not known exactly. This
 *      dominates the *absolute* figure.
 *   2. Measurement scatter — five pulls do not give five identical answers. This
 *      dominates the *difference* between sessions.
 *
 * Each draw therefore does both: it samples one parameter vector and it resamples
 * the pulls with replacement. Crucially, the parameter vector is shared between
 * the two sessions, because it is the same car on the same road. That is not a
 * simplification — it is the reason the gain is a far better-determined quantity
 * than either absolute number, and it is where the common-mode cancellation in the
 * reference results (2.1×) comes from.
 *
 * Power is linear in every parameter, so a draw is a matrix multiply over the four
 * stored components rather than a re-run of the model.
 */

import {
  CURVE_SMOOTH_HALF_WINDOW,
  MAX_ROAD_GRADIENT,
  MIN_PULL_COVERAGE_FRACTION,
  MONTE_CARLO_DRAWS,
  VEHICLE_DEFAULTS,
} from './constants';
import { hpToTorqueNm, powerCurveWatts, wattsToHp } from './power';
import type { ParameterDraw } from './power';
import { estimateFromDraws, type Rng } from './stats';
import type {
  Estimate,
  PeakRpm,
  PowerCurvePoint,
  UncertaintyBudget,
  VehicleParameters,
} from './types';

/** One session's contribution: the per-pull power bases and their corrections. */
export interface SessionBasis {
  /** Per pull, a flat K×4 basis on the shared rpm axis. */
  readonly bases: readonly Float64Array[];
  /** Per pull, the atmospheric correction factor applied to its power. */
  readonly corrections: readonly number[];
}

export interface MonteCarloOutput {
  readonly peakBefore: Estimate;
  readonly peakAfter: Estimate;
  readonly delta: Estimate;
  readonly deltaPercent: Estimate;
  readonly commonModeCancellation: number;
  readonly curve: readonly PowerCurvePoint[];
  readonly budget: readonly UncertaintyBudget[];
  /** Peak power per pull at nominal parameters — the input to the significance test. */
  readonly peakPerPullBefore: readonly number[];
  readonly peakPerPullAfter: readonly number[];
  /** Mean difference across the compared rpm band. */
  readonly averageDelta: Estimate;
  /** Peak crank torque per session and its difference, N·m. */
  readonly peakTorqueBefore: Estimate;
  readonly peakTorqueAfter: Estimate;
  readonly torqueDelta: Estimate;
  readonly peakRpm: PeakRpm;
}

interface Sampled {
  readonly massKg: number;
  readonly inertiaFactor: number;
  readonly dragAreaM2: number;
  readonly rollingResistance: number;
  readonly efficiency: number;
  readonly gradient: number;
}

function drawParameters(vehicle: VehicleParameters, rng: Rng, vary: Partial<Record<keyof Sampled, boolean>> | null): Sampled {
  const on = (key: keyof Sampled): boolean => (vary === null ? true : vary[key] === true);
  const massRelSd = vehicle.massWeighed
    ? VEHICLE_DEFAULTS.massRelSdWeighed
    : VEHICLE_DEFAULTS.massRelSdEstimated;

  return {
    massKg: vehicle.massKg * (1 + (on('massKg') ? rng.normal() * massRelSd : 0)),
    inertiaFactor:
      vehicle.rotationalInertiaFactor +
      (on('inertiaFactor') ? rng.normal() * VEHICLE_DEFAULTS.rotationalInertiaFactorSd : 0),
    dragAreaM2:
      vehicle.dragAreaM2 * (1 + (on('dragAreaM2') ? rng.normal() * VEHICLE_DEFAULTS.dragAreaRelSd : 0)),
    rollingResistance:
      vehicle.rollingResistance *
      (1 + (on('rollingResistance') ? rng.normal() * VEHICLE_DEFAULTS.rollingResistanceRelSd : 0)),
    efficiency: Math.min(
      0.99,
      Math.max(
        0.5,
        vehicle.drivetrainEfficiency +
          (on('efficiency') ? rng.normal() * VEHICLE_DEFAULTS.drivetrainEfficiencySd : 0),
      ),
    ),
    // The gradient is centred on zero and is shared by both sessions: the protocol
    // asks for the same road in the same direction precisely so that it cancels.
    gradient: on('gradient') ? rng.normal() * (MAX_ROAD_GRADIENT / 2) : 0,
  };
}

function toDraw(sampled: Sampled): ParameterDraw {
  return {
    effectiveMass: sampled.massKg * sampled.inertiaFactor,
    dragArea: sampled.dragAreaM2,
    rollingProduct: sampled.massKg * sampled.rollingResistance,
    gradientProduct: sampled.massKg * sampled.gradient,
    efficiency: sampled.efficiency,
  };
}

/**
 * Mean power curve of a session for one parameter draw and one choice of pulls.
 * Returns horsepower on the shared rpm axis, with NaN where no pull covered it.
 */
function sessionCurve(
  basis: SessionBasis,
  pullIndices: readonly number[],
  draw: ParameterDraw,
  k: number,
  scratch: Float64Array,
  out: Float64Array,
): void {
  out.fill(0);
  const counts = new Int32Array(k);

  for (const index of pullIndices) {
    const pullBasis = basis.bases[index];
    const correction = basis.corrections[index];
    if (!pullBasis || !Number.isFinite(correction)) continue;
    powerCurveWatts(pullBasis, draw, scratch);
    for (let i = 0; i < k; i++) {
      const watts = scratch[i] as number;
      if (!Number.isFinite(watts)) continue;
      out[i] = (out[i] as number) + wattsToHp(watts) * correction;
      counts[i] = (counts[i] as number) + 1;
    }
  }
  // A point is only reported where enough of the session's pulls reached it.
  // Otherwise the ends of the curve are one pull's value wearing a five-pull
  // label, which is how a curve grows a spike no engine made.
  const minCount = Math.max(1, Math.ceil(MIN_PULL_COVERAGE_FRACTION * pullIndices.length));
  for (let i = 0; i < k; i++) {
    const count = counts[i] as number;
    out[i] = count >= minCount ? (out[i] as number) / count : NaN;
  }
  smoothCurveInPlace(out, k);
}

/**
 * Light smoothing along the rpm axis before the peak is read.
 *
 * Taking the maximum of a noisy curve is biased upward: over 71 rpm points, the
 * largest excursion of the acceleration noise gets reported as peak power. A real
 * power curve is smooth and nearly flat at the top, so averaging over ±100 rpm
 * costs almost nothing in peak height and removes most of that bias.
 */
function smoothCurveInPlace(curve: Float64Array, k: number): void {
  const source = SMOOTH_SCRATCH.length >= k ? SMOOTH_SCRATCH : new Float64Array(k);
  source.set(curve.subarray(0, k));
  for (let i = 0; i < k; i++) {
    // Smoothing must not fill a gap: a point with too little coverage stays
    // missing rather than borrowing its neighbours' values.
    if (!Number.isFinite(source[i] as number)) {
      curve[i] = NaN;
      continue;
    }
    let sum = 0;
    let count = 0;
    const lo = Math.max(0, i - CURVE_SMOOTH_HALF_WINDOW);
    const hi = Math.min(k - 1, i + CURVE_SMOOTH_HALF_WINDOW);
    for (let j = lo; j <= hi; j++) {
      const v = source[j] as number;
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    curve[i] = count > 0 ? sum / count : NaN;
  }
}

/** Reused between draws; the Monte Carlo runs this thousands of times. */
const SMOOTH_SCRATCH = new Float64Array(512);

/** Maximum of a draw's torque curve, N·m, from its power curve in hp. */
function peakTorqueOf(curve: Float64Array, rpmAxis: Float64Array): number {
  let peak = NaN;
  for (let i = 0; i < curve.length; i++) {
    const torque = hpToTorqueNm(curve[i] as number, rpmAxis[i] as number);
    if (Number.isFinite(torque) && (!Number.isFinite(peak) || torque > peak)) peak = torque;
  }
  return peak;
}

/**
 * The rpm at which each session's curve peaks, read from the reported (mean)
 * curve — the "@ 4000 rpm" of a dyno sheet.
 */
function peakRpms(curve: readonly PowerCurvePoint[]): PeakRpm {
  const argmax = (value: (p: PowerCurvePoint) => number): number => {
    let best = NaN;
    let bestValue = -Infinity;
    for (const point of curve) {
      const v = value(point);
      if (Number.isFinite(v) && v > bestValue) {
        bestValue = v;
        best = point.rpm;
      }
    }
    return best;
  };
  return {
    powerBefore: argmax((p) => p.before.value),
    powerAfter: argmax((p) => p.after.value),
    torqueBefore: argmax((p) => hpToTorqueNm(p.before.value, p.rpm)),
    torqueAfter: argmax((p) => hpToTorqueNm(p.after.value, p.rpm)),
  };
}

function peakOf(curve: Float64Array): number {
  let peak = NaN;
  for (let i = 0; i < curve.length; i++) {
    const v = curve[i] as number;
    if (Number.isFinite(v) && (!Number.isFinite(peak) || v > peak)) peak = v;
  }
  return peak;
}

function indices(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function resample(n: number, rng: Rng): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = rng.int(n);
  return out;
}

export function runMonteCarlo(
  before: SessionBasis,
  after: SessionBasis,
  vehicle: VehicleParameters,
  rpmAxis: Float64Array,
  rng: Rng,
  draws = MONTE_CARLO_DRAWS,
): MonteCarloOutput {
  const k = rpmAxis.length;
  const scratch = new Float64Array(k);
  const curveBefore = new Float64Array(k);
  const curveAfter = new Float64Array(k);

  const peakB = new Float64Array(draws).fill(NaN);
  const peakA = new Float64Array(draws).fill(NaN);
  const deltaDraws = new Float64Array(draws).fill(NaN);
  const deltaPercentDraws = new Float64Array(draws).fill(NaN);
  const torqueB = new Float64Array(draws).fill(NaN);
  const torqueA = new Float64Array(draws).fill(NaN);
  const torqueDeltaDraws = new Float64Array(draws).fill(NaN);

  // Per-rpm draws, laid out [rpmIndex * draws + draw].
  const curveDrawsBefore = new Float64Array(k * draws).fill(NaN);
  const curveDrawsAfter = new Float64Array(k * draws).fill(NaN);
  const curveDrawsDelta = new Float64Array(k * draws).fill(NaN);

  const nBefore = before.bases.length;
  const nAfter = after.bases.length;

  for (let d = 0; d < draws; d++) {
    const sampled = drawParameters(vehicle, rng, null);
    const draw = toDraw(sampled);

    // Same parameters for both sessions — the car did not change mass between logs.
    sessionCurve(before, resample(nBefore, rng), draw, k, scratch, curveBefore);
    sessionCurve(after, resample(nAfter, rng), draw, k, scratch, curveAfter);

    const pb = peakOf(curveBefore);
    const pa = peakOf(curveAfter);
    peakB[d] = pb;
    peakA[d] = pa;
    deltaDraws[d] = pa - pb;
    // Peak torque is not peak power scaled: it sits at a different rpm, so it is
    // taken from each draw's own torque curve.
    const tb = peakTorqueOf(curveBefore, rpmAxis);
    const ta = peakTorqueOf(curveAfter, rpmAxis);
    torqueB[d] = tb;
    torqueA[d] = ta;
    torqueDeltaDraws[d] = ta - tb;
    deltaPercentDraws[d] = pb > 0 ? ((pa - pb) / pb) * 100 : NaN;

    for (let i = 0; i < k; i++) {
      const b = curveBefore[i] as number;
      const a = curveAfter[i] as number;
      curveDrawsBefore[i * draws + d] = b;
      curveDrawsAfter[i * draws + d] = a;
      curveDrawsDelta[i * draws + d] = a - b;
    }
  }

  // Nominal (no parameter perturbation, no resampling) per-pull peaks: the sample
  // the significance test and the consistency score are computed on.
  const nominalDraw = toDraw({
    massKg: vehicle.massKg,
    inertiaFactor: vehicle.rotationalInertiaFactor,
    dragAreaM2: vehicle.dragAreaM2,
    rollingResistance: vehicle.rollingResistance,
    efficiency: vehicle.drivetrainEfficiency,
    gradient: 0,
  });
  const peakPerPullBefore = perPullPeaks(before, nominalDraw, k, scratch);
  const peakPerPullAfter = perPullPeaks(after, nominalDraw, k, scratch);

  const peakBefore = estimateFromDraws(peakB);
  const peakAfter = estimateFromDraws(peakA);
  const delta = estimateFromDraws(deltaDraws);
  const deltaPercent = estimateFromDraws(deltaPercentDraws);
  const peakTorqueBefore = estimateFromDraws(torqueB);
  const peakTorqueAfter = estimateFromDraws(torqueA);
  const torqueDelta = estimateFromDraws(torqueDeltaDraws);

  // How much of the error cancelled: the uncertainty of an absolute figure over
  // the uncertainty of the difference. Both sessions are the same car on the same
  // road, so the parameter error is shared and largely drops out of the
  // subtraction — which is why this application answers "how much did it gain"
  // far more precisely than "how much does it make".
  const commonModeCancellation = delta.sd > 0 ? peakAfter.sd / delta.sd : NaN;

  const curve: PowerCurvePoint[] = [];
  for (let i = 0; i < k; i++) {
    const sliceB = curveDrawsBefore.subarray(i * draws, (i + 1) * draws);
    const sliceA = curveDrawsAfter.subarray(i * draws, (i + 1) * draws);
    const sliceD = curveDrawsDelta.subarray(i * draws, (i + 1) * draws);
    curve.push({
      rpm: rpmAxis[i] as number,
      before: estimateFromDraws(sliceB),
      after: estimateFromDraws(sliceA),
      delta: estimateFromDraws(sliceD),
      nBefore: countCovering(before, i, k),
      nAfter: countCovering(after, i, k),
    });
  }

  // Mean difference across the compared band, per draw, over the rpm points where
  // the comparison is defined. Averaging inside each draw (rather than averaging
  // the per-point estimates) keeps the correlation between neighbouring points,
  // so the interval is not falsely narrowed by treating 60 points as independent.
  const compared = curve.map((point, i) => (Number.isFinite(point.delta.value) ? i : -1)).filter((i) => i >= 0);
  const averageDraws = new Float64Array(draws).fill(NaN);
  for (let d = 0; d < draws; d++) {
    let sum = 0;
    let n = 0;
    for (const i of compared) {
      const value = curveDrawsDelta[i * draws + d] as number;
      if (Number.isFinite(value)) {
        sum += value;
        n++;
      }
    }
    if (n > 0) averageDraws[d] = sum / n;
  }
  const averageDelta = estimateFromDraws(averageDraws);

  return {
    peakBefore,
    peakAfter,
    delta,
    deltaPercent,
    commonModeCancellation,
    averageDelta,
    peakTorqueBefore,
    peakTorqueAfter,
    torqueDelta,
    peakRpm: peakRpms(curve),
    curve,
    budget: varianceBudget(after, vehicle, k, rng),
    peakPerPullBefore,
    peakPerPullAfter,
  };
}

function perPullPeaks(
  basis: SessionBasis,
  draw: ParameterDraw,
  k: number,
  scratch: Float64Array,
): number[] {
  const peaks: number[] = [];
  const curve = new Float64Array(k);
  for (let p = 0; p < basis.bases.length; p++) {
    const pullBasis = basis.bases[p];
    const correction = basis.corrections[p] ?? 1;
    if (!pullBasis) continue;
    powerCurveWatts(pullBasis, draw, scratch);
    for (let i = 0; i < k; i++) {
      const watts = scratch[i] as number;
      curve[i] = Number.isFinite(watts) ? wattsToHp(watts) * correction : NaN;
    }
    // Smoothed on the same terms as the session curves, so that the per-pull
    // peaks the significance test sees carry the same (small) bias as the headline
    // figure rather than a different one.
    smoothCurveInPlace(curve, k);
    peaks.push(peakOf(curve));
  }
  return peaks;
}

function countCovering(basis: SessionBasis, rpmIndex: number, _k: number): number {
  let count = 0;
  for (const pullBasis of basis.bases) {
    if (Number.isFinite(pullBasis[rpmIndex * 4] as number)) count++;
  }
  return count;
}

/**
 * Variance budget: which parameter is worth measuring better.
 *
 * Computed by varying one parameter at a time over a fixed set of pulls, so the
 * shares describe the *parameter* uncertainty of the absolute figure, not the
 * pull-to-pull scatter. On the reference vehicle mass dominates at 62% and
 * drivetrain efficiency follows at 31% — which is why the UI tells the user to
 * weigh the car rather than to guess it.
 */
function varianceBudget(
  basis: SessionBasis,
  vehicle: VehicleParameters,
  k: number,
  rng: Rng,
  draws = 1000,
): UncertaintyBudget[] {
  const scratch = new Float64Array(k);
  const curve = new Float64Array(k);
  const all = indices(basis.bases.length);
  if (all.length === 0) return [];

  const components: { component: UncertaintyBudget['component']; keys: (keyof Sampled)[] }[] = [
    { component: 'mass', keys: ['massKg'] },
    { component: 'dragArea', keys: ['dragAreaM2'] },
    { component: 'rollingResistance', keys: ['rollingResistance'] },
    { component: 'efficiency', keys: ['efficiency'] },
    { component: 'inertia', keys: ['inertiaFactor'] },
  ];

  const variances = components.map(({ component, keys }) => {
    const vary: Partial<Record<keyof Sampled, boolean>> = {};
    for (const key of keys) vary[key] = true;
    const peaks = new Float64Array(draws);
    for (let d = 0; d < draws; d++) {
      const draw = toDraw(drawParameters(vehicle, rng, vary));
      sessionCurve(basis, all, draw, k, scratch, curve);
      peaks[d] = peakOf(curve);
    }
    const estimate = estimateFromDraws(peaks);
    return { component, variance: estimate.sd * estimate.sd };
  });

  const total = variances.reduce((sum, v) => sum + (Number.isFinite(v.variance) ? v.variance : 0), 0);
  if (total <= 0) return variances.map((v) => ({ component: v.component, share: 0 }));

  return variances
    .map((v) => ({ component: v.component, share: (Number.isFinite(v.variance) ? v.variance : 0) / total }))
    .sort((a, b) => b.share - a.share);
}
