/**
 * Signal processing: resampling onto a uniform grid, local polynomial smoothing,
 * differentiation and detrending.
 *
 * Every function here is NaN-aware. A gap in an OBD-2 log is not a zero — treating
 * it as one puts a spike into the acceleration trace and a phantom 40 hp into the
 * result — so gaps propagate as NaN and are counted, never filled silently.
 */

import { MAX_INTERPOLATION_GAP_S, TARGET_SAMPLE_RATE_HZ } from './constants';

/** A uniform time grid covering [t0, t1] at the target rate. */
export function uniformGrid(t0: number, t1: number, rateHz = TARGET_SAMPLE_RATE_HZ): Float64Array {
  const dt = 1 / rateHz;
  const n = Math.max(1, Math.floor((t1 - t0) / dt) + 1);
  const grid = new Float64Array(n);
  for (let i = 0; i < n; i++) grid[i] = t0 + i * dt;
  return grid;
}

/**
 * Linear resampling of (t, v) onto `grid`.
 *
 * Source samples must be sorted by t. A grid point that falls inside a source gap
 * longer than maxGapS becomes NaN rather than an interpolated invention: at 10 Hz,
 * bridging a 2-second dropout would fabricate twenty samples of a transient that
 * the detectors are specifically looking for.
 */
export function resampleLinear(
  t: readonly number[],
  v: readonly number[],
  grid: Float64Array,
  maxGapS = MAX_INTERPOLATION_GAP_S,
): Float64Array {
  const out = new Float64Array(grid.length).fill(NaN);
  if (t.length === 0) return out;

  let j = 0;
  for (let i = 0; i < grid.length; i++) {
    const target = grid[i] as number;
    while (j < t.length - 1 && (t[j + 1] as number) < target) j++;

    const t0 = t[j] as number;
    const v0 = v[j] as number;

    if (j === t.length - 1) {
      out[i] = Math.abs(target - t0) <= maxGapS ? v0 : NaN;
      continue;
    }
    const t1 = t[j + 1] as number;
    const v1 = v[j + 1] as number;

    if (target < t0) {
      out[i] = t0 - target <= maxGapS ? v0 : NaN;
      continue;
    }
    if (t1 - t0 > maxGapS) {
      // Inside a real gap: keep the endpoint only if the grid point is close to it.
      if (target - t0 <= maxGapS) out[i] = v0;
      else if (t1 - target <= maxGapS) out[i] = v1;
      else out[i] = NaN;
      continue;
    }
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) {
      out[i] = NaN;
      continue;
    }
    const w = t1 === t0 ? 0 : (target - t0) / (t1 - t0);
    out[i] = v0 + (v1 - v0) * w;
  }
  return out;
}

/**
 * Median sample interval of a timestamp series, as a rate. Median rather than mean
 * because a single long pause between two recordings would halve a mean rate and
 * cause a perfectly good 10 Hz log to be rejected.
 */
export function estimateSampleRate(t: readonly number[]): number {
  if (t.length < 2) return NaN;
  const deltas: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const d = (t[i] as number) - (t[i - 1] as number);
    if (d > 0 && Number.isFinite(d)) deltas.push(d);
  }
  if (deltas.length === 0) return NaN;
  deltas.sort((a, b) => a - b);
  const mid = deltas[Math.floor(deltas.length / 2)] as number;
  return mid > 0 ? 1 / mid : NaN;
}

/**
 * Savitzky–Golay style local quadratic fit, returning both the smoothed value and
 * its first derivative at every sample.
 *
 * A quadratic fit is used rather than a moving average because the derivative is
 * what matters: acceleration comes from the speed trace, and a moving average
 * followed by a difference both lags the signal and amplifies its quantisation.
 * OBD-2 speed arrives quantised to 1 km/h, so this is not a theoretical concern.
 */
