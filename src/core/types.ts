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
// Requested vs delivered
// ---------------------------------------------------------------------------

/** A quantity the ECU asks for and the engine then either delivers or does not. */
export type TrackedQuantity = 'boost' | 'lambda' | 'fuelRail' | 'timing';

export interface TrackingPoint {
  readonly rpm: number;
  readonly requested: Estimate;
  readonly delivered: Estimate;
  /** delivered − requested, in the quantity's canonical unit. */
  readonly error: Estimate;
  readonly pulls: number;
}

/**
 * How a zone tracked its request. `spooling` separates a turbocharger that has
 * not yet built boost — normal, and not the tune's fault — from one that never
 * reaches its target, which is the finding a tuner can act on.
 */
export type TrackingStatus = 'onTarget' | 'short' | 'over' | 'spooling' | 'insufficient';

export interface TrackingZone {
  readonly zone: Zone;
  /**
   * Mean error relative to the request (degrees for timing), with an interval
   * across pulls. Positive means more than was asked for.
   */
  readonly error: Estimate;
  readonly status: TrackingStatus;
}

export interface TrackingSeries {
  readonly quantity: TrackedQuantity;
  readonly session: 'before' | 'after';
  /**
   * Whether the request was logged directly or reconstructed. Timing requests are
   * always reconstructed (logged advance plus knock retard), and the UI says so.
   */
  readonly requestSource: 'logged' | 'reconstructed';
  readonly points: readonly TrackingPoint[];
  readonly zones: readonly TrackingZone[];
}

// ---------------------------------------------------------------------------
// ECU-reported torque
// ---------------------------------------------------------------------------

export interface EcuTorquePoint {
  readonly rpm: number;
  /** The ECU's own calculated full-load torque, N·m, from every gear in the log. */
  readonly before: Estimate;
  readonly after: Estimate;
}

