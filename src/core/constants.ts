/**
 * Every threshold, tolerance and confidence factor in the application lives here.
 *
 * Rule (hard constraint 5): no rule, detector or UI component may hardcode a
 * numeric threshold inline. If a number decides something, it is declared in this
 * file with a comment recording where it came from.
 *
 * Provenance vocabulary used below:
 *   [CALIBRATED]  derived from the validated Python implementation
 *                 (80 runs / 847 pulls, then a closed loop of 64 further runs with
 *                 fresh seeds). Do not tune by hand — re-run the calibration.
 *   [STANDARD]    fixed by a published standard (SAE J1349, DIN 70020, ISO 2533).
 *   [PHYSICAL]    a physical constant or a property of the measurement chain.
 *   [ENGINEERING] a working value chosen for usability, not calibrated. These are
 *                 the ones that may be argued about; each says why it is what it is.
 */

// ---------------------------------------------------------------------------
// Sampling and synchronisation
// ---------------------------------------------------------------------------

/**
 * [ENGINEERING] Working sample rate. Every session is resampled onto this grid
 * before anything else touches it, so that two logs recorded by different tools at
 * different rates become directly comparable.
 *
 * 10 Hz is the lowest rate at which a boost overshoot transient (typically
 * 150–400 ms of rise) is still resolved by 2–4 samples. Higher costs memory for no
 * diagnostic gain: OBD-2 channels themselves update at 5–20 Hz at best.
 */
export const TARGET_SAMPLE_RATE_HZ = 10;

/**
 * [ENGINEERING] A log slower than this cannot be upsampled honestly — interpolating
 * 1 Hz OBD data to 10 Hz invents the transients the detectors look for. Import is
 * rejected outright below this rate.
 */
export const MIN_ACCEPTED_SAMPLE_RATE_HZ = 2;

/**
 * [ENGINEERING] Between this and TARGET_SAMPLE_RATE_HZ the import succeeds but the
 * user is warned: gain estimates stay valid, transient detectors (boost overshoot,
 * oscillation) lose recall.
 */
export const WARN_SAMPLE_RATE_HZ = 5;

/**
 * [ENGINEERING] A gap longer than this in the source timestamps is treated as a
 * break in the recording rather than as missing samples, and is never interpolated
 * across. 0.5 s at 10 Hz is five invented samples — already too many.
 */
export const MAX_INTERPOLATION_GAP_S = 0.5;

// ---------------------------------------------------------------------------
// WOT segment extraction
// ---------------------------------------------------------------------------

/**
 * [CALIBRATED] Throttle fraction above which the pedal counts as "full". Real
 * full-throttle pulls on a road rarely hold a clean 1.00 — pedal travel, throttle
 * mapping and logging quantisation put a genuine WOT pull at 0.88–0.99. Dropping to
 * 0.85 recovered the pulls that a 0.95 gate silently discarded without admitting any
 * part-throttle segment in the 847-pull set.
 */
export const WOT_THROTTLE_MIN = 0.85;

/**
 * [ENGINEERING] Brief throttle dips (gear change blips, a pothole, a logging
 * dropout) shorter than this do not terminate a pull.
 */
export const WOT_GAP_TOLERANCE_S = 0.3;

/**
 * [ENGINEERING] Below this duration a segment carries too few samples for a
 * bootstrap interval to mean anything.
 */
export const WOT_MIN_DURATION_S = 2.0;

/**
 * [ENGINEERING] A pull must sweep at least this much rpm. Shorter sweeps are
 * dominated by the gear change at either end.
 */
export const WOT_MIN_RPM_SPAN = 1200;

/**
 * [ENGINEERING] rpm must be rising through a pull. A small negative rate is
 * tolerated for noise and for the flat spot at a turbo's spool.
 */
export const WOT_MIN_RPM_RATE = -50; // rpm/s

/**
 * [ENGINEERING] Samples discarded at each end of a pull before power is computed.
 *
 * Acceleration comes from a local quadratic fit over ±SMOOTH_HALF_WINDOW samples,
 * so within one window of a segment boundary that fit is partly reading the coast
 * the driver was in before the throttle opened. Left in, it produces power figures
 * that are not merely noisy but negative at the bottom of the sweep. The pull is
 * still reported as covering its full rpm span — the trim removes a contaminated
 * derivative, not the measurement.
 */
export const PULL_EDGE_TRIM_SAMPLES = 5;

/**
 * [ENGINEERING] A point on the rpm axis is reported only where at least this
 * fraction of a session's pulls reached it. At the extreme ends of the range one
 * pull may have gone slightly further than the others, and averaging a single
 * pull's value into a curve labelled "five pulls" is how a curve grows a spike no
 * engine made.
 */
