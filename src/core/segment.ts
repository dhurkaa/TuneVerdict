/**
 * Stage 3: WOT segment extraction and gear classification.
 *
 * A "pull" is one full-throttle acceleration in a fixed gear. Everything the
 * application claims is claimed about pulls, so this stage decides what the answer
 * is made of — and, just as importantly, records why each rejected candidate was
 * rejected. A silent rejection is how a user ends up comparing two pulls against
 * five without noticing.
 */

import { airDensity } from './import';
import {
  CURVE_RPM_STEP,
  GEAR_MIN_SPEED_MS,
  GEAR_RATIO_TOLERANCE,
  PROTOCOL_RPM_HIGH,
  PROTOCOL_RPM_HIGH_DIESEL,
  PROTOCOL_RPM_LOW_DIESEL,
  PROTOCOL_RPM_LOW,
  PULL_EDGE_TRIM_SAMPLES,
  SMOOTH_HALF_WINDOW,
  TARGET_SAMPLE_RATE_HZ,
  WOT_GAP_TOLERANCE_S,
  WOT_MIN_DURATION_S,
  WOT_MIN_RPM_RATE,
  WOT_MIN_RPM_SPAN,
  WOT_THROTTLE_MIN,
} from './constants';
import { correctionFactor, vapourPressureKpa } from './normalise';
import { componentsAt, packBasis } from './power';
import { median, quantile } from './stats';
import { localQuadratic, resampleOnAxis, sliceMean } from './signal';
import type { PowerComponents, Pull, Session, VehicleParameters } from './types';

/** A pull plus the arrays derived from it that later stages need. */
export interface PullData {
  readonly pull: Pull;
  /** Common rpm axis, shared by every pull in the analysis. */
  readonly rpmAxis: Float64Array;
  /**
   * Power basis on the rpm axis, flat K×4 (inertia, aero, rolling, gradient).
   * NaN where the pull did not cover that rpm.
   */
  readonly basis: Float64Array;
  /** Channel slices on the rpm axis, for the detectors. */
  readonly onRpm: ReadonlyMap<string, Float64Array>;
}

export interface SegmentationResult {
  readonly pulls: readonly PullData[];
  readonly rejected: readonly Pull[];
  readonly rpmAxis: Float64Array;
}

/** The shared rpm axis. Built once and reused, so every pull is directly comparable. */
/** The protocol's rpm window for the fuel: a diesel neither reaches nor needs 5500 rpm. */
export function protocolRpmRange(fuel: VehicleParameters['fuel']): { low: number; high: number } {
  return fuel === 'diesel'
    ? { low: PROTOCOL_RPM_LOW_DIESEL, high: PROTOCOL_RPM_HIGH_DIESEL }
    : { low: PROTOCOL_RPM_LOW, high: PROTOCOL_RPM_HIGH };
}

export function buildRpmAxis(low = PROTOCOL_RPM_LOW, high = PROTOCOL_RPM_HIGH): Float64Array {
  const n = Math.floor((high - low) / CURVE_RPM_STEP) + 1;
  const axis = new Float64Array(n);
  for (let i = 0; i < n; i++) axis[i] = low + i * CURVE_RPM_STEP;
  return axis;
}

/** Channels the detectors want resampled onto the rpm axis alongside the power basis. */
const DETECTOR_CHANNELS = [
  'lambda',
  'lambdaTarget',
  'knockRetard',
  'timing',
  'boost',
  'boostTarget',
  'fuelRail',
  'fuelRailTarget',
  'iat',
  'egt',
  'map',
  'engineLoad',
  'ecuTorque',
] as const;

/**
 * Find the full-throttle segments in a session and turn each into a pull.
 *
 * Candidates are accepted only if they are long enough, sweep enough rpm and keep
 * rpm rising. Everything else is returned in `rejected` with a reason key, because
 * "3 of your 5 pulls were discarded" is information the user needs before reading
 * a verdict.
 */
