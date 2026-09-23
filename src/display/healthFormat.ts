/**
 * How health-check values are printed, shared by the screen and the PDF so both
 * show the same digits.
 */

import type { HealthMetric } from '../core/types';

const DIGITS: Record<string, number> = { λ: 2, bar: 2, '%': 1, '°C': 0, Nm: 0, '°': 1 };

/** Decimal places for a metric: rail pressure runs to thousands of bar, boost to two. */
export function metricDigits(m: Pick<HealthMetric, 'key' | 'unit'>): number {
  if (m.key === 'health.metric.railPeak') return 0;
  return DIGITS[m.unit] ?? 1;
}

/** Rounded as displayed, without a "-0" when a tiny negative rounds to zero. */
export function roundForDisplay(value: number, digits: number): number {
  const rounded = Number(value.toFixed(digits));
  return rounded === 0 ? 0 : rounded;
}
