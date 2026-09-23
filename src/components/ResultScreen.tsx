/**
 * The result screen, laid out as a tuner's dashboard: the figures across the
 * top, torque and power on one chart with the key points beside it, and
 * everything else in tabs underneath — read at a glance, like a dyno sheet.
 * Nothing is displayed as a bare number — every value carries its uncertainty —
 * and nothing is asserted without the evidence that produced it one click away.
 */

import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import { Badge, Label, Meter, Panel, Stat } from './ui';
import { useState } from 'react';
import { DeltaChart } from './PowerChart';
import { TuningChart } from './TuningChart';
import { PowerUnitToggle, usePowerUnit } from '../display/powerUnit';
import { useAiAvailability } from '../ai/client';
import { FindingsPanel } from './Findings';
import { BandsSummary, CorrectionsPanel, LoggingPanel, MarginsPanel, TrackingPanel } from './ActionPanels';
import { AskPanel } from './AskPanel';
import { AiSummaryPanel } from './AiSummaryPanel';
import { HealthPanel } from './HealthPanel';
import type { AiSummary } from './AiSummaryPanel';
import { CONFIDENCE, DISPLAY_PRECISION, VALIDITY } from '../core/constants';
import type {
  EcuTorqueComparison,
  AnalysisResult,
  SessionSummary,
  Severity,
  UncertaintyBudget,
  Verdict,
} from '../core/types';

const VERDICT_TONE: Record<Verdict, Severity | 'muted'> = {
  good: 'info',
  mixed: 'caution',
  bad: 'risk',
  inconclusive: 'muted',
};

type TabId = 'changes' | 'tracking' | 'limits' | 'findings' | 'band' | 'uncertainty' | 'sessions' | 'protocol' | 'ask';

