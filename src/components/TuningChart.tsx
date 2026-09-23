/**
 * The tuning chart: torque and power against rpm, before and after, on one plot —
 * the view a tuner already reads from a dyno sheet or a map-pack viewer.
 *
 * Torque on the left axis (N·m), power on the right (PS, hp or kW). The two axes
 * share their gridlines, so the plot reads as one grid rather than two scales
 * fighting.
 *
 * Two sources, switchable when the logs carry the ECU's own torque:
 *   - Measured: torque and power from how the car actually accelerated;
 *   - ECU-reported: the torque the engine controller calculated and logged, with
 *     power derived as torque × rpm — the "calculated torque/power" a map-pack
 *     viewer shows. It is labelled as the ECU's claim, not a measurement.
 *
 * The house chart rules, adapted for two quantities:
 *   - "before" is dashed, "after" solid. With two quantities on the plot, each
 *     keeps its own hue (torque blue, power signal-green) so the pairs stay
 *     readable; the dash is what marks a line as "before".
 *   - the "after" curves carry their 95% interval as a band, never as extra
 *     lines; banding "before" as well would bury the plot under four bands;
 *   - curves are drawn only where pulls from both sessions reached.
 *
 * Hover, or focus and use the arrow keys, to read every value at any rpm.
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { usePowerUnit } from '../display/powerUnit';
import { hpToTorqueNm } from '../core/power';
import { sharedAxes, smoothArea, smoothPath } from '../display/scale';
import { segments, ticks } from './PowerChart';
import type { EcuTorqueComparison, Estimate, GainResult, PowerCurvePoint } from '../core/types';

const WIDTH = 960;
const HEIGHT = 440;
const M = { top: 36, right: 64, bottom: 42, left: 64 } as const;
const PW = WIDTH - M.left - M.right;
const PH = HEIGHT - M.top - M.bottom;

type Source = 'measured' | 'ecu';

interface Row {
  readonly rpm: number;
  readonly torqueBefore: Estimate;
  readonly torqueAfter: Estimate;
  readonly powerBefore: Estimate;
  readonly powerAfter: Estimate;
}

interface Peak {
  readonly value: number;
  readonly rpm: number;
}

/** Everything the chart draws and summarises, from whichever source is shown. */
interface View {
  readonly rows: readonly Row[];
  readonly torqueBefore: Peak;
  readonly torqueAfter: Peak;
  readonly powerBefore: Peak;
  readonly powerAfter: Peak;
  readonly torqueDelta: Estimate;
  readonly powerDelta: Estimate;
}

const scale = (e: Estimate, f: number): Estimate => ({
  value: e.value * f,
  sd: e.sd * f,
  lo: e.lo * f,
  hi: e.hi * f,
});

function argmax(rows: readonly Row[], pick: (r: Row) => number): Peak {
  let best: Peak = { value: NaN, rpm: NaN };
  for (const r of rows) {
    const v = pick(r);
    if (Number.isFinite(v) && !(v <= best.value)) best = { value: v, rpm: r.rpm };
  }
  return best;
}

const bare = (value: number): Estimate => ({
  value,
  sd: NaN,
  lo: NaN,
  hi: NaN,
});