export function segment(
  session: Session,
  vehicle: VehicleParameters,
  rpmAxis: Float64Array,
): SegmentationResult {
  const rpm = session.channels.get('rpm');
  const speed = session.channels.get('speed');
  const throttle = session.channels.get('throttle');
  if (!rpm || !speed || !throttle) {
    return { pulls: [], rejected: [], rpmAxis };
  }

  const dt = 1 / TARGET_SAMPLE_RATE_HZ;
  // Acceleration comes from a local quadratic fit rather than a raw difference:
  // OBD-2 speed is quantised to 1 km/h, and differencing that directly produces an
  // acceleration trace that swings by ±2 m/s² on a constant-speed cruise.
  const speedFit = localQuadratic(speed, dt, SMOOTH_HALF_WINDOW);
  const accel = speedFit.slope;
  const smoothSpeed = speedFit.value;
  const rpmFit = localQuadratic(rpm, dt, SMOOTH_HALF_WINDOW);

  // A full-throttle stretch on an automatic gearbox is usually several gears: a
  // kickdown, then upshifts. Each gear is its own pull; measured across a shift,
  // the speed trace and the rpm trace stop describing the same thing.
  const loggedGear = session.channels.get('gear');
  const candidates = findThrottleSegments(throttle).flatMap(([s, e]) =>
    splitAtGearChanges(s, e, rpm, speed, loggedGear),
  );

  const accepted: PullData[] = [];
  const rejected: Pull[] = [];
  let index = 0;

  for (const [start, end] of candidates) {
    const base = describeCandidate(session, start, end, rpm, speed, index, vehicle);
    const reason = rejectionReason(base, rpmFit.slope, start, end);
    if (reason) {
      rejected.push({ ...base, rejected: reason });
      continue;
    }

    const components: PowerComponents[] = [];
    const rpmWithin: number[] = [];
    const rho = pullAirDensity(session, start, end);

    // The derivative is unreliable within one smoothing window of the segment
    // boundary, where the fit still sees the coast before the throttle opened.
    const from = start + PULL_EDGE_TRIM_SAMPLES;
    const to = end - PULL_EDGE_TRIM_SAMPLES;
    if (to - from < 4) {
      rejected.push({ ...base, rejected: 'segment.rejected.tooFewSamples' });
      continue;
    }

    for (let i = from; i <= to; i++) {
      const v = smoothSpeed[i] as number;
      const a = accel[i] as number;
      const r = rpm[i] as number;
      if (!Number.isFinite(v) || !Number.isFinite(a) || !Number.isFinite(r)) continue;
      components.push(componentsAt(v, a, rho));
      rpmWithin.push(r);
    }
    if (components.length < 4) {
      rejected.push({ ...base, rejected: 'segment.rejected.tooFewSamples' });
      continue;
    }

    const axis = Array.from(rpmAxis);
    const basis = new Float64Array(rpmAxis.length * 4);
    const packed = packBasis(components);
    for (let c = 0; c < 4; c++) {
      const series: number[] = [];
      for (let i = 0; i < components.length; i++) series.push(packed[i * 4 + c] as number);
      const onAxis = resampleOnAxis(rpmWithin, series, axis);
      for (let k = 0; k < rpmAxis.length; k++) basis[k * 4 + c] = onAxis[k] as number;
    }

    const onRpm = new Map<string, Float64Array>();
    for (const channelId of DETECTOR_CHANNELS) {
      const source = session.channels.get(channelId);
      if (!source) continue;
      const slice: number[] = [];
      const rpmSlice: number[] = [];
      for (let i = start; i <= end; i++) {
        const value = source[i] as number;
        const r = rpm[i] as number;
        if (!Number.isFinite(r)) continue;
        slice.push(value);
        rpmSlice.push(r);
      }
      onRpm.set(channelId, resampleOnAxis(rpmSlice, slice, axis));
    }

    accepted.push({ pull: { ...base, index }, rpmAxis, basis, onRpm });
    index++;
  }

  return { pulls: accepted, rejected, rpmAxis };
}

/**
 * Contiguous runs where the throttle is at or above the WOT gate, bridging dips
 * shorter than WOT_GAP_TOLERANCE_S. A gear change blip or a single dropped sample
 * should not split one pull into two half-pulls, both of which would then be
 * rejected for being too short.
 */
