/**
 * Stage 8: the Validity Card.
 *
 *   index = Gain × Consistency × Safety
 *
 * The product is the whole argument. A sum would let a large gain buy off a
 * dangerous one: 40 hp and audible knock would average out to "quite good". A
 * product cannot be talked round — if safety is 0.2, nothing else matters, which
 * is the correct behaviour for an instrument whose output a person will act on.
 *
 * Each factor is in 0…1 and each is separately visible in the UI, because the
 * composite number is a summary, not an explanation.
 */

import { VALIDITY } from './constants';
import { clamp } from './stats';
import type { Finding, GainResult, ValidityCard, Verdict } from './types';

/**
 * Gain: how much was won, relative to what a large real gain looks like.
 *
 * Zero when the interval includes zero. This is the rule that keeps the
 * application honest about placebo results — a 3 hp "gain" with a ±6 hp interval
 * is not a gain, and reporting it as 0.2 of one would be reporting noise as
 * progress. A loss also scores zero rather than going negative, because the index
 * is a product and a negative factor would produce a nonsense composite.
 */
export function gainScore(gain: GainResult): number {
  if (VALIDITY.requireSignificantGain && !gain.significant) return 0;
  const fraction = gain.deltaPercent.value / 100;
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  return clamp(fraction / VALIDITY.gainSaturationFraction, 0, 1);
}

/**
 * Consistency: how repeatable the pulls were.
 *
 * Driven by the coefficient of variation of peak power across the "after"
 * session's pulls. A tune that measures 250, 251, 249 hp is telling you something;
 * one that measures 230, 260, 245 is telling you that the measurement, the road or
 * the car is not under control — and its headline figure means correspondingly
 * less.
 */
export function consistencyScore(cv: number): number {
  if (!Number.isFinite(cv)) return 0;
  if (cv <= VALIDITY.consistencyCvPerfect) return 1;
  if (cv >= VALIDITY.consistencyCvZero) return 0;
  return (
    1 - (cv - VALIDITY.consistencyCvPerfect) / (VALIDITY.consistencyCvZero - VALIDITY.consistencyCvPerfect)
  );
}

/**
 * Safety: 1.0 minus what the findings take away, each weighted by its own
 * confidence.
 *
 * Weighting by confidence is what stops a low-confidence detection from
 * condemning a tune outright: a knock finding at 0.45 confidence removes 0.45 of
 * the risk penalty, not all of it. Only findings in the "after" session count —
 * the question is whether the tune as it now stands is safe, not whether the car
 * was healthy before it.
 */
export function safetyScore(findings: readonly Finding[]): number {
  let score = 1;
  for (const finding of findings) {
    if (finding.evidence.session === 'before') continue;
    const penalty =
      finding.severity === 'risk'
        ? VALIDITY.safetyPenaltyRisk
        : finding.severity === 'caution'
          ? VALIDITY.safetyPenaltyCaution
          : 0;
    score -= penalty * finding.confidence;
  }
  return clamp(score, VALIDITY.safetyFloor, 1);
}

/**
 * The verdict.
 *
 * The index is a continuous summary, but the presence of a risk-level finding is
 * categorical and is treated as such: a tune that knocks may not be called good,
 * whatever it gained. Without this rule a single confident knock finding leaves
 * the index at 0.68 and the headline reads "gain proven, no safety findings",
 * which is exactly the confident wrong answer this application exists to avoid.
 */
export function verdictFor(
  index: number,
  gain: GainResult,
  safety: number,
  hasRiskFinding: boolean,
): Verdict {
  // No proven gain and a real risk: nothing was won and something was lost.
  if (!gain.significant && hasRiskFinding) return 'bad';

  // An unproven gain on its own is not a bad tune — it is an unanswered question,
  // and saying so is more useful than a verdict the evidence does not support.
  if (!gain.significant && safety > VALIDITY.verdictGoodMin) return 'inconclusive';

  if (index < VALIDITY.verdictMixedMin) return 'bad';
  if (hasRiskFinding) return 'mixed';
  return index >= VALIDITY.verdictGoodMin ? 'good' : 'mixed';
}

/**
 * Findings must reach here already merged across adjacent zones (see
 * `mergeAdjacentZones`). Knock from 4000 to 5500 rpm is one problem, and counting
 * it once per zone would subtract its penalty three times — turning a single
 * finding into a failing safety score on arithmetic alone.
 */
export function buildValidityCard(
  gain: GainResult,
  consistencyCv: number,
  mergedFindings: readonly Finding[],
): ValidityCard {
  const g = gainScore(gain);
  const c = consistencyScore(consistencyCv);
  const s = safetyScore(mergedFindings);
  const index = g * c * s;
  const hasRisk = mergedFindings.some(
    (finding) => finding.severity === 'risk' && finding.evidence.session !== 'before',
  );
  return { gain: g, consistency: c, safety: s, index, verdict: verdictFor(index, gain, s, hasRisk) };
}
