/**
 * The AI's key messages about a comparison, written automatically for every
 * result when the deployment has the AI configured. It sits below the calibrated
 * verdict, never above it, and every rendering says it is not part of the verdict.
 *
 * Customers see no settings: the key belongs to the operator and lives on the
 * server. When the AI is not configured the panel does not render at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { Language, TranslationKey } from '../i18n';
import { resultContext } from '../ai/explain';
import { AiError, streamExplanation, useAiAvailability } from '../ai/client';
import { Badge, Panel } from './ui';
import type { AnalysisResult } from '../core/types';

export interface AiSummary {
  /** Which result it was written for — `computedAt` is unique per analysis. */
  readonly resultId: string;
  readonly text: string;
  readonly language: Language;
  readonly model: string;
}

export function AiSummaryPanel({
  result,
  summary,
  onSummary,
}: {
  result: AnalysisResult;
  summary: AiSummary | null;
  onSummary: (summary: AiSummary | null) => void;
}): JSX.Element | null {
  const i18n = useI18n();
  const { t, language } = i18n;
  const availability = useAiAvailability();
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const context = useMemo(() => resultContext(result, i18n), [result, i18n]);
  const current = summary && summary.resultId === result.computedAt ? summary : null;

  const write = useCallback(async (): Promise<void> => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(null);
    setStreaming('');
    let partial = '';

    try {
      const { text, model } = await streamExplanation({
        mode: 'summary',
        language,
        context,
        onText: (delta) => {
          partial += delta;
          setStreaming(partial);
        },
        signal: abort.signal,
      });
      onSummary({ resultId: result.computedAt, text, language, model });
    } catch (caught) {
      const kind = caught instanceof AiError ? caught.kind : 'generic';
      if (kind === 'aborted') return;
      setError(t(`ai.error.${kind}` as TranslationKey));
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
        setStreaming('');
      }
    }
  }, [language, context, onSummary, result.computedAt, t]);

  // One automatic summary per comparison. The cleanup aborts an in-flight request
  // when the screen is left, so a summary is never written into the wrong result.
  const autoStarted = useRef<string | null>(null);
  useEffect(() => {
    if (availability !== 'available' || current) return;
    if (autoStarted.current === result.computedAt) return;
    autoStarted.current = result.computedAt;
    void write();
    return () => {
      controller.current?.abort();
      // Allow a remount (React's development double-mount included) to start again.
      autoStarted.current = null;
    };
    // `write` is left out on purpose: the summary starts once per result.
  }, [result.computedAt, availability]);

  if (availability !== 'available') return null;

  const text = busy ? streaming : current?.text ?? '';

  return (
    <Panel id="ai-summary" title={t('ai.summary.title')} actions={<Badge>{t('ai.badge')}</Badge>}>
      <p className="field-hint">
        {t('ai.notVerdict')} {t('ai.summary.privacy')}
      </p>
      {text ? (
        <div className="inset" aria-live="polite">
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{text}</p>
        </div>
      ) : busy ? (
        <p className="field-hint" aria-live="polite">
          {t('ai.summary.writing')}
        </p>
      ) : null}

      {current && current.language !== language && !busy && (
        <p className="field-hint">{t('ai.summary.otherLanguage')}</p>
      )}

      {error && (
        <p className="inset bg-risk tone-risk" role="alert">
          {error}
        </p>
      )}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {busy ? (
          <button type="button" className="button" onClick={() => controller.current?.abort()}>
            {t('ai.stop')}
          </button>
        ) : (
          <button type="button" className="button" onClick={() => void write()}>
            {current ? t('ai.summary.rewrite') : t('ai.summary.write')}
          </button>
        )}
      </div>
    </Panel>
  );
}
