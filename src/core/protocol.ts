/**
 * Measurement protocol validation.
 *
 * The protocol: 5 pulls per session · gear 3 or 4 · 2000→5500 rpm · same road and
 * direction · ΔT < 3 °C between sessions · fuel above 50% · engine at operating
 * temperature.
 *
 * Checking it is not pedantry. A comparison across mismatched conditions is the
 * single most likely way for a user to get a confident wrong answer, and the
 * failure is invisible in the result: the numbers look exactly as convincing as
 * real ones. So the violations are computed before the verdict and shown with it,
 * not buried in a log.
 */

import {
  MIN_PULLS_FOR_STATISTICS,
  PRIOR_PULL_CV,
  PROTOCOL_MAX_IAT_DELTA_C,
  PROTOCOL_MIN_COOLANT_C,
  PROTOCOL_MIN_FUEL_FRACTION,
  PROTOCOL_PULLS_PER_SESSION,
  PROTOCOL_RPM_COVERAGE_TOLERANCE,
  PROTOCOL_RPM_HIGH,
  PROTOCOL_RPM_LOW,
  TARGET_SAMPLE_RATE_HZ,
  WARN_SAMPLE_RATE_HZ,
  DIESEL_LAMBDA_HINT,
} from './constants';
import { mean, median } from './stats';
import type { PullData } from './segment';
import type { ProtocolViolation, Session } from './types';

export interface ProtocolInput {
  readonly session: Session;
  readonly pulls: readonly PullData[];
  readonly rejectedCount: number;
  readonly which: 'before' | 'after';
  /** The protocol's rpm window for this fuel; the petrol window when omitted. */
  readonly rpmRange?: { readonly low: number; readonly high: number };
}

/**
 * Violations for one session. Severity separates "this invalidates the comparison"
 * (risk) from "this widens the interval" (caution).
 */
export function checkSession(input: ProtocolInput): ProtocolViolation[] {
  const violations: ProtocolViolation[] = [];
  const { session, pulls, which } = input;
  const rpmLow = input.rpmRange?.low ?? PROTOCOL_RPM_LOW;
  const rpmHigh = input.rpmRange?.high ?? PROTOCOL_RPM_HIGH;

  if (pulls.length < MIN_PULLS_FOR_STATISTICS) {
    // Analysable, but the pull-to-pull scatter is assumed rather than measured:
    // the interval and the significance test rest on PRIOR_PULL_CV.
    violations.push({
      key: 'protocol.assumedScatter',
      severity: 'caution',
      detail: {
        session: which,
        found: pulls.length,
        needed: MIN_PULLS_FOR_STATISTICS,
        cv: PRIOR_PULL_CV * 100,
        rejected: input.rejectedCount,
      },
    });
  } else if (pulls.length < PROTOCOL_PULLS_PER_SESSION) {
    violations.push({
      key: 'protocol.fewerPullsThanProtocol',
      severity: 'caution',
      detail: { session: which, found: pulls.length, expected: PROTOCOL_PULLS_PER_SESSION },
    });
  }

  if (session.sourceSampleRateHz < WARN_SAMPLE_RATE_HZ) {
    violations.push({
      key: 'protocol.lowSampleRate',
      severity: 'caution',
      detail: {
        session: which,
        rate: round(session.sourceSampleRateHz, 1),
        target: TARGET_SAMPLE_RATE_HZ,
      },
    });
  }

  // Gears must agree *within* a session too: three pulls in 3rd and two in 4th is
  // not five comparable measurements.
  const gears = new Set(pulls.map((p) => p.pull.gear).filter((g) => g > 0));
  if (gears.size > 1) {
    violations.push({
      key: 'protocol.mixedGears',
      severity: 'risk',
      detail: { session: which, gears: [...gears].sort().join(', ') },
    });
  }

  const coolant = pulls.map((p) => p.pull.meanCoolantC).filter(Number.isFinite);
  if (coolant.length > 0 && median(coolant) < PROTOCOL_MIN_COOLANT_C) {
    violations.push({
      key: 'protocol.engineCold',
      severity: 'caution',
      detail: {
        session: which,
        coolant: round(median(coolant), 1),
        minimum: PROTOCOL_MIN_COOLANT_C,
      },
    });
  }

  const fuel = session.channels.get('fuelLevel');
  if (fuel) {
    const level = median(fuel);
    if (Number.isFinite(level) && level < PROTOCOL_MIN_FUEL_FRACTION) {
      violations.push({
        key: 'protocol.lowFuel',
        severity: 'caution',
        detail: {
          session: which,
          level: round(level * 100, 0),
          minimum: PROTOCOL_MIN_FUEL_FRACTION * 100,
        },
      });
    }
  }

  const outOfBand = pulls.filter((p) => !p.pull.correction.inValidBand).length;
  if (outOfBand > 0) {
    violations.push({
      key: 'protocol.correctionOutOfBand',
      severity: 'caution',
      detail: { session: which, pulls: outOfBand, total: pulls.length },
    });
  }

  // rpm coverage: a pull that only reached 4800 rpm cannot support a claim about
  // 5500 rpm, and the curve must not be drawn where no pull went.
  const highest = Math.max(...pulls.map((p) => p.pull.rpmEnd).filter(Number.isFinite), 0);
  const lowest = Math.min(
    ...pulls.map((p) => p.pull.rpmStart).filter(Number.isFinite),
    Number.POSITIVE_INFINITY,
  );
  if (
    Number.isFinite(highest) &&
    highest > 0 &&
    highest < rpmHigh - PROTOCOL_RPM_COVERAGE_TOLERANCE
  ) {
    violations.push({
      key: 'protocol.rpmCoverageHigh',
      severity: 'caution',
      detail: { session: which, reached: round(highest, 0), expected: rpmHigh },
    });
  }
  if (Number.isFinite(lowest) && lowest > rpmLow + PROTOCOL_RPM_COVERAGE_TOLERANCE) {
    violations.push({
      key: 'protocol.rpmCoverageLow',
      severity: 'caution',
      detail: { session: which, started: round(lowest, 0), expected: rpmLow },
    });
  }

  return violations;
}

