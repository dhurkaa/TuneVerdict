/**
 * Requested vs delivered.
 *
 * The core principle of the thesis: the strongest diagnostic signal is not the
 * absolute value of any channel, but the difference between what the ECU asked
 * for and what the engine delivered. A boost figure of 1.38 bar is neither good
 * nor bad; a boost figure of 1.38 bar against a request of 1.50 bar says the
 * turbocharger cannot do what the map asks of it, and that is something a tuner
 * can act on.
 *
 * Four pairs are tracked where the log carries them:
 *   boost     boost target            → boost
 *   lambda    λ target                → λ
 *   fuelRail  rail pressure target    → rail pressure
 *   timing    advance + knock retard  → advance (the request is reconstructed:
 *             no OBD-2 source logs the pre-retard advance directly)
 */

import {
  BOOST_SETTLED_FRACTION,
  MIN_PULL_COVERAGE_FRACTION,
  TRACKING_MIN_BOOST_REQUEST_KPA,
  TRACKING_TOLERANCE,
} from './constants';
import { zoneRange, zones } from './detect';
import type { PullData } from './segment';
import { bootstrapMean, estimateFromSd, mean, median, sd } from './stats';
import type { Rng } from './stats';
import type {
  Estimate,
  TrackedQuantity,
  TrackingPoint,
  TrackingSeries,
  TrackingStatus,
  TrackingZone,
} from './types';

interface PairSpec {
  readonly quantity: TrackedQuantity;
  readonly requested: (pull: PullData) => Float64Array | null;
  readonly delivered: (pull: PullData) => Float64Array | null;
  /** Relative error (fraction of the request) or absolute (degrees). */
  readonly relative: boolean;
  readonly tolerance: number;
  readonly requestSource: TrackingSeries['requestSource'];
  /** Requests at or below this value are not compared. */
  readonly minRequest: number;
}

const channel =
  (id: string) =>
  (pull: PullData): Float64Array | null =>
    (pull.onRpm.get(id) as Float64Array | undefined) ?? null;

/**
 * The timing request, reconstructed as logged advance plus the retard the knock
 * controller applied. Only available when both are logged; the UI labels it as a
 * reconstruction rather than a measurement.
 */
function requestedTiming(pull: PullData): Float64Array | null {
  const timing = pull.onRpm.get('timing');
  const retard = pull.onRpm.get('knockRetard');
  if (!timing || !retard) return null;
  const out = new Float64Array(timing.length).fill(NaN);
  for (let i = 0; i < timing.length; i++) {
    const t = timing[i] as number;
    const r = retard[i] as number;
    if (Number.isFinite(t) && Number.isFinite(r)) out[i] = t + Math.max(0, r);
  }
  return out;
}

const PAIRS: readonly PairSpec[] = [
  {
    quantity: 'boost',
    requested: channel('boostTarget'),
    delivered: channel('boost'),
    relative: true,
    tolerance: TRACKING_TOLERANCE.boost,
    requestSource: 'logged',
    minRequest: TRACKING_MIN_BOOST_REQUEST_KPA,
  },
  {
    quantity: 'lambda',
    requested: channel('lambdaTarget'),
    delivered: channel('lambda'),
    relative: true,
    tolerance: TRACKING_TOLERANCE.lambda,
    requestSource: 'logged',
    minRequest: 0,
  },
  {
    quantity: 'fuelRail',
    requested: channel('fuelRailTarget'),
    delivered: channel('fuelRail'),
    relative: true,
    tolerance: TRACKING_TOLERANCE.fuelRail,
    requestSource: 'logged',
    minRequest: 0,
  },
  {
    quantity: 'timing',
    requested: requestedTiming,
    delivered: channel('timing'),
    relative: false,
    tolerance: TRACKING_TOLERANCE.timingDeg,
    requestSource: 'reconstructed',
    minRequest: -Infinity,
  },
];

function errorOf(spec: PairSpec, requested: number, delivered: number): number {
  if (!Number.isFinite(requested) || !Number.isFinite(delivered)) return NaN;
  if (requested <= spec.minRequest) return NaN;
  if (!spec.relative) return delivered - requested;
  return requested === 0 ? NaN : (delivered - requested) / requested;
}

/**
 * The rpm at which a pull's boost reached its settled plateau. Below it, a
 * delivered value short of the request is spool, not a fault.
 */
