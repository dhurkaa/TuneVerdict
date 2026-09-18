/**
 * The power curves, drawn as inline SVG.
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
import type { PowerCurvePoint } from '../core/types';

const WIDTH = 920;
const HEIGHT = 380;
const MARGIN = { top: 16, right: 20, bottom: 44, left: 62 } as const;

const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

interface Scale {
  (value: number): number;
}

function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** Nice round tick values covering a domain. */
function ticks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return [min];
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let value = start; value <= max + step / 2; value += step) out.push(Number(value.toFixed(6)));
  return out;
}

/**
 * Split a series at gaps so a missing stretch is a hole in the line, not a
 * straight segment bridging it. Drawing through a gap would assert a measurement
 * that was never made.
 */
function segments<T>(points: T[], isValid: (point: T) => boolean): T[][] {
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

function linePath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

function bandPath(points: { x: number; lo: number; hi: number }[]): string {
  if (points.length === 0) return '';
  const top = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.hi.toFixed(2)}`);
  const bottom = [...points]
    .reverse()
    .map((p) => `L${p.x.toFixed(2)},${p.lo.toFixed(2)}`);
  return `${top.join(' ')} ${bottom.join(' ')} Z`;
}

export function PowerChart({ curve }: { curve: readonly PowerCurvePoint[] }): JSX.Element | null {
  const { t, n } = useI18n();

  // Only where both sessions produced a value. The coverage rule lives in the
  // pipeline; the chart simply refuses to draw where it returned nothing.
  const points = curve.filter(
    (p) => Number.isFinite(p.before.value) && Number.isFinite(p.after.value),
  );
  if (points.length < 2) return null;

  const rpmMin = points[0]?.rpm ?? 0;
  const rpmMax = points[points.length - 1]?.rpm ?? 0;

  let yMax = 0;
  for (const point of points) {
    for (const value of [point.before.hi, point.after.hi, point.before.value, point.after.value]) {
      if (Number.isFinite(value)) yMax = Math.max(yMax, value);
    }
  }
  yMax = Math.ceil((yMax * 1.06) / 25) * 25;

  const x = linearScale([rpmMin, rpmMax], [MARGIN.left, MARGIN.left + PLOT_WIDTH]);
  const y = linearScale([0, yMax], [MARGIN.top + PLOT_HEIGHT, MARGIN.top]);

  const peakBefore = Math.max(...points.map((p) => (Number.isFinite(p.before.value) ? p.before.value : 0)));
  const peakAfter = Math.max(...points.map((p) => (Number.isFinite(p.after.value) ? p.after.value : 0)));

  const beforeSegments = segments(points, (p) => Number.isFinite(p.before.value));
  const afterSegments = segments(points, (p) => Number.isFinite(p.after.value));
  const beforeBands = segments(points, (p) => Number.isFinite(p.before.lo) && Number.isFinite(p.before.hi));
  const afterBands = segments(points, (p) => Number.isFinite(p.after.lo) && Number.isFinite(p.after.hi));

  return (
    <figure style={{ margin: 0 }} className="stack">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={t('result.chart.description', {
          before: n(peakBefore, 1),
          after: n(peakAfter, 1),
        })}
        style={{ display: 'block' }}
      >
        <Grid x={x} y={y} yMax={yMax} rpmMin={rpmMin} rpmMax={rpmMax} unit={t('result.chart.power')} rpmUnit={t('result.chart.rpm')} />

        {beforeBands.map((segment, i) => (
          <path
            key={`bb${i}`}
            d={bandPath(segment.map((p) => ({ x: x(p.rpm), lo: y(p.before.lo), hi: y(p.before.hi) })))}
            fill="var(--reference-tint)"
          />
        ))}
        {afterBands.map((segment, i) => (
          <path
            key={`ab${i}`}
            d={bandPath(segment.map((p) => ({ x: x(p.rpm), lo: y(p.after.lo), hi: y(p.after.hi) })))}
            fill="var(--signal-tint)"
          />
        ))}

        {beforeSegments.map((segment, i) => (
          <path
            key={`bl${i}`}
            d={linePath(segment.map((p) => ({ x: x(p.rpm), y: y(p.before.value) })))}
            fill="none"
            stroke="var(--reference)"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        ))}
        {afterSegments.map((segment, i) => (
          <path
            key={`al${i}`}
            d={linePath(segment.map((p) => ({ x: x(p.rpm), y: y(p.after.value) })))}
            fill="none"
            stroke="var(--signal)"
            strokeWidth={2.5}
          />
        ))}
      </svg>
      <Legend />
      <figcaption className="field-hint">{t('result.chart.coverage')}</figcaption>
    </figure>
  );
}

export function DeltaChart({ curve }: { curve: readonly PowerCurvePoint[] }): JSX.Element | null {
  const { t } = useI18n();
  const points = curve.filter((p) => Number.isFinite(p.delta.value));
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

function Grid({
  x,
  y,
  yMax,
  rpmMin,
  rpmMax,
  unit,
  rpmUnit,
}: {
  x: Scale;
  y: Scale;
  yMax: number;
  rpmMin: number;
  rpmMax: number;
  unit: string;
  rpmUnit: string;
}): JSX.Element {
  return (
    <g>
      {ticks(0, yMax, 5).map((value) => (
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
      {ticks(rpmMin, rpmMax, 6).map((value) => (
        <text
          key={value}
          x={x(value)}
          y={MARGIN.top + PLOT_HEIGHT + 22}
          textAnchor="middle"
          className="mono"
          fontSize={11}
          fill="var(--muted)"
        >
          {value}
        </text>
      ))}
      <text x={MARGIN.left - 10} y={MARGIN.top - 4} textAnchor="end" fontSize={11} fill="var(--muted)">
        {unit}
      </text>
      <text
        x={MARGIN.left + PLOT_WIDTH}
        y={MARGIN.top + PLOT_HEIGHT + 38}
        textAnchor="end"
        fontSize={11}
        fill="var(--muted)"
      >
        {rpmUnit}
      </text>
    </g>
  );
}

function Legend(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
      <LegendItem colour="var(--reference)" dashed label={t('result.chart.before')} />
      <LegendItem colour="var(--signal)" label={t('result.chart.after')} />
      <span className="row" style={{ gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 22,
            height: 10,
            background: 'var(--signal-tint)',
            border: '1px solid var(--line)',
            borderRadius: 2,
          }}
        />
        <span className="field-hint">{t('result.chart.band')}</span>
      </span>
    </div>
  );
}

function LegendItem({
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
