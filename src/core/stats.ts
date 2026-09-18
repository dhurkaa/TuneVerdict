/**
 * Statistics, with a deterministic random source.
 *
 * Reproducibility is a requirement, not a nicety: the same two logs must produce
 * the same verdict tomorrow, or the calibration means nothing. So the bootstrap and
 * the Monte Carlo do not touch Math.random — they take a seeded generator, and the
 * seed is derived from the input files themselves and reported with the result.
 */

import { BOOTSTRAP_RESAMPLES, CONFIDENCE_LEVEL, MAD_TO_SD } from './constants';
import type { Estimate } from './types';

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Standard normal. */
  normal(): number;
  /** Integer in [0, n). */
  int(n: number): number;
}

/**
 * mulberry32 — small, fast, and good enough for resampling and error propagation.
 * Not a cryptographic generator, and does not need to be.
 */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  let spare: number | null = null;

  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    // Box–Muller, keeping the second deviate rather than throwing it away.
    normal(): number {
      if (spare !== null) {
        const value = spare;
        spare = null;
        return value;
      }
      let u = 0;
      let v = 0;
      let s = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s === 0 || s >= 1);
      const scale = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * scale;
      return u * scale;
    },
  };
}

/** FNV-1a over the input text, so the seed is a property of the data. */
export function seedFrom(...parts: (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Descriptive statistics (NaN-tolerant: a gap is not a zero)
// ---------------------------------------------------------------------------

export function finite(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function mean(values: ArrayLike<number>): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n === 0 ? NaN : sum / n;
}

/** Sample standard deviation (n − 1). */
export function sd(values: ArrayLike<number>): number {
  const m = mean(values);
  if (!Number.isFinite(m)) return NaN;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (Number.isFinite(v)) {
      sum += (v - m) * (v - m);
      n++;
    }
  }
  return n < 2 ? 0 : Math.sqrt(sum / (n - 1));
}

export function median(values: ArrayLike<number>): number {
  return quantile(values, 0.5);
}

/** Linear-interpolated quantile over the finite values. */
export function quantile(values: ArrayLike<number>, p: number): number {
  const sorted = finite(values).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0] as number;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const w = pos - lo;
  return (sorted[lo] as number) * (1 - w) + (sorted[hi] as number) * w;
}

/** Median absolute deviation, scaled to be comparable with a standard deviation. */
export function mad(values: ArrayLike<number>): number {
  const med = median(values);
  if (!Number.isFinite(med)) return NaN;
  const deviations = finite(values).map((v) => Math.abs(v - med));
  return MAD_TO_SD * median(deviations);
}

/** Coefficient of variation, |sd / mean|. Undefined at a mean of zero. */
export function coefficientOfVariation(values: ArrayLike<number>): number {
  const m = mean(values);
  if (!Number.isFinite(m) || m === 0) return NaN;
  return Math.abs(sd(values) / m);
}

// ---------------------------------------------------------------------------
// Intervals
// ---------------------------------------------------------------------------

const TAIL = (1 - CONFIDENCE_LEVEL) / 2;

/** Build an Estimate from a set of Monte Carlo or bootstrap draws. */
export function estimateFromDraws(draws: ArrayLike<number>, centre?: number): Estimate {
  const values = finite(draws);
  if (values.length === 0) return { value: NaN, sd: NaN, lo: NaN, hi: NaN };
  const value = centre ?? mean(values);
  return {
    value,
    sd: sd(values),
    lo: quantile(values, TAIL),
    hi: quantile(values, 1 - TAIL),
  };
}

/** A known value with a known standard deviation, assumed normal. */
export function estimateFromSd(value: number, standardDeviation: number): Estimate {
  // 1.959963985 is the two-sided 95% normal quantile; CONFIDENCE_LEVEL drives it.
  const z = normalQuantile(1 - TAIL);
  return {
    value,
    sd: standardDeviation,
    lo: value - z * standardDeviation,
    hi: value + z * standardDeviation,
  };
}

/**
 * Bootstrap the mean of a small sample — the case throughout this application,
 * where "small" is five pulls. The percentile interval is used rather than the
 * normal approximation because five pulls do not justify a normal assumption.
 */
