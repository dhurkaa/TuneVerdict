/**
 * The data structures the pipeline passes between its stages.
 *
 * Two rules hold throughout:
 *   1. A value never travels without its uncertainty. `Estimate` is the type that
 *      enforces it — there is no bare number in any result.
 *   2. A finding never travels without its evidence. `Evidence` records which
 *      pulls, which zone and how many samples produced it, so that every claim on
 *      screen can be traced back to the samples that caused it.
 */

import type { ChannelId } from './channels';

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Where a channel's samples came from. Affects reported confidence. */
export type Provenance =
  /** Present in the log. */
  | 'measured'
  /** Computed from other measured channels (boost from MAP − baro). */
  | 'derived'
  /** Filled from a standard value because the log had nothing (baro at sea level). */
  | 'assumed';

/** How a stage asks a session what it knows about a channel. */
export type ChannelProvenanceLookup = (channel: ChannelId) => Provenance | 'missing';

/** A session after import, resampling and unit conversion. */
export interface Session {
  /** File name, shown in the UI so the user can tell the two apart. */
  readonly label: string;
  /** Uniform time base, seconds from session start, at TARGET_SAMPLE_RATE_HZ. */
  readonly t: Float64Array;
  /** Channel samples on the same grid as `t`. NaN marks a gap. */
  readonly channels: ReadonlyMap<ChannelId, Float64Array>;
  readonly provenance: ReadonlyMap<ChannelId, Provenance>;
  /** Median rate of the source file, before resampling. */
  readonly sourceSampleRateHz: number;
  readonly sourceRowCount: number;
  readonly durationS: number;
}

/** What the importer recognised, and what it did not. Reported honestly. */
export interface SchemaReport {
  readonly label: string;
  readonly detectedFormat: string;
  readonly sourceSampleRateHz: number;
  readonly rowCount: number;
  readonly recognised: readonly RecognisedColumn[];
  readonly unrecognised: readonly string[];
  readonly derived: readonly { channel: ChannelId; from: readonly ChannelId[] }[];
  readonly assumed: readonly { channel: ChannelId; reason: string }[];
  readonly missingRequired: readonly ChannelId[];
  readonly missingRecommended: readonly ChannelId[];
  readonly droppedSamples: number;
}

