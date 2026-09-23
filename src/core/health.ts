/**
 * The health check: what the logs say about the condition of the car, system by
 * system — turbo and boost, fuel system, combustion, temperatures, and torque
 * delivery.
 *
 * Deterministic, like the rest of the pipeline: every status comes from a
 * threshold in constants.ts, a detector finding, or requested-vs-delivered
 * tracking, and carries the measured values that produced it. The AI health
 * report (src/ai) reads this and explains it; it never sets a status.
 *
 * Both sessions are assessed, so the screen can show what the tune changed: a
 * turbo that tracked its target on the stock map and falls short on the tuned
 * one is the tune asking more than the hardware gives.
 */

import {
  EGT_CAUTION_C,
  EGT_RISK_C,
  HEALTH_COOLANT_CONCERN_C,
  HEALTH_COOLANT_WATCH_C,
  HEALTH_CV_CONCERN,
  HEALTH_CV_WATCH,
  HEALTH_DIESEL_LAMBDA_CONCERN,
  HEALTH_DIESEL_LAMBDA_WATCH,
  HEALTH_OIL_CONCERN_C,
  HEALTH_OIL_WATCH_C,
  HEALTH_SCORE_GOOD,
  HEALTH_SCORE_WATCH,
  HEALTH_STATUS_POINTS,
  HEALTH_TRACKING_CONCERN_FRACTION,
  IAT_HEAT_SOAK_RISE_C,
} from './constants';
import type { ChannelId } from './channels';
import type { PullData } from './segment';
import type {
  EcuTorqueComparison,
  Finding,
  FindingKind,
  HealthMetric,
  HealthReport,
  HealthStatus,
  HealthSystem,
  HealthSystemId,
  Session,
  TrackedQuantity,
  TrackingSeries,
  VehicleParameters,
} from './types';

type Which = 'before' | 'after';

export interface HealthInput {
  readonly sessions: Record<Which, Session>;
  readonly pulls: Record<Which, readonly PullData[]>;
  readonly cv: Record<Which, number>;
  readonly tracking: readonly TrackingSeries[];
  /** Merged findings, one per problem (the recommendations' findings). */
  readonly findings: readonly Finding[];
  readonly ecu: EcuTorqueComparison | null;
  readonly fuel: VehicleParameters['fuel'];
}

const RANK: Record<HealthStatus, number> = { unknown: -1, good: 0, watch: 1, concern: 2 };

/** The worst status among those that are known; unknown only if none is. */
export function worst(statuses: readonly HealthStatus[]): HealthStatus {
  let out: HealthStatus = 'unknown';
  for (const s of statuses) if (RANK[s] > RANK[out]) out = s;
  return out;
}

const bySeverity = (finding: Finding): HealthStatus =>
  finding.severity === 'risk' ? 'concern' : finding.severity === 'caution' ? 'watch' : 'good';

/** Rising thresholds: at or above `concern` is a concern, at or above `watch` one to watch. */
const above = (value: number, watch: number, concern: number): HealthStatus =>
  !Number.isFinite(value) ? 'unknown' : value >= concern ? 'concern' : value >= watch ? 'watch' : 'good';

/** Falling thresholds, for quantities where lower is worse. */
const below = (value: number, watch: number, concern: number): HealthStatus =>
  !Number.isFinite(value) ? 'unknown' : value <= concern ? 'concern' : value < watch ? 'watch' : 'good';

/** A channel's extreme over the accepted pulls' samples. */
function pullExtreme(session: Session, pulls: readonly PullData[], channel: ChannelId, pick: 'max' | 'min'): number {
  const series = session.channels.get(channel);
  if (!series) return NaN;
  let out = pick === 'max' ? -Infinity : Infinity;
  for (const { pull } of pulls) {
    for (let i = pull.startSample; i <= pull.endSample && i < series.length; i++) {
      const v = series[i] as number;
      if (!Number.isFinite(v)) continue;
      out = pick === 'max' ? Math.max(out, v) : Math.min(out, v);
    }
  }
  return Number.isFinite(out) ? out : NaN;
}

