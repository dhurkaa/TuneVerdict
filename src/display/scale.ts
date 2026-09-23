/**
 * Axis and curve arithmetic shared by the on-screen chart and the PDF, so the two
 * draw the same grid and the same lines.
 */

/** A round step size of roughly `span / count`: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(span: number, count: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
}

export interface ValueRange {
  readonly min: number;
  readonly max: number;
}

export interface SharedAxes {
  readonly intervals: number;
  readonly leftMin: number;
  readonly leftStep: number;
  readonly leftMax: number;
  readonly rightMin: number;
  readonly rightStep: number;
  readonly rightMax: number;
}

/** Target number of gridline intervals; the fit may use one or two more. */
const TARGET_INTERVALS = 5;
/** Headroom above and below the data, as a fraction of its span. */
const PADDING = 0.12;

/**
 * Two value axes fitted to the data rather than to zero — a dyno sheet shows the
 * curves, not 300 Nm of empty grid under them — with the same number of
 * intervals, so their ticks land on the same gridlines and the plot reads as one
 * grid. An axis whose data comes near zero keeps zero as its floor.
 */
export function sharedAxes(left: ValueRange, right: ValueRange): SharedAxes {
  const fit = (range: ValueRange) => {
    const max = Number.isFinite(range.max) ? range.max : 1;
    const min = Number.isFinite(range.min) ? Math.min(range.min, max) : 0;
    const span = Math.max(max - min, Math.abs(max) * 0.05, 1);
    const step = niceStep(span * (1 + 2 * PADDING), TARGET_INTERVALS);
    const floor = Math.max(0, Math.floor((min - span * PADDING) / step) * step);
    const count = Math.max(1, Math.ceil((max + span * PADDING - floor) / step));
    return { floor, step, count };
  };
  const l = fit(left);
  const r = fit(right);
  const intervals = Math.max(l.count, r.count);
  return {
    intervals,
    leftMin: l.floor,
    leftStep: l.step,
    leftMax: l.floor + intervals * l.step,
    rightMin: r.floor,
    rightStep: r.step,
    rightMax: r.floor + intervals * r.step,
  };
}

export interface XY {
  readonly x: number;
  readonly y: number;
}

/**
 * Tangents for a monotone cubic through the points (Fritsch–Butland). The curve
 * passes through every point and never overshoots between two of them: where
 * the data turns, the tangent is flat. A spline that can overshoot would draw a
 * peak higher than any measured value — a number the log does not contain.
 */
function monotoneTangents(points: readonly XY[]): number[] {
  const n = points.length;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = points[i] as XY;
    const b = points[i + 1] as XY;
    slopes.push((b.y - a.y) / (b.x - a.x || 1));
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = slopes[0] ?? 0;
  m[n - 1] = slopes[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) {
    const d0 = slopes[i - 1] as number;
    const d1 = slopes[i] as number;
    if (d0 * d1 <= 0) continue;
    const h0 = (points[i] as XY).x - (points[i - 1] as XY).x;
    const h1 = (points[i + 1] as XY).x - (points[i] as XY).x;
    m[i] = (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
  }
  return m;
}

/** SVG path commands for a monotone cubic through the points; `start` chooses M or L for the first point. */
export function smoothPath(points: readonly XY[], start: 'M' | 'L' = 'M'): string {
  if (points.length === 0) return '';
  const f = (v: number) => v.toFixed(2);
  const first = points[0] as XY;
  let d = `${start}${f(first.x)},${f(first.y)}`;
  if (points.length < 3) {
    for (const p of points.slice(1)) d += ` L${f(p.x)},${f(p.y)}`;
    return d;
  }
  const m = monotoneTangents(points);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as XY;
    const b = points[i + 1] as XY;
    const h = (b.x - a.x) / 3;
    d += ` C${f(a.x + h)},${f(a.y + (m[i] as number) * h)} ${f(b.x - h)},${f(b.y - (m[i + 1] as number) * h)} ${f(b.x)},${f(b.y)}`;
  }
  return d;
}

/** The same monotone cubic, sampled densely — for renderers that only draw straight segments. */
export function smoothSample(points: readonly XY[], perSegment = 8): XY[] {
  if (points.length < 3) return [...points];
  const m = monotoneTangents(points);
  const out: XY[] = [points[0] as XY];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as XY;
    const b = points[i + 1] as XY;
    const h = b.x - a.x;
    for (let k = 1; k <= perSegment; k++) {
      const s = k / perSegment;
      const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
      const h10 = s ** 3 - 2 * s ** 2 + s;
      const h01 = -2 * s ** 3 + 3 * s ** 2;
      const h11 = s ** 3 - s ** 2;
      out.push({
        x: a.x + s * h,
        y: h00 * a.y + h10 * h * (m[i] as number) + h01 * b.y + h11 * h * (m[i + 1] as number),
      });
    }
  }
  return out;
}

/** A closed area between an upper and a lower curve over the same x values. */
export function smoothArea(upper: readonly XY[], lower: readonly XY[]): string {
  if (upper.length < 2 || lower.length < 2) return '';
  return `${smoothPath(upper)} ${smoothPath([...lower].reverse(), 'L')} Z`;
}
