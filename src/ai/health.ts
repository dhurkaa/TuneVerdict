/**
 * Reading the AI health report. The model is asked for one JSON object; this
 * accepts it even when wrapped in a code fence or a sentence, and returns null
 * when it is not there — the panel then says so instead of showing half a report.
 */

import { HEALTH_SYSTEMS } from './prompts';

export type HealthSystemNotes = Partial<Record<(typeof HEALTH_SYSTEMS)[number], string>>;

export interface AiHealthReport {
  readonly overall: string;
  readonly systems: HealthSystemNotes;
  readonly checks: readonly string[];
}

export function parseHealthReport(text: string): AiHealthReport | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  if (typeof body.overall !== 'string' || !body.overall.trim()) return null;

  const systems: HealthSystemNotes = {};
  if (body.systems && typeof body.systems === 'object') {
    const given = body.systems as Record<string, unknown>;
    for (const id of HEALTH_SYSTEMS) {
      const note = given[id];
      if (typeof note === 'string' && note.trim()) systems[id] = note.trim();
    }
  }
  const checks = Array.isArray(body.checks)
    ? body.checks.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim())
    : [];
  return { overall: body.overall.trim(), systems, checks };
}