/** How well a tracked quantity followed its request, and the worst miss. */
function trackingHealth(
  tracking: readonly TrackingSeries[],
  quantity: TrackedQuantity,
  which: Which,
): { status: HealthStatus; worstPercent: number } {
  const series = tracking.find((s) => s.quantity === quantity && s.session === which);
  if (!series) return { status: 'unknown', worstPercent: NaN };
  const judged = series.zones.filter((z) => z.status !== 'insufficient' && z.status !== 'spooling');
  if (judged.length === 0) return { status: 'unknown', worstPercent: NaN };
  const missed = judged.filter((z) => z.status === 'short' || z.status === 'over').length;
  let worstPercent = 0;
  for (const z of judged) if (Math.abs(z.error.value) > Math.abs(worstPercent)) worstPercent = z.error.value * 100;
  const status: HealthStatus =
    missed === 0 ? 'good' : missed / judged.length >= HEALTH_TRACKING_CONCERN_FRACTION ? 'concern' : 'watch';
  return { status, worstPercent };
}

function findingsOf(input: HealthInput, which: Which, kinds: readonly FindingKind[]): Finding[] {
  return input.findings.filter((f) => f.evidence.session === which && kinds.includes(f.kind));
}

function metric(key: string, value: number, unit: string, status: HealthStatus, limit?: number): HealthMetric | null {
  if (!Number.isFinite(value)) return null;
  return limit === undefined ? { key, value, unit, status } : { key, value, unit, status, limit };
}

function build(
  id: HealthSystemId,
  metrics: readonly (HealthMetric | null)[],
  findings: readonly Finding[],
  extra: readonly HealthStatus[] = [],
): Omit<HealthSystem, 'statusBefore'> {
  const kept = metrics.filter((m): m is HealthMetric => m !== null);
  return {
    id,
    status: worst([...kept.map((m) => m.status), ...findings.map(bySeverity), ...extra]),
    metrics: kept,
    findings: [...new Set(findings.map((f) => f.kind))],
  };
}