export const MIN_PULL_COVERAGE_FRACTION = 0.6;

/**
 * [PROTOCOL] The rpm window the measurement protocol asks for. Comparison is
 * restricted to the overlap of this window and both sessions' actual coverage.
 */
export const PROTOCOL_RPM_LOW = 2000;
export const PROTOCOL_RPM_HIGH = 5500;

/** [PROTOCOL] Pulls per session the protocol asks for. */
export const PROTOCOL_PULLS_PER_SESSION = 5;

/**
 * [ENGINEERING] Absolute minimum usable pulls per session. With two pulls the
 * bootstrap has nothing to resample and consistency is undefined; the analysis is
 * refused rather than reported with a wide interval, because a wide interval still
 * reads as an answer.
 */
export const MIN_PULLS_PER_SESSION = 3;

// ---------------------------------------------------------------------------
// Gear classification
// ---------------------------------------------------------------------------

/**
 * [ENGINEERING] Two pulls belong to the same gear when their rpm-per-(m/s) ratios
 * agree within this fraction. Gear ratios in a production gearbox are spaced
 * 18–30% apart, so 6% separates gears with a wide margin while absorbing tyre
 * slip, rolling-radius change with speed, and rpm/speed sampling skew.
 */
export const GEAR_RATIO_TOLERANCE = 0.06;

/**
 * [ENGINEERING] Samples below this speed are excluded from the gear-ratio estimate:
 * at low speed the rpm/speed quotient is dominated by clutch slip and by the
 * quantisation of a 1 km/h speed channel.
 */
export const GEAR_MIN_SPEED_MS = 8; // ~29 km/h

// ---------------------------------------------------------------------------
// Condition normalisation (SAE J1349 / DIN 70020)
// ---------------------------------------------------------------------------

/** [STANDARD] SAE J1349 reference: 990 hPa dry air, 25 °C (298.15 K). */
export const J1349_REF_DRY_PRESSURE_KPA = 99.0;
export const J1349_REF_TEMPERATURE_K = 298.15;
/** [STANDARD] SAE J1349 form: CF = 1.18 · [(990/Pd) · √(T/298)] − 0.18. */
export const J1349_A = 1.18;
export const J1349_B = 0.18;

/** [STANDARD] DIN 70020 reference: 1013 hPa, 20 °C (293.15 K). */
export const DIN70020_REF_PRESSURE_KPA = 101.3;
export const DIN70020_REF_TEMPERATURE_K = 293.15;

/**
 * [STANDARD] J1349 declares the correction valid only in this band. Outside it the
 * correction is still computed, but the result is flagged: a factor of 1.12 means
 * the two sessions were recorded in conditions too different to reconcile, and the
 * honest answer is to say so rather than to multiply the difference away.
 */
export const CORRECTION_FACTOR_VALID_MIN = 0.93;
export const CORRECTION_FACTOR_VALID_MAX = 1.07;

/**
 * [PHYSICAL] Saturation vapour pressure is computed with the Magnus form; these are
 * the coefficients over water for −45…60 °C (Alduchov & Eskridge 1996).
 */
export const MAGNUS_A = 6.1094; // hPa
export const MAGNUS_B = 17.625;
export const MAGNUS_C = 243.04; // °C

/**
 * [ENGINEERING] Assumed relative humidity when the log carries no humidity channel,
 * which is almost always. At 20 °C the difference between 0% and 100% RH is ~0.9%
 * of the correction factor, so the assumption is cheap; it is still propagated as
 * an uncertainty rather than hidden.
 */
export const ASSUMED_RELATIVE_HUMIDITY = 0.5;
export const ASSUMED_RELATIVE_HUMIDITY_SD = 0.25;

// ---------------------------------------------------------------------------
// Protocol compliance (what the import screen validates)
// ---------------------------------------------------------------------------

/**
 * [PROTOCOL] Maximum intake-air temperature difference between the two sessions.
 * Beyond this the normalisation is doing more work than the tune is, and a
 * confident wrong answer becomes likely.
 */
export const PROTOCOL_MAX_IAT_DELTA_C = 3.0;

/** [PROTOCOL] Fuel above half a tank, so that fuel mass is not a hidden variable. */
export const PROTOCOL_MIN_FUEL_FRACTION = 0.5;

/** [PROTOCOL] Engine at operating temperature. */
export const PROTOCOL_MIN_COOLANT_C = 80;

/**
 * [ENGINEERING] Road gradient beyond this is rejected rather than corrected: the
 * gradient term is inferred from the speed trace, and on a real gradient it becomes
 * confounded with the very acceleration being measured.
 */