export function TuningChart({
  curve,
  gain,
  ecu,
}: {
  curve: readonly PowerCurvePoint[];
  gain: GainResult;
  ecu: EcuTorqueComparison | null;
}): JSX.Element | null {
  const { t, n, signed } = useI18n();
  const { unit, powerEstimate } = usePowerUnit();
  const [show, setShow] = useState({ torque: true, power: true, bands: true });
  const [source, setSource] = useState<Source>(ecu ? 'ecu' : 'measured');
  const [cursor, setCursor] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const summaryId = useId();

  const active: Source = source === 'ecu' && ecu ? 'ecu' : 'measured';

  const view: View = useMemo(() => {
    if (active === 'ecu' && ecu) {
      // Power from the ECU's torque, P = T·ω, in hp then the display unit.
      const rows = ecu.points.map((p) => {
        const hpPerNm = 1 / hpToTorqueNm(1, p.rpm);
        return {
          rpm: p.rpm,
          torqueBefore: p.before,
          torqueAfter: p.after,
          powerBefore: powerEstimate(scale(p.before, hpPerNm)),
          powerAfter: powerEstimate(scale(p.after, hpPerNm)),
        };
      });
      const powerBefore = argmax(rows, (r) => r.powerBefore.value);
      const powerAfter = argmax(rows, (r) => r.powerAfter.value);
      return {
        rows,
        torqueBefore: ecu.peakBefore,
        torqueAfter: ecu.peakAfter,
        powerBefore,
        powerAfter,
        torqueDelta: bare(ecu.torqueDelta),
        powerDelta: bare(powerAfter.value - powerBefore.value),
      };
    }
    const rows = curve
      .filter((p) => Number.isFinite(p.before.value) && Number.isFinite(p.after.value))
      .map((p) => {
        const f = hpToTorqueNm(1, p.rpm);
        return {
          rpm: p.rpm,
          torqueBefore: scale(p.before, f),
          torqueAfter: scale(p.after, f),
          powerBefore: powerEstimate(p.before),
          powerAfter: powerEstimate(p.after),
        };
      });
    const at = (rpm: number, pick: (r: Row) => number) => {
      const row = rows.find((r) => r.rpm === rpm);
      return row ? pick(row) : NaN;
    };
    return {
      rows,
      torqueBefore: {
        value: gain.peakTorqueBefore.value,
        rpm: gain.peakRpm.torqueBefore,
      },
      torqueAfter: {
        value: gain.peakTorqueAfter.value,
        rpm: gain.peakRpm.torqueAfter,
      },
      powerBefore: {
        value: at(gain.peakRpm.powerBefore, (r) => r.powerBefore.value),
        rpm: gain.peakRpm.powerBefore,
      },
      powerAfter: {
        value: at(gain.peakRpm.powerAfter, (r) => r.powerAfter.value),
        rpm: gain.peakRpm.powerAfter,
      },
      torqueDelta: gain.torqueDelta,
      powerDelta: powerEstimate(gain.delta),
    };
  }, [active, ecu, curve, gain, powerEstimate]);

  const rows = view.rows;

  const layout = useMemo(() => {
    if (rows.length < 2) return null;
    const rpmMin = rows[0]!.rpm;
    const rpmMax = rows[rows.length - 1]!.rpm;
    // The axes cover the curves and the "after" band drawn around them.
    const rangeOf = (pick: (r: Row) => Estimate[]) => {
      let min = Infinity;
      let max = -Infinity;
      for (const r of rows) {
        const [before, after] = pick(r) as [Estimate, Estimate];
        for (const v of [before.value, after.value, after.lo, after.hi]) {
          if (!Number.isFinite(v)) continue;
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
      return { min, max };
    };
    const axes = sharedAxes(
      rangeOf((r) => [r.torqueBefore, r.torqueAfter]),
      rangeOf((r) => [r.powerBefore, r.powerAfter]),
    );
    const x = (rpm: number) => M.left + ((rpm - rpmMin) / (rpmMax - rpmMin || 1)) * PW;
    const yT = (v: number) => M.top + PH - ((v - axes.leftMin) / (axes.leftMax - axes.leftMin)) * PH;
    const yP = (v: number) => M.top + PH - ((v - axes.rightMin) / (axes.rightMax - axes.rightMin)) * PH;
    return { rpmMin, rpmMax, axes, x, yT, yP };
  }, [rows]);

  const move = useCallback(
    (clientX: number) => {
      const svg = wrapRef.current?.querySelector('svg');
      if (!svg || !layout) return;
      const box = svg.getBoundingClientRect();
      const vx = ((clientX - box.left) / box.width) * WIDTH;
      const rpm = layout.rpmMin + ((vx - M.left) / PW) * (layout.rpmMax - layout.rpmMin);
      let best = 0;
      for (let i = 1; i < rows.length; i++) {
        if (Math.abs(rows[i]!.rpm - rpm) < Math.abs(rows[best]!.rpm - rpm)) best = i;
      }
      setCursor(best);
    },
    [layout, rows],
  );

  if (!layout) return null;
  const { x, yT, yP, axes } = layout;

  const series = (
    key: 'torqueBefore' | 'torqueAfter' | 'powerBefore' | 'powerAfter',
    y: (v: number) => number,
    colour: string,
    tint: string,
    dashed: boolean,
  ) => {
    const valid = segments([...rows], (r) => Number.isFinite(r[key].value));
    const banded = segments([...rows], (r) => Number.isFinite(r[key].lo) && Number.isFinite(r[key].hi));
    return (
      <g key={key}>
        {/* Bands on the "after" curves only: four overlapping bands turn the plot
            into fog, and the after curve is the one being judged. */}
        {show.bands &&
          active === 'measured' &&
          !dashed &&
          banded.map((seg, i) => (
            <path
              key={`b${i}`}
              d={smoothArea(
                seg.map((r) => ({ x: x(r.rpm), y: y(r[key].hi) })),
                seg.map((r) => ({ x: x(r.rpm), y: y(r[key].lo) })),
              )}
              fill={tint}
            />
          ))}
        {valid.map((seg, i) => (
          <path
            key={`l${i}`}
            d={smoothPath(seg.map((r) => ({ x: x(r.rpm), y: y(r[key].value) })))}
            fill="none"
            stroke={colour}
            strokeWidth={dashed ? 2 : 2.75}
            strokeDasharray={dashed ? '7 5' : undefined}
            opacity={dashed ? 0.8 : 1}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </g>
    );
  };

  /** The area the tune added (or took away) between the before and after curves. */
  const gainArea = (
    before: 'torqueBefore' | 'powerBefore',
    after: 'torqueAfter' | 'powerAfter',
    y: (v: number) => number,
    colour: string,
  ) =>
    segments([...rows], (r) => Number.isFinite(r[before].value) && Number.isFinite(r[after].value)).map((seg, i) => (
      <path
        key={`g${after}${i}`}
        d={smoothArea(
          seg.map((r) => ({ x: x(r.rpm), y: y(r[after].value) })),
          seg.map((r) => ({ x: x(r.rpm), y: y(r[before].value) })),
        )}
        fill={colour}
        opacity={0.07}
      />
    ));

  const peakLabel = (peak: Peak, y: (v: number) => number, colour: string, text: string) =>
    Number.isFinite(peak.rpm) && Number.isFinite(peak.value) ? (
      <text
        x={Math.min(Math.max(x(peak.rpm), M.left + 30), M.left + PW - 30)}
        y={y(peak.value) - 12}
        textAnchor="middle"
        className="mono"
        fontSize={12}
        fontWeight={600}
        fill={colour}
        paintOrder="stroke"
        stroke="var(--panel)"
        strokeWidth={4}
      >
        {text}
      </text>
    ) : null;

  const peakDot = (peak: Peak, y: (v: number) => number, colour: string, filled: boolean) =>
    Number.isFinite(peak.rpm) && Number.isFinite(peak.value) ? (
      <circle
        cx={x(peak.rpm)}
        cy={y(peak.value)}
        r={4.5}
        fill={filled ? colour : 'var(--panel)'}
        stroke={colour}
        strokeWidth={2}
      />
    ) : null;

  const hovered = cursor !== null ? rows[cursor] : null;
  const readoutLeft = hovered ? (x(hovered.rpm) / WIDTH) * 100 : 0;
  const leftTicks = Array.from({ length: axes.intervals + 1 }, (_, i) => axes.leftMin + i * axes.leftStep);
  const rightTicks = Array.from({ length: axes.intervals + 1 }, (_, i) => axes.rightMin + i * axes.rightStep);

  const description = t('chart.description', {
    torqueBefore: n(view.torqueBefore.value, 0),
    torqueAfter: n(view.torqueAfter.value, 0),
    powerBefore: n(view.powerBefore.value, 0),
    powerAfter: n(view.powerAfter.value, 0),
    unit,
  });

  const plusMinus = (e: Estimate, digits: number) => (Number.isFinite(e.sd) ? ` ±${n(e.sd, digits)}` : '');

  return (
    <figure style={{ margin: 0 }} className="stack">
      <div className="chart-toggles">
        {ecu && (
          <div className="segmented" role="group" aria-label={t('chart.source.label')}>
            {(['ecu', 'measured'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={option === active ? 'is-active' : undefined}
                aria-pressed={option === active}
                onClick={() => setSource(option)}
                style={{ fontFamily: 'var(--font-sans)' }}
              >
                {t(option === 'ecu' ? 'chart.source.ecu' : 'chart.source.measured')}
              </button>
            ))}
          </div>
        )}
        <label>
          <input
            type="checkbox"
            checked={show.torque}
            onChange={(e) => setShow({ ...show, torque: e.target.checked })}
          />
          <span style={{ color: 'var(--torque)' }} className="swatch" aria-hidden="true" />
          {t('chart.torque')} (Nm)
        </label>
        <label>
          <input type="checkbox" checked={show.power} onChange={(e) => setShow({ ...show, power: e.target.checked })} />
          <span style={{ color: 'var(--signal)' }} className="swatch" aria-hidden="true" />
          {t('chart.power')} ({unit})
        </label>
        {active === 'measured' && (
          <label>
            <input
              type="checkbox"
              checked={show.bands}
              onChange={(e) => setShow({ ...show, bands: e.target.checked })}
            />
            {t('chart.bands')}
          </label>
        )}
        <span className="field-hint row" style={{ gap: 6 }}>
          <span className="swatch dashed" aria-hidden="true" /> {t('common.before')}
          <span className="swatch" aria-hidden="true" style={{ marginLeft: 8 }} /> {t('common.after')}
        </span>
      </div>

      <p className="field-hint">{t(active === 'ecu' ? 'chart.ecuNote' : 'chart.measuredNote')}</p>

      <div
        ref={wrapRef}
        className="chart-wrap"
        tabIndex={0}
        role="group"
        aria-label={t('chart.title')}
        aria-describedby={summaryId}
        onMouseMove={(e) => move(e.clientX)}
        onMouseLeave={() => setCursor(null)}
        onFocus={() => setCursor((c) => c ?? Math.floor(rows.length / 2))}
        onBlur={() => setCursor(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setCursor((c) => Math.min(rows.length - 1, (c ?? 0) + 1));
          else if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, (c ?? 0) - 1));
          else if (e.key === 'Home') setCursor(0);
          else if (e.key === 'End') setCursor(rows.length - 1);
          else return;
          e.preventDefault();
        }}
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          role="img"
          aria-label={description}
          style={{ display: 'block' }}
        >
          {leftTicks.map((v, i) => (
            <g key={v}>
              <line x1={M.left} x2={M.left + PW} y1={yT(v)} y2={yT(v)} stroke="var(--line)" />
              <text x={M.left - 10} y={yT(v) + 4} textAnchor="end" className="mono" fontSize={11} fill="var(--torque)">
                {v}
              </text>
              <text
                x={M.left + PW + 10}
                y={yT(v) + 4}
                textAnchor="start"
                className="mono"
                fontSize={11}
                fill="var(--signal)"
              >
                {rightTicks[i]}
              </text>
            </g>
          ))}
          {ticks(layout.rpmMin, layout.rpmMax, 7).map((v) => (
            <g key={`x${v}`}>
              <line x1={x(v)} x2={x(v)} y1={M.top} y2={M.top + PH} stroke="var(--line)" strokeDasharray="2 4" />
              <text x={x(v)} y={M.top + PH + 20} textAnchor="middle" className="mono" fontSize={11} fill="var(--muted)">
                {v}
              </text>
            </g>
          ))}
          <text x={M.left - 10} y={M.top - 18} textAnchor="end" fontSize={11} fill="var(--torque)">
            Nm
          </text>
          <text x={M.left + PW + 10} y={M.top - 18} textAnchor="start" fontSize={11} fill="var(--signal)">
            {unit}
          </text>
          <text x={M.left + PW} y={M.top + PH + 36} textAnchor="end" fontSize={11} fill="var(--muted)">
            {t('result.chart.rpm')}
          </text>

          {show.torque && gainArea('torqueBefore', 'torqueAfter', yT, 'var(--torque)')}
          {show.power && gainArea('powerBefore', 'powerAfter', yP, 'var(--signal)')}
          {show.torque && series('torqueBefore', yT, 'var(--torque)', 'var(--torque-tint)', true)}
          {show.power && series('powerBefore', yP, 'var(--signal)', 'var(--signal-tint)', true)}
          {show.torque && series('torqueAfter', yT, 'var(--torque)', 'var(--torque-tint)', false)}
          {show.power && series('powerAfter', yP, 'var(--signal)', 'var(--signal-tint)', false)}

          {show.torque && peakDot(view.torqueBefore, yT, 'var(--torque)', false)}
          {show.torque && peakDot(view.torqueAfter, yT, 'var(--torque)', true)}
          {show.power && peakDot(view.powerBefore, yP, 'var(--signal)', false)}
          {show.power && peakDot(view.powerAfter, yP, 'var(--signal)', true)}
          {show.torque && peakLabel(view.torqueAfter, yT, 'var(--torque)', `${n(view.torqueAfter.value, 0)} Nm`)}
          {show.power && peakLabel(view.powerAfter, yP, 'var(--signal)', `${n(view.powerAfter.value, 0)} ${unit}`)}

          {hovered && (
            <g aria-hidden="true">
              <line
                x1={x(hovered.rpm)}
                x2={x(hovered.rpm)}
                y1={M.top}
                y2={M.top + PH}
                stroke="var(--muted)"
                strokeWidth={1}
              />
              {show.torque && (
                <circle cx={x(hovered.rpm)} cy={yT(hovered.torqueAfter.value)} r={3.5} fill="var(--torque)" />
              )}
              {show.power && (
                <circle cx={x(hovered.rpm)} cy={yP(hovered.powerAfter.value)} r={3.5} fill="var(--signal)" />
              )}
            </g>
          )}

          {/* Captures the pointer over the plot area only. */}
          <rect x={M.left} y={M.top} width={PW} height={PH} fill="transparent" />
        </svg>

        {hovered && (
          <div
            className="chart-readout"
            style={readoutLeft > 55 ? { right: `${100 - readoutLeft + 2}%` } : { left: `${readoutLeft + 2}%` }}
          >
            <div style={{ marginBottom: 4, fontWeight: 600 }}>
              {hovered.rpm} {t('result.chart.rpm')}
            </div>
            <table>
              <tbody>
                <tr>
                  <td />
                  <td>{t('common.before')}</td>
                  <td>{t('common.after')}</td>
                  <td>Δ</td>
                </tr>
                <tr style={{ color: 'var(--torque)' }}>
                  <td>Nm</td>
                  <td>{n(hovered.torqueBefore.value, 0)}</td>
                  <td>{n(hovered.torqueAfter.value, 0)}</td>
                  <td>{signed(hovered.torqueAfter.value - hovered.torqueBefore.value, 0)}</td>
                </tr>
                <tr style={{ color: 'var(--signal)' }}>
                  <td>{unit}</td>
                  <td>{n(hovered.powerBefore.value, 0)}</td>
                  <td>{n(hovered.powerAfter.value, 0)}</td>
                  <td>{signed(hovered.powerAfter.value - hovered.powerBefore.value, 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* The dyno-sheet line: peaks and where they sit. */}
      <figcaption id={summaryId} className="chart-summary">
        {active === 'ecu' && <div className="tone-muted">{t('chart.source.ecu')}</div>}
        <div>
          <span className="tone-muted">{t('common.before')}:</span>{' '}
          <span style={{ color: 'var(--torque)' }}>
            {n(view.torqueBefore.value, 0)} Nm @ {view.torqueBefore.rpm}
          </span>
          {' · '}
          <span style={{ color: 'var(--signal)' }}>
            {n(view.powerBefore.value, 0)} {unit} @ {view.powerBefore.rpm}
          </span>{' '}
          <span className="tone-muted">{t('result.chart.rpm')}</span>
        </div>
        <div>
          <span className="tone-muted">{t('common.after')}:</span>{' '}
          <span style={{ color: 'var(--torque)', fontWeight: 600 }}>
            {n(view.torqueAfter.value, 0)} Nm @ {view.torqueAfter.rpm}
          </span>
          {' · '}
          <span style={{ color: 'var(--signal)', fontWeight: 600 }}>
            {n(view.powerAfter.value, 0)} {unit} @ {view.powerAfter.rpm}
          </span>{' '}
          <span className="tone-muted">{t('result.chart.rpm')}</span>
        </div>
        <div>
          <span className="tone-muted">{t('chart.gain')}:</span>{' '}
          <span style={{ color: 'var(--torque)' }}>
            {signed(view.torqueDelta.value, 0)}
            {plusMinus(view.torqueDelta, 0)} Nm
          </span>
          {' · '}
          <span style={{ color: 'var(--signal)' }}>
            {signed(view.powerDelta.value, 0)}
            {plusMinus(view.powerDelta, 0)} {unit}
          </span>
          <span className="field-hint"> · {t('chart.hint')}</span>
        </div>
      </figcaption>
    </figure>
  );
}