function assessSession(input: HealthInput, which: Which): Omit<HealthSystem, 'statusBefore'>[] {
  const session = input.sessions[which];
  const pulls = input.pulls[which];
  const diesel = input.fuel === 'diesel';
  const max = (channel: ChannelId) => pullExtreme(session, pulls, channel, 'max');
  const min = (channel: ChannelId) => pullExtreme(session, pulls, channel, 'min');

  // --- turbo and boost ------------------------------------------------------
  const boost = trackingHealth(input.tracking, 'boost', which);
  const turbo = build(
    'turbo',
    [
      metric('health.metric.boostPeak', max('boost') / 100, 'bar', 'good'),
      metric('health.metric.boostTracking', boost.worstPercent, '%', boost.status),
    ],
    findingsOf(input, which, ['boostOvershoot', 'boostOscillation']),
  );

  // --- fuel system ------------------------------------------------------------
  const rail = trackingHealth(input.tracking, 'fuelRail', which);
  const fuel = build(
    'fuel',
    [
      metric('health.metric.railPeak', max('fuelRail') / 100, 'bar', 'good'),
      metric('health.metric.railTracking', rail.worstPercent, '%', rail.status),
      metric('health.metric.injectorDuty', max('injectorDuty') * 100, '%', 'good'),
    ],
    findingsOf(input, which, ['fuelRailDroop']),
  );

  // --- combustion ----------------------------------------------------------------
  const lambdaMin = min('lambda');
  const lambdaTracking = trackingHealth(input.tracking, 'lambda', which);
  const combustion = build(
    'combustion',
    [
      diesel
        ? metric(
            'health.metric.lambdaMin',
            lambdaMin,
            'λ',
            below(lambdaMin, HEALTH_DIESEL_LAMBDA_WATCH, HEALTH_DIESEL_LAMBDA_CONCERN),
            HEALTH_DIESEL_LAMBDA_WATCH,
          )
        : metric('health.metric.lambdaMin', lambdaMin, 'λ', 'good'),
      metric('health.metric.lambdaTracking', lambdaTracking.worstPercent, '%', lambdaTracking.status),
      metric('health.metric.knockMax', max('knockRetard'), '°', 'good'),
    ],
    findingsOf(input, which, ['knock', 'lean']),
  );

  // --- temperatures ----------------------------------------------------------------
  const coolant = max('coolant');
  const oil = max('oilTemp');
  const egt = max('egt');
  const iatRise = max('iat') - min('iat');
  const thermal = build(
    'thermal',
    [
      metric(
        'health.metric.coolantMax',
        coolant,
        '°C',
        above(coolant, HEALTH_COOLANT_WATCH_C, HEALTH_COOLANT_CONCERN_C),
        HEALTH_COOLANT_WATCH_C,
      ),
      metric(
        'health.metric.oilMax',
        oil,
        '°C',
        above(oil, HEALTH_OIL_WATCH_C, HEALTH_OIL_CONCERN_C),
        HEALTH_OIL_WATCH_C,
      ),
      metric('health.metric.egtMax', egt, '°C', above(egt, EGT_CAUTION_C, EGT_RISK_C), EGT_CAUTION_C),
      metric(
        'health.metric.iatRise',
        iatRise,
        '°C',
        above(iatRise, IAT_HEAT_SOAK_RISE_C, Infinity),
        IAT_HEAT_SOAK_RISE_C,
      ),
    ],
    findingsOf(input, which, ['iatHeatSoak', 'egt']),
  );

  // --- torque delivery -----------------------------------------------------------
  // Whether the engine makes the same power every pull, and — after the tune —
  // whether it delivers the torque its own ECU reports.
  const cv = input.cv[which];
  const ecu = input.ecu;
  const ecuStatus: HealthStatus =
    which === 'after' && ecu
      ? ecu.agreement === 'notDelivered'
        ? 'concern'
        : ecu.agreement === 'exceeds'
          ? 'watch'
          : ecu.agreement === 'confirmed'
            ? 'good'
            : 'unknown'
      : 'unknown';
  const delivery = build(
    'delivery',
    [
      pulls.length >= 2
        ? metric(
            'health.metric.consistency',
            cv * 100,
            '%',
            above(cv, HEALTH_CV_WATCH, HEALTH_CV_CONCERN),
            HEALTH_CV_WATCH * 100,
          )
        : null,
      which === 'after' && ecu && ecu.agreement !== 'undetermined'
        ? metric('health.metric.ecuDelivered', ecu.measuredChange.value - ecu.reportedChange.value, 'Nm', ecuStatus)
        : null,
    ],
    [],
  );

  return [turbo, fuel, combustion, thermal, delivery];
}

export function scoreOf(systems: readonly { status: HealthStatus }[]): number {
  const known = systems.filter((s) => s.status !== 'unknown');
  if (known.length === 0) return NaN;
  const points = known.map((s) => HEALTH_STATUS_POINTS[s.status as Exclude<HealthStatus, 'unknown'>]);
  return Math.round(points.reduce((a, b) => a + b, 0) / points.length);
}

export function assessHealth(input: HealthInput): HealthReport {
  const after = assessSession(input, 'after');
  const before = assessSession(input, 'before');
  const systems: HealthSystem[] = after.map((system, i) => ({
    ...system,
    statusBefore: before[i]?.status ?? 'unknown',
  }));
  const score = scoreOf(systems);
  const scoreBefore = scoreOf(before);
  return {
    systems,
    score,
    scoreBefore,
    label: !Number.isFinite(score)
      ? 'unknown'
      : score >= HEALTH_SCORE_GOOD
        ? 'healthy'
        : score >= HEALTH_SCORE_WATCH
          ? 'watch'
          : 'attention',
  };
}
