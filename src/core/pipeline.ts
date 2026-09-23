/**
 * The pipeline, assembled.
 *
 * Import → resample → segment → normalise → align → compare → detect → recommend
 * → score → propagate uncertainty. Each stage lives in its own module; this file
 * is the order they run in and the plumbing between them, and nothing else.
 *
 * It is deliberately synchronous and pure: the same two sessions and the same
 * vehicle parameters produce the same AnalysisResult, byte for byte, because the
 * random source is seeded from the input itself.
 */

import { gainBands } from './bands';
import { buildCorrections } from './corrections';
import { compareEcuTorque } from './ecuTorque';
import { assessHealth } from './health';
import { detectHeatSoak, detectResidualOutliers, detectThresholds } from './detect';
import { loggingAdvice } from './loggingAdvice';
import { computeMargins } from './margins';
import { trackSession } from './tracking';
import type { DetectorContext } from './detect';
import { pairPulls } from './dtw';
import type { Pairing } from './dtw';
import {
  CONFIDENCE,
  MIN_PULLS_FOR_STATISTICS,
  MIN_PULLS_PER_SESSION,
  PRIOR_PULL_CV,
  SIGNIFICANCE_ALPHA,
} from './constants';
import { nominalDraw, powerCurveWatts, wattsToHp } from './power';
import { checkFuel, checkPair, checkSession } from './protocol';
import { recommend } from './recommend';
import { buildRpmAxis, classifyGears, protocolRpmRange, segment } from './segment';
import type { PullData, SegmentationResult } from './segment';
import {
  coefficientOfVariation,
  makeRng,
  mean,
  normalCdf,
  permutationPValue,
  seedFrom,
  widenEstimate,
} from './stats';
import { runMonteCarlo } from './uncertainty';
import type { MonteCarloOutput, SessionBasis } from './uncertainty';
import { buildValidityCard } from './validity';
import type {
  AnalysisResult,
  ChannelProvenanceLookup,
  Finding,
  GainResult,
  Session,
  SessionSummary,
  VehicleParameters,
} from './types';

export class AnalysisError extends Error {
  constructor(
    readonly key: string,
    readonly detail: Record<string, string | number> = {},
  ) {
    super(key);
    this.name = 'AnalysisError';
  }
}

export interface AnalyseOptions {
  /** Override the derived seed. Only tests should need this. */
  readonly seed?: number;
  readonly monteCarloDraws?: number;
}