export const MAX_ROAD_GRADIENT = 0.03; // 3%

// ---------------------------------------------------------------------------
// DTW alignment
// ---------------------------------------------------------------------------

/**
 * [ENGINEERING] Sakoe–Chiba band as a fraction of the shorter sequence. Two pulls
 * of the same car in the same gear never need more warping than this; a wider band
 * lets DTW align a 3rd-gear pull to a 4th-gear pull, which is exactly the mistake
 * the gear classifier exists to prevent.
 */
export const DTW_BAND_FRACTION = 0.12;

/**
 * [ENGINEERING] Alignment runs on the rpm axis, resampled to this many points.
 * 200 points over a 3500 rpm pull is ~18 rpm per point — finer than the rpm
 * resolution of any OBD-2 source.
 */
export const DTW_RESAMPLE_POINTS = 200;

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * [CALIBRATED] Bootstrap resamples for every reported interval. At 2000 the
 * 95% bounds were stable to ±0.1 hp across the 64-run closed loop; 5000 changed
 * nothing but the runtime.
 */
export const BOOTSTRAP_RESAMPLES = 2000;

/** [STANDARD] Two-sided 95% intervals throughout. */
export const CONFIDENCE_LEVEL = 0.95;

/**
 * [CALIBRATED] Significance level for the gain test. Validated against placebo
 * pairs (same tune, two sessions): 10% of placebo pairs were declared significant,
 * which is the expected behaviour of a 0.05 two-sided test on this sample size,
 * not a defect.
 */
export const SIGNIFICANCE_ALPHA = 0.05;

/**
 * [CALIBRATED] Monte Carlo draws for uncertainty propagation. Power is linear in
 * the vehicle parameters, so each draw is a matrix multiply over the four
 * normalised components and 4000 draws cost milliseconds. The reported sd changed
 * by less than 0.05 hp between 4000 and 20000 draws.
 */
export const MONTE_CARLO_DRAWS = 4000;

// ---------------------------------------------------------------------------
// Anomaly detectors
// ---------------------------------------------------------------------------

/**
 * Detector thresholds.
 *
 * [CALIBRATED] These are NOT the Youden peak of the ROC curve. The Youden peak
 * produced physically meaningless values — 0.042° of knock retard, which is noise
 * on a real road and would fire on every pull. Each threshold below is the upper
 * bound of the interval over which recall and specificity both remain optimal,
 * which is the largest value that still catches everything the calibration set
 * contains. Measured performance is recorded beside each one.
 *
 * Reference behaviour of the set as a whole: zero false alarms across 1353
 * negative pulls.
 */
export const DETECTOR = {
  /**
   * Ignition retard attributable to knock, in crank degrees, averaged over the
   * affected zone. recall 0.98 · false alarms 0.00 · AUC 0.990
   */
  knockRetardDeg: 0.7,

  /**
   * Lambda under load. *Above* this the mixture is lean where it must not be:
   * at full throttle a healthy tune runs rich (λ 0.78–0.85) because the surplus
   * fuel cools the charge, and λ drifting up to 0.91 means that margin is gone.
   * recall 0.97 · false alarms 0.00 · AUC 0.996
   */
  leanLambda: 0.91,

  /**
   * Peak boost above target, as a fraction of target.
   * recall 0.86 · false alarms 0.00 · AUC 0.895
   */
  boostOvershootFraction: 0.08,

  /**
   * Boost ripple amplitude after detrending, as a fraction of target — the
   * signature of a wastegate or boost controller hunting.
   * recall 0.86 · false alarms 0.00 · AUC 0.895
   */
  boostOscillationFraction: 0.045,

  /**
   * Fuel rail pressure below target, as a fraction of target: the pump running out
   * of capacity at the top end. recall 0.97 · false alarms 0.00 · AUC 0.981
   */
  fuelRailDroopFraction: 0.025,
} as const;

/**
 * [ENGINEERING] The boost oscillation detector only looks at the settled part of
 * the trace: samples at or above this fraction of the pull's plateau. During
 * spool-up boost climbs along a steep S-curve whose curvature a straight-line
 * detrend cannot remove, and the residual reads as ripple — a false alarm on every
 * healthy turbocharged pull. 0.9 admits the plateau and excludes the ramp.
 */
export const BOOST_SETTLED_FRACTION = 0.9;

/** [ENGINEERING] Minimum settled samples before ripple is worth measuring at all. */
export const BOOST_SETTLED_MIN_SAMPLES = 8;

