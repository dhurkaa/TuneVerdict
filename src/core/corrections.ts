/**
 * The correction table: findings turned into changes to specific map cells.
 *
 * A finding says "knock at 4000–5500 rpm". A tuner works in a table indexed by rpm
 * and load, so this module places the evidence into cells of that shape
 * (CORRECTION_RPM_STEP × CORRECTION_LOAD_STEP_KPA) and sizes each change from what
 * the log actually showed in that cell.
 *
 * The one rule that does not bend: every suggestion moves toward safety — less
 * ignition advance, more fuel, less boost — and none moves toward power. A log can
 * prove that a cell did harm; it cannot prove that a cell has headroom. A
 * suggestion to add two degrees would be a guess wearing the authority of a
 * measurement, and the cost of that guess being wrong is a piston.
 *
 * Every size here is a starting point for the next session, not a final value.
 * The UI says so, and the next pair of logs is how it gets checked.
 */

import {
  CORRECTION_BOOST_STEP_KPA,
  CORRECTION_FUEL_STEP_PERCENT,
  CORRECTION_LOAD_STEP_KPA,
  CORRECTION_MIN_CELL_POINTS,
  CORRECTION_REFERENCE_WOT_LAMBDA,
  CORRECTION_RPM_STEP,
  CORRECTION_TIMING_MARGIN_DEG,
  CORRECTION_TIMING_STEP_DEG,
  DETECTOR,
  PROTOCOL_RPM_HIGH,
  PROTOCOL_RPM_LOW,
  TRACKING_TOLERANCE,
} from './constants';
import { computeConfidence, limitSeries, zoneRange, zones } from './detect';
import type { PullData } from './segment';
import { mean } from './stats';
import { pullSpoolRpm } from './tracking';
import type { CorrectionCell, Finding, FindingKind, TrackingSeries } from './types';

/** Round a magnitude up to the next step: a correction is never smaller than the evidence. */
function roundUp(value: number, step: number): number {
  return Math.ceil(value / step - 1e-9) * step;
}

/**
 * A detector's series for a whole pull, computed zone by zone exactly as the
 * detector computes it — boost excess, for instance, is measured against each
 * zone's own plateau, and a whole-pull plateau would give a different number than
 * the finding that triggered this correction.
 */
function fullSeries(kind: FindingKind, pull: PullData, rpmAxis: Float64Array): Float64Array | null {
  const out = new Float64Array(rpmAxis.length).fill(NaN);
  let any = false;
  for (const zone of zones()) {
    const [lo, hi] = zoneRange(rpmAxis, zone);
    if (hi < lo) continue;
    const series = limitSeries(kind, pull, lo, hi);
    if (!series) continue;
    for (let i = lo; i <= hi; i++) {
      const value = series[i] as number;
      if (Number.isFinite(value)) {
        out[i] = value;
        any = true;
      }
    }
  }
  return any ? out : null;
}

interface CellKey {
  readonly rpmLow: number;
  readonly loadLow: number; // NaN when no MAP
}

function cellOf(rpm: number, mapKpa: number): CellKey | null {
  if (!Number.isFinite(rpm) || rpm < PROTOCOL_RPM_LOW || rpm > PROTOCOL_RPM_HIGH) return null;
  const rpmLow =
    PROTOCOL_RPM_LOW +
    Math.min(
      Math.floor((rpm - PROTOCOL_RPM_LOW) / CORRECTION_RPM_STEP),
      Math.floor((PROTOCOL_RPM_HIGH - PROTOCOL_RPM_LOW) / CORRECTION_RPM_STEP) - 1,
    ) *
      CORRECTION_RPM_STEP;
  const loadLow = Number.isFinite(mapKpa)
    ? Math.floor(mapKpa / CORRECTION_LOAD_STEP_KPA) * CORRECTION_LOAD_STEP_KPA
    : NaN;
  return { rpmLow, loadLow };
}