export function ResultScreen({
  result,
  onBack,
  onExport,
  exporting,
  aiSummary,
  onAiSummary,
}: {
  result: AnalysisResult;
  onBack: () => void;
  onExport: () => void;
  exporting: boolean;
  aiSummary: AiSummary | null;
  onAiSummary: (summary: AiSummary | null) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>(defaultTab(result));

  return (
    <div className="stack" style={{ gap: 'var(--space-2)' }}>
      <div className="toolbar no-print">
        <button type="button" className="button button-quiet button-small" onClick={onBack}>
          ← {t('common.back')}
        </button>
        <div className="row" style={{ gap: 'var(--space-1)' }}>
          <PowerUnitToggle label={t('result.unit')} />
          <button type="button" className="button button-small" onClick={() => window.print()}>
            {t('result.exportPrint')}
          </button>
          <button type="button" className="button button-primary button-small" onClick={onExport} disabled={exporting}>
            {exporting ? t('result.exporting') : t('result.export')}
          </button>
        </div>
      </div>

      <HeadlineStrip result={result} />

      <div className="dashboard-main">
        <Panel id="chart" title={t('chart.title')}>
          <TuningChart curve={result.curve} gain={result.gain} ecu={result.ecu} />
        </Panel>
        <div className="dashboard-side">
          <KeyPoints result={result} onOpen={setTab} />
          <div className="no-print">
            <AiSummaryPanel result={result} summary={aiSummary} onSummary={onAiSummary} />
          </div>
        </div>
      </div>

      <HealthPanel result={result} />

      <DetailTabs result={result} tab={tab} onTab={setTab} />
    </div>
  );
}

/** Open on whatever needs attention first: the changes to make, then the findings. */
function defaultTab(result: AnalysisResult): TabId {
  if (result.corrections.length > 0) return 'changes';
  if (result.recommendations.some((r) => r.finding.evidence.session === 'after')) return 'findings';
  return 'band';
}

// ---------------------------------------------------------------------------
// Headline figures
// ---------------------------------------------------------------------------

function EcuHeadline({ ecu, result }: { ecu: EcuTorqueComparison; result: AnalysisResult }): JSX.Element {
  const { t, n, signed } = useI18n();
  const { unit, power } = usePowerUnit();
  const gainPercent = (100 * ecu.powerDelta) / ecu.peakPowerBefore.value;
  const tone = ecu.powerDelta > 0 ? 'tone-ok' : 'tone-muted';
  const crossCheck =
    ecu.agreement === 'undetermined'
      ? 'headline.crossCheck.undetermined'
      : (`headline.crossCheck.${ecu.agreement}` as TranslationKey);

  return (
    <>
      <div className="headline-card">
        <span className="label">{t('headline.ecuVerdict')}</span>
        <h2 className={tone} style={{ fontSize: 20 }}>
          {signed(power(ecu.powerDelta), 0)} {unit} · {signed(ecu.torqueDelta, 0)} Nm
        </h2>
        <span className="headline-sub">{t('headline.ecuBasis', { count: ecu.points.length })}</span>
        <span className="headline-sub">
          {t(crossCheck, {
            measured: `${signed(ecu.measuredChange.value, 0)} ±${n(ecu.measuredChange.sd, 0)}`,
          })}
        </span>
      </div>

      <div className="headline-card">
        <span className="label">
          {t('chart.power')} ({unit}) · ECU
        </span>
        <div className="headline-value">
          {n(power(ecu.peakPowerBefore.value), 0)}
          <span className="arrow">→</span>
          <span style={{ color: 'var(--signal)' }}>{n(power(ecu.peakPowerAfter.value), 0)}</span>
        </div>
        <span className="headline-sub" style={{ color: 'var(--signal)' }}>
          {signed(power(ecu.powerDelta), 0)} {unit} · @ {ecu.peakPowerAfter.rpm}
        </span>
      </div>

      <div className="headline-card">
        <span className="label">{t('chart.torque')} (Nm) · ECU</span>
        <div className="headline-value">
          {n(ecu.peakBefore.value, 0)}
          <span className="arrow">→</span>
          <span style={{ color: 'var(--torque)' }}>{n(ecu.peakAfter.value, 0)}</span>
        </div>
        <span className="headline-sub" style={{ color: 'var(--torque)' }}>
          {signed(ecu.torqueDelta, 0)} Nm · @ {ecu.peakAfter.rpm}
        </span>
      </div>

      <div className="headline-card">
        <span className="label">{t('result.gainPercent')}</span>
        <div className="headline-value">
          {signed(gainPercent, 1)}
          <span className="unit">%</span>
        </div>
        <span className="headline-sub">
          {t('headline.ecuAverage', {
            value: signed(ecu.reportedChange.value, 0),
          })}
        </span>
        {!ecu.measuredReliable && Number.isFinite(result.gain.peakBefore.value) && (
          <span className="headline-sub">
            {t('headline.measuredCrossCheck', {
              value: n(power(result.gain.peakBefore.value), 0),
              unit,
            })}
          </span>
        )}
      </div>
    </>
  );
}

function HeadlineStrip({ result }: { result: AnalysisResult }): JSX.Element {
  const { t } = useI18n();
  const afterFindings = result.recommendations.filter((r) => r.finding.evidence.session === 'after');
  const risks = afterFindings.filter((r) => r.severity === 'risk').length;
  const cautions = afterFindings.filter((r) => r.severity === 'caution').length;

  return (
    <section className="headline-strip" aria-label={t('result.title')}>
      {result.ecu ? <EcuHeadline ecu={result.ecu} result={result} /> : <MeasuredHeadline result={result} />}
      <SafetyCard result={result} risks={risks} cautions={cautions} />
    </section>
  );
}

function MeasuredHeadline({ result }: { result: AnalysisResult }): JSX.Element {
  const { t, n, signed } = useI18n();
  const { unit, powerEstimate } = usePowerUnit();
  const { gain, validity } = result;
  const tone = VERDICT_TONE[validity.verdict];
  const pb = powerEstimate(gain.peakBefore);
  const pa = powerEstimate(gain.peakAfter);
  const pd = powerEstimate(gain.delta);

  return (
    <>
      <div className="headline-card">
        <span className="label">{t('result.title')}</span>
        <h2
          className={tone === 'muted' ? 'tone-muted' : `tone-${tone === 'info' ? 'ok' : tone}`}
          style={{ fontSize: 20 }}
        >
          {t(`result.verdict.${validity.verdict}` as TranslationKey)}
        </h2>
        <span className="headline-sub">
          {t('result.validity.index')} {n(validity.index, 2)} · {n(validity.gain, 2)} × {n(validity.consistency, 2)} ×{' '}
          {n(validity.safety, 2)}
        </span>
        <span className="headline-sub">
          {gain.significant ? t('result.significant') : t('result.notSignificant')} ·{' '}
          {t('result.pValue', { value: n(gain.pValue, 3) })}
        </span>
      </div>

      <div className="headline-card">
        <span className="label">
          {t('chart.power')} ({unit})
        </span>
        <div className="headline-value">
          {n(pb.value, 0)}
          <span className="arrow">→</span>
          <span style={{ color: 'var(--signal)' }}>{n(pa.value, 0)}</span>
        </div>
        <span className="headline-sub" style={{ color: 'var(--signal)' }}>
          {signed(pd.value, 0)} ±{n(pd.sd, 0)} {unit} · @ {gain.peakRpm.powerAfter}
        </span>
      </div>

      <div className="headline-card">
        <span className="label">{t('chart.torque')} (Nm)</span>
        <div className="headline-value">
          {n(gain.peakTorqueBefore.value, 0)}
          <span className="arrow">→</span>
          <span style={{ color: 'var(--torque)' }}>{n(gain.peakTorqueAfter.value, 0)}</span>
        </div>
        <span className="headline-sub" style={{ color: 'var(--torque)' }}>
          {signed(gain.torqueDelta.value, 0)} ±{n(gain.torqueDelta.sd, 0)} Nm · @ {gain.peakRpm.torqueAfter}
        </span>
      </div>

      <div className="headline-card">
        <span className="label">{t('result.gainPercent')}</span>
        <div className="headline-value">
          {signed(gain.deltaPercent.value, 1)}
          <span className="unit">%</span>
        </div>
        <span className="headline-sub">
          {t('headline.average', {
            value: signed(powerEstimate(gain.averageDelta).value, 0),
            unit,
          })}
        </span>
      </div>
    </>
  );
}

function SafetyCard({
  result,
  risks,
  cautions,
}: {
  result: AnalysisResult;
  risks: number;
  cautions: number;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="headline-card">
      <span className="label">{t('result.validity.safety')}</span>
      <div className="headline-value" style={{ fontSize: 20, whiteSpace: 'normal' }}>
        {risks + cautions === 0 ? (
          <span className="tone-ok">{t('headline.clean')}</span>
        ) : (
          <>
            {risks > 0 && <span className="tone-risk">{t('headline.risks', { count: risks })} </span>}
            {cautions > 0 && <span className="tone-caution">{t('headline.cautions', { count: cautions })}</span>}
          </>
        )}
      </div>
      <span className="headline-sub">
        {t('headline.changes', { count: result.corrections.length })} ·{' '}
        {t('headline.warnings', { count: result.violations.length })}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key points
// ---------------------------------------------------------------------------

const MAX_KEYPOINTS = 3;

function KeyPoints({ result, onOpen }: { result: AnalysisResult; onOpen: (tab: TabId) => void }): JSX.Element {
  const { t, n, signed } = useI18n();
  const { unit, power } = usePowerUnit();

  const open = (tab: TabId): void => {
    onOpen(tab);
    document.getElementById('details')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const safety = result.recommendations.filter((r) => r.finding.evidence.session === 'after' && r.severity !== 'info');
  const changes = result.corrections;
  const tracking = result.tracking
    .filter((s) => s.session === 'after')
    .flatMap((s) =>
      s.zones.filter((z) => z.status === 'short' || z.status === 'over').map((z) => ({ series: s, zone: z })),
    );
  const tight = result.margins.filter((m) => m.status === 'tight');
  const losses = result.gain.bands.filter((b) => b.kind === 'loss');
  const protocolRisks = result.violations.filter((v) => v.severity === 'risk');
  const ecu = result.ecu;
  const ecuDisagrees = ecu !== null && (ecu.agreement === 'notDelivered' || ecu.agreement === 'exceeds');

  const clean =
    !ecuDisagrees &&
    safety.length === 0 &&
    changes.length === 0 &&
    tracking.length === 0 &&
    losses.length === 0 &&
    result.violations.length === 0;

  const openLink = (tab: TabId, label: string) => (
    <button type="button" className="linklike" onClick={() => open(tab)}>
      {label}
    </button>
  );

  const more = (count: number, tab: TabId) =>
    count > MAX_KEYPOINTS
      ? openLink(tab, t('keypoints.more', { count: count - MAX_KEYPOINTS }))
      : openLink(tab, t('keypoints.open'));

  const changeText = (c: AnalysisResult['corrections'][number]): string => {
    const amount =
      c.parameter === 'hardware'
        ? t('result.corrections.hardwareChange')
        : `${c.change > 0 ? '+' : '−'}${n(Math.abs(c.change), c.unit === 'deg' ? 1 : 0)}${
            c.unit === 'deg' ? '°' : c.unit === 'percent' ? '%' : ' kPa'
          }`;
    return `${t(`result.corrections.parameter.${c.parameter}` as TranslationKey)} ${c.rpmLow}–${c.rpmHigh}: ${amount}`;
  };

  return (
    <Panel id="keypoints" title={t('keypoints.title')}>
      {clean ? (
        <p className="tone-ok">{t('keypoints.clean')}</p>
      ) : (
        <ul className="keypoints">
          {protocolRisks.length > 0 && (
            <li className="keypoint-group">
              <span className="label">{t('keypoints.measurement')}</span>
              <div className="keypoint">
                <span className="dot risk" />
                <span className="grow">{t('keypoints.protocol', { count: protocolRisks.length })}</span>
                {openLink('protocol', t('keypoints.open'))}
              </div>
            </li>
          )}

          {ecu && (ecu.agreement !== 'undetermined' || !ecu.measuredReliable) && (
            <li className="keypoint-group">
              <span className="label">{t('keypoints.ecu')}</span>
              {!ecu.measuredReliable && Number.isFinite(ecu.measuredOffset) && (
                <div className="keypoint">
                  <span className="dot caution" />
                  <span className="grow">
                    {t('keypoints.ecuModelOff', {
                      offset: signed(100 * ecu.measuredOffset, 0),
                    })}
                  </span>
                </div>
              )}
              {ecu.agreement !== 'undetermined' && (
                <div className="keypoint">
                  <span
                    className={`dot ${ecu.agreement === 'confirmed' ? 'ok' : ecu.agreement === 'notDelivered' ? 'risk' : 'caution'}`}
                  />
                  <span className="grow">
                    {t(
                      ecu.agreement === 'notDelivered'
                        ? 'keypoints.ecuNotDelivered'
                        : ecu.agreement === 'exceeds'
                          ? 'keypoints.ecuExceeds'
                          : 'keypoints.ecuConfirmed',
                      {
                        reported: signed(ecu.reportedChange.value, 0),
                        measured: `${signed(ecu.measuredChange.value, 0)} ±${n(ecu.measuredChange.sd, 0)}`,
                      },
                    )}
                  </span>
                </div>
              )}
            </li>
          )}

          {safety.length > 0 && (
            <li className="keypoint-group">
              <span className="label">{t('keypoints.safety')}</span>
              {safety.slice(0, MAX_KEYPOINTS).map((r) => (
                <div className="keypoint" key={r.id}>
                  <span className={`dot ${r.severity}`} />
                  <span className="grow">
                    {t(`finding.${r.finding.kind}` as TranslationKey)}{' '}
                    <span className="mono field-hint">
                      {r.finding.zone.rpmLow}–{r.finding.zone.rpmHigh}
                    </span>
                  </span>
                  <span className="mono field-hint">{n(r.confidence, 2)}</span>
                </div>
              ))}
              {more(safety.length, 'findings')}
            </li>
          )}

          {changes.length > 0 && (
            <li className="keypoint-group">
              <span className="label">{t('keypoints.changes')}</span>
              {changes.slice(0, MAX_KEYPOINTS).map((c, i) => (
                <div className="keypoint" key={`${c.parameter}-${c.rpmLow}-${c.loadLowKpa}-${i}`}>
                  <span className={`dot ${c.parameter === 'hardware' ? 'risk' : 'caution'}`} />
                  <span className="grow mono" style={{ fontSize: 12.5 }}>
                    {changeText(c)}
                  </span>
                </div>
              ))}
              {more(changes.length, 'changes')}
            </li>
          )}

          {tracking.length > 0 && (
            <li className="keypoint-group">
              <span className="label">{t('keypoints.tracking')}</span>
              {tracking.slice(0, MAX_KEYPOINTS).map(({ series, zone }) => (
                <div className="keypoint" key={`${series.quantity}-${zone.zone.rpmLow}`}>
                  <span className="dot caution" />
                  <span className="grow">
                    {t(zone.status === 'short' ? 'keypoints.short' : 'keypoints.over', {
                      quantity: t(`result.tracking.quantity.${series.quantity}` as TranslationKey),
                      low: zone.zone.rpmLow,
                      high: zone.zone.rpmHigh,
                      error:
                        series.quantity === 'timing'
                          ? `${signed(zone.error.value, 1)}°`
                          : `${signed(zone.error.value * 100, 1)}%`,
                    })}
                  </span>
                </div>
              ))}
              {more(tracking.length, 'tracking')}
            </li>
          )}

          {(losses.length > 0 || tight.length > 0) && (
            <li className="keypoint-group">
              <span className="label">{t('keypoints.band')}</span>
              {losses.map((b) => (
                <div className="keypoint" key={`loss-${b.rpmLow}`}>
                  <span className="dot risk" />
                  <span className="grow">
                    {t('keypoints.loss', {
                      delta: n(Math.abs(power(b.meanDelta)), 0),
                      unit,
                      low: b.rpmLow,
                      high: b.rpmHigh,
                    })}
                  </span>
                </div>
              ))}
              {tight.length > 0 && (
                <div className="keypoint">
                  <span className="dot caution" />
                  <span className="grow">{t('keypoints.tight', { count: tight.length })}</span>
                  {openLink('limits', t('keypoints.open'))}
                </div>
              )}
            </li>
          )}

          {protocolRisks.length === 0 && result.violations.length > 0 && (
            <li className="keypoint-group">
              <span className="label">{t('keypoints.measurement')}</span>
              <div className="keypoint">
                <span className="dot caution" />
                <span className="grow">{t('keypoints.warnings', { count: result.violations.length })}</span>
                {openLink('protocol', t('keypoints.open'))}
              </div>
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Detail tabs
// ---------------------------------------------------------------------------

function DetailTabs({
  result,
  tab,
  onTab,
}: {
  result: AnalysisResult;
  tab: TabId;
  onTab: (tab: TabId) => void;
}): JSX.Element {
  const { t } = useI18n();
  const ai = useAiAvailability();

  const afterFindings = result.recommendations.filter((r) => r.finding.evidence.session === 'after');
  const worst = (items: readonly { severity: string }[]): string =>
    items.some((i) => i.severity === 'risk') ? 'risk' : items.length > 0 ? 'caution' : '';

  const tabs: {
    id: TabId;
    label: TranslationKey;
    count?: number;
    tone?: string;
  }[] = [
    {
      id: 'changes',
      label: 'tabs.changes',
      count: result.corrections.length,
      tone: result.corrections.length ? 'caution' : '',
    },
    {
      id: 'findings',
      label: 'tabs.findings',
      count: result.recommendations.length,
      tone: worst(afterFindings),
    },
    {
      id: 'tracking',
      label: 'tabs.tracking',
      count: result.tracking
        .filter((s) => s.session === 'after')
        .flatMap((s) => s.zones)
        .filter((z) => z.status === 'short' || z.status === 'over').length,
    },
    {
      id: 'limits',
      label: 'tabs.limits',
      count: result.margins.filter((m) => m.status === 'tight' || m.status === 'exceeded').length,
    },
    { id: 'band', label: 'tabs.band' },
    { id: 'uncertainty', label: 'tabs.uncertainty' },
    { id: 'sessions', label: 'tabs.sessions' },
    {
      id: 'protocol',
      label: 'tabs.protocol',
      count: result.violations.length + result.loggingAdvice.length,
      tone: worst(result.violations),
    },
    ...(ai === 'available' ? [{ id: 'ask' as TabId, label: 'tabs.ask' as TranslationKey }] : []),
  ];

  const onKey = (event: React.KeyboardEvent, index: number): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next) {
      onTab(next.id);
      document.getElementById(`tab-${next.id}`)?.focus();
    }
  };

  // Every panel stays mounted, so switching tabs keeps its state (a half-typed
  // question, a chosen session) and printing can show them all.
  const panel = (id: TabId, content: JSX.Element) => (
    <div
      key={id}
      id={`tabpanel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      className="tab-panel"
      hidden={tab !== id}
    >
      {content}
    </div>
  );

  return (
    <section id="details" aria-label={t('tabs.label')}>
      <div role="tablist" aria-label={t('tabs.label')} className="tabs no-print">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`tabpanel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => onTab(item.id)}
            onKeyDown={(event) => onKey(event, index)}
          >
            {t(item.label)}
            {item.count !== undefined && item.count > 0 && (
              <span className={`tab-count ${item.tone ?? ''}`}>{item.count}</span>
            )}
          </button>
        ))}
      </div>

      {panel('changes', <CorrectionsPanel result={result} />)}
      {panel('findings', <FindingsPanel recommendations={result.recommendations} />)}
      {panel('tracking', <TrackingPanel result={result} />)}
      {panel('limits', <MarginsPanel result={result} />)}
      {panel(
        'band',
        <Panel id="band" title={t('result.chart.deltaTitle')}>
          <DeltaChart curve={result.curve} />
          <hr className="divider" />
          <BandsSummary result={result} />
        </Panel>,
      )}
      {panel(
        'uncertainty',
        <div className="stack">
          <ValidityPanel result={result} />
          <UncertaintyPanel result={result} />
        </div>,
      )}
      {panel('sessions', <SessionsPanel result={result} />)}
      {panel(
        'protocol',
        <div className="stack">
          <ProtocolPanel result={result} />
          <LoggingPanel result={result} />
        </div>,
      )}
      {ai === 'available' && panel('ask', <AskPanel result={result} />)}
    </section>
  );
}

function ValidityPanel({ result }: { result: AnalysisResult }): JSX.Element {
  const { t, n } = useI18n();
  const { validity } = result;

  const factors: {
    key: TranslationKey;
    hint: TranslationKey;
    value: number;
    tone: Severity;
  }[] = [
    {
      key: 'result.validity.gain',
      hint: 'result.validity.gainHint',
      value: validity.gain,
      tone: 'info',
    },
    {
      key: 'result.validity.consistency',
      hint: 'result.validity.consistencyHint',
      value: validity.consistency,
      tone: 'info',
    },
    {
      key: 'result.validity.safety',
      hint: 'result.validity.safetyHint',
      value: validity.safety,
      tone: validity.safety < 0.6 ? 'risk' : validity.safety < 0.9 ? 'caution' : 'info',
    },
  ];

  return (
    <Panel id="validity" title={t('result.validity.title')} lead={t('result.validity.lead')}>
      <div className="grid-2">
        <div className="inset stack">
          <Label>{t('result.validity.formula')}</Label>
          <div className="row" style={{ alignItems: 'baseline', gap: 'var(--space-2)' }}>
            <span className="figure mono">{n(validity.index, DISPLAY_PRECISION.index)}</span>
            <span className="field-hint mono">
              {n(validity.gain, 2)} × {n(validity.consistency, 2)} × {n(validity.safety, 2)}
            </span>
          </div>
          <Meter
            value={validity.index}
            label={t('result.validity.index')}
            tone={
              validity.index >= VALIDITY.verdictGoodMin
                ? 'info'
                : validity.index >= VALIDITY.verdictMixedMin
                  ? 'caution'
                  : 'risk'
            }
          />
        </div>

        <div className="stack">
          {factors.map((factor) => (
            <div key={factor.key} className="stack" style={{ gap: 4 }}>
              <div className="row-between">
                <Label>{t(factor.key)}</Label>
                <span className="mono">{n(factor.value, 2)}</span>
              </div>
              <Meter value={factor.value} tone={factor.tone} label={t(factor.key)} />
              <span className="field-hint">{t(factor.hint)}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

const BUDGET_KEY: Record<UncertaintyBudget['component'], TranslationKey> = {
  mass: 'result.uncertainty.component.mass',
  dragArea: 'result.uncertainty.component.dragArea',
  rollingResistance: 'result.uncertainty.component.rollingResistance',
  efficiency: 'result.uncertainty.component.efficiency',
  inertia: 'result.uncertainty.component.inertia',
};

function UncertaintyPanel({ result }: { result: AnalysisResult }): JSX.Element {
  const { t, n, formatDate } = useI18n();
  const massLeads = result.budget[0]?.component === 'mass';

  return (
    <Panel id="uncertainty" title={t('result.uncertainty.title')} lead={t('result.uncertainty.lead')}>
      <div className="grid-2">
        <div className="stack">
          <Label>{t('result.uncertainty.budget')}</Label>
          {result.budget.map((entry) => (
            <div key={entry.component} className="stack" style={{ gap: 4 }}>
              <div className="row-between">
                <span>{t(BUDGET_KEY[entry.component])}</span>
                <span className="mono">{n(entry.share * 100, 0)}%</span>
              </div>
              <Meter
                value={entry.share}
                label={t(BUDGET_KEY[entry.component])}
                tone={entry.component === 'mass' ? 'caution' : 'info'}
              />
            </div>
          ))}
          {massLeads && (
            <p className="field-hint" style={{ marginTop: 'var(--space-1)' }}>
              {t('result.uncertainty.massAdvice')}
            </p>
          )}
        </div>

        <div className="stack">
          <div className="inset stack" style={{ gap: 6 }}>
            <Label>{t('result.uncertainty.cancellationTitle')}</Label>
            <p>
              {t('result.uncertainty.cancellation', {
                factor: n(result.gain.commonModeCancellation, 1),
              })}
            </p>
          </div>
          <div className="inset stack" style={{ gap: 6 }}>
            <Label>{t('result.findings.confidence')}</Label>
            <p>
              {t('result.uncertainty.ece', {
                ece: n(CONFIDENCE.expectedCalibrationError, 3),
                cap: n(CONFIDENCE.cap, 3),
              })}
            </p>
          </div>
          <div className="inset stack" style={{ gap: 6 }}>
            <Label>{t('result.uncertainty.seedTitle')}</Label>
            <p className="field-hint">{t('result.uncertainty.reproducible')}</p>
            <p className="mono field-hint">
              {t('result.uncertainty.seed', {
                seed: result.seed,
                when: formatDate(result.computedAt),
              })}
            </p>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SessionsPanel({ result }: { result: AnalysisResult }): JSX.Element {
  const { t } = useI18n();
  return (
    <Panel id="sessions" title={t('result.sessions.title')}>
      <div className="grid-2">
        <SessionCard summary={result.before} which="before" />
        <SessionCard summary={result.after} which="after" />
      </div>

      {result.pairings.length > 0 && (
        <div className="inset stack" style={{ gap: 6 }}>
          <Label>{t('result.pairing.title')}</Label>
          <p className="field-hint">{t('result.pairing.lead')}</p>
          <ul
            className="row"
            style={{
              flexWrap: 'wrap',
              gap: 'var(--space-2)',
              margin: 0,
              padding: 0,
              listStyle: 'none',
            }}
          >
            {result.pairings.map((pair) => (
              <li key={`${pair.beforeIndex}-${pair.afterIndex}`} className="mono field-hint">
                {t('result.pairing.pair', {
                  before: pair.beforeIndex + 1,
                  after: pair.afterIndex + 1,
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function SessionCard({ summary, which }: { summary: SessionSummary; which: 'before' | 'after' }): JSX.Element {
  const { t, n } = useI18n();
  const { unit, power } = usePowerUnit();
  const accepted = summary.pulls.filter((pull) => pull.rejected === undefined);
  const rejected = summary.pulls.filter((pull) => pull.rejected !== undefined);

  return (
    <div className="stack">
      <div className="row-between">
        <h3>{t(which === 'before' ? 'common.before' : 'common.after')}</h3>
        <span className="mono field-hint" style={{ wordBreak: 'break-all' }}>
          {summary.label}
        </span>
      </div>

      <div className="grid-2">
        <Stat label={t('result.sessions.peak')} value={`${n(power(summary.peakPower.value), 1)} ${unit}`} />
        <Stat
          label={t('result.sessions.gear')}
          value={summary.gear || '—'}
          hint={summary.gearIsRelative ? t('result.sessions.gearRelative') : undefined}
        />
        <Stat
          label={t('result.sessions.pullsAccepted')}
          value={`${summary.acceptedPulls}`}
          hint={
            summary.rejectedPulls > 0 ? `${t('result.sessions.pullsRejected')}: ${summary.rejectedPulls}` : undefined
          }
        />
        <Stat label={t('result.sessions.cv')} value={`${n(summary.cv * 100, 1)}%`} />
        <Stat label={t('result.sessions.iat')} value={`${n(summary.meanIatC, 1)} ${t('unit.celsius')}`} />
        <Stat
          label={t('result.sessions.iatRise')}
          value={`${n(summary.iatRiseC, 1)} ${t('unit.celsius')}`}
          tone={summary.iatRiseC > 8 ? 'caution' : undefined}
        />
        <Stat label={t('result.sessions.correction')} value={n(summary.meanCorrection, 4)} />
        <Stat label={t('result.sessions.rate')} value={`${n(summary.sourceSampleRateHz, 1)} ${t('unit.hz')}`} />
      </div>

      <details>
        <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>{t('result.pulls.title')}</summary>
        <table style={{ marginTop: 'var(--space-1)' }}>
          <thead>
            <tr>
              <th className="num">{t('result.pulls.index')}</th>
              <th className="num">{t('result.pulls.rpm')}</th>
              <th className="num">{t('result.pulls.iat')}</th>
              <th className="num">{t('result.pulls.correction')}</th>
              <th>{t('result.pulls.status')}</th>
            </tr>
          </thead>
          <tbody>
            {[...accepted, ...rejected].map((pull, index) => (
              <tr key={`${pull.startSample}-${index}`}>
                <td className="num mono">{index + 1}</td>
                <td className="num mono">
                  {n(pull.rpmStart, 0)}–{n(pull.rpmEnd, 0)}
                </td>
                <td className="num mono">{n(pull.meanIatC, 1)}</td>
                <td className="num mono">{n(pull.correction.factor, 4)}</td>
                <td className={pull.rejected ? 'tone-caution' : 'tone-muted'}>
                  {pull.rejected
                    ? t('result.pulls.rejectedBecause', {
                        reason: t(pull.rejected as TranslationKey),
                      })
                    : t('result.pulls.used')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function ProtocolPanel({ result }: { result: AnalysisResult }): JSX.Element {
  const { t } = useI18n();
  return (
    <Panel id="protocol" title={t('protocol.title')} lead={t('protocol.lead')}>
      {result.violations.length === 0 ? (
        <p className="tone-ok">{t('protocol.none')}</p>
      ) : (
        <ul className="stack" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {result.violations.map((violation, index) => (
            <li
              key={`${violation.key}-${index}`}
              className={`inset ${violation.severity === 'risk' ? 'bg-risk' : 'bg-caution'}`}
            >
              <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                <Badge tone={violation.severity}>
                  {t(violation.severity === 'risk' ? 'requirement.required' : 'requirement.recommended')}
                </Badge>
                <p>
                  {t(violation.key as TranslationKey, {
                    ...violation.detail,
                    session: translateSession(violation.detail.session, t),
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function translateSession(value: string | number | undefined, t: (key: TranslationKey) => string): string {
  if (value === 'before') return t('common.before');
  if (value === 'after') return t('common.after');
  return String(value ?? '');
}