function spoolRpm(pull: PullData, rpmAxis: Float64Array): number {
  const boost = pull.onRpm.get('boost');
  if (!boost) return NaN;
  let max = -Infinity;
  for (const value of boost) if (Number.isFinite(value) && value > max) max = value;
  if (!Number.isFinite(max) || max <= 0) return NaN;
  for (let i = 0; i < boost.length; i++) {
    const value = boost[i] as number;
    if (Number.isFinite(value) && value >= BOOST_SETTLED_FRACTION * max) return rpmAxis[i] as number;
  }
  return NaN;
}

/** Mean with a standard-error band — adequate for drawing a curve point. */
function meanEstimate(values: readonly number[]): Estimate {
  const m = mean(values);
  const s = values.length > 1 ? sd(values) / Math.sqrt(values.length) : NaN;
  return estimateFromSd(m, s);
}

export function trackSession(
  pulls: readonly PullData[],
  rpmAxis: Float64Array,
  session: 'before' | 'after',
  rng: Rng,
): TrackingSeries[] {
  const series: TrackingSeries[] = [];
  if (pulls.length === 0) return series;
  const minPulls = Math.max(1, Math.ceil(MIN_PULL_COVERAGE_FRACTION * pulls.length));

  for (const spec of PAIRS) {
    const perPull = pulls.map((pull) => ({ requested: spec.requested(pull), delivered: spec.delivered(pull) }));
    if (!perPull.some((p) => p.requested && p.delivered)) continue;

    // --- per rpm point -------------------------------------------------------
    const points: TrackingPoint[] = [];
    for (let k = 0; k < rpmAxis.length; k++) {
      const requested: number[] = [];
      const delivered: number[] = [];
      const errors: number[] = [];
      for (const { requested: req, delivered: del } of perPull) {
        if (!req || !del) continue;
        const r = req[k] as number;
        const d = del[k] as number;
        const e = errorOf(spec, r, d);
        if (!Number.isFinite(e)) continue;
        requested.push(r);
        delivered.push(d);
        errors.push(spec.relative ? d - r : e);
      }
      if (errors.length < minPulls) continue;
      points.push({
        rpm: rpmAxis[k] as number,
        requested: meanEstimate(requested),
        delivered: meanEstimate(delivered),
        error: meanEstimate(errors),
        pulls: errors.length,
      });
    }
    if (points.length === 0) continue;

    // --- per zone --------------------------------------------------------------
    const spoolRpms = spec.quantity === 'boost' ? pulls.map((p) => spoolRpm(p, rpmAxis)) : [];
    const typicalSpool = spoolRpms.length > 0 ? median(spoolRpms) : NaN;

    const zoneResults: TrackingZone[] = zones().map((zone) => {
      const [lo, hi] = zoneRange(rpmAxis, zone);
      const pullMeans: number[] = [];
      for (const { requested: req, delivered: del } of perPull) {
        if (!req || !del) continue;
        const errors: number[] = [];
        for (let k = lo; k <= hi; k++) {
          const e = errorOf(spec, req[k] as number, del[k] as number);
          if (Number.isFinite(e)) errors.push(e);
        }
        if (errors.length > 0) pullMeans.push(mean(errors));
      }

      if (pullMeans.length < minPulls) {
        return { zone, error: { value: NaN, sd: NaN, lo: NaN, hi: NaN }, status: 'insufficient' as TrackingStatus };
      }

      const error = bootstrapMean(pullMeans, rng);
      // A deviation is reported only when it is both larger than the tolerance and
      // distinguishable from zero across pulls. Either alone is not enough: a
      // large but inconsistent error is noise, a consistent but tiny one is not
      // worth a tuner's time. With a single pull there is no spread to test
      // against, so the tolerance alone decides — the protocol panel already says
      // the session has too few pulls for a measured scatter.
      const provenNonZero = pullMeans.length === 1 || error.lo > 0 || error.hi < 0;
      let status: TrackingStatus = 'onTarget';
      if (provenNonZero && Math.abs(error.value) > spec.tolerance) {
        status = error.value < 0 ? 'short' : 'over';
        if (status === 'short' && spec.quantity === 'boost' && zone.rpmLow < typicalSpool) {
          status = 'spooling';
        }
      }
      return { zone, error, status };
    });

    series.push({
      quantity: spec.quantity,
      session,
      requestSource: spec.requestSource,
      points,
      zones: zoneResults,
    });
  }

  return series;
}

/** Spool rpm per pull, for the correction table's boost-shortfall rule. */
export function pullSpoolRpm(pull: PullData, rpmAxis: Float64Array): number {
  return spoolRpm(pull, rpmAxis);
}