export interface RecognisedColumn {
  readonly header: string;
  readonly channel: ChannelId;
  /** The unit the column was read as, after the header was parsed. */
  readonly unit: string;
  readonly validSamples: number;
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/** One full-throttle pull. */
export interface Pull {
  readonly index: number;
  readonly startSample: number;
  readonly endSample: number;
  readonly startS: number;
  readonly endS: number;
  readonly rpmStart: number;
  readonly rpmEnd: number;
  /** rpm per (m/s); the basis of gear classification. */
  readonly ratio: number;
  /** Gear ordinal assigned by clustering, or the logged gear when present. */
  readonly gear: number;
  readonly meanIatC: number;
  readonly meanCoolantC: number;
  /** Correction factor applied to this pull's power, and whether it was in band. */
  readonly correction: CorrectionFactor;
  /** Estimated road gradient over the pull, from the speed/acceleration residual. */
  readonly gradient: number;
  /** Why a candidate was rejected; absent on accepted pulls. */
  readonly rejected?: string;
}

export interface CorrectionFactor {
  readonly standard: 'SAE J1349' | 'DIN 70020';
  readonly factor: number;
  readonly inValidBand: boolean;
  readonly dryPressureKpa: number;
  readonly intakeTempC: number;
}

// ---------------------------------------------------------------------------
// Estimates and uncertainty
// ---------------------------------------------------------------------------

/**
 * A quantity with its uncertainty. Nothing is displayed as a bare number, so
 * nothing is computed as one either.
 */
export interface Estimate {
  readonly value: number;
  /** Standard deviation, in the same unit as `value`. */
  readonly sd: number;
  /** Two-sided interval at CONFIDENCE_LEVEL. */
  readonly lo: number;
  readonly hi: number;
}

/** Per-parameter share of the variance, so the UI can say what to fix first. */
export interface UncertaintyBudget {
  readonly component: 'mass' | 'dragArea' | 'rollingResistance' | 'efficiency' | 'inertia';
  readonly share: number;
}

/**
 * Power at a point on the rpm axis, both sessions and their difference.
 * The four road-load components are kept separately: power is linear in the
 * vehicle parameters, so each Monte Carlo draw is a matrix multiply rather than a
 * re-run of the model.
 */
export interface PowerComponents {
  /** Coefficient of effective mass: a·v (W per kg of effective mass). */
  readonly inertia: number;
  /** Coefficient of drag area: ½·ρ·v³ (W per m² of CdA). */
  readonly aerodynamic: number;
  /** Coefficient of rolling resistance: g·v (W per kg·Crr). */
  readonly rolling: number;
  /** Coefficient of gradient: g·v (W per kg of mass per unit grade). */
  readonly gradient: number;
}

export interface PowerCurvePoint {
  readonly rpm: number;
  readonly before: Estimate;
  readonly after: Estimate;
  readonly delta: Estimate;
  /** Number of pulls contributing at this rpm, per session. */
  readonly nBefore: number;
  readonly nAfter: number;
}

// ---------------------------------------------------------------------------
// Findings and recommendations
// ---------------------------------------------------------------------------

export type Severity = 'risk' | 'caution' | 'info';

export type FindingKind =
  | 'knock'
  | 'lean'
  | 'boostOvershoot'
  | 'boostOscillation'
  | 'fuelRailDroop'
  | 'iatHeatSoak'
  | 'egt'
  | 'residualOutlier';

/** Which rpm band a finding belongs to. */
export interface Zone {
  readonly rpmLow: number;
  readonly rpmHigh: number;
}

export interface Evidence {
  /** Indices of the pulls in which the finding appeared. */
  readonly pulls: readonly number[];
  readonly totalPulls: number;
  /** Samples exceeding the threshold within the zone. */
  readonly exceedingSamples: number;
  readonly zoneSamples: number;
  /** The channel the detector read, and whether it was measured or derived. */
  readonly channel: ChannelId;
  readonly channelProvenance: Provenance;
  /** Worst value observed, in the channel's canonical unit. */
  readonly peakValue: number;
  readonly threshold: number;
  readonly session: 'before' | 'after' | 'both';
}

export interface Finding {
  readonly kind: FindingKind;
  readonly severity: Severity;
  readonly zone: Zone;
  readonly evidence: Evidence;
  /** Calibrated, capped at CONFIDENCE.cap. */
  readonly confidence: number;
  /** Factors that raised or lowered the confidence, for the "why" disclosure. */
  readonly confidenceTrace: readonly { reason: string; delta: number }[];
}

export interface Recommendation {
  readonly id: string;
  readonly finding: Finding;
  /** i18n key for the action to take. */
  readonly actionKey: string;
  /** i18n key for what happens if it is ignored. */
  readonly riskKey: string;
  readonly severity: Severity;
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type Verdict = 'good' | 'mixed' | 'bad' | 'inconclusive';

export interface ValidityCard {
  readonly gain: number;
  readonly consistency: number;
  readonly safety: number;
  readonly index: number;
  readonly verdict: Verdict;
}

export interface GainResult {
  /** Peak power, corrected, per session. */
  readonly peakBefore: Estimate;
  readonly peakAfter: Estimate;
  /** Difference, with common-mode error cancelled. */
  readonly delta: Estimate;
  readonly deltaPercent: Estimate;
  /**
   * How much smaller the difference's relative error is than the absolute
   * estimates' — the benefit of comparing two sessions of the same car.
   */
  readonly commonModeCancellation: number;
  readonly significant: boolean;
  readonly pValue: number;
}

export interface ProtocolViolation {
  readonly key: string;
  readonly severity: Severity;
  readonly detail: Record<string, string | number>;
}

export interface AnalysisResult {
  readonly before: SessionSummary;
  readonly after: SessionSummary;
  readonly gain: GainResult;
  readonly curve: readonly PowerCurvePoint[];
  readonly findings: readonly Finding[];
  readonly recommendations: readonly Recommendation[];
  readonly validity: ValidityCard;
  readonly budget: readonly UncertaintyBudget[];
  readonly violations: readonly ProtocolViolation[];
  /** Which "before" pull each "after" pull was matched to, and how well. */
  readonly pairings: readonly {
    readonly beforeIndex: number;
    readonly afterIndex: number;
    readonly distance: number;
  }[];
  readonly vehicle: VehicleParameters;
  /** Seed actually used, so a result can be reproduced exactly. */
  readonly seed: number;
  readonly computedAt: string;
}

export interface SessionSummary {
  readonly label: string;
  readonly pulls: readonly Pull[];
  readonly acceptedPulls: number;
  readonly rejectedPulls: number;
  readonly gear: number;
  /**
   * True when the gear number came from clustering rpm/speed ratios rather than
   * from a logged gear channel. The clustered numbering is relative — it says the
   * two sessions used the same gear, not which gear that was — and the UI must
   * say so rather than print "gear 1" for a pull that was driven in third.
   */
  readonly gearIsRelative: boolean;
  readonly meanIatC: number;
  readonly iatRiseC: number;
  readonly meanCorrection: number;
  readonly sourceSampleRateHz: number;
  readonly peakPower: Estimate;
  /** Coefficient of variation of peak power across pulls. */
  readonly cv: number;
}

export interface VehicleParameters {
  readonly massKg: number;
  /** Whether the user weighed the car or guessed; drives the mass uncertainty. */
  readonly massWeighed: boolean;
  readonly dragAreaM2: number;
  readonly rollingResistance: number;
  readonly drivetrainEfficiency: number;
  readonly rotationalInertiaFactor: number;
  readonly fuel: 'gasoline' | 'diesel' | 'e85' | 'lpg';
  readonly correctionStandard: 'SAE J1349' | 'DIN 70020';
}
