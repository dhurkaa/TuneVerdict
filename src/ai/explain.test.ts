import { describe, expect, it } from 'vitest';
import { importCsv } from '../core/import';
import { analyse } from '../core/pipeline';
import { DEFAULT_SYNTHETIC, generateCsv } from '../core/testing/synthetic';
import type { VehicleParameters } from '../core/types';
import { en } from '../i18n/en';
import type { TranslationKey } from '../i18n';
import { resultContext } from './explain';
import { SUMMARY_INSTRUCTION, systemPrompt } from './prompts';

const VEHICLE: VehicleParameters = {
  massKg: DEFAULT_SYNTHETIC.massKg,
  massWeighed: true,
  dragAreaM2: DEFAULT_SYNTHETIC.dragAreaM2,
  rollingResistance: DEFAULT_SYNTHETIC.rollingResistance,
  drivetrainEfficiency: DEFAULT_SYNTHETIC.drivetrainEfficiency,
  rotationalInertiaFactor: DEFAULT_SYNTHETIC.rotationalInertiaFactor,
  fuel: 'gasoline',
  correctionStandard: 'SAE J1349',
};

const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
  en[key].replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match));

const beforeCsv = generateCsv({ seed: 11, peakHp: 220 });
const afterCsv = generateCsv({ seed: 12, peakHp: 255, knockRetardDeg: 2.5, knockAboveRpm: 4500 });
const result = analyse(
  importCsv(beforeCsv, 'before.csv').session,
  importCsv(afterCsv, 'after.csv').session,
  VEHICLE,
  { monteCarloDraws: 400 },
);

describe('the context the model is given', () => {
  const context = resultContext(result, { t });
  const parsed = JSON.parse(context);

  it('is the finished summary, not the log', () => {
    // Nothing from the raw CSV may reach the API: only computed results.
    expect(context).not.toContain(beforeCsv.slice(0, 200));
    expect(context).not.toContain('Engine RPM (rpm)');
    expect(context.length).toBeLessThan(20000);
  });

  it('carries the same advice sentences the screen shows', () => {
    expect(parsed.findings[0].whatToDo).toBe(en['advice.knock.action']);
  });

  it('carries the suggested map changes, all toward safety', () => {
    expect(parsed.suggestedMapChanges.length).toBeGreaterThan(0);
    for (const change of parsed.suggestedMapChanges) {
      if (change.table === 'ignition') expect(change.change.startsWith('-')).toBe(true);
    }
  });

  it('carries the verdict and the gain with its interval', () => {
    expect(parsed.verdict.kind).toBe(result.validity.verdict);
    expect(parsed.power_hp.gain.lo95).not.toBeNull();
  });
});

describe('the instructions the model is given', () => {
  it('forbids changing the analysis or suggesting changes toward power', () => {
    const prompt = systemPrompt('en');
    expect(prompt).toMatch(/final/i);
    expect(prompt).toMatch(/do not suggest adding advance, raising boost or leaning the mixture/i);
  });

  it('answers in the interface language', () => {
    expect(systemPrompt('sq')).toContain('Write in Albanian');
    expect(systemPrompt('en')).toContain('Write in English');
  });

  it('keeps the assistant on the subject of the analysis', () => {
    expect(systemPrompt('en')).toMatch(/can only help with the analysis/);
  });

  it('is stable, so repeated questions share a cacheable prefix', () => {
    expect(systemPrompt('en')).toBe(systemPrompt('en'));
  });
});

describe('the automatic summary', () => {
  it('asks for a short list of key messages from the data only', () => {
    expect(SUMMARY_INSTRUCTION).toMatch(/at most five/);
    expect(SUMMARY_INSTRUCTION).toMatch(/only values from the data/i);
  });
});