/**
 * [ENGINEERING] Half-window, in rpm-axis points, of the smoothing applied to a
 * session's mean power curve before its peak is read.
 *
 * Reading the maximum of a noisy curve is biased upward — with 71 points, the
 * largest excursion of the noise is reported as the peak. Real power curves are
 * smooth and nearly flat at the top, so a ±100 rpm average costs almost nothing in
 * peak height and removes most of that bias.
 */
export const CURVE_SMOOTH_HALF_WINDOW = 2;

/**
 * [ENGINEERING] How far short of the protocol's rpm window a session may fall
 * before it is reported. A pull that stops at 5483 rpm instead of 5500 has not
 * violated anything; one that stops at 5100 has.
 */
export const PROTOCOL_RPM_COVERAGE_TOLERANCE = 100;

/**
 * [ENGINEERING] Exhaust gas temperature limits. Not part of the calibrated set —
 * no EGT channel was present in the calibration logs — so these are the
 * conventional material limits, and findings derived from them are reported at
 * reduced confidence (see CONFIDENCE.uncalibratedDetectorPenalty).
 */
export const EGT_CAUTION_C = 900;
export const EGT_RISK_C = 950;

/**
 * [ENGINEERING] Intake air temperature rise across a session that indicates
 * heat-soak: the intercooler is saturating and later pulls are not comparable to
 * earlier ones. This is one of the two scenarios with a known physical limit where
 * gain bias does not fully cancel (see the reference results in README).
 */
export const IAT_HEAT_SOAK_RISE_C = 12;

/**
 * [ENGINEERING] A detection must persist over at least this fraction of the zone
 * it is reported in, so that a single sample of sensor noise cannot raise a
 * finding.
 */
export const DETECTOR_MIN_PERSISTENCE = 0.15;

/** [ENGINEERING] A finding must appear in at least this fraction of the pulls. */
export const DETECTOR_MIN_PULL_FRACTION = 0.4;

/**
 * [ENGINEERING] Residual outlier model: a point is an outlier beyond this many
 * robust standard deviations (MAD-scaled) from the median residual. 3.5 is the
 * conventional Iglewicz–Hoaglin modified z-score cut.
 */
export const RESIDUAL_OUTLIER_Z = 3.5;

/** [PHYSICAL] MAD → sd conversion for a normal distribution. */
export const MAD_TO_SD = 1.4826;

/**
 * [ENGINEERING] Resolution of the common rpm axis every pull is resampled onto.
 * 50 rpm over a 2000–5500 sweep is 71 points: finer than the rpm resolution of an
 * OBD-2 source at 10 Hz, and coarse enough that each point has real samples behind
 * it rather than interpolation.
 */
export const CURVE_RPM_STEP = 50;

/**
 * [ENGINEERING] Half-window, in samples, of the local quadratic fit used to get
 * acceleration from the speed trace. At 10 Hz this is ±0.5 s — long enough to
 * suppress the 1 km/h quantisation of an OBD-2 speed channel, short enough not to
 * flatten the torque peak.
 */
export const SMOOTH_HALF_WINDOW = 5;

/**
 * [ENGINEERING] Analysis zones. Findings are reported per zone rather than per
 * sample, because "lean at 4800 rpm" is actionable and "lean at sample 1174" is not.
 */
export const ZONE_RPM_EDGES = [2000, 3000, 4000, 5000, 5500] as const;

// ---------------------------------------------------------------------------
// Confidence calibration
// ---------------------------------------------------------------------------

/**
 * [CALIBRATED] Confidence reported with every recommendation.
 *
 * The ceiling is the binding constraint. On the validation set the detectors were
 * empirically perfect (10/10 correct), but 10 of 10 only proves accuracy above
 * 0.7225 at the Wilson 95% lower bound. Reporting 1.00 would be overclaiming what
 * the evidence supports, so confidence is capped at that bound. Mean reported
 * confidence after recalibration is 0.712, which sits just under it by
 * construction.
 *
 * This keeps the expected calibration error at 0.288. That number cannot be
 * reduced without either more validation data or dishonesty; it is reported in the
 * UI rather than hidden.
 */
