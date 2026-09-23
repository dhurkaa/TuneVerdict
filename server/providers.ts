/**
 * Server-side calls to the AI provider.
 *
 * The API key is read from the server's environment (OPENAI_API_KEY, or
 * ANTHROPIC_API_KEY) and never leaves the server: the browser talks to
 * /api/explain, and only this code talks to the provider.
 *
 * Environment variables:
 *   OPENAI_API_KEY      the operator's OpenAI key — enables the AI with OpenAI
 *   OPENAI_MODEL        optional, defaults to DEFAULT_MODEL.openai
 *   ANTHROPIC_API_KEY   used instead when no OpenAI key is set
 *   ANTHROPIC_MODEL     optional, defaults to DEFAULT_MODEL.anthropic
 *
 * Never prefix these with VITE_: Vite copies VITE_* variables into the browser
 * bundle, which would publish the key to every visitor.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export type Provider = 'openai' | 'anthropic';

/**
 * Defaults when the operator does not name a model. The OpenAI default is the
 * newest general-purpose model the installed SDK declares.
 */
export const DEFAULT_MODEL: Record<Provider, string> = {
  openai: 'gpt-5.5',
  anthropic: 'claude-opus-5',
};

/**
 * [ENGINEERING] Output cap per answer, in tokens. Every answer is paid for by the
 * operator, so an answer has a ceiling: a five-point summary needs a few hundred
 * tokens, and reasoning models spend part of the budget before writing, so the
 * cap leaves room for both without allowing essays.
 */
export const MAX_OUTPUT_TOKENS = 4000;

export interface ProviderConfig {
  readonly provider: Provider;
  readonly apiKey: string;
  readonly model: string;
}

export function configFromEnv(env: Record<string, string | undefined>): ProviderConfig | null {
  const openai = env.OPENAI_API_KEY?.trim();
  if (openai) return { provider: 'openai', apiKey: openai, model: env.OPENAI_MODEL?.trim() || DEFAULT_MODEL.openai };
  const anthropic = env.ANTHROPIC_API_KEY?.trim();
  if (anthropic) {
    return { provider: 'anthropic', apiKey: anthropic, model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL.anthropic };
  }
  return null;
}

export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export type FailureKind = 'unavailable' | 'rate' | 'refused' | 'upstream' | 'aborted';

export class ProviderError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface StreamParams {
  readonly config: ProviderConfig;
  readonly system: string;
  readonly turns: readonly ChatTurn[];
  readonly signal: AbortSignal;
}

/** A stream of text deltas from whichever provider is configured. */
export type TextStreamer = (params: StreamParams) => AsyncIterable<string>;

export const streamText: TextStreamer = (params) =>
  params.config.provider === 'openai' ? streamOpenAI(params) : streamAnthropic(params);

async function* streamOpenAI({ config, system, turns, signal }: StreamParams): AsyncGenerator<string> {
  const client = new OpenAI({ apiKey: config.apiKey });
  try {
    const stream = await client.chat.completions.create(
      {
        model: config.model,
        messages: [
          { role: 'system', content: system },
          ...turns.map((turn) =>
            turn.role === 'user'
              ? ({ role: 'user', content: turn.text } as const)
              : ({ role: 'assistant', content: turn.text } as const),
          ),
        ],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
      },
      { signal },
    );

    let wrote = false;
    let refusal = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        wrote = true;
        yield delta.content;
      }
      if (delta?.refusal) refusal += delta.refusal;
    }
    if (!wrote && refusal) throw new ProviderError('refused', refusal);
  } catch (error) {
    throw mapOpenAIError(error);
  }
}

function mapOpenAIError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof OpenAI.APIUserAbortError) return new ProviderError('aborted', 'aborted');
  // A rejected key is the operator's problem, not the customer's: it is reported
  // to the page only as "unavailable", and logged here for the operator.
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    console.error('[explain] OpenAI rejected the configured key:', error.message);
    return new ProviderError('unavailable', 'provider authentication failed');
  }
  if (error instanceof OpenAI.RateLimitError) return new ProviderError('rate', error.message);
  if (error instanceof OpenAI.APIError) {
    console.error('[explain] OpenAI error:', error.status, error.message);
    return new ProviderError('upstream', error.message);
  }
  console.error('[explain] OpenAI request failed:', error);
  return new ProviderError('upstream', error instanceof Error ? error.message : String(error));
}

/** Models that accept the server-side refusal fallback. */
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1']);

async function* streamAnthropic({ config, system, turns, signal }: StreamParams): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: config.apiKey });
  try {
    const stream = client.beta.messages.stream(
      {
        model: config.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages: turns.map((turn) => ({ role: turn.role, content: turn.text })),
        cache_control: { type: 'ephemeral' },
        ...(FALLBACK_MODELS.has(config.model)
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new ProviderError('refused', 'refusal');
  } catch (error) {
    throw mapAnthropicError(error);
  }
}

function mapAnthropicError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new ProviderError('aborted', 'aborted');
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    console.error('[explain] Anthropic rejected the configured key:', error.message);
    return new ProviderError('unavailable', 'provider authentication failed');
  }
  if (error instanceof Anthropic.RateLimitError) return new ProviderError('rate', error.message);
  if (error instanceof Anthropic.APIError) {
    console.error('[explain] Anthropic error:', error.status, error.message);
    return new ProviderError('upstream', error.message);
  }
  console.error('[explain] Anthropic request failed:', error);
  return new ProviderError('upstream', error instanceof Error ? error.message : String(error));
}
