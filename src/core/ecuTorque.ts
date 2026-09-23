/**
 * ECU-reported torque against measured torque.
 *
 * Many loggers — Autotuner, ECU flashers, OEM diagnostic tools — record the
 * torque the engine controller *calculates* from its own model (fuel injected,
 * air mass, efficiency tables). It is what a map-pack viewer plots as "calculated
 * torque", and it is not a measurement: after a tune it is whatever the tune's
 * torque model says. TuneVerdict measures torque from how the car actually
 * accelerated.
 *
 * Comparing the two is the thesis's core principle — requested against delivered
 * — applied to torque itself. The comparison is made on the *change* between
 * sessions, not on absolute values: the absolute measured figure depends on the
 * assumed drivetrain losses, but those are the same car both times and cancel in
 * the difference, whereas the ECU's claimed change and the car's delivered change
 * can be set side by side directly.
 *
 * When both logs carry it, the ECU's figure is the primary basis of the result:
 * it is the calibrated number the tuner works with, it needs no vehicle model,
 * and it covers every gear in the log rather than only the one gear that can be
 * compared by acceleration. Its full-load curve is built from every settled,
 * high-pedal sample in the session, whatever the gear — torque at the crank does
 * not depend on the gear. The measured figures stay beside it as a cross-check.
 *
 * Three outcomes a tuner can act on:
 *   confirmed     the ECU's claimed gain was delivered;
 *   notDelivered  the ECU claims more than the car delivered — the tune changed
 *                 the torque model (or only the log), not the engine's output;
 *   exceeds       the car delivered more than the ECU claims — the tune raised
 *                 output without updating the torque model, which leaves the
 *                 gearbox and torque limiters working from wrong numbers.
 */

import {
  ECU_CURVE_RPM_STEP,
  ECU_CURVE_SMOOTH_HALF_WINDOW,
  ECU_FULL_LOAD_QUANTILE,
  ECU_LOAD_PEDAL_MIN,
  ECU_MEASURED_MISMATCH_FRACTION,
  ECU_MIN_SAMPLES_PER_BIN,
  ECU_SETTLE_S,
  ECU_TRANSIENT_RATE_NM_S,
} from './constants';
import { hpToTorqueNm } from './power';
import { estimateFromSd, mean, quantile, sd } from './stats';
import type { EcuTorqueComparison, EcuTorquePoint, Estimate, PowerCurvePoint, Session } from './types';

const NO_ESTIMATE: Estimate = { value: NaN, sd: NaN, lo: NaN, hi: NaN };

/**
 * The ECU's full-load torque curve for one session, keyed by bin-centre rpm.
 * Samples qualify when the pedal is at or above ECU_LOAD_PEDAL_MIN and the
 * torque is settled (not ramping in after a kick-down or cut for a shift).
 */
export function ecuFullLoadCurve(session: Session): Map<number, Estimate> {
  const curve = new Map<number, Estimate>();
  const torque = session.channels.get('ecuTorque');
  const rpm = session.channels.get('rpm');
  const pedal = session.channels.get('throttle') ?? session.channels.get('pedal');
  if (!torque || !rpm || !pedal) return curve;
  const t = session.t;

  const bins = new Map<number, number[]>();
  let lastTransient = -Infinity;
  for (let i = 1; i < torque.length - 1; i++) {
    const T = torque[i] as number;
    const R = rpm[i] as number;
    const P = pedal[i] as number;
    const prev = torque[i - 1] as number;
    const next = torque[i + 1] as number;
    const dt = (t[i + 1] as number) - (t[i - 1] as number);
    if (!Number.isFinite(prev) || !Number.isFinite(next) || !(dt > 0)) continue;
    // A transient, and the overshoot that follows it while boost settles, are
    // not the steady full-load value.
    if (Math.abs((next - prev) / dt) > ECU_TRANSIENT_RATE_NM_S) {
      lastTransient = t[i] as number;
      continue;
    }
    if ((t[i] as number) - lastTransient < ECU_SETTLE_S) continue;
    if (!Number.isFinite(T) || !Number.isFinite(R) || !Number.isFinite(P) || P < ECU_LOAD_PEDAL_MIN || T <= 0) continue;
    const centre = Math.round(R / ECU_CURVE_RPM_STEP) * ECU_CURVE_RPM_STEP;
    const list = bins.get(centre) ?? [];
    list.push(T);
    bins.set(centre, list);
  }

  const raw = new Map<number, Estimate>();
  for (const [centre, values] of bins) {
    if (values.length < ECU_MIN_SAMPLES_PER_BIN) continue;
    raw.set(centre, estimateFromSd(quantile(values, ECU_FULL_LOAD_QUANTILE), sd(values) / Math.sqrt(values.length)));
  }

  // A 1-2-1 average with the neighbouring bins that exist: adjacent bins are
  // often filled from different gears, whose slightly different transients put
  // a step between them that the engine does not have.
  for (const [centre, own] of raw) {
    let sum = 2 * own.value;
    let weight = 2;
    for (let k = 1; k <= ECU_CURVE_SMOOTH_HALF_WINDOW; k++) {
      for (const neighbour of [raw.get(centre - k * ECU_CURVE_RPM_STEP), raw.get(centre + k * ECU_CURVE_RPM_STEP)]) {
        if (!neighbour) continue;
        sum += neighbour.value;
        weight += 1;
      }
    }
    curve.set(centre, estimateFromSd(sum / weight, own.sd));
  }
  return curve;
}

