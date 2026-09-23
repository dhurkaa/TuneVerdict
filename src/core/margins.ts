/**
 * Safety margins: how close each zone came to each limit.
 *
 * A detector answers "did it cross the line". A tuner also needs "how close did it
 * get" — a zone that ran λ 0.905 against a 0.91 threshold produced no finding, and
 * is one warm day away from producing one. The margins report that distance, using
 * exactly the series the detectors read (`limitSeries`), so a margin and the
 * finding beside it can never disagree about what was measured.
 *
 * Margin = distance to the threshold as a fraction of the threshold, positive on
 * the safe side.
 */

import { MARGIN_TIGHT_FRACTION } from './constants';
import { detectorLimit, limitSeries, zoneRange, zones } from './detect';
import type { PullData } from './segment';
import { bootstrapMean } from './stats';
import type { Rng } from './stats';
import type { FindingKind, MarginCell, MarginLimit, MarginStatus } from './types';

const LIMITS: readonly MarginLimit[] = ['knock', 'lean', 'boostOvershoot', 'fuelRailDroop', 'egt'];

/**
 * Capped at 1: boost sitting *below* its target is not "150% safe" from
 * overshoot, it is simply nowhere near it. Values past zero on the safe side say
 * nothing more than a full margin does.
 */
function marginOf(worst: number, threshold: number, direction: 'above' | 'below'): number {
  if (!Number.isFinite(worst) || threshold === 0) return NaN;
  const margin =
    direction === 'above'
      ? (threshold - worst) / Math.abs(threshold)
      : (worst - threshold) / Math.abs(threshold);
  return Math.min(1, margin);
}

export function computeMargins(
  pulls: readonly PullData[],
  rpmAxis: Float64Array,
  rng: Rng,
  fuel: 'gasoline' | 'diesel' | 'e85' | 'lpg' = 'gasoline',
): MarginCell[] {
  const cells: MarginCell[] = [];

  for (const limit of LIMITS) {
    // A diesel's λ margin is to the smoke limit, not the petrol lean limit.
    if (limit === 'lean' && fuel === 'diesel') continue;
    const spec = detectorLimit(limit as FindingKind);
    if (!spec) continue;

    for (const zone of zones()) {
      const [lo, hi] = zoneRange(rpmAxis, zone);
      const perPull: number[] = [];

      for (const pull of pulls) {
        if (hi < lo) break;
        const series = limitSeries(limit as FindingKind, pull, lo, hi);
        if (!series) continue;
        let worst = spec.direction === 'above' ? -Infinity : Infinity;
        let seen = false;
        for (let i = lo; i <= hi; i++) {
          const value = series[i] as number;
          if (!Number.isFinite(value)) continue;
          seen = true;
          worst = spec.direction === 'above' ? Math.max(worst, value) : Math.min(worst, value);
        }
        if (seen) perPull.push(marginOf(worst, spec.threshold, spec.direction));
      }

      if (perPull.length === 0) {
        cells.push({
          zone,
          limit,
          margin: { value: NaN, sd: NaN, lo: NaN, hi: NaN },
          worstMargin: NaN,
          status: 'unavailable',
        });
        continue;
      }

      const worstMargin = Math.min(...perPull);
      const status: MarginStatus =
        worstMargin < 0 ? 'exceeded' : worstMargin < MARGIN_TIGHT_FRACTION ? 'tight' : 'ok';

      cells.push({ zone, limit, margin: bootstrapMean(perPull, rng), worstMargin, status });
    }
  }

  return cells;
}
