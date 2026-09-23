import { describe, expect, it } from 'vitest';
import { ecuFullLoadCurve } from './ecuTorque';
import { importCsv } from './import';
import { analyse } from './pipeline';
import { DEFAULT_SYNTHETIC, generateCsv } from './testing/synthetic';
import type { Session, VehicleParameters } from './types';

/**
 * Logs in the shape an Autotuner / Bosch EDC logger writes them: millisecond
 * timestamps, "Boost pressure" that is really absolute pressure in mbar, rail
 * pressure in bar, the logged gear, and the ECU's own calculated torque.
 */
const VEHICLE: VehicleParameters = {
  massKg: DEFAULT_SYNTHETIC.massKg,
  massWeighed: true,
  dragAreaM2: DEFAULT_SYNTHETIC.dragAreaM2,
  rollingResistance: DEFAULT_SYNTHETIC.rollingResistance,
  drivetrainEfficiency: DEFAULT_SYNTHETIC.drivetrainEfficiency,
  rotationalInertiaFactor: DEFAULT_SYNTHETIC.rotationalInertiaFactor,
  fuel: 'diesel',
  correctionStandard: 'SAE J1349',
};

type Options = Parameters<typeof generateCsv>[0];

const autotuner = (options: Options): string =>
  generateCsv({
    dialect: 'autotuner',
    sampleRateHz: 20,
    pulls: 1,
    lambda: 1.4, // a diesel under load
    lambdaTarget: 1.4,
    fuelRailKpa: 180000, // 1800 bar common rail
    ...options,
  });

function run(before: Options, after: Options) {
  const b = importCsv(autotuner({ seed: 31, ...before }), 'stock.csv', {
    fuel: 'diesel',
  });
  const a = importCsv(autotuner({ seed: 32, ...after }), 'tuned.csv', {
    fuel: 'diesel',
  });
  return analyse(b.session, a.session, VEHICLE, { monteCarloDraws: 600 });
}

describe('importing an Autotuner log', () => {
  const { session, report } = importCsv(autotuner({ seed: 1 }), 'log.csv', {
    fuel: 'diesel',
  });

  it('reads millisecond timestamps as milliseconds', () => {
    // A 20 Hz log whose time column counts 0, 50, 100 … must not read as one
    // sample every 50 seconds.
    expect(report.sourceSampleRateHz).toBeGreaterThan(15);
    expect(report.sourceSampleRateHz).toBeLessThan(25);
    expect(session.durationS).toBeLessThan(120);
  });

  it('recognises the Bosch channel names', () => {
    const channels = report.recognised.map((c) => c.channel);
    for (const id of [
      'rpm',
      'speed',
      'pedal',
      'boostTarget',
      'baro',
      'fuelRail',
      'fuelRailTarget',
      'lambda',
      'gear',
      'ecuTorque',
    ]) {
      expect(channels, id).toContain(id);
    }
  });

  it('turns absolute "boost pressure" into gauge boost, and says so', () => {
    expect(report.assumed.some((a) => a.reason === 'import.assumed.absoluteBoost')).toBe(true);
    const boost = Array.from(session.channels.get('boost') as Float64Array).filter(Number.isFinite);
    // Coasting at ~35 kPa absolute is ~ −66 kPa gauge; full boost ~120 kPa gauge.
    expect(Math.min(...boost)).toBeLessThan(0);
    expect(Math.max(...boost)).toBeGreaterThan(100);
    expect(Math.max(...boost)).toBeLessThan(140);
  });

  it('keeps diesel rail pressure and lambda instead of dropping them as faults', () => {
    const rail = Array.from(session.channels.get('fuelRail') as Float64Array).filter(Number.isFinite);
    expect(rail.length).toBeGreaterThan(0);
    expect(Math.max(...rail)).toBeCloseTo(180000, -3);
    const lambda = Array.from(session.channels.get('lambda') as Float64Array).filter(Number.isFinite);
    expect(lambda.some((v) => v > 1.3)).toBe(true);
  });
});

describe('comparing single-pull Autotuner logs', () => {
  it('runs on one pull per session', () => {
    const result = run({ peakHp: 180 }, { peakHp: 215 });
    expect(result.before.acceptedPulls).toBe(1);
    expect(result.gain.delta.value).toBeGreaterThan(20);
  });

  it('does not run the petrol lean detector on a diesel', () => {
    const result = run({}, {});
    expect(result.findings.some((f) => f.kind === 'lean')).toBe(false);
    expect(result.margins.some((m) => m.limit === 'lean')).toBe(false);
  });

  it('warns when a diesel log is analysed with the fuel set to petrol', () => {
    const b = importCsv(autotuner({ seed: 31 }), 'stock.csv', {
      fuel: 'gasoline',
    });
    const a = importCsv(autotuner({ seed: 32 }), 'tuned.csv', {
      fuel: 'gasoline',
    });
    const result = analyse(b.session, a.session, { ...VEHICLE, fuel: 'gasoline' }, { monteCarloDraws: 300 });
    expect(result.violations.some((v) => v.key === 'protocol.lambdaLooksDiesel')).toBe(true);
  });
});