export function analyse(
  before: Session,
  after: Session,
  vehicle: VehicleParameters,
  options: AnalyseOptions = {},
): AnalysisResult {
  const range = protocolRpmRange(vehicle.fuel);
  const rpmAxis = buildRpmAxis(range.low, range.high);

  const segmentedBefore = segment(before, vehicle, rpmAxis);
  const segmentedAfter = segment(after, vehicle, rpmAxis);

  // Gears are classified across both sessions at once, so that "gear 3" means the
  // same gear in both logs. Classifying them separately would let a 3rd-gear
  // before-session and a 4th-gear after-session both be labelled "gear 1".
  classifyGears(
    [segmentedBefore.pulls, segmentedAfter.pulls],
    [before.channels.get('gear'), after.channels.get('gear')],
  );

  // Compare like with like: when the logs hold pulls in several gears — a road log
  // from an automatic gearbox always does — only the gear both sessions share, and
  // cover best, is compared. The rest are reported as rejected, with the reason.
  const [segBefore, segAfter] = selectCommonGear(segmentedBefore, segmentedAfter);

  if (segBefore.pulls.length < MIN_PULLS_PER_SESSION) {
    throw new AnalysisError('analysis.error.tooFewPulls', {
      session: before.label,
      found: segBefore.pulls.length,
      minimum: MIN_PULLS_PER_SESSION,
      rejected: segBefore.rejected.length,
    });
  }
  if (segAfter.pulls.length < MIN_PULLS_PER_SESSION) {
    throw new AnalysisError('analysis.error.tooFewPulls', {
      session: after.label,
      found: segAfter.pulls.length,
      minimum: MIN_PULLS_PER_SESSION,
      rejected: segAfter.rejected.length,
    });
  }

  const seed = options.seed ?? seedFrom(before.label, after.label, before.sourceRowCount, after.sourceRowCount, vehicle.massKg);
  const rng = makeRng(seed);

  const basisBefore = toSessionBasis(segBefore);
  const basisAfter = toSessionBasis(segAfter);

  const rawMc = runMonteCarlo(basisBefore, basisAfter, vehicle, rpmAxis, rng, options.monteCarloDraws);

  const nBefore = segBefore.pulls.length;
  const nAfter = segAfter.pulls.length;
  const fewPulls = nBefore < MIN_PULLS_FOR_STATISTICS || nAfter < MIN_PULLS_FOR_STATISTICS;
  const mc = fewPulls ? withAssumedScatter(rawMc, nBefore, nAfter) : rawMc;

  // Significance is tested on the per-pull peaks rather than on the Monte Carlo
  // draws: the question "did this tune do anything" is a question about the pulls,
  // and the parameter uncertainty is common to both sessions and cancels. With too
  // few pulls for a permutation test, a z-test against the assumed pull-to-pull
  // scatter stands in — and the protocol panel says it was assumed.
  const pValue = fewPulls
    ? mc.delta.sd > 0
      ? 2 * (1 - normalCdf(Math.abs(mc.delta.value) / mc.delta.sd))
      : NaN
    : permutationPValue(mc.peakPerPullBefore, mc.peakPerPullAfter, rng);
  const significant = Number.isFinite(pValue) && pValue < SIGNIFICANCE_ALPHA;

  const gain: GainResult = {
    peakBefore: mc.peakBefore,
    peakAfter: mc.peakAfter,
    delta: mc.delta,
    deltaPercent: mc.deltaPercent,
    commonModeCancellation: mc.commonModeCancellation,
    significant,
    pValue,
    averageDelta: mc.averageDelta,
    bands: gainBands(mc.curve),
    peakTorqueBefore: mc.peakTorqueBefore,
    peakTorqueAfter: mc.peakTorqueAfter,
    torqueDelta: mc.torqueDelta,
    peakRpm: mc.peakRpm,
  };

  // DTW pairing runs on the per-pull power curves: it is what lets a finding be
  // reported against a specific counterpart rather than against the session mean.
  const curvesBefore = nominalCurves(segBefore.pulls, vehicle, rpmAxis.length);
  const curvesAfter = nominalCurves(segAfter.pulls, vehicle, rpmAxis.length);
  const pairings: Pairing[] = pairPulls(
    curvesBefore.map((c) => Array.from(c)),
    curvesAfter.map((c) => Array.from(c)),
  );

  const findings: Finding[] = [
    ...runDetectors(before, segBefore, 'before', curvesBefore, rpmAxis, vehicle.fuel),
    ...runDetectors(after, segAfter, 'after', curvesAfter, rpmAxis, vehicle.fuel),
  ];

  const recommendations = recommend(findings);

  // The validity card scores the *merged* findings, not the raw ones: knock from
  // 4000 to 5500 rpm is one problem, and subtracting its penalty once per zone
  // would fail a tune on arithmetic rather than on evidence.
  // One pull has no scatter to measure; the assumed figure stands in, so a single
  // pull is neither rewarded with perfect consistency nor punished with none.
  const cvAfter = nAfter >= 2 ? coefficientOfVariation(mc.peakPerPullAfter) : PRIOR_PULL_CV;
  const validity = buildValidityCard(
    gain,
    cvAfter,
    recommendations.map((recommendation) => recommendation.finding),
  );

  // --- what the tuner can act on ----------------------------------------------
  // Requested vs delivered for both sessions; margins and corrections for the
  // after session only, because the question they answer is what to change in the
  // tune as it now stands.
  const tracking = [
    ...trackSession(segBefore.pulls, rpmAxis, 'before', rng),
    ...trackSession(segAfter.pulls, rpmAxis, 'after', rng),
  ];
  const mergedAfter = recommendations
    .map((recommendation) => recommendation.finding)
    .filter((finding) => finding.evidence.session === 'after');
  const corrections = buildCorrections(
    segAfter.pulls,
    rpmAxis,
    mergedAfter,
    tracking.filter((series) => series.session === 'after'),
    after.sourceSampleRateHz,
  );
  const margins = computeMargins(segAfter.pulls, rpmAxis, rng, vehicle.fuel);

  const violations = [
    ...checkSession({
      session: before,
      pulls: segBefore.pulls,
      rejectedCount: segBefore.rejected.length,
      which: 'before',
      rpmRange: range,
    }),
    ...checkSession({
      session: after,
      pulls: segAfter.pulls,
      rejectedCount: segAfter.rejected.length,
      which: 'after',
      rpmRange: range,
    }),
    ...checkPair(segBefore.pulls, segAfter.pulls),
    ...checkFuel(segAfter.pulls, vehicle.fuel),
  ];

  const ecu = compareEcuTorque(before, after, mc.curve);
  const cvBefore = nBefore >= 2 ? coefficientOfVariation(mc.peakPerPullBefore) : PRIOR_PULL_CV;
  const health = assessHealth({
    sessions: { before, after },
    pulls: { before: segBefore.pulls, after: segAfter.pulls },
    cv: { before: cvBefore, after: cvAfter },
    tracking,
    findings: recommendations.map((recommendation) => recommendation.finding),
    ecu,
    fuel: vehicle.fuel,
  });

  return {
    before: summarise(before, segBefore, mc.peakBefore, mc.peakPerPullBefore),
    after: summarise(after, segAfter, mc.peakAfter, mc.peakPerPullAfter),
    gain,
    curve: mc.curve,
    findings,
    recommendations,
    tracking,
    ecu,
    health,
    corrections,
    margins,
    loggingAdvice: loggingAdvice(before, after, vehicle.fuel),
    validity,
    budget: mc.budget,
    violations,
    vehicle,
    seed,
    computedAt: new Date().toISOString(),
    pairings,
  };
}