function findThrottleSegments(throttle: Float64Array): [number, number][] {
  const gapSamples = Math.round(WOT_GAP_TOLERANCE_S * TARGET_SAMPLE_RATE_HZ);
  const segments: [number, number][] = [];
  let start = -1;
  let lastOpen = -1;

  for (let i = 0; i < throttle.length; i++) {
    const value = throttle[i] as number;
    const open = Number.isFinite(value) && value >= WOT_THROTTLE_MIN;
    if (open) {
      if (start === -1) start = i;
      lastOpen = i;
    } else if (start !== -1 && i - lastOpen > gapSamples) {
      segments.push([start, lastOpen]);
      start = -1;
    }
  }
  if (start !== -1 && lastOpen > start) segments.push([start, lastOpen]);
  return segments;
}

/**
 * Split a segment wherever the gear changes: when the logged gear changes, or —
 * for logs without a gear channel — when the rpm-per-speed ratio moves by more
 * than GEAR_RATIO_TOLERANCE from where the piece started. The samples of the
 * shift itself (clutch or torque converter slipping, ratio in between two gears)
 * end up in short pieces that the duration rule then rejects.
 */
function splitAtGearChanges(
  start: number,
  end: number,
  rpm: Float64Array,
  speed: Float64Array,
  loggedGear: Float64Array | undefined,
): [number, number][] {
  const pieces: [number, number][] = [];
  let pieceStart = start;
  let referenceRatio = NaN;
  let referenceGear = NaN;

  for (let i = start; i <= end; i++) {
    const r = rpm[i] as number;
    const v = speed[i] as number;
    const ratio = Number.isFinite(r) && Number.isFinite(v) && v > GEAR_MIN_SPEED_MS ? r / v : NaN;
    const gear = loggedGear ? Math.round(loggedGear[i] as number) : NaN;

    const gearChanged = Number.isFinite(gear) && Number.isFinite(referenceGear) && gear !== referenceGear;
    const ratioChanged =
      Number.isFinite(ratio) &&
      Number.isFinite(referenceRatio) &&
      Math.abs(ratio - referenceRatio) / referenceRatio > GEAR_RATIO_TOLERANCE;

    if ((gearChanged || ratioChanged) && i > pieceStart) {
      pieces.push([pieceStart, i - 1]);
      pieceStart = i;
      referenceRatio = NaN;
      referenceGear = NaN;
    }
    if (!Number.isFinite(referenceRatio) && Number.isFinite(ratio)) referenceRatio = ratio;
    if (!Number.isFinite(referenceGear) && Number.isFinite(gear)) referenceGear = gear;
  }
  if (end >= pieceStart) pieces.push([pieceStart, end]);
  return pieces;
}

function describeCandidate(
  session: Session,
  start: number,
  end: number,
  rpm: Float64Array,
  speed: Float64Array,
  index: number,
  vehicle: VehicleParameters,
): Pull {
  const ratios: number[] = [];
  for (let i = start; i <= end; i++) {
    const v = speed[i] as number;
    const r = rpm[i] as number;
    if (Number.isFinite(v) && Number.isFinite(r) && v > GEAR_MIN_SPEED_MS) ratios.push(r / v);
  }

  const iat = session.channels.get('iat');
  const coolant = session.channels.get('coolant');
  const baro = session.channels.get('baro');

  const meanIatC = iat ? sliceMean(iat, start, end) : NaN;
  const meanBaroKpa = baro ? sliceMean(baro, start, end) : 101.325;
  const correction = correctionFactor(
    vehicle.correctionStandard,
    Number.isFinite(meanBaroKpa) ? meanBaroKpa : 101.325,
    Number.isFinite(meanIatC) ? meanIatC : 20,
  );

  return {
    index,
    startSample: start,
    endSample: end,
    startS: (session.t[start] as number) ?? NaN,
    endS: (session.t[end] as number) ?? NaN,
    rpmStart: rpm[start] as number,
    rpmEnd: rpm[end] as number,
    ratio: ratios.length > 0 ? median(ratios) : NaN,
    gear: 0, // assigned by classifyGears once both sessions are segmented
    meanIatC,
    meanCoolantC: coolant ? sliceMean(coolant, start, end) : NaN,
    correction,
    // The road gradient is not observable from a single OBD-2 log: it is
    // confounded with the acceleration being measured. It is therefore carried as
    // a parameter centred on zero with an explicit uncertainty (see uncertainty.ts)
    // and it is common-mode between the two sessions when the protocol's "same road,
    // same direction" rule is followed — which is precisely why the gain is a far
    // better-determined quantity than either absolute figure.
    gradient: 0,
  };
}

