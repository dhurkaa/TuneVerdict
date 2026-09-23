/**
 * The browser side of the AI explanation: talks to /api/explain, never to a
 * provider directly, and never holds a key.
 */

import { useEffect, useState } from 'react';
import type { Turn } from './explain';
import type { PromptLanguage } from './prompts';

export type AiFailure = 'unavailable' | 'rate' | 'refused' | 'network' | 'generic' | 'aborted';

export class AiError extends Error {
  constructor(readonly kind: AiFailure) {
    super(kind);
    this.name = 'AiError';
  }
}

const ENDPOINT = `${import.meta.env.BASE_URL}api/explain`;

export type AiAvailability = 'checking' | 'available' | 'unavailable';

let availability: Promise<boolean> | null = null;

/**
 * Whether the deployment has the AI configured. Asked once per page load. A
 * static host without the function (GitHub Pages) answers 404, which reads the
 * same as "not configured": the AI panels simply do not appear.
 */
function checkAvailability(): Promise<boolean> {
  availability ??= fetch(ENDPOINT, { method: 'GET' })
    .then(async (response) => {
      if (!response.ok) return false;
      const body = (await response.json()) as { available?: boolean };
      return body.available === true;
    })
    .catch(() => false);
  return availability;
}

export function useAiAvailability(): AiAvailability {
  const [state, setState] = useState<AiAvailability>('checking');
  useEffect(() => {
    let live = true;
    void checkAvailability().then((ok) => {
      if (live) setState(ok ? 'available' : 'unavailable');
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

const STATUS_FAILURE: Record<number, AiFailure> = {
  429: 'rate',
  422: 'refused',
  503: 'unavailable',
};

/**
 * Stream an answer. `mode: 'summary'` asks for the key messages (the instruction
 * is supplied by the server); `mode: 'question'` sends the conversation.
 */
export async function streamExplanation({
  mode,
  language,
  context,
  turns = [],
  onText,
  signal,
}: {
  mode: 'summary' | 'question' | 'health';
  language: PromptLanguage;
  context: string;
  turns?: readonly Turn[];
  onText: (delta: string) => void;
  signal: AbortSignal;
}): Promise<{ text: string; model: string }> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, language, context, turns }),
      signal,
    });
  } catch {
    if (signal.aborted) throw new AiError('aborted');
    throw new AiError('network');
  }

  if (!response.ok || !response.body) {
    throw new AiError(STATUS_FAILURE[response.status] ?? 'generic');
  }

  const model = response.headers.get('x-ai-model') ?? '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const delta = decoder.decode(value, { stream: true });
      if (delta) {
        text += delta;
        onText(delta);
      }
    }
  } catch {
    if (signal.aborted) throw new AiError('aborted');
    throw new AiError('network');
  }
  return { text, model };
}