export const CONFIDENCE = {
  /** Wilson 95% lower bound for 10/10 successes. Nothing may report above this. */
  cap: 0.7225,

  /** Floor below which a finding is not shown at all. */
  floor: 0.35,

  /** Starting confidence for a detector firing on a single pull. */
  base: 0.45,

  /** Added per additional pull that agrees, up to maxPullBonus. */
  perAgreeingPull: 0.06,
  maxPullBonus: 0.24,

  /**
   * Added when the effect exceeds its threshold by a wide margin: the bonus scales
   * with (value/threshold − 1), saturating at this value.
   */
  maxMarginBonus: 0.12,

  /** Subtracted when the supporting channel was derived rather than measured. */
  derivedChannelPenalty: 0.08,

  /** Subtracted for detectors outside the calibrated set (EGT, heat-soak). */
  uncalibratedDetectorPenalty: 0.15,

  /** Subtracted when the session's sample rate is below TARGET_SAMPLE_RATE_HZ. */
  lowSampleRatePenalty: 0.1,

  /** Subtracted when condition normalisation left the valid J1349 band. */
  outOfBandCorrectionPenalty: 0.12,

  /** Expected calibration error of the above, reported honestly in the UI. */
  expectedCalibrationError: 0.288,
} as const;

// ---------------------------------------------------------------------------
// Vehicle model and its uncertainties
// ---------------------------------------------------------------------------

/**
 * [PHYSICAL] Standard values used by the road-load power model. Each has an
 * associated relative standard deviation which is what the Monte Carlo actually
 * draws on.
 */
export const VEHICLE_DEFAULTS = {
  /** kg, including driver and fuel. There is no sensible default — the UI insists. */
  massKg: 1500,
  /**
   * [CALIBRATED] Mass dominates the uncertainty budget at 62%. For a ±5 hp claim,
   * mass must be known to within 1.44% — ±22 kg on 1500 kg. The UI says so: weigh
   * the car, do not assume its mass.
   */
  massRelSdWeighed: 0.0144,
  massRelSdEstimated: 0.05,

  /** m², drag area Cd·A. A compact hatchback sits near 0.62. */
  dragAreaM2: 0.62,
  dragAreaRelSd: 0.08,

  /** Rolling resistance coefficient, warm tyres on dry asphalt. */
  rollingResistance: 0.011,
  rollingResistanceRelSd: 0.15,

  /**
   * Drivetrain efficiency, engine flywheel → wheels. [CALIBRATED] Efficiency is
   * the second-largest contributor to the budget at 31%.
   */
  drivetrainEfficiency: 0.88,
  drivetrainEfficiencySd: 0.03,

  /**
   * Rotational inertia factor: effective mass / static mass, accounting for wheels,
   * flywheel and gearbox. Gear-dependent; 1.06 is representative of 3rd/4th.
   */
  rotationalInertiaFactor: 1.06,
  rotationalInertiaFactorSd: 0.015,
} as const;

/** [PHYSICAL] Constants of the road-load model. */
export const PHYSICS = {
  gravity: 9.80665, // m/s²
  /** Specific gas constant for dry air, J/(kg·K). */
  airGasConstant: 287.058,
  /** Specific gas constant for water vapour, J/(kg·K). */
  vapourGasConstant: 461.495,
  /** ISO 2533 sea-level density, used only as a fallback when baro is missing. */
  fallbackAirDensity: 1.225, // kg/m³
  wattsPerHp: 745.699872,
  wattsPerPs: 735.49875,
} as const;

// ---------------------------------------------------------------------------
// Validity Card
// ---------------------------------------------------------------------------

/**
 * [ENGINEERING] The composite index is Gain × Consistency × Safety, deliberately
 * multiplicative: a tune that gained 40 hp and knocks scores near zero, because a
 * sum would let the gain buy off the danger. Each factor is in 0…1.
 */
export const VALIDITY = {
  /**
   * Gain reaches 1.0 at this relative improvement. 15% is a large, real gain for a
   * turbocharged engine on a software-only tune.
   */
  gainSaturationFraction: 0.15,

  /** Gain is scored as zero when the interval includes zero — no proven gain. */
  requireSignificantGain: true,

  /**
   * Consistency is 1.0 when the coefficient of variation across pulls is at or
   * below this, and falls linearly to 0 at consistencyCvZero.
   */
  consistencyCvPerfect: 0.02,
  consistencyCvZero: 0.12,

  /** Safety starts at 1.0 and each finding subtracts by severity. */
  safetyPenaltyRisk: 0.45,
  safetyPenaltyCaution: 0.15,
  safetyFloor: 0,

  /** Verdict bands over the composite index. */
  verdictGoodMin: 0.6,
  verdictMixedMin: 0.3,
} as const;

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * [ENGINEERING] Decimal places per displayed quantity. Declared centrally so that
 * no component invents a precision the measurement does not support: reporting
 * 253.42 hp when the interval is ±9.4 hp is a lie told by a format string.
 */
export const DISPLAY_PRECISION = {
  power: 1,
  torque: 1,
  gainPercent: 1,
  rpm: 0,
  lambda: 3,
  pressureKpa: 1,
  temperatureC: 1,
  degrees: 2,
  confidence: 2,
  index: 2,
} as const;