function rejectionReason(
  pull: Pull,
  rpmRate: Float64Array,
  start: number,
  end: number,
): string | null {
  const duration = pull.endS - pull.startS;
  if (!Number.isFinite(duration) || duration < WOT_MIN_DURATION_S) {
    return 'segment.rejected.tooShort';
  }
  const span = pull.rpmEnd - pull.rpmStart;
  if (!Number.isFinite(span) || span < WOT_MIN_RPM_SPAN) {
    return 'segment.rejected.rpmSpan';
  }
  // A pull where rpm falls is a gear change, a clutch slip or a hill — not a
  // measurement of what the engine makes.
  const rates: number[] = [];
  for (let i = start; i <= end; i++) {
    const r = rpmRate[i] as number;
    if (Number.isFinite(r)) rates.push(r);
  }
  if (rates.length > 0 && quantile(rates, 0.1) < WOT_MIN_RPM_RATE) {
    return 'segment.rejected.rpmFalling';
  }
  if (!Number.isFinite(pull.ratio)) {
    return 'segment.rejected.noGearRatio';
  }
  return null;
}

/** Air density over a pull, from that pull's own barometric pressure and IAT. */
function pullAirDensity(session: Session, start: number, end: number): number {
  const baro = session.channels.get('baro');
  const iat = session.channels.get('iat');
  const ambient = session.channels.get('ambient');
  const pressure = baro ? sliceMean(baro, start, end) : NaN;
  // Ambient temperature is the right one for aerodynamic drag; intake temperature
  // is the fallback, and after a hard pull it reads high — which slightly
  // underestimates drag, and therefore power. Recorded here so the bias is known.
  const temperature = ambient
    ? sliceMean(ambient, start, end)
    : iat
      ? sliceMean(iat, start, end)
      : NaN;
  return airDensity(pressure, temperature, vapourPressureKpa(temperature));
}

/**
 * Assign gear ordinals by clustering rpm-per-(m/s) ratios.
 *
 * Both sessions are classified together, so that "gear 3" means the same gear in
 * the before log as in the after log. Clusters are formed greedily within
 * GEAR_RATIO_TOLERANCE and then ordered: the highest ratio is the lowest gear.
 *
 * When the log carries a real gear channel it wins — an ECU knows which gear it is
 * in, and no amount of clustering beats that.
 */
export function classifyGears(
  pullsBySession: readonly (readonly PullData[])[],
  loggedGears: readonly (Float64Array | undefined)[],
): void {
  const all: { data: PullData; session: number }[] = [];
  pullsBySession.forEach((pulls, s) => pulls.forEach((data) => all.push({ data, session: s })));
  if (all.length === 0) return;

  // Prefer the logged gear where it exists.
  let allLogged = true;
  for (const { data, session } of all) {
    const logged = loggedGears[session];
    if (!logged) {
      allLogged = false;
      break;
    }
    const value = median(logged.slice(data.pull.startSample, data.pull.endSample + 1));
    if (!Number.isFinite(value) || value <= 0) {
      allLogged = false;
      break;
    }
    (data.pull as { gear: number }).gear = Math.round(value);
  }
  if (allLogged) return;

  const sorted = [...all].sort((a, b) => b.data.pull.ratio - a.data.pull.ratio);
  const clusters: { centre: number; members: typeof sorted }[] = [];

  for (const entry of sorted) {
    const ratio = entry.data.pull.ratio;
    if (!Number.isFinite(ratio)) continue;
    const cluster = clusters.find(
      (c) => Math.abs(ratio - c.centre) / c.centre <= GEAR_RATIO_TOLERANCE,
    );
    if (cluster) {
      cluster.members.push(entry);
      cluster.centre = median(cluster.members.map((m) => m.data.pull.ratio));
    } else {
      clusters.push({ centre: ratio, members: [entry] });
    }
  }

  // Highest ratio = lowest gear. The absolute numbering is arbitrary without a
  // reference, so it starts at 1 and what matters is that both sessions agree.
  clusters.sort((a, b) => b.centre - a.centre);
  clusters.forEach((cluster, i) => {
    for (const member of cluster.members) {
      (member.data.pull as { gear: number }).gear = i + 1;
    }
  });
}
