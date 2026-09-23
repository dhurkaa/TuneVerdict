/**
 * Chart helpers and the difference chart, drawn as inline SVG.
 *
 * No chart library. The rules are fixed and few, so a library would mostly be
 * something to fight:
 *   - "before" is always a dashed grey line, "after" a solid line in the signal
 *     colour. The pairing never swaps, in either theme.
 *   - the confidence interval is a band, never a pair of lines.
 *   - no chart without its uncertainty.
 *   - the curve is drawn only where pulls from both sessions actually reached.
 *
 * The curve itself is the information, so each chart carries `role="img"` and a
 * description that states what a reader who cannot see it would otherwise miss.
 */

import { useI18n } from '../i18n';
import { usePowerUnit } from '../display/powerUnit';
import type { PowerCurvePoint } from '../core/types';

export const WIDTH = 920;
export const MARGIN = { top: 16, right: 20, bottom: 44, left: 62 } as const;

export const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;

export interface Scale {
  (value: number): number;
}

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** Nice round tick values covering a domain. */
export function ticks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return [min];
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const start = Math.ceil(min / step - 1e-9) * step;
  const out: number[] = [];
  // Ticks stay inside the domain: a label past the last data point would sit
  // outside the plot and suggest a range the chart does not cover.
  for (let value = start; value <= max + step * 1e-6; value += step) out.push(Number(value.toFixed(6)));
  return out;
}

/**
 * Split a series at gaps so a missing stretch is a hole in the line, not a
 * straight segment bridging it. Drawing through a gap would assert a measurement
 * that was never made.
 */
export function segments<T>(points: T[], isValid: (point: T) => boolean): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  for (const point of points) {
    if (isValid(point)) current.push(point);
    else if (current.length > 0) {
      out.push(current);
      current = [];
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

export function linePath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

export function bandPath(points: { x: number; lo: number; hi: number }[]): string {
  if (points.length === 0) return '';
  const top = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.hi.toFixed(2)}`);
  const bottom = [...points]
    .reverse()
    .map((p) => `L${p.x.toFixed(2)},${p.lo.toFixed(2)}`);
  return `${top.join(' ')} ${bottom.join(' ')} Z`;
}

export function DeltaChart({ curve }: { curve: readonly PowerCurvePoint[] }): JSX.Element | null {
  const { t } = useI18n();
  const { unit, powerEstimate } = usePowerUnit();
  const points = curve
    .filter((p) => Number.isFinite(p.delta.value))
    .map((p) => ({ ...p, delta: powerEstimate(p.delta) }));
  if (points.length < 2) return null;

  const rpmMin = points[0]?.rpm ?? 0;
  const rpmMax = points[points.length - 1]?.rpm ?? 0;

  let lo = 0;
  let hi = 0;
  for (const point of points) {
    if (Number.isFinite(point.delta.lo)) lo = Math.min(lo, point.delta.lo);
    if (Number.isFinite(point.delta.hi)) hi = Math.max(hi, point.delta.hi);
  }
  const pad = Math.max(2, (hi - lo) * 0.08);
  const yLo = Math.floor((lo - pad) / 5) * 5;
  const yHi = Math.ceil((hi + pad) / 5) * 5;

  const height = 240;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const x = linearScale([rpmMin, rpmMax], [MARGIN.left, MARGIN.left + PLOT_WIDTH]);
  const y = linearScale([yLo, yHi], [MARGIN.top + plotHeight, MARGIN.top]);

  const bands = segments(points, (p) => Number.isFinite(p.delta.lo) && Number.isFinite(p.delta.hi));

  return (
    <figure style={{ margin: 0 }} className="stack">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        width="100%"
        role="img"
        aria-label={t('result.chart.deltaDescription')}
        style={{ display: 'block' }}
      >
        <text x={MARGIN.left - 10} y={MARGIN.top - 4} textAnchor="end" fontSize={11} fill="var(--muted)">
          {unit}
        </text>
        {ticks(yLo, yHi, 4).map((value) => (
          <g key={value}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + PLOT_WIDTH}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={MARGIN.left - 10}
              y={y(value) + 4}
              textAnchor="end"
              className="mono"
              fontSize={11}
              fill="var(--muted)"
            >
              {value}
            </text>
          </g>
        ))}

        {/* Zero is the line that matters: where the band crosses it, no gain is
            proven at that engine speed. */}
        <line
          x1={MARGIN.left}
          x2={MARGIN.left + PLOT_WIDTH}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--muted)"
          strokeWidth={1.5}
          strokeDasharray="2 3"
        />

        {bands.map((segment, i) => (
          <path
            key={`db${i}`}
            d={bandPath(segment.map((p) => ({ x: x(p.rpm), lo: y(p.delta.lo), hi: y(p.delta.hi) })))}
            fill="var(--signal-tint)"
          />
        ))}
        {segments(points, (p) => Number.isFinite(p.delta.value)).map((segment, i) => (
          <path
            key={`dl${i}`}
            d={linePath(segment.map((p) => ({ x: x(p.rpm), y: y(p.delta.value) })))}
            fill="none"
            stroke="var(--signal)"
            strokeWidth={2.5}
          />
        ))}

        {ticks(rpmMin, rpmMax, 6).map((value) => (
          <text
            key={value}
            x={x(value)}
            y={MARGIN.top + plotHeight + 22}
            textAnchor="middle"
            className="mono"
            fontSize={11}
            fill="var(--muted)"
          >
            {value}
          </text>
        ))}
        <text
          x={MARGIN.left + PLOT_WIDTH}
          y={MARGIN.top + plotHeight + 38}
          textAnchor="end"
          fontSize={11}
          fill="var(--muted)"
        >
          {t('result.chart.rpm')}
        </text>
      </svg>
      <figcaption className="field-hint">{t('result.chart.zero')} · {t('result.chart.band')}</figcaption>
    </figure>
  );
}

export function LegendItem({
  colour,
  label,
  dashed = false,
}: {
  colour: string;
  label: string;
  dashed?: boolean;
}): JSX.Element {
  return (
    <span className="row" style={{ gap: 8 }}>
      <svg width={24} height={10} aria-hidden="true">
        <line
          x1={0}
          x2={24}
          y1={5}
          y2={5}
          stroke={colour}
          strokeWidth={2.5}
          strokeDasharray={dashed ? '6 4' : undefined}
        />
      </svg>
      <span className="field-hint">{label}</span>
    </span>
  );
}
