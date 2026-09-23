/**
 * Gain across the rpm range.
 *
 * The headline figure is a difference of peaks, and a peak is one point. A tune
 * can add 40 hp at 5000 rpm and take 10 hp away at 3000 — which is where the car
 * is driven most of the time — and the peak figure will not show it. This module
 * splits the compared range into stretches where the difference is proven
 * positive, proven negative, or not proven either way, from the same interval the
 * difference chart draws.
 */

import { BAND_MIN_WIDTH_RPM, CURVE_RPM_STEP } from './constants';
import { mean } from './stats';
import type { GainBand, PowerCurvePoint } from './types';

type Kind = GainBand['kind'];

function classify(point: PowerCurvePoint): Kind | null {
  const { lo, hi, value } = point.delta;
  if (!Number.isFinite(value)) return null;
  if (Number.isFinite(lo) && lo > 0) return 'gain';
  if (Number.isFinite(hi) && hi < 0) return 'loss';
  return 'unproven';
}

interface Run {
  kind: Kind;
  points: PowerCurvePoint[];
}

function width(run: Run): number {
  const first = run.points[0];
  const last = run.points[run.points.length - 1];
  return first && last ? last.rpm - first.rpm + CURVE_RPM_STEP : 0;
}

export function gainBands(curve: readonly PowerCurvePoint[]): GainBand[] {
  const runs: Run[] = [];
  for (const point of curve) {
    const kind = classify(point);
    if (kind === null) continue;
    const last = runs[runs.length - 1];
    const contiguous = last && point.rpm - (last.points[last.points.length - 1]?.rpm ?? -Infinity) <= CURVE_RPM_STEP;
    if (last && contiguous && last.kind === kind) last.points.push(point);
    else runs.push({ kind, points: [point] });
  }

  // A proven gain or loss narrower than BAND_MIN_WIDTH_RPM is two or three curve
  // points at the edge of the interval, not a region of the power band. It is
  // folded into "unproven" rather than reported as a finding of its own.
  for (const run of runs) {
    if (run.kind !== 'unproven' && width(run) < BAND_MIN_WIDTH_RPM) run.kind = 'unproven';
  }

  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.kind === run.kind) last.points.push(...run.points);
    else merged.push({ kind: run.kind, points: [...run.points] });
  }

  return merged.map((run) => ({
    rpmLow: run.points[0]?.rpm ?? NaN,
    rpmHigh: run.points[run.points.length - 1]?.rpm ?? NaN,
    kind: run.kind,
    meanDelta: mean(run.points.map((p) => p.delta.value)),
  }));
}