/**
 * Keep only the gear both sessions share, choosing the one they cover best
 * together; pulls in other gears move to `rejected` with a reason. When the
 * sessions share no gear, nothing is dropped and the protocol check reports the
 * mismatch instead.
 */
function selectCommonGear(
  before: SegmentationResult,
  after: SegmentationResult,
): [SegmentationResult, SegmentationResult] {
  const coverage = (result: SegmentationResult, gear: number): number =>
    result.pulls
      .filter((p) => p.pull.gear === gear)
      .reduce((sum, p) => sum + Math.max(0, p.pull.rpmEnd - p.pull.rpmStart), 0);
  const gearsBefore = new Set(before.pulls.map((p) => p.pull.gear));
  const gearsAfter = new Set(after.pulls.map((p) => p.pull.gear));
  if (gearsBefore.size <= 1 && gearsAfter.size <= 1) return [before, after];

  const shared = [...gearsBefore].filter((g) => gearsAfter.has(g));
  if (shared.length === 0) return [before, after];

  let best = shared[0] as number;
  for (const gear of shared) {
    if (Math.min(coverage(before, gear), coverage(after, gear)) > Math.min(coverage(before, best), coverage(after, best))) {
      best = gear;
    }
  }

  const keep = (result: SegmentationResult): SegmentationResult => ({
    ...result,
    pulls: result.pulls.filter((p) => p.pull.gear === best),
    rejected: [
      ...result.rejected,
      ...result.pulls
        .filter((p) => p.pull.gear !== best)
        .map((p) => ({ ...p.pull, rejected: 'segment.rejected.otherGear' })),
    ],
  });
  return [keep(before), keep(after)];
}

/**
 * Add the assumed pull-to-pull scatter (PRIOR_PULL_CV) to every figure that
 * compares or reports a session, when there were too few pulls to measure it.
 * Without this, one pull against one pull would carry only the parameter
 * uncertainty — which cancels in a comparison — and a 2 hp difference would look
 * proven.
 */
function withAssumedScatter(mc: MonteCarloOutput, nBefore: number, nAfter: number): MonteCarloOutput {
  const both = Math.sqrt(1 / nBefore + 1 / nAfter);
  const peakMean = mean([mc.peakBefore.value, mc.peakAfter.value]);
  const torqueMean = mean([mc.peakTorqueBefore.value, mc.peakTorqueAfter.value]);

  const curve = mc.curve.map((point) => {
    const level = mean([point.before.value, point.after.value]);
    return {
      ...point,
      before: widenEstimate(point.before, (PRIOR_PULL_CV * point.before.value) / Math.sqrt(nBefore)),
      after: widenEstimate(point.after, (PRIOR_PULL_CV * point.after.value) / Math.sqrt(nAfter)),
      delta: widenEstimate(point.delta, PRIOR_PULL_CV * level * both),
    };
  });
  const bandLevel = mean(curve.map((p) => mean([p.before.value, p.after.value])));

  return {
    ...mc,
    peakBefore: widenEstimate(mc.peakBefore, (PRIOR_PULL_CV * mc.peakBefore.value) / Math.sqrt(nBefore)),
    peakAfter: widenEstimate(mc.peakAfter, (PRIOR_PULL_CV * mc.peakAfter.value) / Math.sqrt(nAfter)),
    delta: widenEstimate(mc.delta, PRIOR_PULL_CV * peakMean * both),
    deltaPercent: widenEstimate(mc.deltaPercent, PRIOR_PULL_CV * 100 * both),
    averageDelta: widenEstimate(mc.averageDelta, PRIOR_PULL_CV * bandLevel * both),
    peakTorqueBefore: widenEstimate(mc.peakTorqueBefore, (PRIOR_PULL_CV * mc.peakTorqueBefore.value) / Math.sqrt(nBefore)),
    peakTorqueAfter: widenEstimate(mc.peakTorqueAfter, (PRIOR_PULL_CV * mc.peakTorqueAfter.value) / Math.sqrt(nAfter)),
    torqueDelta: widenEstimate(mc.torqueDelta, PRIOR_PULL_CV * torqueMean * both),
    curve,
  };
}