/**
 * Violations that only exist between the two sessions. These are the dangerous
 * ones: each session can be individually perfect and the comparison still
 * meaningless.
 */
export function checkPair(
  before: readonly PullData[],
  after: readonly PullData[],
): ProtocolViolation[] {
  const violations: ProtocolViolation[] = [];
  if (before.length === 0 || after.length === 0) return violations;

  const gearBefore = median(before.map((p) => p.pull.gear));
  const gearAfter = median(after.map((p) => p.pull.gear));
  if (Number.isFinite(gearBefore) && Number.isFinite(gearAfter) && gearBefore !== gearAfter) {
    violations.push({
      key: 'protocol.gearMismatch',
      severity: 'risk',
      detail: { before: gearBefore, after: gearAfter },
    });
  }

  const iatBefore = mean(before.map((p) => p.pull.meanIatC));
  const iatAfter = mean(after.map((p) => p.pull.meanIatC));
  const delta = Math.abs(iatAfter - iatBefore);
  if (Number.isFinite(delta) && delta > PROTOCOL_MAX_IAT_DELTA_C) {
    violations.push({
      key: 'protocol.iatMismatch',
      severity: delta > 2 * PROTOCOL_MAX_IAT_DELTA_C ? 'risk' : 'caution',
      detail: {
        delta: round(delta, 1),
        maximum: PROTOCOL_MAX_IAT_DELTA_C,
        before: round(iatBefore, 1),
        after: round(iatAfter, 1),
      },
    });
  }

  // Gear ratios differing while the gear ordinal matches means different tyres or
  // a different gearbox — the two logs are not the same car in the same state.
  const ratioBefore = median(before.map((p) => p.pull.ratio));
  const ratioAfter = median(after.map((p) => p.pull.ratio));
  const ratioDelta = Math.abs(ratioAfter - ratioBefore) / ratioBefore;
  if (Number.isFinite(ratioDelta) && ratioDelta > 0.02) {
    violations.push({
      key: 'protocol.ratioMismatch',
      severity: 'caution',
      detail: { delta: round(ratioDelta * 100, 1) },
    });
  }

  return violations;
}

/**
 * A petrol engine at full load runs rich, λ 0.75–0.9; a diesel never does. When
 * the fuel setting says petrol but the logged λ under full load sits well above 1,
 * the setting is almost certainly wrong — and with it, how an AFR column was
 * converted and whether the lean detector should run at all.
 */
export function checkFuel(
  pulls: readonly PullData[],
  fuel: 'gasoline' | 'diesel' | 'e85' | 'lpg',
): ProtocolViolation[] {
  if (fuel === 'diesel') return [];
  const values: number[] = [];
  for (const pull of pulls) {
    const lambda = pull.onRpm.get('lambda');
    if (!lambda) continue;
    for (const v of lambda) if (Number.isFinite(v)) values.push(v);
  }
  if (values.length === 0) return [];
  const typical = median(values);
  return typical > DIESEL_LAMBDA_HINT
    ? [{ key: 'protocol.lambdaLooksDiesel', severity: 'caution', detail: { lambda: round(typical, 2) } }]
    : [];
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return NaN;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
