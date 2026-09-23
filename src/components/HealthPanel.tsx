/**
 * The car health check: an overall score, one tile per system with the status the
 * rules gave it and the values behind it, and — when the deployment has the AI
 * configured — the AI mechanic's note under each system and a workshop checklist.
 *
 * The statuses and the score are the pipeline's (core/health.ts) and show without
 * the AI. The AI only explains them, and the panel says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import { resultContext } from '../ai/explain';
import { AiError, streamExplanation, useAiAvailability } from '../ai/client';
import { parseHealthReport } from '../ai/health';
import type { AiHealthReport } from '../ai/health';
import { Badge, Panel } from './ui';
import { metricDigits, roundForDisplay } from '../display/healthFormat';
import type { AnalysisResult, HealthMetric, HealthStatus, HealthSystem, HealthSystemId } from '../core/types';

const STATUS_COLOUR: Record<HealthStatus, string> = {
  good: 'var(--ok)',
  watch: 'var(--caution)',
  concern: 'var(--risk)',
  unknown: 'var(--reference)',
};

const LABEL_COLOUR: Record<AnalysisResult['health']['label'], string> = {
  healthy: 'var(--ok)',
  watch: 'var(--caution)',
  attention: 'var(--risk)',
  unknown: 'var(--reference)',
};

/** Line icons, 24×24, drawn in the tile's status colour. */
const ICON: Record<HealthSystemId, JSX.Element> = {
  turbo: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 10c0-3 1.5-5 4-5.5M14 12c3 0 5 1.5 5.5 4M12 14c0 3-1.5 5-4 5.5M10 12c-3 0-5-1.5-5.5-4" />
    </>
  ),
  fuel: <path d="M12 3.5s6 6.8 6 10.9a6 6 0 0 1-12 0C6 10.3 12 3.5 12 3.5zM9.5 15a2.5 2.5 0 0 0 2.5 2.5" />,
  combustion: (
    <path d="M12 3c.8 3.6 5 5.2 5 10.2A5 5 0 0 1 7 13.2c0-2.6 1.6-3.6 1.8-5.6 1.1 1 1.7 2.2 1.7 3.4C11.3 8.6 12.3 6.2 12 3z" />
  ),
  thermal: (
    <>
      <path d="M10 5a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z" />
      <path d="M12 9v7.5" />
    </>
  ),
  delivery: (
    <>
      <path d="M4 16.5a8 8 0 1 1 16 0" />
      <path d="M12 16.5l4.2-5.2" />
      <circle cx="12" cy="16.5" r="1.2" />
    </>
  ),
};

interface Stored {
  readonly resultId: string;
  readonly language: string;
  readonly report: AiHealthReport;
  readonly model: string;
}

