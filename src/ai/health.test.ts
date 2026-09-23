import { describe, expect, it } from 'vitest';
import { parseHealthReport } from './health';

describe('reading the AI health report', () => {
  it('reads the JSON object, even inside a code fence', () => {
    const text =
      '```json\n{"overall":"Healthy car.","systems":{"turbo":"Boost on target.","nonsense":"x"},"checks":["Check the intercooler hoses."," "]}\n```';
    expect(parseHealthReport(text)).toEqual({
      overall: 'Healthy car.',
      systems: { turbo: 'Boost on target.' },
      checks: ['Check the intercooler hoses.'],
    });
  });

  it('returns null when there is no usable report', () => {
    expect(parseHealthReport('I cannot help with that.')).toBeNull();
    expect(parseHealthReport('{"systems":{}}')).toBeNull();
    expect(parseHealthReport('{"overall": "cut off')).toBeNull();
  });
});
