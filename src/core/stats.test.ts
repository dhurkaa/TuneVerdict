import { describe, expect, it } from 'vitest';
import { CONFIDENCE } from './constants';
import {
  bootstrapDifference,
  bootstrapMean,
  coefficientOfVariation,
  mad,
  makeRng,
  mean,
  median,
  normalQuantile,
  permutationPValue,
  quantile,
  sd,
  seedFrom,
  wilsonLowerBound,
} from './stats';

describe('deterministic randomness', () => {
  it('produces the same sequence for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
  });

  it('produces different sequences for different seeds', () => {
    expect(makeRng(1).next()).not.toBe(makeRng(2).next());
  });

  it('derives a stable seed from the data', () => {
    expect(seedFrom('before.csv', 'after.csv', 1200)).toBe(seedFrom('before.csv', 'after.csv', 1200));
    expect(seedFrom('a', 1)).not.toBe(seedFrom('a', 2));
  });

  it('draws an approximately standard normal', () => {
    const rng = makeRng(7);
    const draws = Array.from({ length: 20000 }, () => rng.normal());
    expect(mean(draws)).toBeCloseTo(0, 1);
    expect(sd(draws)).toBeCloseTo(1, 1);
  });
});

describe('descriptive statistics', () => {
  it('ignores NaN rather than treating a gap as a zero', () => {
    expect(mean([1, NaN, 3])).toBe(2);
    expect(median([1, NaN, 3, 5])).toBe(3);
    expect(sd([2, NaN, 4])).toBeCloseTo(Math.SQRT2, 6);
  });

  it('interpolates quantiles', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
  });

  it('scales the MAD to be comparable with a standard deviation', () => {
    const values = [10, 10.5, 11, 11.5, 12];
    expect(mad(values)).toBeCloseTo(1.4826 * 0.5, 6);
  });

  it('computes a coefficient of variation', () => {
    expect(coefficientOfVariation([100, 100, 100])).toBe(0);
    expect(coefficientOfVariation([90, 100, 110])).toBeCloseTo(0.1, 6);
  });
});

describe('intervals and tests', () => {
  it('brackets the true mean with a bootstrap interval', () => {
    const rng = makeRng(3);
    const sample = [248, 251, 250, 249, 252];
    const estimate = bootstrapMean(sample, rng, 2000);
    expect(estimate.value).toBeCloseTo(250, 6);
    expect(estimate.lo).toBeLessThan(250);
    expect(estimate.hi).toBeGreaterThan(250);
  });

  it('estimates a difference of means', () => {
    const rng = makeRng(11);
    const estimate = bootstrapDifference([200, 202, 198], [240, 241, 239], rng, 2000);
    expect(estimate.value).toBeCloseTo(40, 6);
    expect(estimate.lo).toBeGreaterThan(0);
  });

  it('finds a real difference significant', () => {
    const rng = makeRng(5);
    const p = permutationPValue([200, 201, 199, 200, 202], [240, 241, 239, 240, 242], rng, 2000);
    expect(p).toBeLessThan(0.05);
  });

  it('does not find a placebo difference significant', () => {
    // Two sessions of the same tune. The test must not reward relabelling.
    const rng = makeRng(9);
    const p = permutationPValue([250, 248, 252, 249, 251], [249, 253, 247, 250, 250], rng, 2000);
    expect(p).toBeGreaterThan(0.05);
  });

  it('never returns a p-value of exactly zero', () => {
    const rng = makeRng(13);
    const p = permutationPValue([1, 1, 1, 1], [100, 100, 100, 100], rng, 500);
    expect(p).toBeGreaterThan(0);
  });
});

describe('normal quantile and Wilson bound', () => {
  it('matches known normal quantiles', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959964, 5);
  });

  it('reproduces the confidence ceiling from 10 correct out of 10', () => {
    // This is where CONFIDENCE.cap comes from. If this test fails, the constant and
    // its justification have drifted apart.
    expect(wilsonLowerBound(10, 10)).toBeCloseTo(CONFIDENCE.cap, 3);
  });

  it('is more cautious with less evidence', () => {
    expect(wilsonLowerBound(3, 3)).toBeLessThan(wilsonLowerBound(10, 10));
    expect(wilsonLowerBound(100, 100)).toBeGreaterThan(wilsonLowerBound(10, 10));
  });
});
