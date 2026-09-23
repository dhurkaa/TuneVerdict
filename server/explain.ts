/**
 * POST /api/explain — the only server code in TuneVerdict.
 *
 * The analysis itself still runs entirely in the browser. This endpoint exists for
 * one reason: the AI explanation needs an API key, and a key shipped to the
 * browser is a key published to every visitor. So the browser sends the finished
 * summary and the question here, and this code adds the key and the
 * instructions and relays the answer.
 *
 * Because the operator pays for every request, the endpoint accepts only what the
 * application itself sends:
 *   - the instructions are fixed here; the page cannot replace them;
 *   - the summary mode sends a fixed instruction; only follow-up questions carry
 *     free text, and that text is size-limited;
 *   - the context must parse as a TuneVerdict result;
 *   - each client address gets a bounded number of requests per window.
 * None of this makes a public endpoint abuse-proof — nothing without accounts
 * can — so the operator should also set a monthly spending limit with the
 * provider.
 *
 *   GET  → { available: boolean, model: string | null }
 *   POST { mode: 'summary' | 'question' | 'health', language: 'sq' | 'en', context, turns? }
 *        → 200 text/plain, streamed; or a JSON error with a status code
 */

import { HEALTH_INSTRUCTION, SUMMARY_INSTRUCTION, systemPrompt } from '../src/ai/prompts';
import type { PromptLanguage } from '../src/ai/prompts';
import { ProviderError, streamText } from './providers';
import type { ChatTurn, FailureKind, ProviderConfig, TextStreamer } from './providers';

/** [ENGINEERING] Limits on what a request may carry. */
export const LIMITS = {
  /** The result summary the page sends is ~5–10 kB; 60 kB leaves ample margin. */
  contextChars: 60_000,
  /** A follow-up question. */
  questionChars: 2_000,
  /** An earlier answer being replayed as history. */
  answerChars: 12_000,
  /** Turns in one conversation, including the answers. */
  turns: 12,
  /** Requests per client address per window. */
  requestsPerWindow: 30,
  windowMs: 10 * 60 * 1000,
} as const;

export interface ExplainDeps {
  readonly config: ProviderConfig | null;
  readonly stream?: TextStreamer;
  readonly now?: () => number;
}

type Body = {
  mode: 'summary' | 'question' | 'health';
  language: PromptLanguage;
  context: string;
  turns: ChatTurn[];
};

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly kind: string,
  ) {
    super(kind);
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const FAILURE_STATUS: Record<FailureKind, number> = {
  unavailable: 503,
  rate: 429,
  refused: 422,
  upstream: 502,
  aborted: 499,
};

function parseBody(raw: unknown): Body {
  if (!raw || typeof raw !== 'object') throw new RequestError(400, 'invalid');
  const body = raw as Record<string, unknown>;

  const mode = body.mode;
  if (mode !== 'summary' && mode !== 'question' && mode !== 'health') throw new RequestError(400, 'invalid');
  const language = body.language;
  if (language !== 'sq' && language !== 'en') throw new RequestError(400, 'invalid');

  const context = body.context;
  if (typeof context !== 'string' || context.length === 0 || context.length > LIMITS.contextChars) {
    throw new RequestError(400, 'invalid');
  }
  // The context must be what the application produces, not arbitrary text.
  try {
    const parsed = JSON.parse(context) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || !('verdict' in parsed) || !('power_hp' in parsed)) {
      throw new Error('shape');
    }
    if (mode === 'health' && !('health' in parsed)) throw new Error('shape');
  } catch {
    throw new RequestError(400, 'invalid');
  }

  let turns: ChatTurn[] = [];
  if (mode === 'question') {
    if (!Array.isArray(body.turns) || body.turns.length === 0 || body.turns.length > LIMITS.turns) {
      throw new RequestError(400, 'invalid');
    }
    turns = body.turns.map((turn, index): ChatTurn => {
      const t = turn as Record<string, unknown>;
      const expected = index % 2 === 0 ? 'user' : 'assistant';
      const limit = expected === 'user' ? LIMITS.questionChars : LIMITS.answerChars;
      if (t.role !== expected || typeof t.text !== 'string' || !t.text.trim() || t.text.length > limit) {
        throw new RequestError(400, 'invalid');
      }
      return { role: expected, text: t.text };
    });
    // A conversation sent for an answer must end with the user's question.
    if (turns[turns.length - 1]?.role !== 'user') throw new RequestError(400, 'invalid');
  }

  return { mode, language, context, turns };
}

/** The first user turn carries the analysis; the rest pass through unchanged. */
function withContext(context: string, turns: readonly ChatTurn[]): ChatTurn[] {
  return turns.map((turn, index) =>
    index === 0 ? { role: turn.role, text: `<analysis_result>\n${context}\n</analysis_result>\n\n${turn.text}` } : turn,
  );
}

function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return (forwarded?.split(',')[0] ?? request.headers.get('x-real-ip') ?? 'unknown').trim();
}

export function createExplainHandler({ config, stream = streamText, now = Date.now }: ExplainDeps) {
  // Best effort: each serverless instance keeps its own window, so the real limit
  // across a busy deployment is a multiple of this. It still stops a single
  // client in a loop, which is the common case.
  const windows = new Map<string, { start: number; count: number }>();

  function allow(address: string): boolean {
    const time = now();
    const window = windows.get(address);
    if (!window || time - window.start > LIMITS.windowMs) {
      windows.set(address, { start: time, count: 1 });
      if (windows.size > 10_000) windows.clear();
      return true;
    }
    window.count++;
    return window.count <= LIMITS.requestsPerWindow;
  }

  return async function handle(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      return json(200, { available: config !== null, model: config?.model ?? null });
    }
    if (request.method !== 'POST') return json(405, { error: 'method' }, { allow: 'GET, POST' });
    if (!config) return json(503, { error: 'unavailable' });

    let body: Body;
    try {
      const raw = await request.text();
      if (raw.length > LIMITS.contextChars + LIMITS.turns * LIMITS.answerChars + 1_000) {
        throw new RequestError(413, 'invalid');
      }
      body = parseBody(JSON.parse(raw));
    } catch (error) {
      if (error instanceof RequestError) return json(error.status, { error: error.kind });
      return json(400, { error: 'invalid' });
    }

    if (!allow(clientAddress(request))) return json(429, { error: 'rate' });

    const turns =
      body.mode === 'summary'
        ? withContext(body.context, [{ role: 'user', text: SUMMARY_INSTRUCTION }])
        : body.mode === 'health'
          ? withContext(body.context, [{ role: 'user', text: HEALTH_INSTRUCTION }])
          : withContext(body.context, body.turns);

    const iterator = stream({
      config,
      system: systemPrompt(body.language),
      turns,
      signal: request.signal,
    })[Symbol.asyncIterator]();

    // Wait for the first piece of text before committing to a 200, so a refused
    // key or a refusal becomes a proper error status rather than an empty answer.
    let first: IteratorResult<string>;
    try {
      first = await iterator.next();
    } catch (error) {
      const kind: FailureKind = error instanceof ProviderError ? error.kind : 'upstream';
      return json(FAILURE_STATUS[kind], { error: kind });
    }

    const encoder = new TextEncoder();
    const body$ = new ReadableStream<Uint8Array>({
      start(controller) {
        if (!first.done && first.value) controller.enqueue(encoder.encode(first.value));
        if (first.done) controller.close();
      },
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(next.value));
        } catch {
          // Mid-answer failures end the stream; the page keeps what arrived.
          controller.close();
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    });

    return new Response(body$, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-ai-model': config.model,
      },
    });
  };
}
