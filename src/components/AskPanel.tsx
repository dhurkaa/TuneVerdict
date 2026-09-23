/**
 * "Ask about this result" — follow-up questions to the AI, answered through the
 * deployment's /api/explain endpoint. Customers see no key and no settings; the
 * panel does not render when the AI is not configured.
 *
 * Every answer is labelled as not part of the verdict: the calibrated analysis
 * above it is the result, and this is a reading of it.
 */

import { useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import { resultContext } from '../ai/explain';
import type { Turn } from '../ai/explain';
import { AiError, streamExplanation, useAiAvailability } from '../ai/client';
import { Badge, Panel } from './ui';
import type { AnalysisResult } from '../core/types';

const SUGGESTIONS: TranslationKey[] = ['ai.suggest.explain', 'ai.suggest.first', 'ai.suggest.confidence'];

export function AskPanel({ result }: { result: AnalysisResult }): JSX.Element | null {
  const i18n = useI18n();
  const { t, language } = i18n;
  const availability = useAiAvailability();
  const questionId = useId();

  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Built once per result and language, so every question in a conversation
  // shares a byte-identical prefix.
  const context = useMemo(() => resultContext(result, i18n), [result, i18n]);

  if (availability !== 'available') return null;

  const submit = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const history: Turn[] = [...turns, { role: 'user', text: trimmed }];
    setTurns(history);
    setQuestion('');
    setStreaming('');
    setError(null);
    setBusy(true);

    const abort = new AbortController();
    controller.current = abort;
    let partial = '';

    try {
      const { text: answer } = await streamExplanation({
        mode: 'question',
        language,
        context,
        turns: history,
        onText: (delta) => {
          partial += delta;
          setStreaming(partial);
        },
        signal: abort.signal,
      });
      setTurns([...history, { role: 'assistant', text: answer }]);
    } catch (caught) {
      const kind = caught instanceof AiError ? caught.kind : 'generic';
      if (kind === 'aborted') {
        // Keep what arrived, so a stopped answer is still readable.
        setTurns(partial ? [...history, { role: 'assistant', text: partial }] : turns);
      } else {
        // Drop the unanswered question so user and assistant turns keep
        // alternating, and put it back in the box for a retry.
        setTurns(turns);
        setQuestion(trimmed);
        setError(t(`ai.error.${kind}` as TranslationKey));
      }
    } finally {
      setStreaming('');
      setBusy(false);
      controller.current = null;
    }
  };

  return (
    <Panel id="ask" title={t('ai.title')} lead={t('ai.lead')} actions={<Badge>{t('ai.badge')}</Badge>}>
      <p className="field-hint">{t('ai.privacy')}</p>

      {(turns.length > 0 || busy) && (
        <div className="stack" aria-live="polite">
          {turns.map((turn, index) => (
            <Message key={index} turn={turn} />
          ))}
          {busy && <Message turn={{ role: 'assistant', text: streaming || t('ai.asking') }} />}
        </div>
      )}

      {error && (
        <p className="inset bg-risk tone-risk" role="alert">
          {error}
        </p>
      )}

      <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        {SUGGESTIONS.map((key) => (
          <button
            key={key}
            type="button"
            className="button button-small"
            disabled={busy}
            onClick={() => void submit(t(key))}
          >
            {t(key)}
          </button>
        ))}
      </div>

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(question);
        }}
      >
        <label className="label" htmlFor={questionId}>
          {t('ai.question')}
        </label>
        <textarea
          id={questionId}
          rows={3}
          maxLength={2000}
          value={question}
          placeholder={t('ai.placeholder')}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void submit(question);
            }
          }}
          style={{
            width: '100%',
            padding: 'var(--space-1) var(--space-2)',
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--line)',
            background: 'var(--inset)',
            color: 'var(--text)',
            font: 'inherit',
            resize: 'vertical',
          }}
        />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {turns.length > 0 && !busy && (
            <button type="button" className="button button-quiet" onClick={() => setTurns([])}>
              {t('ai.clear')}
            </button>
          )}
          {busy ? (
            <button type="button" className="button" onClick={() => controller.current?.abort()}>
              {t('ai.stop')}
            </button>
          ) : (
            <button type="submit" className="button button-primary" disabled={!question.trim()}>
              {t('ai.ask')}
            </button>
          )}
        </div>
      </form>
    </Panel>
  );
}

function Message({ turn }: { turn: Turn }): JSX.Element {
  const { t } = useI18n();
  const isModel = turn.role === 'assistant';
  return (
    <div className={isModel ? 'card stack' : 'inset stack'} style={{ gap: 6 }}>
      <div className="row-between">
        <span className="label">{isModel ? t('ai.model') : t('ai.you')}</span>
        {isModel && <span className="field-hint">{t('ai.notVerdict')}</span>}
      </div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{turn.text}</p>
    </div>
  );
}
