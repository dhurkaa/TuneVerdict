/**
 * The result screen.
 *
 * Ordered by what a reader needs first: the verdict, then the number behind it,
 * then the evidence, then the reasons not to trust either. Nothing is displayed
 * as a bare number — every value carries its uncertainty — and nothing is
 * asserted without the evidence that produced it being one click away.
 */

import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import { Badge, Figure, Label, Meter, Panel, Stat } from './ui';
import { DeltaChart, PowerChart } from './PowerChart';
import { FindingsPanel } from './Findings';
import { CONFIDENCE, DISPLAY_PRECISION, VALIDITY } from '../core/constants';
import type {
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

export function ResultScreen({
  result,
  onBack,
  onExport,
  exporting,
}: {
  result: AnalysisResult;
  onBack: () => void;
  onExport: () => void;
  exporting: boolean;
}): JSX.Element {
  const { t } = useI18n();

  return (
    <div className="stack stack-3">
      <div className="row-between no-print">
        <button type="button" className="button button-quiet" onClick={onBack}>
          ← {t('common.back')}
        </button>
        <div className="row">
          <button type="button" className="button" onClick={() => window.print()}>
            {t('result.exportPrint')}
          </button>
          <button type="button" className="button button-primary" onClick={onExport} disabled={exporting}>
            {exporting ? t('result.exporting') : t('result.export')}
          </button>
        </div>
      </div>

      <VerdictPanel result={result} />
      <ValidityPanel result={result} />

      <Panel id="curves" title={t('result.chart.title')}>
        <PowerChart curve={result.curve} />
      </Panel>

      <Panel id="delta" title={t('result.chart.deltaTitle')}>
        <DeltaChart curve={result.curve} />
      </Panel>

      <FindingsPanel recommendations={result.recommendations} />
      <UncertaintyPanel result={result} />
      <SessionsPanel result={result} />
      <ProtocolPanel result={result} />
    </div>
  );
}

function VerdictPanel({ result }: { result: AnalysisResult }): JSX.Element {
  const { t, n } = useI18n();
  const { gain, validity } = result;
  const tone = VERDICT_TONE[validity.verdict];

  return (
    <Panel id="verdict">
      <div className="row-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div className="stack" style={{ gap: 'var(--space-1)', maxWidth: '46ch' }}>
          <Label>{t('result.title')}</Label>
          <h2 className={tone === 'muted' ? 'tone-muted' : `tone-${tone === 'info' ? 'ok' : tone}`}>
            {t(`result.verdict.${validity.verdict}` as TranslationKey)}
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            {t(`result.verdict.${validity.verdict}Body` as TranslationKey)}
          </p>
          <div className="row" style={{ gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
            <Badge tone={gain.significant ? 'info' : 'muted'}>
              {gain.significant ? t('result.significant') : t('result.notSignificant')}
            </Badge>
            <span className="mono field-hint">
              {t('result.pValue', { value: n(gain.pValue, 3) })}
            </span>
          </div>
        </div>

        <div className="stack" style={{ gap: 'var(--space-1)' }}>
          <Label>{t('result.gain')}</Label>
          <Figure
            estimate={gain.delta}
            unit={t('unit.hp')}
            digits={DISPLAY_PRECISION.power}
            size="headline"
            signed
            tone={gain.significant ? 'info' : 'muted'}
          />
        </div>
      </div>

      <hr className="divider" />

      <div className="grid-3">
        <div className="stack" style={{ gap: 4 }}>
          <Label>{t('result.peakBefore')}</Label>
          <Figure estimate={gain.peakBefore} unit={t('unit.hp')} digits={DISPLAY_PRECISION.power} />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <Label>{t('result.peakAfter')}</Label>
          <Figure estimate={gain.peakAfter} unit={t('unit.hp')} digits={DISPLAY_PRECISION.power} />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <Label>{t('result.gainPercent')}</Label>
          <Figure
            estimate={gain.deltaPercent}
            unit={t('unit.percent')}
            digits={DISPLAY_PRECISION.gainPercent}
            signed
          />
        </div>
      </div>
    </Panel>
  );
}

function ValidityPanel({ result }: { result: AnalysisResult }): JSX.Element {
  const { t, n } = useI18n();
  const { validity } = result;

  const factors: { key: TranslationKey; hint: TranslationKey; value: number; tone: Severity }[] = [
    { key: 'result.validity.gain', hint: 'result.validity.gainHint', value: validity.gain, tone: 'info' },
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
          <ul className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)', margin: 0, padding: 0, listStyle: 'none' }}>
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

function SessionCard({
  summary,
  which,
}: {
  summary: SessionSummary;
  which: 'before' | 'after';
}): JSX.Element {
  const { t, n } = useI18n();
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
        <Stat label={t('result.sessions.peak')} value={`${n(summary.peakPower.value, 1)} ${t('unit.hp')}`} />
        <Stat
          label={t('result.sessions.gear')}
          value={summary.gear || '—'}
          hint={summary.gearIsRelative ? t('result.sessions.gearRelative') : undefined}
        />
        <Stat
          label={t('result.sessions.pullsAccepted')}
          value={`${summary.acceptedPulls}`}
          hint={summary.rejectedPulls > 0 ? `${t('result.sessions.pullsRejected')}: ${summary.rejectedPulls}` : undefined}
        />
        <Stat label={t('result.sessions.cv')} value={`${n(summary.cv * 100, 1)}%`} />
        <Stat label={t('result.sessions.iat')} value={`${n(summary.meanIatC, 1)} ${t('unit.celsius')}`} />
        <Stat
          label={t('result.sessions.iatRise')}
          value={`${n(summary.iatRiseC, 1)} ${t('unit.celsius')}`}
          tone={summary.iatRiseC > 8 ? 'caution' : undefined}
        />
        <Stat label={t('result.sessions.correction')} value={n(summary.meanCorrection, 4)} />
        <Stat
          label={t('result.sessions.rate')}
          value={`${n(summary.sourceSampleRateHz, 1)} ${t('unit.hz')}`}
        />
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

function translateSession(
  value: string | number | undefined,
  t: (key: TranslationKey) => string,
): string {
  if (value === 'before') return t('common.before');
  if (value === 'after') return t('common.after');
  return String(value ?? '');
}
