import { describe, expect, it } from 'vitest';
import { ALIAS_COUNT, CHANNELS, normaliseHeader, resolveHeader } from './channels';

describe('channel alias resolution', () => {
  it('carries the alias coverage the architecture asks for', () => {
    // "200+ channel aliases, English and German" is a stated requirement, so it is
    // a test rather than a claim in a comment.
    expect(ALIAS_COUNT).toBeGreaterThanOrEqual(200);
  });

  it('resolves the same channel across four logging tools', () => {
    for (const header of ['Engine RPM', 'Engine RPM(rpm)', 'ENGINE_RPM', 'RPM', 'Motordrehzahl']) {
      expect(resolveHeader(header)?.id).toBe('rpm');
    }
  });

  it('resolves German headers', () => {
    expect(resolveHeader('Ansauglufttemperatur')?.id).toBe('iat');
    expect(resolveHeader('Kühlmitteltemperatur')?.id).toBe('coolant');
    expect(resolveHeader('Klopfregelung')?.id).toBe('knockRetard');
    expect(resolveHeader('Geschwindigkeit')?.id).toBe('speed');
  });

  it('attaches the right default unit to an alias', () => {
    expect(resolveHeader('Speed')?.defaultUnit).toBe('km/h');
    expect(resolveHeader('AFR')?.defaultUnit).toBe('afrGasoline');
    expect(resolveHeader('Lambda')?.defaultUnit).toBe('lambda');
    expect(resolveHeader('Boost')?.defaultUnit).toBe('bar');
  });

  it('normalises decoration, case and umlauts away', () => {
    expect(normaliseHeader('Intake Air Temperature (°C)')).toBe('intakeairtemperature');
    expect(normaliseHeader('ENGINE_RPM')).toBe('enginerpm');
    expect(normaliseHeader('Außentemperatur')).toBe('aussentemperatur');
  });

  it('returns null for a header it does not know, rather than guessing', () => {
    // Guessing is the failure mode that matters: a misidentified channel produces
    // a confident wrong verdict.
    expect(resolveHeader('Cabin Fan Duty')).toBeNull();
    expect(resolveHeader('')).toBeNull();
  });

  it('never maps one alias to two channels', () => {
    const seen = new Map<string, string>();
    for (const spec of CHANNELS) {
      for (const alias of spec.aliases) {
        const text = typeof alias === 'string' ? alias : alias[0];
        const key = normaliseHeader(text);
        const previous = seen.get(key);
        if (previous && previous !== spec.id) {
          throw new Error(`alias "${text}" claimed by both ${previous} and ${spec.id}`);
        }
        seen.set(key, spec.id);
      }
    }
  });
});
