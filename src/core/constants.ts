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
 * [ENGINEERING] A median timestamp step at or above this (in the column's own
 * units) means the column is in milliseconds. A real datalog steps 0.01–0.5 s;
 * the same log in milliseconds steps 10–500. Nothing in between is a log worth
 * analysing, so 5 separates the two with a wide margin either side.
 */
export const MS_TIMESTAMP_MIN_STEP = 5;

/**
 * [PHYSICAL] A channel named "boost" whose quiet-running values sit at or above
 * this fraction of barometric pressure is absolute manifold pressure, not boost.
 * Gauge boost at part load is near zero or negative; absolute pressure at part load
 * is near ambient (~100 kPa). Bosch EDC/MED loggers — Autotuner among them — label
 * absolute pressure "Boost pressure", and reading it as gauge would report a car
 * idling at 1.1 bar of boost.
 */
export const ABSOLUTE_BOOST_BARO_FRACTION = 0.6;

/**
 * [PHYSICAL] The sharper test, used whenever the log has closed-pedal samples:
 * with the pedal released, gauge boost is at or below zero — a diesel's turbo
 * idles near ambient, a petrol engine pulls vacuum (−60 kPa gauge). Absolute
 * pressure in the same moments reads 30–100 kPa, or more on overrun while the
 * turbo spins down. A closed-pedal median above this can only be absolute.
 */
export const ABSOLUTE_BOOST_CLOSED_PEDAL_KPA = 15;

/** [ENGINEERING] Pedal or throttle below this counts as released. */
export const CLOSED_PEDAL_FRACTION = 0.1;

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
 * [ENGINEERING] A pull must sweep at least this much rpm after it has been split
 * at gear changes. Road logs from automatic gearboxes (9G-Tronic, ZF8) rarely hold
 * one gear for more than 500–1500 rpm before the next upshift, so a higher floor
 * would reject every pull such a car can produce; below 500 rpm the curve is too
 * short to say anything about its shape. The protocol still asks for 2000→5500 in
 * one gear, and a short pull is reported, not hidden.
 */
export const WOT_MIN_RPM_SPAN = 500;

/**
 * [ENGINEERING] Pulls needed for the full statistics: a measured pull-to-pull
 * scatter, a bootstrap interval and a permutation test. With fewer — a single-run
 * Autotuner or flasher log is usually one pull — the analysis still runs, using
 * PRIOR_PULL_CV in place of the scatter it cannot measure, and says so.
 */
export const MIN_PULLS_FOR_STATISTICS = 3;

/**
 * [ENGINEERING] Assumed pull-to-pull variation of peak power, used only when a
 * session has fewer than MIN_PULLS_FOR_STATISTICS pulls. 3% is a conservative
 * figure for road logging on the same road; the synthetic validation logs show
 * about 1%, real roads more. It is deliberately not optimistic: with one pull per
 * session, a gain must beat this to be called proven.
 */
export const PRIOR_PULL_CV = 0.03;

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

/**
 * [PROTOCOL] The same window for a diesel. A passenger-car diesel makes peak power
 * at 3500–4000 rpm and is governed at 4500–5000 (Mercedes OM654 220d: 194 PS at
 * 3800 rpm, 400 Nm from 1600 rpm), so a sweep to 5500 rpm is impossible and the
 * torque plateau sits below 2000. 1500→4500 covers plateau and peak power.
 */
export const PROTOCOL_RPM_LOW_DIESEL = 1500;
export const PROTOCOL_RPM_HIGH_DIESEL = 4500;

/** [PROTOCOL] Pulls per session the protocol asks for. */
export const PROTOCOL_PULLS_PER_SESSION = 5;

/**
 * [ENGINEERING] Minimum usable pulls per session for any analysis at all. One
 * pull can be compared — that is what a single-run Autotuner log contains — but
 * only with an assumed repeatability (PRIOR_PULL_CV) instead of a measured one,
 * which the protocol panel reports.
 */
export const MIN_PULLS_PER_SESSION = 1;

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

/**
 * [PHYSICAL] Median λ under full load above which the log is almost certainly
 * from a diesel. A petrol engine at full load runs λ 0.75–0.9; a diesel runs
 * 1.2 and up.
 */
export const DIESEL_LAMBDA_HINT = 1.1;

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
// Requested vs delivered
// ---------------------------------------------------------------------------

