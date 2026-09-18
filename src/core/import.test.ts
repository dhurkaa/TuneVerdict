import { describe, expect, it } from 'vitest';
import { ImportError, importCsv, parseNumber, parseTimestamp } from './import';
import { generateCsv } from './testing/synthetic';

describe('cell parsing', () => {
  it('reads both decimal conventions', () => {
    expect(parseNumber('1234.5')).toBeCloseTo(1234.5, 6);
    expect(parseNumber('1.234,5')).toBeCloseTo(1234.5, 6);
    expect(parseNumber('1,234.5')).toBeCloseTo(1234.5, 6);
    expect(parseNumber('12,5')).toBeCloseTo(12.5, 6);
  });

  it('treats missing markers as missing, not as zero', () => {
    for (const token of ['', '-', 'NA', 'n/a', 'NaN', 'null', '?']) {
      expect(parseNumber(token)).toBeNaN();
    }
  });

  it('strips a unit printed in the cell', () => {
    expect(parseNumber('95 kPa')).toBeCloseTo(95, 6);
  });

  it('parses timestamps in several shapes', () => {
    expect(parseTimestamp('12.5')).toBeCloseTo(12.5, 6);
    expect(parseTimestamp('01.05.2026 12:00:01.500')).toBeCloseTo(
      parseTimestamp('01.05.2026 12:00:00.500') + 1,
      3,
    );
    expect(Number.isFinite(parseTimestamp('2026-05-01T12:00:00Z'))).toBe(true);
  });
});

describe('schema recognition', () => {
  it('imports a Car Scanner style log', () => {
    const { session, report } = importCsv(generateCsv({ pulls: 2 }), 'before.csv');
    expect(report.missingRequired).toHaveLength(0);
    expect(session.channels.has('rpm')).toBe(true);
    expect(session.channels.has('speed')).toBe(true);
    expect(session.sourceSampleRateHz).toBeCloseTo(10, 0);
  });

  it('imports a German semicolon-delimited log identically', () => {
    const en = importCsv(generateCsv({ pulls: 2, locale: 'en' }), 'en.csv');
    const de = importCsv(generateCsv({ pulls: 2, locale: 'de' }), 'de.csv');

    // Same data, different language and dialect: the recognised channels and the
    // converted values must agree.
    const enRpm = en.session.channels.get('rpm') as Float64Array;
    const deRpm = de.session.channels.get('rpm') as Float64Array;
    expect(deRpm.length).toBe(enRpm.length);
    expect(deRpm[50]).toBeCloseTo(enRpm[50] as number, 6);

    const enSpeed = en.session.channels.get('speed') as Float64Array;
    const deSpeed = de.session.channels.get('speed') as Float64Array;
    expect(deSpeed[50]).toBeCloseTo(enSpeed[50] as number, 6);
  });

  it('imports a Torque Pro style log', () => {
    const { report } = importCsv(generateCsv({ pulls: 2, dialect: 'torque' }), 'torque.csv');
    expect(report.missingRequired).toHaveLength(0);
    expect(report.detectedFormat).toContain('Torque');
  });

  it('converts a TunerStudio AFR column into lambda', () => {
    const { session } = importCsv(
      generateCsv({ pulls: 2, dialect: 'tunerStudio', lambda: 0.85 }),
      'ts.csv',
    );
    const lambda = session.channels.get('lambda') as Float64Array;
    const values = Array.from(lambda).filter((v) => Number.isFinite(v) && v < 0.95);
    expect(values.length).toBeGreaterThan(0);
    expect(values[0]).toBeCloseTo(0.85, 2);
  });

  it('converts throttle from percent to a fraction', () => {
    const { session } = importCsv(generateCsv({ pulls: 2 }), 'x.csv');
    const throttle = session.channels.get('throttle') as Float64Array;
    const peak = Math.max(...Array.from(throttle).filter(Number.isFinite));
    expect(peak).toBeLessThanOrEqual(1.05);
    expect(peak).toBeGreaterThan(0.9);
  });

  it('reports what it did not recognise instead of dropping it silently', () => {
    const csv = generateCsv({ pulls: 2 });
    const [header, ...rows] = csv.split('\n');
    const withExtra = [
      `${header},Cabin Fan Duty`,
      ...rows.map((r) => `${r},42`),
    ].join('\n');

    const { report } = importCsv(withExtra, 'extra.csv');
    expect(report.unrecognised).toContain('Cabin Fan Duty');
  });

  it('derives boost from MAP and barometric pressure, and says so', () => {
    const csv = generateCsv({ pulls: 2 });
    const lines = csv.split('\n');
    const headers = (lines[0] as string).split(',');
    const boostIndex = headers.findIndex((h) => h.startsWith('Boost'));
    const withoutBoost = lines
      .map((line) => line.split(',').filter((_, i) => i !== boostIndex).join(','))
      .join('\n');

    const { session, report } = importCsv(withoutBoost, 'noboost.csv');
    expect(session.provenance.get('boost')).toBe('derived');
    expect(report.derived.some((d) => d.channel === 'boost')).toBe(true);
  });

  it('assumes sea-level pressure when there is no barometer, and records it', () => {
    const csv = generateCsv({ pulls: 2 });
    const lines = csv.split('\n');
    const headers = (lines[0] as string).split(',');
    const baroIndex = headers.findIndex((h) => h.startsWith('Barometric'));
    const withoutBaro = lines
      .map((line) => line.split(',').filter((_, i) => i !== baroIndex).join(','))
      .join('\n');

    const { session, report } = importCsv(withoutBaro, 'nobaro.csv');
    expect(session.provenance.get('baro')).toBe('assumed');
    expect(report.assumed.some((a) => a.channel === 'baro')).toBe(true);
  });

  it('rejects a log that is too slow to resample honestly', () => {
    const csv = generateCsv({ pulls: 2, sampleRateHz: 1 });
    expect(() => importCsv(csv, 'slow.csv')).toThrow(ImportError);
  });

  it('rejects a log with no recognisable rpm channel', () => {
    const csv = ['Time,Vehicle Speed (km/h)', '0,10', '0.1,11', '0.2,12'].join('\n');
    expect(() => importCsv(csv, 'norpm.csv')).toThrow(ImportError);
  });

  it('drops implausible samples rather than averaging them in', () => {
    const csv = generateCsv({ pulls: 2 });
    const lines = csv.split('\n');
    const headers = (lines[0] as string).split(',');
    const iatIndex = headers.findIndex((h) => h.startsWith('Intake Air'));
    const corrupted = lines
      .map((line, i) => {
        if (i === 0 || i % 7 !== 0) return line;
        const cells = line.split(',');
        cells[iatIndex] = '1200.00'; // a dropout code, not a measurement
        return cells.join(',');
      })
      .join('\n');

    const { session, report } = importCsv(corrupted, 'faults.csv');
    const iat = session.channels.get('iat') as Float64Array;
    expect(Math.max(...Array.from(iat).filter(Number.isFinite))).toBeLessThan(150);
    expect(report.droppedSamples).toBeGreaterThan(0);
  });
});
