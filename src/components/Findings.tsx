/**
 * Findings and recommendations.
 *
 * Every recommendation carries the four things that make it actionable rather
 * than merely alarming: the problem, the zone it happened in, the evidence that
 * produced it, and a confidence with the reasoning behind it exposed. None of it
 * is generated prose — each string is a key into the translation layer, so the
 * same evidence produces the same sentence every time, in either language.
 */

import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import { Badge, Panel } from './ui';
import { DISPLAY_PRECISION } from '../core/constants';
import type { FindingKind, Recommendation, Severity } from '../core/types';

/**
 * How a detector's peak value should be read. The detectors work in different
 * units — degrees, λ, fractions of a target — and printing all of them with the
 * same format would make three of the five meaningless.
 */
function formatPeak(
  kind: FindingKind,
  value: number,
  n: (value: number, digits?: number) => string,
  t: (key: TranslationKey) => string,
): string {
  switch (kind) {
    case 'knock':
      return `${n(value, DISPLAY_PRECISION.degrees)}${t('unit.degrees')}`;
    case 'lean':
      return `${t('unit.lambda')} ${n(value, DISPLAY_PRECISION.lambda)}`;
    case 'boostOvershoot':
    case 'boostOscillation':
    case 'fuelRailDroop':
      return `${n(value * 100, 1)}${t('unit.percent')}`;
    case 'egt':
      return `${n(value, 0)}${t('unit.celsius')}`;
    case 'iatHeatSoak':
      return `${n(value, 1)}${t('unit.celsius')}`;
    case 'residualOutlier':
      return `${n(value, 1)}${t('unit.sd')}`;
  }
}

const SEVERITY_BG: Record<Severity, string> = {
  risk: 'bg-risk',
  caution: 'bg-caution',
  info: '',
};

export function FindingsPanel({
  recommendations,
}: {
  recommendations: readonly Recommendation[];
}): JSX.Element {
  const { t } = useI18n();

  return (
    <Panel id="findings" title={t('result.findings.title')}>
      {recommendations.length === 0 ? (
        <p style={{ color: 'var(--muted)', maxWidth: '70ch' }}>{t('result.findings.none')}</p>
      ) : (
        <ul className="stack stack-3" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {recommendations.map((recommendation) => (
            <li key={recommendation.id}>
              <FindingCard recommendation={recommendation} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FindingCard({ recommendation }: { recommendation: Recommendation }): JSX.Element {
  const { t, n } = useI18n();
  const { finding } = recommendation;
  const { evidence } = finding;

  return (
    <article className={`card stack ${SEVERITY_BG[finding.severity]}`}>
      <header className="row-between" style={{ flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'wrap' }}>
          <h3>{t(`finding.${finding.kind}` as TranslationKey)}</h3>
          <Badge tone={finding.severity}>
            {t('result.findings.zone', { low: finding.zone.rpmLow, high: finding.zone.rpmHigh })}
          </Badge>
          <Badge>
            {t('result.findings.inSession', {
              session: t(evidence.session === 'before' ? 'common.before' : 'common.after'),
            })}
          </Badge>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="label">{t('result.findings.confidence')}</span>
          <span className="mono" style={{ fontSize: 18 }}>
            {n(finding.confidence, DISPLAY_PRECISION.confidence)}
          </span>
        </div>
      </header>

      <div className="grid-2">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">{t('result.findings.action')}</span>
          <p>{t(recommendation.actionKey as TranslationKey)}</p>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">{t('result.findings.risk')}</span>
          <p>{t(recommendation.riskKey as TranslationKey)}</p>
        </div>
      </div>

      <details>
        <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>
          {t('result.findings.evidence')}
        </summary>
        <div className="inset stack" style={{ gap: 6, marginTop: 'var(--space-1)' }}>
          <p>
            {t('result.findings.pulls', {
              count: evidence.pulls.length,
              total: evidence.totalPulls,
            })}
          </p>
          <p>
            {t('result.findings.samples', {
              exceeding: evidence.exceedingSamples,
              total: evidence.zoneSamples,
            })}
          </p>
          <p className="mono">
            {t('result.findings.peak', {
              peak: formatPeak(finding.kind, evidence.peakValue, n, t),
              threshold: formatPeak(finding.kind, evidence.threshold, n, t),
            })}
          </p>
          <p>
            {t('result.findings.channel', {
              channel: t(`channel.${evidence.channel}` as TranslationKey),
              provenance: t(`provenance.${evidence.channelProvenance}` as TranslationKey),
            })}
          </p>

          <span className="label">{t('result.findings.whyConfidence')}</span>
          <ul className="stack" style={{ gap: 2, margin: 0, padding: 0, listStyle: 'none' }}>
            {finding.confidenceTrace.map((entry, index) => (
              <li key={`${entry.reason}-${index}`} className="row-between">
                <span>{t(entry.reason as TranslationKey)}</span>
                <span
                  className={`mono ${entry.delta < 0 ? 'tone-caution' : 'tone-ok'}`}
                  style={{ marginLeft: 'var(--space-2)' }}
                >
                  {entry.delta >= 0 ? '+' : '−'}
                  {n(Math.abs(entry.delta), 2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </article>
  );
}
