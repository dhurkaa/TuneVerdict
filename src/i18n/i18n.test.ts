import { describe, expect, it } from 'vitest';
import { en } from './en';
import { sq } from './sq';

/**
 * The type system already refuses a build in which Albanian is missing a key.
 * These tests cover what it cannot see: a key that exists but was never
 * translated, and a placeholder that survives in one language and not the other —
 * which would print a literal "{delta}" to a user.
 */
describe('translations', () => {
  const keys = Object.keys(en) as (keyof typeof en)[];

  it('covers every key in both languages', () => {
    expect(keys.length).toBeGreaterThan(150);
    for (const key of keys) {
      expect(sq[key], `missing Albanian for ${key}`).toBeTruthy();
    }
  });

  it('uses the same placeholders in both languages', () => {
    const placeholders = (text: string): string[] =>
      (text.match(/\{(\w+)\}/g) ?? []).sort();

    for (const key of keys) {
      expect(placeholders(sq[key]), `placeholder mismatch in ${key}`).toEqual(
        placeholders(en[key]),
      );
    }
  });

  it('does not leave English text sitting in the Albanian dictionary', () => {
    // Proper nouns, units and standard names are the same in both languages and
    // are expected to match; prose is not.
    const shared = new Set([
      'app.title',
      'import.fuel.e85',
      'import.fuel.lpg',
      'report.title',
      'unit.hp',
      'unit.celsius',
      'unit.kpa',
      'unit.bar',
      'unit.degrees',
      'unit.percent',
      'unit.hz',
      'unit.kg',
      'unit.lambda',
      'unit.seconds',
      'unit.sd',
      'channel.lambda',
      'result.chart.power',
      'common.of',
    ]);

    for (const key of keys) {
      if (shared.has(key)) continue;
      if (en[key].length < 12) continue; // single words often coincide legitimately
      expect(sq[key], `${key} appears untranslated`).not.toBe(en[key]);
    }
  });

  it('keeps the agreed technical vocabulary', () => {
    // These terms are fixed for the thesis; drifting between synonyms across the
    // interface would make the written work and the tool disagree.
    expect(sq['result.findings.pulls']).toContain('tërheqje');
    expect(sq['finding.boostOvershoot']).toContain('Mbipresion');
    expect(sq['channel.timing']).toContain('Paraprirja');
    expect(sq['channel.fuelRail']).toContain('rampës së karburantit');
    expect(sq['finding.lean']).toContain('Përzierje e varfër');
    expect(sq['result.findings.confidence']).toContain('Besueshmëria');
    expect(sq['result.uncertainty.title']).toContain('pasiguria');
    expect(sq['result.validity.consistency']).toContain('Qëndrueshmëria');
  });
});
