/**
 * Stage 6: hybrid anomaly detection.
 *
 * "Hybrid" means two sources of evidence, deliberately kept separate:
 *
 *   - Physical rules with experimentally calibrated thresholds. These know what
 *     they are looking at: knock retard is degrees of ignition timing the ECU took
 *     away, and 0.7° of it is a real event whatever the statistics say.
 *   - An outlier model over the residuals, which catches what no rule was written
 *     for — a pull that does not behave like its siblings for a reason nobody
 *     anticipated.
 *
 * Every detector returns evidence, not a verdict: which pulls, which zone, how many
 * samples, what the peak value was and what it was compared against. The
 * recommendation engine turns that into advice; the UI can always show the user
 * what the machine actually saw.
 */

import type { ChannelId } from './channels';
import {
  BOOST_SETTLED_FRACTION,
  BOOST_SETTLED_MIN_SAMPLES,
  CONFIDENCE,
  DETECTOR,
  DETECTOR_MIN_PERSISTENCE,
  DETECTOR_MIN_PULL_FRACTION,
  EGT_CAUTION_C,
  EGT_RISK_C,
  IAT_HEAT_SOAK_RISE_C,
  MAD_TO_SD,
  RESIDUAL_OUTLIER_Z,
  TARGET_SAMPLE_RATE_HZ,
  ZONE_RPM_EDGES,
} from './constants';
import { detrendLinear, rms } from './signal';
import { clamp, mad, median, quantile } from './stats';
import type { PullData } from './segment';
import type {
  Evidence,
  Finding,
  FindingKind,
  Provenance,
  Severity,
  Zone,
} from './types';

export interface DetectorContext {
  readonly session: 'before' | 'after';
  readonly pulls: readonly PullData[];
  readonly rpmAxis: Float64Array;
  /** Provenance of a channel in the session the pulls came from. */
  readonly provenanceOf: (channel: ChannelId) => Provenance | 'missing';
  readonly sourceSampleRateHz: number;
  /** Whether every pull's atmospheric correction stayed inside the valid band. */
  readonly correctionInBand: boolean;
  /** Intake air temperature rise across the session, °C. */
  readonly iatRiseC: number;
  /**
   * The fuel. A diesel runs lean by design — λ 1.2–5 under load is normal and
   * the smoke limit, not the lean limit, is its constraint — so the petrol lean
   * detector is not run on a diesel: it would fire on every pull.
   */
  readonly fuel: 'gasoline' | 'diesel' | 'e85' | 'lpg';
}

/** The rpm bands findings are reported in. */
export function zones(): Zone[] {
  const out: Zone[] = [];
  for (let i = 0; i < ZONE_RPM_EDGES.length - 1; i++) {
    out.push({ rpmLow: ZONE_RPM_EDGES[i] as number, rpmHigh: ZONE_RPM_EDGES[i + 1] as number });
  }
  return out;
}

/**
 * Zones are half-open, [low, high), except the last, which includes its upper
 * edge. With closed zones the point at 5000 rpm belonged to both 4000–5000 and
 * 5000–5500, so an event that began exactly at a boundary was counted in the zone
 * below it as well.
 */