/**
 * [ENGINEERING] Tracking error, as a fraction of the requested value, at which a
 * zone is reported as not delivering what the ECU asked for. Deliberately looser
 * than the detector thresholds: these are observations for the tuner, not safety
 * findings. 5% of a 1.5 bar boost target is 75 mbar — beyond the settling noise
 * of a healthy closed-loop controller, and well inside what a turbocharger that
 * has run out of flow will show.
 */
export const TRACKING_TOLERANCE = {
  boost: 0.05,
  lambda: 0.03,
  fuelRail: 0.03,
  /** Timing is compared in degrees, not as a fraction. */
  timingDeg: 0.5,
} as const;

/**
 * [ENGINEERING] Boost requests below this gauge pressure are not compared as a
 * fraction. Near zero gauge a 5 kPa difference is a 100% "error", which says
 * nothing about whether the turbocharger delivered — it had not been asked to yet.
 */
export const TRACKING_MIN_BOOST_REQUEST_KPA = 20;

// ---------------------------------------------------------------------------
// Correction table
// ---------------------------------------------------------------------------

/**
 * [ENGINEERING] Cell size of the correction table. 500 rpm × 20 kPa is the
 * resolution of a typical factory ignition or boost map, so a suggested change can
 * be entered into the tuner's table without re-interpolating it by hand.
 */
export const CORRECTION_RPM_STEP = 500;
export const CORRECTION_LOAD_STEP_KPA = 20;

/** [ENGINEERING] A cell needs this many rpm-axis points of evidence to be listed. */
export const CORRECTION_MIN_CELL_POINTS = 3;

/**
 * [ENGINEERING] Extra ignition retard suggested beyond what the knock controller
 * already took. The controller retards until knock stops, so the observed retard
 * is the minimum that was needed on that day, in that fuel, at that temperature —
 * not a margin. 0.5° is one step of most factory timing tables.
 */
export const CORRECTION_TIMING_MARGIN_DEG = 0.5;

/** [ENGINEERING] Timing suggestions are rounded up to this step, in degrees. */
export const CORRECTION_TIMING_STEP_DEG = 0.5;

/**
 * [ENGINEERING] λ a full-load cell is enriched toward when no λ target was logged.
 * 0.85 is the lean edge of the conventional WOT band (0.78–0.85) for a
 * turbocharged petrol engine: the least enrichment that restores the charge
 * cooling the lean detector exists to protect.
 */
export const CORRECTION_REFERENCE_WOT_LAMBDA = 0.85;

/** [ENGINEERING] Fuel suggestions are rounded up to this step, in percent. */
export const CORRECTION_FUEL_STEP_PERCENT = 1;

/** [ENGINEERING] Boost suggestions are rounded up to this step, in kPa. */
export const CORRECTION_BOOST_STEP_KPA = 5;

// ---------------------------------------------------------------------------
// Safety margins
// ---------------------------------------------------------------------------

/**
 * [ENGINEERING] A zone whose worst pull sits within this fraction of a detector
 * threshold is shown as tight, even though nothing fired. "No findings" and "no
 * margin" are different statements, and the second is the one a tuner can act on
 * before it becomes the first.
 */
export const MARGIN_TIGHT_FRACTION = 0.05;

// ---------------------------------------------------------------------------
// Gain across the band
// ---------------------------------------------------------------------------

/**
 * [ENGINEERING] Minimum width of an rpm band reported as a gain or a loss. Two or
 * three curve points crossing zero are noise at the edges of the interval, not a
 * region of the power band the tune changed.
 */
export const BAND_MIN_WIDTH_RPM = 300;

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

// ---------------------------------------------------------------------------
// ECU-reported full-load curve
// ---------------------------------------------------------------------------

/**
 * [ENGINEERING] Pedal position above which a sample may sit on the ECU's full-load
 * torque limiter. Lower than WOT_THROTTLE_MIN on purpose: a turbo-diesel reaches
 * its torque limiter well before the pedal is floored — the reference Autotuner
 * log of a Mercedes OM654 (220d) holds 376–387 Nm, its limiter, at 62–65% pedal.
 * Part-load samples admitted by the lower gate cannot raise the curve; the upper
 * quantile below keeps them from lowering it.
 */
export const ECU_LOAD_PEDAL_MIN = 0.6;

/**
 * [ENGINEERING] A sample whose ECU torque changes faster than this is a transient
 * — torque building after a kick-down, or cut for a shift — not the steady
 * full-load value a map-pack viewer plots. On the reference OM654 log the ramp-in
 * after a kick-down rises at 250–500 Nm/s, while the full-load curve falling with
 * rpm in 4th gear changes at under 80 Nm/s.
 */
