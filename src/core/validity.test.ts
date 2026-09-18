import { describe, expect, it } from 'vitest';
import { VALIDITY } from './constants';
import type { Finding, GainResult } from './types';
import { buildValidityCard, consistencyScore, gainScore, safetyScore } from './validity';

function gain(deltaPercent: number, significant: boolean): GainResult {
  const estimate = (value: number) => ({ value, sd: 1, lo: value - 2, hi: value + 2 });
  return {
    peakBefore: estimate(200),
    peakAfter: estimate(200 * (1 + deltaPercent / 100)),
    delta: estimate(200 * (deltaPercent / 100)),
    deltaPercent: estimate(deltaPercent),
    commonModeCancellation: 3,
    significant,
    pValue: significant ? 0.01 : 0.4,
  };
}

function finding(severity: Finding['severity'], confidence: number): Finding {
  return {
    kind: 'knock',
    severity,
    zone: { rpmLow: 4000, rpmHigh: 5000 },
    evidence: {
      pulls: [0, 1, 2],
      totalPulls: 5,
      exceedingSamples: 20,
      zoneSamples: 100,
      channel: 'knockRetard',
      channelProvenance: 'measured',
      peakValue: 3,
      threshold: 0.7,
      session: 'after',
    },
    confidence,
    confidenceTrace: [],
  };
}

describe('gain score', () => {
  it('is zero when the gain is not distinguishable from noise', () => {
    // A 3 hp "gain" with a ±6 hp interval is not a gain, and scoring it as a
    // fraction of one would be reporting noise as progress.
    expect(gainScore(gain(8, false))).toBe(0);
  });

  it('saturates at a large real gain', () => {
    expect(gainScore(gain(VALIDITY.gainSaturationFraction * 100, true))).toBe(1);
    expect(gainScore(gain(30, true))).toBe(1);
  });

  it('scales linearly below saturation', () => {
    expect(gainScore(gain(7.5, true))).toBeCloseTo(0.5, 6);
  });

  it('is zero for a loss rather than negative', () => {
    // The index is a product; a negative factor would produce a nonsense composite.
    expect(gainScore(gain(-10, true))).toBe(0);
  });
});

describe('consistency score', () => {
  it('rewards pulls that agree', () => {
    expect(consistencyScore(0.01)).toBe(1);
    expect(consistencyScore(VALIDITY.consistencyCvPerfect)).toBe(1);
  });

  it('falls to zero for pulls that do not', () => {
    expect(consistencyScore(VALIDITY.consistencyCvZero)).toBe(0);
    expect(consistencyScore(0.3)).toBe(0);
  });

  it('is undefined-safe', () => {
    expect(consistencyScore(NaN)).toBe(0);
  });
});

describe('safety score', () => {
  it('is one when nothing fired', () => {
    expect(safetyScore([])).toBe(1);
  });

  it('weights each penalty by the finding’s own confidence', () => {
    // A finding at 0.45 confidence removes 0.45 of the penalty, not all of it.
    expect(safetyScore([finding('risk', 1)])).toBeCloseTo(1 - VALIDITY.safetyPenaltyRisk, 6);
    expect(safetyScore([finding('risk', 0.5)])).toBeCloseTo(1 - VALIDITY.safetyPenaltyRisk / 2, 6);
  });

  it('ignores findings in the before session', () => {
    // The question is whether the tune as it stands is safe, not whether the car
    // was healthy before it.
    const before: Finding = {
      ...finding('risk', 0.7),
      evidence: { ...finding('risk', 0.7).evidence, session: 'before' },
    };
    expect(safetyScore([before])).toBe(1);
  });

  it('never goes below its floor', () => {
    const many = Array.from({ length: 8 }, () => finding('risk', 0.7));
    expect(safetyScore(many)).toBe(VALIDITY.safetyFloor);
  });
});

describe('the composite index', () => {
  it('multiplies, so a large gain cannot buy off a dangerous one', () => {
    const clean = buildValidityCard(gain(20, true), 0.01, []);
    const knocking = buildValidityCard(gain(20, true), 0.01, [finding('risk', 0.7)]);

    expect(clean.index).toBe(1);
    expect(clean.verdict).toBe('good');
    // A sum would have averaged this out to "quite good".
    expect(knocking.index).toBeLessThan(0.7);
  });

  it('calls an unproven difference inconclusive rather than bad', () => {
    const card = buildValidityCard(gain(1, false), 0.01, []);
    expect(card.gain).toBe(0);
    expect(card.verdict).toBe('inconclusive');
  });

  it('never calls a tune that knocks good, however much it gained', () => {
    // A risk finding is categorical, not a number to be outweighed. Without this
    // rule a single confident knock leaves the index at 0.68 and the headline
    // reads "gain proven, no safety findings".
    const card = buildValidityCard(gain(30, true), 0.01, [finding('risk', 0.72)]);
    expect(card.index).toBeGreaterThan(VALIDITY.verdictGoodMin);
    expect(card.verdict).toBe('mixed');
  });

  it('calls an unproven gain with a real risk bad, not inconclusive', () => {
    // Nothing was won and something was lost; "no proven difference" would be a
    // fair description of the gain and a dangerous description of the tune.
    const card = buildValidityCard(gain(1, false), 0.01, [finding('risk', 0.72)]);
    expect(card.verdict).toBe('bad');
  });

  it('calls a tune with several serious findings bad', () => {
    const card = buildValidityCard(gain(20, true), 0.01, [
      finding('risk', 0.72),
      finding('risk', 0.72),
      finding('caution', 0.72),
    ]);
    expect(card.verdict).toBe('bad');
  });
});
