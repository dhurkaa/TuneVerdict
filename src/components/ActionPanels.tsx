/**
 * The panels that turn a verdict into something a tuner can act on: gain across
 * the rpm range, requested vs delivered, the correction table, the distance to
 * each limit, and what to log next time.
 *
 * All of it is deterministic and computed by the pipeline. Nothing on this page
 * is generated text; every sentence is a translation key filled with measured
 * values.
 */

import { useState } from 'react';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import { Badge, Figure, Label, Panel } from './ui';
import { LegendItem, MARGIN, PLOT_WIDTH, WIDTH, bandPath, linePath, linearScale, segments, ticks } from './PowerChart';
import { CORRECTION_LOAD_STEP_KPA, DISPLAY_PRECISION } from '../core/constants';
import { usePowerUnit } from '../display/powerUnit';
import type {
  AnalysisResult,
  CorrectionCell,
  MarginLimit,
  MarginStatus,
  Severity,
  TrackedQuantity,
  TrackingSeries,
  TrackingStatus,
} from '../core/types';

// ---------------------------------------------------------------------------
// Gain across the rpm range
// ---------------------------------------------------------------------------

export function BandsSummary({ result }: { result: AnalysisResult }): JSX.Element {
  const { t, signed } = useI18n();
  const { unit, power, powerEstimate } = usePowerUnit();
  const { bands, averageDelta } = result.gain;
  const hasLoss = bands.some((band) => band.kind === 'loss');

  return (
    <div className="stack" style={{ gap: 'var(--space-2)' }}>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 4 }}>
          <Label>{t('result.bands.average')}</Label>
          <Figure estimate={powerEstimate(averageDelta)} unit={unit} digits={DISPLAY_PRECISION.power} signed />
        </div>
        <ul className="stack" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
          {bands.map((band) => (
            <li key={`${band.rpmLow}-${band.kind}`} className="row" style={{ gap: 'var(--space-1)', flexWrap: 'wrap' }}>
              <Badge tone={band.kind === 'gain' ? 'info' : band.kind === 'loss' ? 'risk' : 'muted'}>
                {t(`result.bands.kind.${band.kind}` as TranslationKey)}
              </Badge>
              <span className="mono">{t('result.bands.band', { low: band.rpmLow, high: band.rpmHigh })}</span>
              <span className="field-hint mono">
                {t('result.bands.mean', { delta: signed(power(band.meanDelta), DISPLAY_PRECISION.power), unit })}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {hasLoss && (
        <p className="inset bg-caution" role="note">
          {t('result.bands.lossWarning')}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Requested vs delivered
// ---------------------------------------------------------------------------

/** Display unit per tracked quantity. Rail pressure reads in bar, as tuners quote it. */
const TRACK_DISPLAY: Record<TrackedQuantity, { scale: number; unit: string; digits: number; relative: boolean }> = {
  boost: { scale: 1, unit: 'kPa', digits: 0, relative: true },
  lambda: { scale: 1, unit: 'λ', digits: 3, relative: true },
  fuelRail: { scale: 0.01, unit: 'bar', digits: 0, relative: true },
  timing: { scale: 1, unit: '°', digits: 1, relative: false },
};

const STATUS_TONE: Record<TrackingStatus, Severity | 'muted'> = {
  onTarget: 'info',
  short: 'caution',
  over: 'caution',
  spooling: 'muted',
  insufficient: 'muted',
};

export function TrackingPanel({ result }: { result: AnalysisResult }): JSX.Element {
  const { t } = useI18n();
  const sessions = (['after', 'before'] as const).filter((s) => result.tracking.some((series) => series.session === s));
  const [session, setSession] = useState<'before' | 'after'>(sessions[0] ?? 'after');
  const visible = result.tracking.filter((series) => series.session === session);

  return (
    <Panel id="tracking" title={t('result.tracking.title')} lead={t('result.tracking.lead')}>
      {result.tracking.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>{t('result.tracking.none')}</p>
      ) : (
        <>
          {sessions.length > 1 && (
            <div className="row" role="group" aria-label={t('common.session')}>
              {sessions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`button button-small ${s === session ? 'button-primary' : ''}`}
                  aria-pressed={s === session}
                  onClick={() => setSession(s)}
                >
                  {t(s === 'before' ? 'common.before' : 'common.after')}
                </button>
              ))}
            </div>
          )}
          <div className="stack stack-3">
            {visible.map((series) => (
              <TrackingCard key={`${series.session}-${series.quantity}`} series={series} />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

function TrackingCard({ series }: { series: TrackingSeries }): JSX.Element {
  const { t, n } = useI18n();
  const display = TRACK_DISPLAY[series.quantity];
  const name = t(`result.tracking.quantity.${series.quantity}` as TranslationKey);

  return (
    <div className="card stack">
      <div className="row-between" style={{ flexWrap: 'wrap' }}>
        <h3>
          {name} <span className="field-hint mono">({display.unit})</span>
        </h3>
        <span className="field-hint">{t(`result.tracking.hint.${series.quantity}` as TranslationKey)}</span>
      </div>

      <TrackingChart series={series} />

      <ul className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-1)', margin: 0, padding: 0, listStyle: 'none' }}>
        {series.zones.map((zone) => {
          const error = display.relative
            ? `${zone.error.value >= 0 ? '+' : '−'}${n(Math.abs(zone.error.value) * 100, 1)}%`
            : `${zone.error.value >= 0 ? '+' : '−'}${n(Math.abs(zone.error.value), 1)}°`;
          return (
            <li key={zone.zone.rpmLow}>
              <Badge tone={STATUS_TONE[zone.status]}>
                {zone.zone.rpmLow}–{zone.zone.rpmHigh}: {t(`result.tracking.status.${zone.status}` as TranslationKey)}
                {zone.status !== 'insufficient' && Number.isFinite(zone.error.value) ? ` · ${error}` : ''}
              </Badge>
            </li>
          );
        })}
      </ul>

      {series.requestSource === 'reconstructed' && (
        <p className="field-hint">{t('result.tracking.reconstructed')}</p>
      )}
    </div>
  );
}

function TrackingChart({ series }: { series: TrackingSeries }): JSX.Element | null {
  const { t } = useI18n();
  const display = TRACK_DISPLAY[series.quantity];
  const points = series.points;
  if (points.length < 2) return null;

  const height = 220;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const rpmMin = points[0]?.rpm ?? 0;
  const rpmMax = points[points.length - 1]?.rpm ?? 0;

  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    for (const v of [p.requested.value, p.delivered.lo, p.delivered.hi, p.delivered.value]) {
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v * display.scale);
        hi = Math.max(hi, v * display.scale);
      }
    }
  }
  const pad = Math.max((hi - lo) * 0.1, Math.abs(hi) * 0.02, 1e-3);
  const yLo = lo - pad;
  const yHi = hi + pad;

  const x = linearScale([rpmMin, rpmMax], [MARGIN.left, MARGIN.left + PLOT_WIDTH]);
  const y = linearScale([yLo, yHi], [MARGIN.top + plotHeight, MARGIN.top]);
  const s = (v: number): number => v * display.scale;

  return (
    <figure style={{ margin: 0 }} className="stack">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        width="100%"
        role="img"
        aria-label={t('result.tracking.description', {
          quantity: t(`result.tracking.quantity.${series.quantity}` as TranslationKey),
          session: t(series.session === 'before' ? 'common.before' : 'common.after'),
        })}
        style={{ display: 'block' }}
      >
        {ticks(yLo, yHi, 4).map((value) => (
          <g key={value}>
            <line x1={MARGIN.left} x2={MARGIN.left + PLOT_WIDTH} y1={y(value)} y2={y(value)} stroke="var(--line)" />
            <text x={MARGIN.left - 10} y={y(value) + 4} textAnchor="end" className="mono" fontSize={11} fill="var(--muted)">
              {Number(value.toFixed(display.digits + 1))}
            </text>
          </g>
        ))}
        {ticks(rpmMin, rpmMax, 6).map((value) => (
          <text key={value} x={x(value)} y={MARGIN.top + plotHeight + 22} textAnchor="middle" className="mono" fontSize={11} fill="var(--muted)">
            {value}
          </text>
        ))}

        {segments([...points], (p) => Number.isFinite(p.delivered.lo) && Number.isFinite(p.delivered.hi)).map((seg, i) => (
          <path
            key={`b${i}`}
            d={bandPath(seg.map((p) => ({ x: x(p.rpm), lo: y(s(p.delivered.lo)), hi: y(s(p.delivered.hi)) })))}
            fill="var(--signal-tint)"
          />
        ))}
        {segments([...points], (p) => Number.isFinite(p.requested.value)).map((seg, i) => (
          <path
            key={`r${i}`}
            d={linePath(seg.map((p) => ({ x: x(p.rpm), y: y(s(p.requested.value)) })))}
            fill="none"
            stroke="var(--reference)"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        ))}
        {segments([...points], (p) => Number.isFinite(p.delivered.value)).map((seg, i) => (
          <path
            key={`d${i}`}
            d={linePath(seg.map((p) => ({ x: x(p.rpm), y: y(s(p.delivered.value)) })))}
            fill="none"
            stroke="var(--signal)"
            strokeWidth={2.5}
          />
        ))}
      </svg>
      <figcaption className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <LegendItem colour="var(--reference)" dashed label={t('result.tracking.requested')} />
        <LegendItem colour="var(--signal)" label={t('result.tracking.delivered')} />
        <span className="row" style={{ gap: 8 }}>
          <span aria-hidden="true" style={{ width: 22, height: 10, background: 'var(--signal-tint)', borderRadius: 2 }} />
          <span className="field-hint">{t('result.tracking.band')}</span>
        </span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Correction table
// ---------------------------------------------------------------------------

export function CorrectionsPanel({ result }: { result: AnalysisResult }): JSX.Element {
  const { t } = useI18n();
  const cells = result.corrections;

  return (
    <Panel id="corrections" title={t('result.corrections.title')} lead={t('result.corrections.lead')}>
      {cells.length === 0 ? (
        <p className="tone-ok">{t('result.corrections.none')}</p>
      ) : (
        <>
          <p className="inset bg-caution" role="note">
            {t('result.corrections.caveat')}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>{t('result.corrections.table')}</th>
                  <th className="num">{t('result.corrections.rpm')}</th>
                  <th className="num">
                    {t('result.corrections.load')} ({t('unit.kpa')})
                  </th>
                  <th className="num">{t('result.corrections.change')}</th>
                  <th>{t('result.corrections.why')}</th>
                  <th>{t('result.corrections.evidence')}</th>
                  <th className="num">{t('result.corrections.confidence')}</th>
                </tr>
              </thead>
              <tbody>
                {cells.map((cell, index) => (
                  <CorrectionRow key={`${cell.parameter}-${cell.cause}-${cell.rpmLow}-${cell.loadLowKpa}-${index}`} cell={cell} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

function CorrectionRow({ cell }: { cell: CorrectionCell }): JSX.Element {
  const { t, n } = useI18n();

  const change =
    cell.parameter === 'hardware'
      ? t('result.corrections.hardwareChange')
      : `${cell.change > 0 ? '+' : '−'}${n(Math.abs(cell.change), cell.unit === 'deg' ? 1 : 0)}${
          cell.unit === 'deg' ? '°' : cell.unit === 'percent' ? '%' : ` ${t('unit.kpa')}`
        }`;

  const load = Number.isFinite(cell.loadLowKpa)
    ? `${n(cell.loadLowKpa, 0)}–${n(cell.loadLowKpa + CORRECTION_LOAD_STEP_KPA, 0)}`
    : t('result.corrections.anyLoad');

  const why = (() => {
    switch (cell.cause) {
      case 'knock':
        return t('result.corrections.cause.knock', { observed: n(cell.observed, 1) });
      case 'lean':
        return t('result.corrections.cause.lean', { observed: n(cell.observed, 3), reference: n(cell.reference, 2) });
      case 'boostOvershoot':
        return t('result.corrections.cause.boostOvershoot', { observed: n(cell.observed * 100, 1) });
      case 'boostShortfall':
        return t('result.corrections.cause.boostShortfall', {
          observed: n(cell.observed, 0),
          reference: n(cell.reference, 0),
        });
      case 'fuelRailDroop':
        return t('result.corrections.cause.fuelRailDroop', { observed: n(cell.observed * 100, 1) });
      default:
        return '';
    }
  })();

  return (
    <tr>
      <td>{t(`result.corrections.parameter.${cell.parameter}` as TranslationKey)}</td>
      <td className="num mono">
        {cell.rpmLow}–{cell.rpmHigh}
      </td>
      <td className="num mono">{load}</td>
      <td
        className={`num mono ${cell.parameter === 'hardware' ? 'tone-risk' : 'tone-caution'}`}
        style={{ fontWeight: 600 }}
      >
        {change}
      </td>
      <td>{why}</td>
      <td className="field-hint">
        {t('result.corrections.evidenceText', {
          points: cell.evidencePoints,
          pulls: cell.pulls.map((p) => `#${p + 1}`).join(', ') || '—',
        })}
      </td>
      <td className="num mono">{n(cell.confidence, DISPLAY_PRECISION.confidence)}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Margins
// ---------------------------------------------------------------------------

const MARGIN_STYLE: Record<MarginStatus, { tone: string; bg: string }> = {
  ok: { tone: 'tone-ok', bg: '' },
  tight: { tone: 'tone-caution', bg: 'bg-caution' },
  exceeded: { tone: 'tone-risk', bg: 'bg-risk' },
  unavailable: { tone: 'tone-muted', bg: '' },
};

export function MarginsPanel({ result }: { result: AnalysisResult }): JSX.Element {
  const { t, n } = useI18n();
  const limits = Array.from(new Set(result.margins.map((m) => m.limit))) as MarginLimit[];
  const zoneKeys = Array.from(new Set(result.margins.map((m) => `${m.zone.rpmLow}-${m.zone.rpmHigh}`)));

  return (
    <Panel id="margins" title={t('result.margins.title')} lead={t('result.margins.lead')}>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th />
              {zoneKeys.map((key) => (
                <th key={key} className="num">
                  {key.replace('-', '–')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {limits.map((limit) => (
              <tr key={limit}>
                <th scope="row" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 13, color: 'var(--text)' }}>
                  {t(`result.margins.limit.${limit}` as TranslationKey)}
                </th>
                {zoneKeys.map((key) => {
                  const cell = result.margins.find(
                    (m) => m.limit === limit && `${m.zone.rpmLow}-${m.zone.rpmHigh}` === key,
                  );
                  if (!cell) return <td key={key} />;
                  const style = MARGIN_STYLE[cell.status];
                  const label = t('result.margins.cell', {
                    limit: t(`result.margins.limit.${limit}` as TranslationKey),
                    zone: key,
                    worst: n(cell.worstMargin * 100, 0),
                    mean: n(cell.margin.value * 100, 0),
                    status: t(`result.margins.status.${cell.status}` as TranslationKey),
                  });
                  return (
                    <td key={key} className={`num ${style.bg}`} aria-label={label} title={label}>
                      {cell.status === 'unavailable' ? (
                        <span className="tone-muted field-hint">{t('result.margins.status.unavailable')}</span>
                      ) : (
                        <span className={`mono ${style.tone}`}>
                          {n(cell.worstMargin * 100, 0)}%
                          {cell.status !== 'ok' && (
                            <span className="field-hint" style={{ display: 'block' }}>
                              {t(`result.margins.status.${cell.status}` as TranslationKey)}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="field-hint">{t('result.margins.explain')}</p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Logging advice
// ---------------------------------------------------------------------------

export function LoggingPanel({ result }: { result: AnalysisResult }): JSX.Element {
  const { t } = useI18n();
  const advice = result.loggingAdvice;

  return (
    <Panel id="logging" title={t('result.logging.title')} lead={t('result.logging.lead')}>
      {advice.length === 0 ? (
        <p className="tone-ok">{t('result.logging.none')}</p>
      ) : (
        <ul className="stack" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {advice.map((item) => (
            <li key={item.key} className="row" style={{ alignItems: 'flex-start', gap: 'var(--space-2)' }}>
              <Badge tone={item.severity === 'info' ? 'muted' : item.severity}>
                {item.session === 'both'
                  ? t('result.logging.both')
                  : t(item.session === 'before' ? 'common.before' : 'common.after')}
              </Badge>
              <p>{t(item.key as TranslationKey, item.detail)}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