export const ECU_TRANSIENT_RATE_NM_S = 150;

/**
 * [ENGINEERING] Time after a transient during which samples are still left out.
 * After a kick-down the torque overshoots by 5–6% while boost settles (the
 * reference OM654 log peaks at 409 Nm for about 0.4 s, then holds 387–391 Nm);
 * that overshoot is not the full-load value a map-pack viewer plots.
 */
export const ECU_SETTLE_S = 0.5;

/**
 * [ENGINEERING] Width of the rpm bins the ECU's full-load curve is built on. Twice
 * CURVE_RPM_STEP so that every bin centre also lies on the measured curve's axis,
 * and wide enough that a single pull through a bin at 10 Hz leaves several
 * samples in it.
 */
export const ECU_CURVE_RPM_STEP = 100;

/** [ENGINEERING] Fewest settled samples for an rpm bin to appear on the curve. */
export const ECU_MIN_SAMPLES_PER_BIN = 2;

/**
 * [ENGINEERING] Neighbouring bins, each side, averaged into each point of the ECU
 * curve (weights 1-2-1 at 1). ±100 rpm, the same order as the smoothing a dyno
 * applies to its sheet and as CURVE_SMOOTH_HALF_WINDOW on the measured curve;
 * on the reference OM654 log it changes the peak by under 1%.
 */
export const ECU_CURVE_SMOOTH_HALF_WINDOW = 1;

/**
 * [ENGINEERING] The full-load value of a bin is this upper quantile of its settled
 * samples: the limiter is the most torque the ECU allows, and samples beneath it
 * are part load, not a different limiter.
 */
export const ECU_FULL_LOAD_QUANTILE = 0.9;

/**
 * [ENGINEERING] When the power measured from acceleration on the before-log
 * differs from the power the ECU's own torque implies by more than this fraction,
 * the vehicle model — mass, drag, a road that was not level — is off for this
 * log, and the measured figures are shown as a cross-check only. 10% is well
 * outside the ±5% an ECU torque model is calibrated to at full load.
 */
export const ECU_MEASURED_MISMATCH_FRACTION = 0.1;

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * [ENGINEERING] Coolant temperature under full load. A pressurised system on a
 * modern car regulates at 90–105 °C (map-controlled thermostats run the upper end
 * at part load); sustained readings above 105 °C at full load point at the
 * radiator, fan or thermostat, and above 112 °C the cooling system is losing.
 */
export const HEALTH_COOLANT_WATCH_C = 105;
export const HEALTH_COOLANT_CONCERN_C = 112;

/**
 * [ENGINEERING] Engine oil temperature. Oil ages quickly above 130 °C and most
 * manufacturers' warning threshold sits at 140–150 °C.
 */
export const HEALTH_OIL_WATCH_C = 130;
export const HEALTH_OIL_CONCERN_C = 140;

/**
 * [ENGINEERING] Lowest lambda a passenger-car diesel should reach at full load.
 * Common-rail smoke limiters are calibrated to hold λ ≈ 1.15–1.3 (the reference
 * OM654 log sits at 1.25–1.35); below 1.15 soot rises sharply and below 1.05 the
 * exhaust smokes visibly and EGT climbs.
 */
export const HEALTH_DIESEL_LAMBDA_WATCH = 1.15;
export const HEALTH_DIESEL_LAMBDA_CONCERN = 1.05;

/**
 * [ENGINEERING] Pull-to-pull variation of peak power. PRIOR_PULL_CV (3%) is what
 * a healthy engine on a road shows; twice that means the engine is not delivering
 * the same thing twice — heat soak, a limiter stepping in, a failing sensor.
 */
export const HEALTH_CV_WATCH = PRIOR_PULL_CV;
export const HEALTH_CV_CONCERN = 2 * PRIOR_PULL_CV;

/**
 * [ENGINEERING] Share of a system's tracked rpm zones that miss the request
 * before the system is a concern rather than one to watch. One zone off is a
 * local tuning issue; half the range off is the hardware not keeping up.
 */
export const HEALTH_TRACKING_CONCERN_FRACTION = 0.5;

/**
 * [ENGINEERING] Points per status for the overall health score (0–100). Watch is
 * closer to good than to concern on purpose: "keep an eye on it" is not a fault.
 */
export const HEALTH_STATUS_POINTS = { good: 100, watch: 65, concern: 20 } as const;

/** [ENGINEERING] Score bands for the overall label. */
export const HEALTH_SCORE_GOOD = 85;
export const HEALTH_SCORE_WATCH = 60;