function zoneIndices(rpmAxis: Float64Array, zone: Zone): [number, number] {
  const lastEdge = ZONE_RPM_EDGES[ZONE_RPM_EDGES.length - 1] as number;
  let lo = rpmAxis.length;
  let hi = -1;
  for (let i = 0; i < rpmAxis.length; i++) {
    const rpm = rpmAxis[i] as number;
    const belowTop = rpm < zone.rpmHigh || (zone.rpmHigh === lastEdge && rpm <= zone.rpmHigh);
    if (rpm >= zone.rpmLow && belowTop) {
      if (i < lo) lo = i;
      if (i > hi) hi = i;
    }
  }
  return [lo, hi];
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

interface ConfidenceInput {
  readonly agreeingPulls: number;
  readonly totalPulls: number;
  readonly peakValue: number;
  readonly threshold: number;
  /** Direction: 'above' when exceeding the threshold is the anomaly. */
  readonly direction: 'above' | 'below';
  readonly provenance: Provenance;
  readonly uncalibrated: boolean;
  readonly sourceSampleRateHz: number;
  readonly correctionInBand: boolean;
}

/**
 * Calibrated confidence for a finding.
 *
 * The ceiling is the point of this function. On the validation set the detectors
 * were empirically perfect, but ten correct answers out of ten only prove accuracy
 * above the Wilson lower bound of 0.7225 — so nothing here may report more than
 * that, however obvious the evidence looks. Everything else raises or lowers the
 * value inside that ceiling, and every adjustment is recorded so the UI can show
 * its work.
 */
export function computeConfidence(input: ConfidenceInput): {
  confidence: number;
  trace: { reason: string; delta: number }[];
} {
  const trace: { reason: string; delta: number }[] = [];
  let value = CONFIDENCE.base;
  trace.push({ reason: 'confidence.base', delta: CONFIDENCE.base });

  const extraPulls = Math.max(0, input.agreeingPulls - 1);
  const pullBonus = Math.min(CONFIDENCE.maxPullBonus, extraPulls * CONFIDENCE.perAgreeingPull);
  if (pullBonus > 0) {
    value += pullBonus;
    trace.push({ reason: 'confidence.agreeingPulls', delta: pullBonus });
  }

  // How far past the threshold the evidence sits, relative to the threshold.
  const margin =
    input.direction === 'above'
      ? input.peakValue / input.threshold - 1
      : input.threshold / input.peakValue - 1;
  if (Number.isFinite(margin) && margin > 0) {
    // Saturating: twice the threshold is convincing, ten times is not five times
    // as convincing — it is more likely a sensor fault.
    const marginBonus = CONFIDENCE.maxMarginBonus * (1 - Math.exp(-2 * margin));
    value += marginBonus;
    trace.push({ reason: 'confidence.margin', delta: marginBonus });
  }

  if (input.provenance === 'derived' || input.provenance === 'assumed') {
    value -= CONFIDENCE.derivedChannelPenalty;
    trace.push({ reason: 'confidence.derivedChannel', delta: -CONFIDENCE.derivedChannelPenalty });
  }
  if (input.uncalibrated) {
    value -= CONFIDENCE.uncalibratedDetectorPenalty;
    trace.push({
      reason: 'confidence.uncalibratedDetector',
      delta: -CONFIDENCE.uncalibratedDetectorPenalty,
    });
  }
  if (input.sourceSampleRateHz < TARGET_SAMPLE_RATE_HZ) {
    value -= CONFIDENCE.lowSampleRatePenalty;
    trace.push({ reason: 'confidence.lowSampleRate', delta: -CONFIDENCE.lowSampleRatePenalty });
  }
  if (!input.correctionInBand) {
    value -= CONFIDENCE.outOfBandCorrectionPenalty;
    trace.push({
      reason: 'confidence.outOfBandCorrection',
      delta: -CONFIDENCE.outOfBandCorrectionPenalty,
    });
  }

  const capped = clamp(value, 0, CONFIDENCE.cap);
  if (capped < value) {
    trace.push({ reason: 'confidence.wilsonCap', delta: capped - value });
  }
  return { confidence: capped, trace };
}

// ---------------------------------------------------------------------------
// Threshold detectors
// ---------------------------------------------------------------------------

interface ThresholdSpec {
  readonly kind: FindingKind;
  readonly severity: Severity;
  readonly channel: ChannelId;
  readonly threshold: number;
  readonly direction: 'above' | 'below';
  readonly uncalibrated?: boolean;
  /** Transform the channel series before comparison (e.g. into a fraction of target). */
  readonly transform?: (pull: PullData, lo: number, hi: number) => Float64Array | null;
}

function seriesFor(pull: PullData, channel: ChannelId): Float64Array | null {
  return (pull.onRpm.get(channel) as Float64Array | undefined) ?? null;
}

/**
 * Boost above target, as a fraction of target.
 *
 * When the log carries no target channel — most consumer logs do not — the pull's
 * own settled plateau stands in for it: the median of the upper half of the boost
 * trace. That makes the detector measure overshoot *relative to what the system
 * settled at*, which is what a spike above a plateau actually is. The substitution
 * is reported as a derived channel and costs confidence accordingly.
 */
function boostExcess(pull: PullData, lo: number, hi: number): Float64Array | null {
  const boost = seriesFor(pull, 'boost');
  if (!boost) return null;
  const target = seriesFor(pull, 'boostTarget');
  const out = new Float64Array(boost.length).fill(NaN);

  const window: number[] = [];
  for (let i = lo; i <= hi; i++) {
    const v = boost[i] as number;
    if (Number.isFinite(v)) window.push(v);
  }
  if (window.length === 0) return null;
  const plateau = median(window.filter((v) => v >= quantile(window, 0.5)));

  for (let i = lo; i <= hi; i++) {
    const value = boost[i] as number;
    const reference = target ? (target[i] as number) : plateau;
    if (!Number.isFinite(value) || !Number.isFinite(reference) || reference <= 0) continue;
    out[i] = value / reference - 1;
  }
  return out;
}

/**
 * Boost ripple: the detrended trace's RMS as a fraction of the plateau.
 *
 * Detrending is what separates hunting from spooling — boost rising steadily with
 * rpm is normal and must not read as oscillation. The result is written to every
 * sample of the zone because ripple is a property of the zone, not of a sample.
 */
function boostRipple(pull: PullData, lo: number, hi: number): Float64Array | null {
  const boost = seriesFor(pull, 'boost');
  if (!boost) return null;

  const window: number[] = [];
  for (let i = lo; i <= hi; i++) window.push(boost[i] as number);
  const finite = window.filter(Number.isFinite);
  if (finite.length < BOOST_SETTLED_MIN_SAMPLES) return null;

  const plateau = median(finite.filter((v) => v >= quantile(finite, 0.5)));
  if (!Number.isFinite(plateau) || plateau <= 0) return null;

  // Only the settled part of the trace counts. During spool-up boost climbs along
  // a steep S-curve, and the curvature a straight line cannot remove reads as
  // ripple — a false alarm on every healthy turbocharged pull. Restricting the
  // detector to samples that have reached the plateau is what separates a
  // wastegate hunting from a turbocharger simply doing its job.
  const settled: number[] = [];
  for (const value of window) {
    if (Number.isFinite(value) && value >= BOOST_SETTLED_FRACTION * plateau) settled.push(value);
  }
  if (settled.length < BOOST_SETTLED_MIN_SAMPLES) return null;

  const ripple = rms(detrendLinear(settled)) / plateau;

  const out = new Float64Array(boost.length).fill(NaN);
  for (let i = lo; i <= hi; i++) {
    const value = boost[i] as number;
    if (Number.isFinite(value) && value >= BOOST_SETTLED_FRACTION * plateau) out[i] = ripple;
  }
  return out;
}

/**
 * Fuel rail pressure shortfall as a fraction of target. Without a target channel,
 * the reference is the rail pressure the pull started at: a pump that holds
 * pressure at 3000 rpm and loses it at 5500 is exactly the failure this looks for.
 */
function railDroop(pull: PullData, lo: number, hi: number): Float64Array | null {
  const rail = seriesFor(pull, 'fuelRail');
  if (!rail) return null;
  const target = seriesFor(pull, 'fuelRailTarget');
  const out = new Float64Array(rail.length).fill(NaN);

  let reference = NaN;
  if (!target) {
    const early: number[] = [];
    for (let i = 0; i < Math.min(rail.length, lo + 1); i++) {
      const v = rail[i] as number;
      if (Number.isFinite(v)) early.push(v);
    }
    reference = early.length > 0 ? median(early) : NaN;
  }

  for (let i = lo; i <= hi; i++) {
    const value = rail[i] as number;
    const ref = target ? (target[i] as number) : reference;
    if (!Number.isFinite(value) || !Number.isFinite(ref) || ref <= 0) continue;
    out[i] = 1 - value / ref;
  }
  return out;
}

const THRESHOLD_DETECTORS: readonly ThresholdSpec[] = [
  {
    kind: 'knock',
    severity: 'risk',
    channel: 'knockRetard',
    threshold: DETECTOR.knockRetardDeg,
    direction: 'above',
  },
  {
    kind: 'lean',
    // λ above the threshold under full load is the dangerous direction, not below
    // it. Under boost the mixture is deliberately rich — λ 0.78–0.85 — because the
    // extra fuel cools the charge. A mixture that drifts *up* to λ 0.91 at full
    // load has lost that margin, which is what the calibrated threshold marks.
    severity: 'risk',
    channel: 'lambda',
    threshold: DETECTOR.leanLambda,
    direction: 'above',
  },
  {
    kind: 'boostOvershoot',
    severity: 'caution',
    channel: 'boost',
    threshold: DETECTOR.boostOvershootFraction,
    direction: 'above',
    transform: boostExcess,
  },
  {
    kind: 'boostOscillation',
    severity: 'caution',
    channel: 'boost',
    threshold: DETECTOR.boostOscillationFraction,
    direction: 'above',
    transform: boostRipple,
  },
  {
    kind: 'fuelRailDroop',
    severity: 'risk',
    channel: 'fuelRail',
    threshold: DETECTOR.fuelRailDroopFraction,
    direction: 'above',
    transform: railDroop,
  },
  {
    kind: 'egt',
    severity: 'risk',
    channel: 'egt',
    threshold: EGT_RISK_C,
    direction: 'above',
    uncalibrated: true,
  },
];

/**
 * The series a threshold detector compares, for one pull over one rpm-axis range.
 *
 * Exposed so that the margin and correction analyses read *exactly* the quantity
 * the detector reads — boost as a fraction of target, rail pressure as a fraction
 * short of its reference — rather than a second, subtly different definition that
 * could disagree with the finding it sits beside.
 */
export function limitSeries(
  kind: FindingKind,
  pull: PullData,
  lo: number,
  hi: number,
): Float64Array | null {
  const spec = THRESHOLD_DETECTORS.find((candidate) => candidate.kind === kind);
  if (!spec) return null;
  return spec.transform ? spec.transform(pull, lo, hi) : seriesFor(pull, spec.channel);
}

/** A detector's threshold and which side of it is the anomaly. */
export function detectorLimit(
  kind: FindingKind,
): { threshold: number; direction: 'above' | 'below'; channel: ChannelId } | null {
  const spec = THRESHOLD_DETECTORS.find((candidate) => candidate.kind === kind);
  return spec ? { threshold: spec.threshold, direction: spec.direction, channel: spec.channel } : null;
}

/** Index range of the rpm axis inside a zone, inclusive; hi < lo when empty. */
export function zoneRange(rpmAxis: Float64Array, zone: Zone): [number, number] {
  return zoneIndices(rpmAxis, zone);
}

function exceeds(value: number, threshold: number, direction: 'above' | 'below'): boolean {
  if (!Number.isFinite(value)) return false;
  return direction === 'above' ? value > threshold : value < threshold;
}

/** Run every threshold detector over every zone of one session. */
export function detectThresholds(ctx: DetectorContext): Finding[] {
  const findings: Finding[] = [];
  const totalPulls = ctx.pulls.length;
  if (totalPulls === 0) return findings;

  for (const spec of THRESHOLD_DETECTORS) {
    if (spec.kind === 'lean' && ctx.fuel === 'diesel') continue;
    const provenance = ctx.provenanceOf(spec.channel);
    if (provenance === 'missing') continue;

    for (const zone of zones()) {
      const [lo, hi] = zoneIndices(ctx.rpmAxis, zone);
      if (hi < lo) continue;

      const agreeing: number[] = [];
      let exceedingSamples = 0;
      let zoneSamples = 0;
      let peakValue = spec.direction === 'above' ? -Infinity : Infinity;

      for (const pull of ctx.pulls) {
        const series = spec.transform
          ? spec.transform(pull, lo, hi)
          : seriesFor(pull, spec.channel);
        if (!series) continue;

        let pullExceeding = 0;
        let pullSamples = 0;
        for (let i = lo; i <= hi; i++) {
          const value = series[i] as number;
          if (!Number.isFinite(value)) continue;
          pullSamples++;
          if (exceeds(value, spec.threshold, spec.direction)) {
            pullExceeding++;
            peakValue =
              spec.direction === 'above' ? Math.max(peakValue, value) : Math.min(peakValue, value);
          }
        }
        if (pullSamples === 0) continue;
        zoneSamples += pullSamples;
        exceedingSamples += pullExceeding;

        // Persistence gate: one noisy sample is not a finding.
        if (pullExceeding / pullSamples >= DETECTOR_MIN_PERSISTENCE) agreeing.push(pull.pull.index);
      }

      if (agreeing.length === 0) continue;
      // Repeatability gate: an event that happened in one pull out of five is
      // reported only if it happened in enough of them to be a property of the
      // tune rather than of that lap.
      if (agreeing.length / totalPulls < DETECTOR_MIN_PULL_FRACTION) continue;

      const derivedTransform = spec.transform !== undefined;
      const effectiveProvenance: Provenance =
        derivedTransform && !ctx.pulls.some((p) => p.onRpm.has(targetChannelFor(spec.kind)))
          ? 'derived'
          : provenance;

      const { confidence, trace } = computeConfidence({
        agreeingPulls: agreeing.length,
        totalPulls,
        peakValue,
        threshold: spec.threshold,
        direction: spec.direction,
        provenance: effectiveProvenance,
        uncalibrated: spec.uncalibrated === true,
        sourceSampleRateHz: ctx.sourceSampleRateHz,
        correctionInBand: ctx.correctionInBand,
      });
      if (confidence < CONFIDENCE.floor) continue;

      const evidence: Evidence = {
        pulls: agreeing,
        totalPulls,
        exceedingSamples,
        zoneSamples,
        channel: spec.channel,
        channelProvenance: effectiveProvenance,
        peakValue,
        threshold: spec.threshold,
        session: ctx.session,
      };

      findings.push({
        kind: spec.kind,
        severity: severityFor(spec, peakValue),
        zone,
        evidence,
        confidence,
        confidenceTrace: trace,
      });
    }
  }

  return findings;
}

/** Which channel would have made a transform-based detector a measured one. */
function targetChannelFor(kind: FindingKind): ChannelId {
  switch (kind) {
    case 'boostOvershoot':
    case 'boostOscillation':
      return 'boostTarget';
    case 'fuelRailDroop':
      return 'fuelRailTarget';
    default:
      return 'boost';
  }
}

function severityFor(spec: ThresholdSpec, peakValue: number): Severity {
  if (spec.kind === 'egt') {
    return peakValue >= EGT_RISK_C ? 'risk' : peakValue >= EGT_CAUTION_C ? 'caution' : 'info';
  }
  return spec.severity;
}

// ---------------------------------------------------------------------------
// Session-level detectors
// ---------------------------------------------------------------------------

/**
 * Intake air temperature rise across a session: the intercooler saturating.
 *
 * This is one of the two scenarios in the calibration where gain bias does not
 * fully cancel, because the later pulls of a heat-soaked session are genuinely a
 * different engine from the earlier ones. It is reported as a caution rather than
 * a risk: nothing is breaking, but the comparison is compromised.
 */
export function detectHeatSoak(ctx: DetectorContext): Finding | null {
  if (!Number.isFinite(ctx.iatRiseC) || ctx.iatRiseC < IAT_HEAT_SOAK_RISE_C) return null;
  const provenance = ctx.provenanceOf('iat');
  if (provenance === 'missing') return null;

  const { confidence, trace } = computeConfidence({
    agreeingPulls: ctx.pulls.length,
    totalPulls: ctx.pulls.length,
    peakValue: ctx.iatRiseC,
    threshold: IAT_HEAT_SOAK_RISE_C,
    direction: 'above',
    provenance,
    uncalibrated: true,
    sourceSampleRateHz: ctx.sourceSampleRateHz,
    correctionInBand: ctx.correctionInBand,
  });
  if (confidence < CONFIDENCE.floor) return null;

  return {
    kind: 'iatHeatSoak',
    severity: 'caution',
    zone: { rpmLow: ZONE_RPM_EDGES[0] as number, rpmHigh: ZONE_RPM_EDGES[ZONE_RPM_EDGES.length - 1] as number },
    evidence: {
      pulls: ctx.pulls.map((p) => p.pull.index),
      totalPulls: ctx.pulls.length,
      exceedingSamples: ctx.pulls.length,
      zoneSamples: ctx.pulls.length,
      channel: 'iat',
      channelProvenance: provenance,
      peakValue: ctx.iatRiseC,
      threshold: IAT_HEAT_SOAK_RISE_C,
      session: ctx.session,
    },
    confidence,
    confidenceTrace: trace,
  };
}

// ---------------------------------------------------------------------------
// Residual outlier model
// ---------------------------------------------------------------------------

/**
 * The statistical half of the hybrid: a pull that does not behave like its
 * siblings, for a reason no rule was written for.
 *
 * Residuals are each pull's power curve minus the session's median curve. The cut
 * is a modified z-score on the MAD rather than on the standard deviation, because
 * with five pulls a single bad one inflates the sd enough to hide itself.
 */
export function detectResidualOutliers(
  ctx: DetectorContext,
  curvesHp: readonly Float64Array[],
): Finding[] {
  const n = curvesHp.length;
  if (n < 3) return [];
  const k = ctx.rpmAxis.length;

  const medianCurve = new Float64Array(k).fill(NaN);
  for (let i = 0; i < k; i++) {
    const column: number[] = [];
    for (const curve of curvesHp) {
      const v = curve[i] as number;
      if (Number.isFinite(v)) column.push(v);
    }
    if (column.length > 0) medianCurve[i] = median(column);
  }

  const findings: Finding[] = [];

  for (const zone of zones()) {
    const [lo, hi] = zoneIndices(ctx.rpmAxis, zone);
    if (hi < lo) continue;

    const perPull: number[] = [];
    for (const curve of curvesHp) {
      const residuals: number[] = [];
      for (let i = lo; i <= hi; i++) {
        const v = curve[i] as number;
        const m = medianCurve[i] as number;
        if (Number.isFinite(v) && Number.isFinite(m)) residuals.push(v - m);
      }
      perPull.push(residuals.length > 0 ? median(residuals) : NaN);
    }

    const centre = median(perPull);
    const scale = mad(perPull);
    if (!Number.isFinite(centre) || !Number.isFinite(scale) || scale <= 0) continue;

    const outliers: number[] = [];
    let peakZ = 0;
    perPull.forEach((value, index) => {
      if (!Number.isFinite(value)) return;
      const z = Math.abs(value - centre) / scale;
      if (z > RESIDUAL_OUTLIER_Z) {
        outliers.push(ctx.pulls[index]?.pull.index ?? index);
        peakZ = Math.max(peakZ, z);
      }
    });
    if (outliers.length === 0) continue;

    const { confidence, trace } = computeConfidence({
      agreeingPulls: outliers.length,
      totalPulls: n,
      peakValue: peakZ,
      threshold: RESIDUAL_OUTLIER_Z,
      direction: 'above',
      provenance: 'derived',
      uncalibrated: true,
      sourceSampleRateHz: ctx.sourceSampleRateHz,
      correctionInBand: ctx.correctionInBand,
    });
    if (confidence < CONFIDENCE.floor) continue;

    findings.push({
      kind: 'residualOutlier',
      severity: 'info',
      zone,
      evidence: {
        pulls: outliers,
        totalPulls: n,
        exceedingSamples: outliers.length,
        zoneSamples: n,
        channel: 'rpm',
        channelProvenance: 'derived',
        // Reported in units of robust sd, which is what the reader needs to judge it.
        peakValue: peakZ,
        threshold: RESIDUAL_OUTLIER_Z,
        session: ctx.session,
      },
      confidence,
      confidenceTrace: trace,
    });
  }

  return findings;
}

/** Exposed for tests: the MAD scale factor is part of the detector's definition. */
export const MODIFIED_Z_SCALE = MAD_TO_SD;