export function bootstrapMean(
  values: readonly number[],
  rng: Rng,
  resamples = BOOTSTRAP_RESAMPLES,
): Estimate {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return { value: NaN, sd: NaN, lo: NaN, hi: NaN };
  if (clean.length === 1) {
    const only = clean[0] as number;
    return { value: only, sd: NaN, lo: NaN, hi: NaN };
  }
  const draws = new Float64Array(resamples);
  for (let b = 0; b < resamples; b++) {
    let sum = 0;
    for (let i = 0; i < clean.length; i++) {
      sum += clean[rng.int(clean.length)] as number;
    }
    draws[b] = sum / clean.length;
  }
  return estimateFromDraws(draws, mean(clean));
}

/**
 * Bootstrap the difference of two independent samples, resampling within each
 * group. This is the gain estimate: the mean of the "after" pulls minus the mean
 * of the "before" pulls.
 */
export function bootstrapDifference(
  before: readonly number[],
  after: readonly number[],
  rng: Rng,
  resamples = BOOTSTRAP_RESAMPLES,
): Estimate {
  const a = before.filter(Number.isFinite);
  const b = after.filter(Number.isFinite);
  if (a.length === 0 || b.length === 0) return { value: NaN, sd: NaN, lo: NaN, hi: NaN };
  const draws = new Float64Array(resamples);
  for (let k = 0; k < resamples; k++) {
    let sumA = 0;
    for (let i = 0; i < a.length; i++) sumA += a[rng.int(a.length)] as number;
    let sumB = 0;
    for (let i = 0; i < b.length; i++) sumB += b[rng.int(b.length)] as number;
    draws[k] = sumB / b.length - sumA / a.length;
  }
  return estimateFromDraws(draws, mean(b) - mean(a));
}

/**
 * Two-sided permutation test on the difference of means.
 *
 * Used instead of a t-test because five pulls per session do not support a
 * normality assumption, and because the placebo validation — two sessions of the
 * same tune — is exactly a permutation argument: if the label carries no
 * information, relabelling should not change the difference. On the calibration
 * set, 10% of placebo pairs came out significant at α = 0.05, which is the
 * expected behaviour of the test at this sample size.
 */
export function permutationPValue(
  before: readonly number[],
  after: readonly number[],
  rng: Rng,
  resamples = BOOTSTRAP_RESAMPLES,
): number {
  const a = before.filter(Number.isFinite);
  const b = after.filter(Number.isFinite);
  if (a.length < 2 || b.length < 2) return NaN;
  const pooled = [...a, ...b];
  const observed = Math.abs(mean(b) - mean(a));
  let atLeastAsExtreme = 0;

  for (let k = 0; k < resamples; k++) {
    // Partial Fisher–Yates: shuffle only as far as we need to split the pool.
    const shuffled = pooled.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const tmp = shuffled[i] as number;
      shuffled[i] = shuffled[j] as number;
      shuffled[j] = tmp;
    }
    const permA = shuffled.slice(0, a.length);
    const permB = shuffled.slice(a.length);
    if (Math.abs(mean(permB) - mean(permA)) >= observed) atLeastAsExtreme++;
  }
  // +1 in both places: the observed labelling is itself one of the permutations,
  // which keeps the p-value from ever being exactly zero.
  return (atLeastAsExtreme + 1) / (resamples + 1);
}

// ---------------------------------------------------------------------------
// Normal distribution helpers
// ---------------------------------------------------------------------------

/** Inverse standard normal CDF (Acklam's rational approximation, |ε| < 1.15e-9). */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/**
 * Wilson score lower bound for k successes in n trials.
 *
 * This is where CONFIDENCE.cap comes from: 10 correct out of 10 gives 0.7225 here,
 * and that — not 1.00 — is what the evidence supports.
 */
export function wilsonLowerBound(successes: number, trials: number, level = CONFIDENCE_LEVEL): number {
  if (trials === 0) return 0;
  const z = normalQuantile(1 - (1 - level) / 2);
  const phat = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = phat + (z * z) / (2 * trials);
  const spread = z * Math.sqrt((phat * (1 - phat)) / trials + (z * z) / (4 * trials * trials));
  return (centre - spread) / denominator;
}

/** Clamp into [lo, hi]. Used wherever a score must stay a score. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Linear interpolation, guarding against a degenerate span. */
export function lerp(a: number, b: number, w: number): number {
  return a + (b - a) * w;
}