export function compareEcuTorque(
  before: Session,
  after: Session,
  measured: readonly PowerCurvePoint[],
): EcuTorqueComparison | null {
  if (!before.channels.has('ecuTorque') || !after.channels.has('ecuTorque')) return null;
  const curveBefore = ecuFullLoadCurve(before);
  const curveAfter = ecuFullLoadCurve(after);

  const points: EcuTorquePoint[] = [...curveBefore.keys()]
    .filter((rpm) => curveAfter.has(rpm))
    .sort((a, b) => a - b)
    .map((rpm) => ({
      rpm,
      before: curveBefore.get(rpm) ?? NO_ESTIMATE,
      after: curveAfter.get(rpm) ?? NO_ESTIMATE,
    }));
  if (points.length < 2) return null;

  const peak = (pick: (p: EcuTorquePoint) => number) => {
    let best = points[0] as EcuTorquePoint;
    for (const p of points) if (pick(p) > pick(best)) best = p;
    return { value: pick(best), rpm: best.rpm };
  };
  const hp = (nm: number, rpm: number) => nm / hpToTorqueNm(1, rpm);

  const peakBefore = peak((p) => p.before.value);
  const peakAfter = peak((p) => p.after.value);
  const peakPowerBefore = peak((p) => hp(p.before.value, p.rpm));
  const peakPowerAfter = peak((p) => hp(p.after.value, p.rpm));

  // The change, averaged over the rpm points where both the ECU's figure and the
  // measured curve exist in both sessions.
  const reported: number[] = [];
  const measuredChange: number[] = [];
  const measuredSd: number[] = [];
  const measuredBeforeHp: number[] = [];
  const ecuBeforeHp: number[] = [];
  for (const p of points) {
    const m = measured.find((c) => c.rpm === p.rpm);
    if (!m || !Number.isFinite(m.delta.value)) continue;
    const scale = hpToTorqueNm(1, p.rpm);
    reported.push(p.after.value - p.before.value);
    measuredChange.push(m.delta.value * scale);
    measuredSd.push(m.delta.sd * scale);
    if (Number.isFinite(m.before.value)) {
      measuredBeforeHp.push(m.before.value);
      ecuBeforeHp.push(hp(p.before.value, p.rpm));
    }
  }

  const reportedChange = estimateFromSd(
    mean(reported.length > 0 ? reported : points.map((p) => p.after.value - p.before.value)),
    NaN,
  );
  // Neighbouring points are strongly correlated, so their spreads are averaged,
  // not combined as if independent — that would shrink the interval falsely.
  const delivered = reported.length > 0 ? estimateFromSd(mean(measuredChange), mean(measuredSd)) : NO_ESTIMATE;

  let agreement: EcuTorqueComparison['agreement'] = 'undetermined';
  if (Number.isFinite(reportedChange.value) && Number.isFinite(delivered.lo) && Number.isFinite(delivered.hi)) {
    if (reportedChange.value > delivered.hi) agreement = 'notDelivered';
    else if (reportedChange.value < delivered.lo) agreement = 'exceeds';
    else agreement = 'confirmed';
  }

  // How far the acceleration-based figure sits from the ECU's on the stock log:
  // the check on the vehicle model (mass, drag, a level road) for this log.
  const measuredOffset = measuredBeforeHp.length > 0 ? mean(measuredBeforeHp) / mean(ecuBeforeHp) - 1 : NaN;

  return {
    points,
    peakBefore,
    peakAfter,
    peakPowerBefore,
    peakPowerAfter,
    torqueDelta: peakAfter.value - peakBefore.value,
    powerDelta: peakPowerAfter.value - peakPowerBefore.value,
    reportedChange,
    measuredChange: delivered,
    agreement,
    measuredOffset,
    measuredReliable: Number.isFinite(measuredOffset) && Math.abs(measuredOffset) <= ECU_MEASURED_MISMATCH_FRACTION,
  };
}