const keyString = (key: CellKey): string => `${key.rpmLow}|${Number.isFinite(key.loadLow) ? key.loadLow : 'all'}`;

/** Values gathered for one quantity in one cell, kept per pull. */
class CellSamples {
  readonly byPull = new Map<number, number[]>();
  add(pullIndex: number, value: number): void {
    if (!Number.isFinite(value)) return;
    const list = this.byPull.get(pullIndex);
    if (list) list.push(value);
    else this.byPull.set(pullIndex, [value]);
  }
  get count(): number {
    let n = 0;
    for (const list of this.byPull.values()) n += list.length;
    return n;
  }
  /** The worst pull's mean, and the pulls whose mean crossed the given line. */
  worst(crosses: (value: number) => boolean): { worst: number; pulls: number[]; overall: number } {
    let worst = -Infinity;
    const pulls: number[] = [];
    const all: number[] = [];
    for (const [pull, values] of this.byPull) {
      const m = mean(values);
      all.push(...values);
      if (m > worst) worst = m;
      if (crosses(m)) pulls.push(pull);
    }
    return { worst, pulls: pulls.sort((a, b) => a - b), overall: mean(all) };
  }
}

interface Cell {
  readonly key: CellKey;
  readonly knock: CellSamples;
  readonly lambda: CellSamples;
  readonly lambdaTarget: CellSamples;
  readonly boostExcess: CellSamples;
  readonly boostTarget: CellSamples;
  readonly boost: CellSamples;
  readonly shortfall: CellSamples;
  readonly railDroop: CellSamples;
}

function newCell(key: CellKey): Cell {
  return {
    key,
    knock: new CellSamples(),
    lambda: new CellSamples(),
    lambdaTarget: new CellSamples(),
    boostExcess: new CellSamples(),
    boostTarget: new CellSamples(),
    boost: new CellSamples(),
    shortfall: new CellSamples(),
    railDroop: new CellSamples(),
  };
}

/** Whether a finding of this kind, in the after session, covers this rpm. */
function coveredBy(findings: readonly Finding[], kind: FindingKind, rpmLow: number, rpmHigh: number): Finding | null {
  return (
    findings.find(
      (f) =>
        f.kind === kind &&
        f.evidence.session === 'after' &&
        f.zone.rpmLow < rpmHigh &&
        f.zone.rpmHigh > rpmLow,
    ) ?? null
  );
}

