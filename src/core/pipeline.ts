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

import { detectHeatSoak, detectResidualOutliers, detectThresholds } from './detect';
import type { DetectorContext } from './detect';
import { pairPulls } from './dtw';
import type { Pairing } from './dtw';
import { CONFIDENCE, MIN_PULLS_PER_SESSION, SIGNIFICANCE_ALPHA } from './constants';
import { nominalDraw, powerCurveWatts, wattsToHp } from './power';
import { checkPair, checkSession } from './protocol';
import { recommend } from './recommend';
import { buildRpmAxis, classifyGears, segment } from './segment';
import type { PullData, SegmentationResult } from './segment';
import { coefficientOfVariation, makeRng, mean, permutationPValue, seedFrom } from './stats';
import { runMonteCarlo } from './uncertainty';
import type { SessionBasis } from './uncertainty';
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
  const rpmAxis = buildRpmAxis();

  const segBefore = segment(before, vehicle, rpmAxis);
  const segAfter = segment(after, vehicle, rpmAxis);

  // Gears are classified across both sessions at once, so that "gear 3" means the
  // same gear in both logs. Classifying them separately would let a 3rd-gear
  // before-session and a 4th-gear after-session both be labelled "gear 1".
  classifyGears(
    [segBefore.pulls, segAfter.pulls],
    [before.channels.get('gear'), after.channels.get('gear')],
  );

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

  const mc = runMonteCarlo(basisBefore, basisAfter, vehicle, rpmAxis, rng, options.monteCarloDraws);

  // Significance is tested on the per-pull peaks rather than on the Monte Carlo
  // draws: the question "did this tune do anything" is a question about the pulls,
  // and the parameter uncertainty is common to both sessions and cancels.
  const pValue = permutationPValue(mc.peakPerPullBefore, mc.peakPerPullAfter, rng);
  const significant = Number.isFinite(pValue) && pValue < SIGNIFICANCE_ALPHA;

  const gain: GainResult = {
    peakBefore: mc.peakBefore,
    peakAfter: mc.peakAfter,
    delta: mc.delta,
    deltaPercent: mc.deltaPercent,
    commonModeCancellation: mc.commonModeCancellation,
    significant,
    pValue,
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
    ...runDetectors(before, segBefore, 'before', curvesBefore, rpmAxis),
    ...runDetectors(after, segAfter, 'after', curvesAfter, rpmAxis),
  ];

  const recommendations = recommend(findings);

  // The validity card scores the *merged* findings, not the raw ones: knock from
  // 4000 to 5500 rpm is one problem, and subtracting its penalty once per zone
  // would fail a tune on arithmetic rather than on evidence.
  const cvAfter = coefficientOfVariation(mc.peakPerPullAfter);
  const validity = buildValidityCard(
    gain,
    cvAfter,
    recommendations.map((recommendation) => recommendation.finding),
  );

  const violations = [
    ...checkSession({
      session: before,
      pulls: segBefore.pulls,
      rejectedCount: segBefore.rejected.length,
      which: 'before',
    }),
    ...checkSession({
      session: after,
      pulls: segAfter.pulls,
      rejectedCount: segAfter.rejected.length,
      which: 'after',
    }),
    ...checkPair(segBefore.pulls, segAfter.pulls),
  ];

  return {
    before: summarise(before, segBefore, mc.peakBefore, mc.peakPerPullBefore),
    after: summarise(after, segAfter, mc.peakAfter, mc.peakPerPullAfter),
    gain,
    curve: mc.curve,
    findings,
    recommendations,
    validity,
    budget: mc.budget,
    violations,
    vehicle,
    seed,
    computedAt: new Date().toISOString(),
    pairings,
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