export function HealthPanel({ result }: { result: AnalysisResult }): JSX.Element {
  const i18n = useI18n();
  const { t, language } = i18n;
  const availability = useAiAvailability();
  const [stored, setStored] = useState<Stored | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const controller = useRef<AbortController | null>(null);

  const health = result.health;
  const context = useMemo(() => resultContext(result, i18n), [result, i18n]);
  const ai = stored && stored.resultId === result.computedAt ? stored.report : null;

  const ask = useCallback(async (): Promise<void> => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(null);
    try {
      const { text, model } = await streamExplanation({
        mode: 'health',
        language,
        context,
        onText: () => undefined,
        signal: abort.signal,
      });
      const report = parseHealthReport(text);
      if (!report) {
        setError(t('health.ai.unreadable'));
        return;
      }
      setStored({ resultId: result.computedAt, language, report, model });
      setDone(new Set());
    } catch (caught) {
      const kind = caught instanceof AiError ? caught.kind : 'generic';
      if (kind !== 'aborted') setError(t(`ai.error.${kind}` as TranslationKey));
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }, [context, language, result.computedAt, t]);

  // One automatic report per result, as with the key messages.
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (availability !== 'available' || ai) return;
    if (started.current === result.computedAt) return;
    started.current = result.computedAt;
    void ask();
    return () => {
      controller.current?.abort();
      started.current = null;
    };
    // `ask` is left out on purpose: the report starts once per result.
  }, [result.computedAt, availability]);

  const aiOn = availability === 'available';

  return (
    <Panel id="health" title={t('health.title')} actions={aiOn ? <Badge>{t('ai.badge')}</Badge> : undefined}>
      <p className="field-hint">{t('health.lead')}</p>

      <div className="health-layout">
        <ScoreRing score={health.score} scoreBefore={health.scoreBefore} label={health.label} />

        <div className="health-grid">
          {health.systems.map((system) => (
            <SystemTile key={system.id} system={system} note={ai?.systems[system.id]} reading={busy && !ai} />
          ))}
        </div>
      </div>

      {aiOn && (
        <div className="health-ai">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="label">{t('health.ai.title')}</span>
            <span className="field-hint">{t('health.ai.note')}</span>
          </div>

          {ai ? (
            <>
              <p className="health-overall">{ai.overall}</p>
              {ai.checks.length > 0 && (
                <>
                  <span className="label">{t('health.ai.checks')}</span>
                  <ul className="health-checks">
                    {ai.checks.map((check, i) => (
                      <li key={i}>
                        <label>
                          <input
                            type="checkbox"
                            checked={done.has(i)}
                            onChange={() =>
                              setDone((prev) => {
                                const next = new Set(prev);
                                if (next.has(i)) next.delete(i);
                                else next.add(i);
                                return next;
                              })
                            }
                          />
                          <span className={done.has(i) ? 'is-done' : undefined}>{check}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : busy ? (
            <p className="field-hint health-reading" aria-live="polite">
              {t('health.ai.reading')}
            </p>
          ) : null}

          {error && (
            <p className="inset bg-risk tone-risk" role="alert">
              {error}
            </p>
          )}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {busy ? (
              <button type="button" className="button button-small" onClick={() => controller.current?.abort()}>
                {t('ai.stop')}
              </button>
            ) : (
              <button type="button" className="button button-small" onClick={() => void ask()}>
                {ai ? t('health.ai.again') : t('health.ai.ask')}
              </button>
            )}
          </div>
        </div>
      )}
      {stored && stored.resultId === result.computedAt && stored.language !== language && !busy && (
        <p className="field-hint">{t('ai.summary.otherLanguage')}</p>
      )}
    </Panel>
  );
}

function ScoreRing({
  score,
  scoreBefore,
  label,
}: {
  score: number;
  scoreBefore: number;
  label: AnalysisResult['health']['label'];
}): JSX.Element {
  const { t, n } = useI18n();
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const fraction = Number.isFinite(score) ? score / 100 : 0;
  // Starts empty and fills, so the score reads as a measurement being taken.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(fraction));
    return () => cancelAnimationFrame(frame);
  }, [fraction]);
  const colour = LABEL_COLOUR[label];

  return (
    <div className="health-score">
      <svg
        viewBox="0 0 128 128"
        width="148"
        height="148"
        role="img"
        aria-label={`${t('health.score')}: ${n(score, 0)}`}
      >
        <circle cx="64" cy="64" r={radius} fill="none" stroke="var(--line)" strokeWidth="10" />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown)}
          transform="rotate(-90 64 64)"
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1)' }}
        />
        <text x="64" y="62" textAnchor="middle" className="mono" fontSize="34" fontWeight="600" fill="var(--text)">
          {Number.isFinite(score) ? n(score, 0) : '–'}
        </text>
        <text x="64" y="82" textAnchor="middle" fontSize="10" fill="var(--muted)" letterSpacing="1.4">
          / 100
        </text>
      </svg>
      <strong style={{ color: colour }}>{t(`health.label.${label}` as TranslationKey)}</strong>
      {Number.isFinite(scoreBefore) && (
        <span className="field-hint">{t('health.scoreStock', { score: n(scoreBefore, 0) })}</span>
      )}
    </div>
  );
}

function SystemTile({
  system,
  note,
  reading,
}: {
  system: HealthSystem;
  note: string | undefined;
  reading: boolean;
}): JSX.Element {
  const { t, n } = useI18n();
  const colour = STATUS_COLOUR[system.status];
  const changed = system.statusBefore !== system.status && system.statusBefore !== 'unknown';

  const value = (m: HealthMetric) => {
    const digits = metricDigits(m);
    const shown = roundForDisplay(m.value, digits);
    const sign = m.unit === '%' && m.key.endsWith('Tracking') && shown > 0 ? '+' : '';
    return `${sign}${n(shown, digits)} ${m.unit}`;
  };

  return (
    <article className="health-tile" style={{ borderTopColor: colour }}>
      <header className="row" style={{ gap: 10, alignItems: 'center' }}>
        <svg
          viewBox="0 0 24 24"
          width="26"
          height="26"
          fill="none"
          stroke={colour}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {ICON[system.id]}
        </svg>
        <strong className="grow">{t(`health.system.${system.id}` as TranslationKey)}</strong>
        <span className="health-pill" style={{ color: colour, borderColor: colour }}>
          {t(`health.status.${system.status}` as TranslationKey)}
        </span>
      </header>

      <span className="field-hint" style={changed ? { color: 'var(--text)' } : undefined}>
        {t('health.stock', { status: t(`health.status.${system.statusBefore}` as TranslationKey) })}
        {changed && ' → ' + t(`health.status.${system.status}` as TranslationKey)}
      </span>

      {system.metrics.length > 0 ? (
        <dl className="health-metrics">
          {system.metrics.map((m) => (
            <div key={m.key}>
              <dt>{t(m.key as TranslationKey)}</dt>
              <dd
                style={m.status === 'watch' || m.status === 'concern' ? { color: STATUS_COLOUR[m.status] } : undefined}
              >
                {value(m)}
                {m.limit !== undefined && (
                  <span className="field-hint"> · {t('health.limit', { value: n(m.limit, metricDigits(m)) })}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="field-hint">{t('health.notLogged')}</p>
      )}

      {system.findings.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {system.findings.map((kind) => (
            <span key={kind} className="health-chip">
              {t(`finding.${kind}` as TranslationKey)}
            </span>
          ))}
        </div>
      )}

      {note ? (
        <p className="health-note">{note}</p>
      ) : reading ? (
        <div className="health-note health-shimmer" aria-hidden="true" />
      ) : null}
    </article>
  );
}