export function buildCorrections(
  pulls: readonly PullData[],
  rpmAxis: Float64Array,
  afterFindings: readonly Finding[],
  afterTracking: readonly TrackingSeries[],
  sourceSampleRateHz: number,
): CorrectionCell[] {
  if (pulls.length === 0) return [];

  // --- gather evidence into cells --------------------------------------------
  const cells = new Map<string, Cell>();
  const boostShortZones = (afterTracking.find((s) => s.quantity === 'boost')?.zones ?? []).filter(
    (z) => z.status === 'short',
  );

  for (const data of pulls) {
    const index = data.pull.index;
    const map = data.onRpm.get('map');
    const knock = data.onRpm.get('knockRetard');
    const lambda = data.onRpm.get('lambda');
    const lambdaTarget = data.onRpm.get('lambdaTarget');
    const boost = data.onRpm.get('boost');
    const boostTarget = data.onRpm.get('boostTarget');
    const excess = fullSeries('boostOvershoot', data, rpmAxis);
    const droop = fullSeries('fuelRailDroop', data, rpmAxis);
    const spool = pullSpoolRpm(data, rpmAxis);

    for (let k = 0; k < rpmAxis.length; k++) {
      const rpm = rpmAxis[k] as number;
      const key = cellOf(rpm, map ? (map[k] as number) : NaN);
      if (!key) continue;
      const id = keyString(key);
      let cell = cells.get(id);
      if (!cell) {
        cell = newCell(key);
        cells.set(id, cell);
      }
      if (knock) cell.knock.add(index, knock[k] as number);
      if (lambda) cell.lambda.add(index, lambda[k] as number);
      if (lambdaTarget) cell.lambdaTarget.add(index, lambdaTarget[k] as number);
      if (excess) cell.boostExcess.add(index, excess[k] as number);
      if (boost) cell.boost.add(index, boost[k] as number);
      if (boostTarget) cell.boostTarget.add(index, boostTarget[k] as number);
      if (droop) cell.railDroop.add(index, droop[k] as number);
      // Boost short of target counts only once the turbocharger has spooled:
      // below that, a shortfall is lag, and lowering the target would not help.
      if (boost && boostTarget && Number.isFinite(spool) && rpm >= spool) {
        const b = boost[k] as number;
        const t = boostTarget[k] as number;
        if (Number.isFinite(b) && Number.isFinite(t)) cell.shortfall.add(index, t - b);
      }
    }
  }

  // --- turn evidence into suggestions ----------------------------------------
  const out: CorrectionCell[] = [];

  for (const cell of cells.values()) {
    const rpmLow = cell.key.rpmLow;
    const rpmHigh = rpmLow + CORRECTION_RPM_STEP;
    const loadLowKpa = cell.key.loadLow;
    const loadHighKpa = Number.isFinite(loadLowKpa) ? loadLowKpa + CORRECTION_LOAD_STEP_KPA : NaN;
    const base = { rpmLow, rpmHigh, loadLowKpa, loadHighKpa };

    // Ignition: retard by at least what the knock controller had to take, plus
    // one table step, because the controller's retard is the minimum that stopped
    // knock on that day — not a margin.
    const knockFinding = coveredBy(afterFindings, 'knock', rpmLow, rpmHigh);
    if (knockFinding && cell.knock.count >= CORRECTION_MIN_CELL_POINTS) {
      const { worst, pulls: crossing } = cell.knock.worst((v) => v > DETECTOR.knockRetardDeg);
      if (worst > DETECTOR.knockRetardDeg) {
        out.push({
          ...base,
          parameter: 'ignition',
          change: -roundUp(worst + CORRECTION_TIMING_MARGIN_DEG, CORRECTION_TIMING_STEP_DEG),
          unit: 'deg',
          cause: 'knock',
          observed: worst,
          reference: DETECTOR.knockRetardDeg,
          evidencePoints: cell.knock.count,
          pulls: crossing,
          confidence: knockFinding.confidence,
        });
      }
    }

    // Fuel: enrich until λ reaches the richer of the logged target and the WOT
    // reference. Fuel mass scales with 1/λ, so moving from λo to λr needs λo/λr − 1
    // more fuel. A map that *requests* a lean λ is itself the problem, which is
    // why the target is never allowed to be leaner than the reference.
    const leanFinding = coveredBy(afterFindings, 'lean', rpmLow, rpmHigh);
    if (leanFinding && cell.lambda.count >= CORRECTION_MIN_CELL_POINTS) {
      const { worst, pulls: crossing } = cell.lambda.worst((v) => v > DETECTOR.leanLambda);
      if (worst > DETECTOR.leanLambda) {
        const target = cell.lambdaTarget.count > 0 ? cell.lambdaTarget.worst(() => false).overall : NaN;
        const reference = Number.isFinite(target)
          ? Math.min(target, CORRECTION_REFERENCE_WOT_LAMBDA)
          : CORRECTION_REFERENCE_WOT_LAMBDA;
        out.push({
          ...base,
          parameter: 'fuel',
          change: roundUp((worst / reference - 1) * 100, CORRECTION_FUEL_STEP_PERCENT),
          unit: 'percent',
          cause: 'lean',
          observed: worst,
          reference,
          evidencePoints: cell.lambda.count,
          pulls: crossing,
          confidence: leanFinding.confidence,
        });
      }
    }

    // Boost overshoot: take the observed excess off the request (or slow the
    // controller, which the advice text also says).
    const overshootFinding = coveredBy(afterFindings, 'boostOvershoot', rpmLow, rpmHigh);
    if (overshootFinding && cell.boostExcess.count >= CORRECTION_MIN_CELL_POINTS) {
      const { worst, pulls: crossing } = cell.boostExcess.worst(
        (v) => v > DETECTOR.boostOvershootFraction,
      );
      if (worst > DETECTOR.boostOvershootFraction) {
        const target =
          cell.boostTarget.count > 0
            ? cell.boostTarget.worst(() => false).overall
            : cell.boost.worst(() => false).overall / (1 + worst);
        if (Number.isFinite(target) && target > 0) {
          out.push({
            ...base,
            parameter: 'boost',
            change: -roundUp(worst * target, CORRECTION_BOOST_STEP_KPA),
            unit: 'kPa',
            cause: 'boostOvershoot',
            observed: worst,
            reference: target,
            evidencePoints: cell.boostExcess.count,
            pulls: crossing,
            confidence: overshootFinding.confidence,
          });
        }
      }
    }

    // Boost the turbocharger cannot reach: lower the request to what it delivers.
    // A request that is never met leaves the boost controller saturated and the
    // fuelling and timing tables computed for a pressure the engine never sees.
    const shortZone = boostShortZones.find((z) => z.zone.rpmLow < rpmHigh && z.zone.rpmHigh > rpmLow);
    if (shortZone && cell.shortfall.count >= CORRECTION_MIN_CELL_POINTS) {
      const target = cell.boostTarget.worst(() => false).overall;
      const { worst, pulls: crossing } = cell.shortfall.worst(
        (v) => Number.isFinite(target) && target > 0 && v / target > TRACKING_TOLERANCE.boost,
      );
      if (Number.isFinite(target) && target > 0 && worst / target > TRACKING_TOLERANCE.boost) {
        const { confidence } = computeConfidence({
          agreeingPulls: crossing.length,
          totalPulls: pulls.length,
          peakValue: worst / target,
          threshold: TRACKING_TOLERANCE.boost,
          direction: 'above',
          provenance: 'measured',
          // Tracking tolerances are engineering values, not calibrated detectors.
          uncalibrated: true,
          sourceSampleRateHz,
          correctionInBand: true,
        });
        out.push({
          ...base,
          parameter: 'boost',
          change: -roundUp(worst, CORRECTION_BOOST_STEP_KPA),
          unit: 'kPa',
          cause: 'boostShortfall',
          observed: worst,
          reference: target,
          evidencePoints: cell.shortfall.count,
          pulls: crossing,
          confidence,
        });
      }
    }

    // Fuel rail droop has no map cell that fixes it: the pump, filter or injector
    // capacity is the limit. Listed as a hardware entry so it is not lost among
    // the map changes.
    const droopFinding = coveredBy(afterFindings, 'fuelRailDroop', rpmLow, rpmHigh);
    if (droopFinding && cell.railDroop.count >= CORRECTION_MIN_CELL_POINTS) {
      const { worst, pulls: crossing } = cell.railDroop.worst((v) => v > DETECTOR.fuelRailDroopFraction);
      if (worst > DETECTOR.fuelRailDroopFraction) {
        out.push({
          ...base,
          parameter: 'hardware',
          change: NaN,
          unit: null,
          cause: 'fuelRailDroop',
          observed: worst,
          reference: DETECTOR.fuelRailDroopFraction,
          evidencePoints: cell.railDroop.count,
          pulls: crossing,
          confidence: droopFinding.confidence,
        });
      }
    }
  }

  const order: Record<CorrectionCell['parameter'], number> = { ignition: 0, fuel: 1, boost: 2, hardware: 3 };
  return out.sort(
    (a, b) =>
      order[a.parameter] - order[b.parameter] ||
      a.rpmLow - b.rpmLow ||
      (Number.isFinite(a.loadLowKpa) ? a.loadLowKpa : 0) - (Number.isFinite(b.loadLowKpa) ? b.loadLowKpa : 0),
  );
}