function toSessionBasis(result: SegmentationResult): SessionBasis {
  return {
    bases: result.pulls.map((p) => p.basis),
    corrections: result.pulls.map((p) => p.pull.correction.factor),
  };
}

/** Per-pull power curves in hp at nominal parameters, for pairing and residuals. */
function nominalCurves(
  pulls: readonly PullData[],
  vehicle: VehicleParameters,
  k: number,
): Float64Array[] {
  const draw = nominalDraw(vehicle, 0);
  const scratch = new Float64Array(k);
  return pulls.map((pull) => {
    powerCurveWatts(pull.basis, draw, scratch);
    const curve = new Float64Array(k);
    for (let i = 0; i < k; i++) {
      const watts = scratch[i] as number;
      curve[i] = Number.isFinite(watts) ? wattsToHp(watts) * pull.pull.correction.factor : NaN;
    }
    return curve;
  });
}

function runDetectors(
  session: Session,
  result: SegmentationResult,
  which: 'before' | 'after',
  curves: readonly Float64Array[],
  rpmAxis: Float64Array,
  fuel: VehicleParameters['fuel'],
): Finding[] {
  const provenanceOf: ChannelProvenanceLookup = (channel) =>
    session.channels.has(channel) ? (session.provenance.get(channel) ?? 'measured') : 'missing';

  const ctx: DetectorContext = {
    session: which,
    pulls: result.pulls,
    rpmAxis,
    provenanceOf,
    sourceSampleRateHz: session.sourceSampleRateHz,
    correctionInBand: result.pulls.every((p) => p.pull.correction.inValidBand),
    iatRiseC: intakeTemperatureRise(result),
    fuel,
  };

  const findings = [...detectThresholds(ctx), ...detectResidualOutliers(ctx, curves)];
  const heatSoak = detectHeatSoak(ctx);
  if (heatSoak) findings.push(heatSoak);
  return findings;
}

/**
 * Intake air temperature rise across a session: the last pull's mean minus the
 * first pull's. Heat-soak is a property of the session's order, which is why this
 * is not simply the range of the IAT channel.
 */
function intakeTemperatureRise(result: SegmentationResult): number {
  const pulls = result.pulls;
  if (pulls.length < 2) return NaN;
  const first = pulls[0]?.pull.meanIatC;
  const last = pulls[pulls.length - 1]?.pull.meanIatC;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return NaN;
  return (last as number) - (first as number);
}

function summarise(
  session: Session,
  result: SegmentationResult,
  peakPower: AnalysisResult['before']['peakPower'],
  perPullPeaks: readonly number[],
): SessionSummary {
  const gears = result.pulls.map((p) => p.pull.gear).filter((g) => g > 0);
  return {
    label: session.label,
    pulls: [...result.pulls.map((p) => p.pull), ...result.rejected],
    acceptedPulls: result.pulls.length,
    rejectedPulls: result.rejected.length,
    gear: gears.length > 0 ? (gears[0] as number) : 0,
    gearIsRelative: !session.channels.has('gear'),
    meanIatC: mean(result.pulls.map((p) => p.pull.meanIatC)),
    iatRiseC: intakeTemperatureRise(result),
    meanCorrection: mean(result.pulls.map((p) => p.pull.correction.factor)),
    sourceSampleRateHz: session.sourceSampleRateHz,
    peakPower,
    cv: coefficientOfVariation(perPullPeaks),
  };
}

/**
 * The expected calibration error of the confidence values, surfaced so the UI can
 * state it rather than imply a precision the calibration does not have.
 */
export const REPORTED_CALIBRATION_ERROR = CONFIDENCE.expectedCalibrationError;