export function localQuadratic(
  values: Float64Array,
  dt: number,
  halfWindow: number,
): { value: Float64Array; slope: Float64Array } {
  const n = values.length;
  const value = new Float64Array(n).fill(NaN);
  const slope = new Float64Array(n).fill(NaN);

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(n - 1, i + halfWindow);

    // Normal equations for y = c0 + c1·x + c2·x², x in samples relative to i.
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
    let b0 = 0, b1 = 0, b2 = 0;
    let count = 0;

    for (let k = lo; k <= hi; k++) {
      const y = values[k] as number;
      if (!Number.isFinite(y)) continue;
      const x = k - i;
      const x2 = x * x;
      s0 += 1;
      s1 += x;
      s2 += x2;
      s3 += x2 * x;
      s4 += x2 * x2;
      b0 += y;
      b1 += x * y;
      b2 += x2 * y;
      count++;
    }

    if (count < 3) {
      // Too few points for a quadratic: fall back to a straight line, then to the
      // point itself. Better a coarse answer than a NaN in the middle of a pull.
      if (count === 2) {
        const det2 = s0 * s2 - s1 * s1;
        if (det2 !== 0) {
          value[i] = (b0 * s2 - b1 * s1) / det2;
          slope[i] = ((b1 * s0 - b0 * s1) / det2) / dt;
        }
      } else if (count === 1) {
        value[i] = b0;
      }
      continue;
    }

    // Solve the symmetric 3×3 system by Cramer's rule.
    const m = [
      [s0, s1, s2],
      [s1, s2, s3],
      [s2, s3, s4],
    ] as const;
    const det =
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

    if (Math.abs(det) < 1e-12) continue;

    const c0 =
      (b0 * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (b1 * m[2][2] - m[1][2] * b2) +
        m[0][2] * (b1 * m[2][1] - m[1][1] * b2)) / det;
    const c1 =
      (m[0][0] * (b1 * m[2][2] - m[1][2] * b2) -
        b0 * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * b2 - b1 * m[2][0])) / det;

    value[i] = c0;
    slope[i] = c1 / dt; // per sample → per second
  }

  return { value, slope };
}

/** NaN-aware moving average over an odd window, for channels that need no slope. */
export function movingAverage(values: Float64Array, halfWindow: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - halfWindow); k <= Math.min(n - 1, i + halfWindow); k++) {
      const v = values[k] as number;
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    if (count > 0) out[i] = sum / count;
  }
  return out;
}

/**
 * Remove the best-fit straight line from a slice.
 *
 * This is what separates a boost *oscillation* from a boost *ramp*: pressure rising
 * with rpm through a pull is normal and must not be read as ripple, so the trend
 * goes and only what hunts around it remains.
 */
export function detrendLinear(values: readonly number[]): number[] {
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = 0; i < values.length; i++) {
    const y = values[i] as number;
    if (!Number.isFinite(y)) continue;
    sx += i;
    sy += y;
    sxx += i * i;
    sxy += i * y;
    n++;
  }
  if (n < 2) return values.map((v) => (Number.isFinite(v) ? 0 : NaN));
  const det = n * sxx - sx * sx;
  if (det === 0) return values.map((v) => (Number.isFinite(v) ? 0 : NaN));
  const slope = (n * sxy - sx * sy) / det;
  const intercept = (sy - slope * sx) / n;
  return values.map((v, i) => (Number.isFinite(v) ? v - (intercept + slope * i) : NaN));
}

/** Root mean square of the finite values. */
export function rms(values: readonly number[]): number {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (Number.isFinite(v)) {
      sum += v * v;
      n++;
    }
  }
  return n === 0 ? NaN : Math.sqrt(sum / n);
}

/**
 * Resample a (x, y) curve onto a monotonically increasing x grid — used to put a
 * pull onto a common rpm axis before comparison, so that two pulls that took
 * different amounts of time to reach 4000 rpm are still compared at 4000 rpm.
 *
 * Where x is not monotonic (rpm dips mid-pull), the later sample wins.
 */
export function resampleOnAxis(
  x: readonly number[],
  y: readonly number[],
  grid: readonly number[],
): Float64Array {
  const pairs: [number, number][] = [];
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] as number;
    const yi = y[i] as number;
    if (Number.isFinite(xi) && Number.isFinite(yi)) pairs.push([xi, yi]);
  }
  pairs.sort((a, b) => a[0] - b[0]);

  const out = new Float64Array(grid.length).fill(NaN);
  if (pairs.length === 0) return out;

  let j = 0;
  for (let i = 0; i < grid.length; i++) {
    const target = grid[i] as number;
    while (j < pairs.length - 1 && (pairs[j + 1] as [number, number])[0] < target) j++;

    const [x0, y0] = pairs[j] as [number, number];
    if (j === pairs.length - 1) {
      out[i] = target === x0 ? y0 : NaN;
      continue;
    }
    const [x1, y1] = pairs[j + 1] as [number, number];
    if (target < x0 || target > x1) {
      out[i] = NaN;
      continue;
    }
    const w = x1 === x0 ? 0 : (target - x0) / (x1 - x0);
    out[i] = y0 + (y1 - y0) * w;
  }
  return out;
}

/** Mean of a slice of a Float64Array, ignoring NaN. */
export function sliceMean(values: Float64Array, from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, from); i <= Math.min(values.length - 1, to); i++) {
    const v = values[i] as number;
    if (Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n === 0 ? NaN : sum / n;
}
