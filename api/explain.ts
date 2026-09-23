/**
 * Vercel serverless function: /api/explain.
 *
 * Reads the operator's key from the deployment's environment variables
 * (Project → Settings → Environment Variables: OPENAI_API_KEY) and serves the AI
 * explanation. All logic lives in server/explain.ts so the local dev server runs
 * exactly the same code.
 */

import { createExplainHandler } from '../server/explain';
import { configFromEnv } from '../server/providers';

const handle = createExplainHandler({ config: configFromEnv(process.env) });

export function GET(request: Request): Promise<Response> {
  return handle(request);
}

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