export interface EcuTorqueComparison {
  readonly points: readonly EcuTorquePoint[];
  readonly peakBefore: { readonly value: number; readonly rpm: number };
  readonly peakAfter: { readonly value: number; readonly rpm: number };
  /** Peak power the ECU's torque implies, P = T·ω, hp at the crank. */
  readonly peakPowerBefore: { readonly value: number; readonly rpm: number };
  readonly peakPowerAfter: { readonly value: number; readonly rpm: number };
  /** Peak-to-peak change, N·m and hp. */
  readonly torqueDelta: number;
  readonly powerDelta: number;
  /** Mean change the ECU reports over the compared rpm, N·m. */
  readonly reportedChange: Estimate;
  /** Mean change the car delivered over the same rpm, N·m, measured. */
  readonly measuredChange: Estimate;
  readonly agreement: 'confirmed' | 'notDelivered' | 'exceeds' | 'undetermined';
  /**
   * Measured stock power relative to the ECU's, minus one: +0.12 means the
   * acceleration-based figure reads 12% high on the before-log. NaN when the two
   * do not overlap in rpm.
   */
  readonly measuredOffset: number;
  /** Whether the measured figures agree with the ECU closely enough to be more than a cross-check. */
  readonly measuredReliable: boolean;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export type HealthSystemId = 'turbo' | 'fuel' | 'combustion' | 'thermal' | 'delivery';

/** `unknown` means the log does not carry what the system is judged on. */
export type HealthStatus = 'good' | 'watch' | 'concern' | 'unknown';

export interface HealthMetric {
  /** i18n key of the label. */
  readonly key: string;
  readonly value: number;
  readonly unit: string;
  readonly status: HealthStatus;
  /** The threshold the status was judged against, where there is one. */
  readonly limit?: number;
}

export interface HealthSystem {
  readonly id: HealthSystemId;
  /** On the "after" log — the car as it now is. */
  readonly status: HealthStatus;
  /** The same system on the "before" log, to show what the tune changed. */
  readonly statusBefore: HealthStatus;
  readonly metrics: readonly HealthMetric[];
  /** Detector findings that bear on this system, on the "after" log. */
  readonly findings: readonly FindingKind[];
}

export interface HealthReport {
  readonly systems: readonly HealthSystem[];
  /** 0–100 over the systems the log could judge; NaN when it could judge none. */
  readonly score: number;
  readonly scoreBefore: number;
  readonly label: 'healthy' | 'watch' | 'attention' | 'unknown';
}

// ---------------------------------------------------------------------------
// Correction table
// ---------------------------------------------------------------------------

export type CorrectionParameter = 'ignition' | 'fuel' | 'boost' | 'hardware';

/**
 * One suggested change to one cell of the tuner's map.
 *
 * Every entry moves toward safety — less timing, more fuel, less boost — and
 * never toward power. A log can prove that a cell was harmful; it cannot prove
 * that a cell has headroom, so a suggestion to add timing would be a guess
 * presented as a measurement.
 */
export interface CorrectionCell {
  readonly rpmLow: number;
  readonly rpmHigh: number;
  /** Manifold pressure band, kPa absolute. NaN when the log carried no MAP. */
  readonly loadLowKpa: number;
  readonly loadHighKpa: number;
  readonly parameter: CorrectionParameter;
  /** Signed change in `unit`; NaN for hardware entries, which have no map value. */
  readonly change: number;
  readonly unit: 'deg' | 'percent' | 'kPa' | null;
  /** What caused it: a finding kind, or 'boostShortfall' from the tracking analysis. */
  readonly cause: FindingKind | 'boostShortfall';
  /** The worst value observed in the cell, and what it was compared against. */
  readonly observed: number;
  readonly reference: number;
  readonly evidencePoints: number;
  readonly pulls: readonly number[];
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Safety margins
// ---------------------------------------------------------------------------

export type MarginLimit = 'knock' | 'lean' | 'boostOvershoot' | 'fuelRailDroop' | 'egt';

export type MarginStatus = 'ok' | 'tight' | 'exceeded' | 'unavailable';

/**
 * How close a zone came to a detector's threshold. The margin is the distance to
 * the threshold as a fraction of the threshold: 0.10 means the worst value sat 10%
 * short of the line, negative means it crossed it.
 */
export interface MarginCell {
  readonly zone: Zone;
  readonly limit: MarginLimit;
  /** Across pulls; the interval says how much the margin itself varied. */
  readonly margin: Estimate;
  /** The single worst pull's margin — the one a tuner should plan against. */
  readonly worstMargin: number;
  readonly status: MarginStatus;
}

// ---------------------------------------------------------------------------
// Logging advice
// ---------------------------------------------------------------------------

export interface LoggingAdvice {
  /** i18n key describing what was missing and what that cost the analysis. */
  readonly key: string;
  readonly channel: ChannelId | null;
  readonly session: 'before' | 'after' | 'both';
  readonly severity: Severity;
  readonly detail: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Gain across the band
// ---------------------------------------------------------------------------

/**
 * A stretch of the rpm range over which the difference between sessions is
 * proven positive, proven negative, or not proven either way.
 */
export interface GainBand {
  readonly rpmLow: number;
  readonly rpmHigh: number;
  readonly kind: 'gain' | 'loss' | 'unproven';
  readonly meanDelta: number;
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
  /**
   * Mean difference across the whole compared rpm range. A tune that adds 40 hp at
   * the peak and loses 10 hp at 3000 rpm is a different tune from one that adds
   * 25 hp everywhere, and a peak figure alone cannot tell them apart.
   */
  readonly averageDelta: Estimate;
  readonly bands: readonly GainBand[];
  /** Peak crank torque, N·m — what a tuner reads first. */
  readonly peakTorqueBefore: Estimate;
  readonly peakTorqueAfter: Estimate;
  readonly torqueDelta: Estimate;
  /** Where each peak sits on the rpm axis. */
  readonly peakRpm: PeakRpm;
}

export interface PeakRpm {
  readonly powerBefore: number;
  readonly powerAfter: number;
  readonly torqueBefore: number;
  readonly torqueAfter: number;
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
  /** Requested vs delivered, per tracked quantity and session. */
  readonly tracking: readonly TrackingSeries[];
  /** ECU-reported torque against measured torque; null when not logged in both. */
  readonly ecu: EcuTorqueComparison | null;
  readonly health: HealthReport;
  /** Suggested map changes for the after session, each toward safety. */
  readonly corrections: readonly CorrectionCell[];
  /** Distance to each detector threshold, per zone, in the after session. */
  readonly margins: readonly MarginCell[];
  /** What the next recording should include, and why. */
  readonly loggingAdvice: readonly LoggingAdvice[];
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
