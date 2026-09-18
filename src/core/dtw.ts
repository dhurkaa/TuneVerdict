/**
 * Stage 5a: segment pairing via Dynamic Time Warping.
 *
 * Two pulls of the same car never take the same amount of time to cover the same
 * rpm — traffic, a slightly different starting speed, a different road surface. A
 * point-by-point comparison on the time axis therefore compares 3200 rpm against
 * 3600 rpm and calls the difference a tuning gain.
 *
 * DTW aligns the two traces by shape rather than by index. It is constrained by a
 * Sakoe–Chiba band: two pulls of the same car in the same gear never need more
 * warping than DTW_BAND_FRACTION, and an unconstrained warp would happily align a
 * 3rd-gear pull to a 4th-gear one, which is exactly the mistake gear
 * classification exists to prevent.
 */

import { DTW_BAND_FRACTION, DTW_RESAMPLE_POINTS } from './constants';
import { mean, sd } from './stats';

export interface DtwResult {
  /** Mean cost along the warping path — comparable across different pull lengths. */
  readonly distance: number;
  /** Aligned index pairs, (indexA, indexB). */
  readonly path: readonly (readonly [number, number])[];
}

/** Resample to a fixed length so that two pulls of different length can be compared. */
export function resampleToLength(values: readonly number[], length: number): Float64Array {
  const out = new Float64Array(length).fill(NaN);
  const clean = values.filter(Number.isFinite);
  if (clean.length === 0) return out;
  if (clean.length === 1) return out.fill(clean[0] as number);

  for (let i = 0; i < length; i++) {
    const pos = (i * (clean.length - 1)) / (length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(clean.length - 1, lo + 1);
    const w = pos - lo;
    out[i] = (clean[lo] as number) * (1 - w) + (clean[hi] as number) * w;
  }
  return out;
}

/**
 * Z-normalise before matching. Without it DTW pairs pulls by how much power they
 * made rather than by shape, which defeats the purpose: the whole point is to
 * align two pulls so that the difference in magnitude can then be measured.
 */
export function zNormalise(values: Float64Array): Float64Array {
  const m = mean(values);
  const s = sd(values);
  const out = new Float64Array(values.length);
  if (!Number.isFinite(m) || s === 0 || !Number.isFinite(s)) return out.fill(0);
  for (let i = 0; i < values.length; i++) out[i] = ((values[i] as number) - m) / s;
  return out;
}

/** Banded DTW with a squared-difference local cost. */
export function dtw(a: Float64Array, b: Float64Array, bandFraction = DTW_BAND_FRACTION): DtwResult {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return { distance: Infinity, path: [] };

  const band = Math.max(1, Math.round(bandFraction * Math.min(n, m)));
  const cost = new Float64Array((n + 1) * (m + 1)).fill(Infinity);
  const width = m + 1;
  cost[0] = 0;

  for (let i = 1; i <= n; i++) {
    // Only the cells inside the band are visited; outside, the cost stays Infinity
    // and the path cannot pass through.
    const centre = Math.round((i * m) / n);
    const lo = Math.max(1, centre - band);
    const hi = Math.min(m, centre + band);
    for (let j = lo; j <= hi; j++) {
      const d = (a[i - 1] as number) - (b[j - 1] as number);
      const local = Number.isFinite(d) ? d * d : 0;
      const best = Math.min(
        cost[(i - 1) * width + j] as number,
        cost[i * width + (j - 1)] as number,
        cost[(i - 1) * width + (j - 1)] as number,
      );
      cost[i * width + j] = local + best;
    }
  }

  const total = cost[n * width + m] as number;
  if (!Number.isFinite(total)) return { distance: Infinity, path: [] };

  // Backtrack.
  const path: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const diag = cost[(i - 1) * width + (j - 1)] as number;
    const up = cost[(i - 1) * width + j] as number;
    const left = cost[i * width + (j - 1)] as number;
    if (diag <= up && diag <= left) {
      i--;
      j--;
    } else if (up <= left) {
      i--;
    } else {
      j--;
    }
  }
  path.reverse();

  return { distance: total / path.length, path };
}

export interface Pairing {
  readonly beforeIndex: number;
  readonly afterIndex: number;
  readonly distance: number;
}

/**
 * Pair every "before" pull with an "after" pull by DTW distance.
 *
 * Matching is greedy over the sorted distance list, which is optimal enough for
 * the five-against-five case the protocol asks for and has the property that
 * matters here: a pull is never paired twice, so an unusually good "after" pull
 * cannot be used to flatter three different "before" pulls.
 *
 * Unpaired pulls are not an error. The comparison uses all accepted pulls of both
 * sessions for the aggregate; the pairing exists so that findings can be reported
 * against a specific counterpart ("pull 3 knocked where its counterpart did not").
 */
export function pairPulls(
  before: readonly (readonly number[])[],
  after: readonly (readonly number[])[],
): Pairing[] {
  const normalisedBefore = before.map((p) => zNormalise(resampleToLength(p, DTW_RESAMPLE_POINTS)));
  const normalisedAfter = after.map((p) => zNormalise(resampleToLength(p, DTW_RESAMPLE_POINTS)));

  const candidates: Pairing[] = [];
  for (let i = 0; i < normalisedBefore.length; i++) {
    for (let j = 0; j < normalisedAfter.length; j++) {
      const { distance } = dtw(
        normalisedBefore[i] as Float64Array,
        normalisedAfter[j] as Float64Array,
      );
      candidates.push({ beforeIndex: i, afterIndex: j, distance });
    }
  }
  candidates.sort((x, y) => x.distance - y.distance);

  const usedBefore = new Set<number>();
  const usedAfter = new Set<number>();
  const pairs: Pairing[] = [];
  for (const candidate of candidates) {
    if (usedBefore.has(candidate.beforeIndex) || usedAfter.has(candidate.afterIndex)) continue;
    if (!Number.isFinite(candidate.distance)) continue;
    usedBefore.add(candidate.beforeIndex);
    usedAfter.add(candidate.afterIndex);
    pairs.push(candidate);
  }
  return pairs.sort((x, y) => x.beforeIndex - y.beforeIndex);
}
