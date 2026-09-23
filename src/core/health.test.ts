import { describe, expect, it } from 'vitest';
import { HEALTH_DIESEL_LAMBDA_CONCERN, HEALTH_STATUS_POINTS } from './constants';
import { scoreOf, worst } from './health';
import { importCsv } from './import';
import { analyse } from './pipeline';
import { DEFAULT_SYNTHETIC, generateCsv } from './testing/synthetic';
import type { VehicleParameters } from './types';

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
const diesel: Options = {
  dialect: 'autotuner',
  sampleRateHz: 20,
  pulls: 5,
  rpmStart: 1450,
  rpmEnd: 4550,
  gearRatio: 122,
  lambda: 1.3,
  lambdaTarget: 1.3,
  fuelRailKpa: 200000,
  boostKpa: 200,
};

function run(before: Options, after: Options) {
  const b = importCsv(generateCsv({ seed: 41, ...diesel, ...before }), 'b.csv', { fuel: 'diesel' });
  const a = importCsv(generateCsv({ seed: 42, ...diesel, ...after }), 'a.csv', { fuel: 'diesel' });
  return analyse(b.session, a.session, VEHICLE, { monteCarloDraws: 300 });
}

const system = (result: ReturnType<typeof run>, id: string) => result.health.systems.find((s) => s.id === id);

describe('the health check', () => {
  it('rates a healthy tune healthy, system by system', () => {
    const result = run({ peakHp: 190 }, { peakHp: 215 });
    expect(result.health.label).toBe('healthy');
    for (const id of ['turbo', 'fuel', 'combustion', 'thermal', 'delivery']) {
      expect(system(result, id)?.status, id).toBe('good');
    }
  });

  it('flags a diesel run so rich it smokes', () => {
    const result = run({}, { lambda: HEALTH_DIESEL_LAMBDA_CONCERN - 0.03, lambdaTarget: 1.3 });
    expect(system(result, 'combustion')?.status).toBe('concern');
    expect(system(result, 'combustion')?.statusBefore).toBe('good');
    expect(result.health.score).toBeLessThan(result.health.scoreBefore);
  });

  it('flags a hot cooling system', () => {
    const result = run({}, { coolantC: 108 });
    expect(system(result, 'thermal')?.status).toBe('watch');
  });

  it('flags torque the ECU reports but the car does not deliver', () => {
    const result = run({ peakHp: 200 }, { peakHp: 200, ecuTorqueClaimFactor: 1.12 });
    expect(system(result, 'delivery')?.status).toBe('concern');
  });

  it('flags a turbo that falls short of its target', () => {
    const result = run({}, { boostShortfall: 0.25, boostShortfallAboveRpm: 2200 });
    expect(['watch', 'concern']).toContain(system(result, 'turbo')?.status);
  });
});

describe('scoring', () => {
  it('scores only the systems the log could judge', () => {
    expect(scoreOf([{ status: 'good' }, { status: 'unknown' }])).toBe(HEALTH_STATUS_POINTS.good);
    expect(Number.isNaN(scoreOf([{ status: 'unknown' }]))).toBe(true);
  });

  it('takes the worst known status', () => {
    expect(worst(['good', 'unknown', 'watch'])).toBe('watch');
    expect(worst(['unknown'])).toBe('unknown');
  });
});