describe('ECU-reported torque against delivered torque', () => {
  it('confirms a claimed gain the car actually delivered', () => {
    const result = run({ peakHp: 180 }, { peakHp: 215 });
    expect(result.ecu).not.toBeNull();
    expect(result.ecu?.reportedChange.value).toBeGreaterThan(20);
    expect(result.ecu?.agreement).toBe('confirmed');
  });

  it('catches a claimed gain the car did not deliver', () => {
    // Same engine both times; only the ECU's torque figure was raised 12% — what
    // an edited log, or a tune that changed the torque model and nothing else,
    // looks like.
    const result = run({ peakHp: 200 }, { peakHp: 200, ecuTorqueClaimFactor: 1.12 });
    expect(result.ecu?.reportedChange.value).toBeGreaterThan(20);
    expect(Math.abs(result.ecu?.measuredChange.value ?? 99)).toBeLessThan(15);
    expect(result.ecu?.agreement).toBe('notDelivered');
  });

  it('catches a real gain the ECU does not know about', () => {
    // More power, torque model left at stock: the gearbox and limiters work from
    // numbers that are now too low.
    const result = run({ peakHp: 180 }, { peakHp: 220, ecuTorqueClaimFactor: 180 / 220 });
    expect(result.ecu?.agreement).toBe('exceeds');
  });

  it('is absent when the logs carry no ECU torque', () => {
    const b = importCsv(generateCsv({ seed: 1 }), 'b.csv');
    const a = importCsv(generateCsv({ seed: 2 }), 'a.csv');
    expect(analyse(b.session, a.session, { ...VEHICLE, fuel: 'gasoline' }, { monteCarloDraws: 200 }).ecu).toBeNull();
  });
});

describe('the ECU full-load curve', () => {
  // 10 Hz. A kick-down: pedal floored, torque ramping 60 → 390 Nm in one second
  // while rpm jumps. Then a long pull in a higher gear at only 65% pedal — on a
  // turbo-diesel already the torque limiter.
  const t: number[] = [];
  const rpm: number[] = [];
  const pedal: number[] = [];
  const torque: number[] = [];
  const push = (r: number, p: number, T: number) => {
    t.push(t.length / 10);
    rpm.push(r);
    pedal.push(p);
    torque.push(T);
  };
  for (let i = 0; i <= 10; i++) push(2600 + 50 * i, 1, 60 + 33 * i);
  for (let i = 0; i <= 60; i++) push(3100 + 10 * i, 0.65, 380 - 0.05 * i);
  const session: Session = {
    label: 'kickdown.csv',
    t: Float64Array.from(t),
    channels: new Map([
      ['rpm', Float64Array.from(rpm)],
      ['throttle', Float64Array.from(pedal)],
      ['ecuTorque', Float64Array.from(torque)],
    ]),
    provenance: new Map(),
    sourceSampleRateHz: 10,
    sourceRowCount: t.length,
    durationS: t.length / 10,
  };
  const curve = ecuFullLoadCurve(session);

  it('leaves out the torque ramp after a kick-down', () => {
    for (const [r, e] of curve) expect(e.value, `${r} rpm`).toBeGreaterThan(350);
  });

  it('keeps the limiter reached at part pedal', () => {
    expect([...curve.keys()]).toContain(3300);
    expect(curve.get(3300)?.value).toBeCloseTo(379, 0);
  });
});

describe('the protocol window for a diesel', () => {
  it('does not ask a diesel to rev to 5500 rpm', () => {
    const sweep = { pulls: 5, rpmStart: 1450, rpmEnd: 4550, gearRatio: 122 };
    const result = run(sweep, { ...sweep, peakHp: 230 });
    const coverage = result.violations.filter((v) => v.key.startsWith('protocol.rpmCoverage'));
    expect(coverage).toEqual([]);
  });

  it('still flags a diesel sweep that stops short of peak power', () => {
    const sweep = { pulls: 5, rpmStart: 1450, rpmEnd: 3400, gearRatio: 122 };
    const result = run(sweep, sweep);
    expect(result.violations.some((v) => v.key === 'protocol.rpmCoverageHigh')).toBe(true);
  });
});
