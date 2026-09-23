import { describe, expect, it } from 'vitest';
import { importCsv } from './import';
import { loggingAdvice } from './loggingAdvice';
import { generateCsv } from './testing/synthetic';

/** An Autotuner diesel log: no knock retard, no ignition advance, no EGT. */
const dieselSession = (seed: number) =>
  importCsv(generateCsv({ dialect: 'autotuner', seed, lambda: 1.3, lambdaTarget: 1.3 }), 'd.csv', { fuel: 'diesel' })
    .session;

describe('what to log next time', () => {
  const before = dieselSession(1);
  const after = dieselSession(2);
  const keys = (fuel: 'diesel' | 'gasoline') => loggingAdvice(before, after, fuel).map((a) => a.key);

  it('does not ask a diesel for knock retard or ignition advance', () => {
    // A compression-ignition engine has neither, so the advice could never be followed.
    expect(keys('diesel')).not.toContain('logging.knockRetard');
    expect(keys('diesel')).not.toContain('logging.timing');
    expect(keys('gasoline')).toContain('logging.knockRetard');
  });

  it('asks a diesel for exhaust gas temperature as a risk, a petrol engine as an extra', () => {
    const severity = (fuel: 'diesel' | 'gasoline') =>
      loggingAdvice(before, after, fuel).find((a) => a.key === 'logging.egt')?.severity;
    expect(severity('diesel')).toBe('risk');
    expect(severity('gasoline')).toBe('info');
  });

  it('names which session is missing the channel', () => {
    const egt = loggingAdvice(before, after, 'diesel').find((a) => a.key === 'logging.egt');
    expect(egt?.session).toBe('both');
    expect(egt?.channel).toBe('egt');
  });
});
