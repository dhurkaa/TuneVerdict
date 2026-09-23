import { describe, expect, it } from 'vitest';
import { CORRECTION_TIMING_MARGIN_DEG, DETECTOR, MARGIN_TIGHT_FRACTION } from './constants';
import { importCsv } from './import';
import { analyse } from './pipeline';
import { DEFAULT_SYNTHETIC, generateCsv } from './testing/synthetic';
import type { AnalysisResult, VehicleParameters } from './types';

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

type Options = Parameters<typeof generateCsv>[0];

function run(beforeOptions: Options = {}, afterOptions: Options = {}, strip: string[] = []): AnalysisResult {
  const load = (options: Options, seed: number, label: string) =>
    importCsv(dropColumns(generateCsv({ seed, ...options }), strip), label).session;
  return analyse(load(beforeOptions, 101, 'before.csv'), load(afterOptions, 202, 'after.csv'), VEHICLE, {
    monteCarloDraws: 800,
  });
}

/** Remove every column whose header starts with one of the given prefixes. */
function dropColumns(csv: string, prefixes: string[]): string {
  if (prefixes.length === 0) return csv;
  const lines = csv.split('\n');
  const headers = (lines[0] as string).split(',');
  const keep = headers.map((h) => !prefixes.some((p) => h.startsWith(p)));
  return lines.map((line) => line.split(',').filter((_, i) => keep[i]).join(',')).join('\n');
}

describe('requested vs delivered', () => {
  it('reports a turbocharger that cannot reach its target at the top end', () => {
    const result = run({}, { boostShortfall: 0.12, boostShortfallAboveRpm: 4500 });
    const boost = result.tracking.find((s) => s.quantity === 'boost' && s.session === 'after');
    expect(boost).toBeDefined();
    const top = boost?.zones.find((z) => z.zone.rpmLow === 5000);
    expect(top?.status).toBe('short');
    expect(top?.error.value).toBeLessThan(-0.05);
  });

  it('calls low-rpm shortfall spool, not a fault', () => {
    // Boost below target while the turbocharger is still building pressure is
    // what turbochargers do; flagging it would be a false alarm on every car.
    const result = run();
    const boost = result.tracking.find((s) => s.quantity === 'boost' && s.session === 'after');
    const bottom = boost?.zones.find((z) => z.zone.rpmLow === 2000);
    expect(bottom?.status === 'spooling' || bottom?.status === 'onTarget').toBe(true);
    for (const zone of boost?.zones ?? []) expect(zone.status).not.toBe('short');
  });

  it('shows a healthy tune on target above spool', () => {
    const result = run();
    const lambda = result.tracking.find((s) => s.quantity === 'lambda' && s.session === 'after');
    expect(lambda?.zones.every((z) => z.status === 'onTarget' || z.status === 'insufficient')).toBe(true);
  });

  it('reconstructs the timing request from advance plus knock retard', () => {
    const result = run({}, { knockRetardDeg: 3, knockAboveRpm: 4000 });
    const timing = result.tracking.find((s) => s.quantity === 'timing' && s.session === 'after');
    expect(timing?.requestSource).toBe('reconstructed');
    const top = timing?.zones.find((z) => z.zone.rpmLow === 4000);
    expect(top?.status).toBe('short');
    expect(top?.error.value).toBeCloseTo(-3, 0);
  });

  it('says nothing about a pair whose target was not logged', () => {
    const result = run({}, {}, ['Lambda Target']);
    expect(result.tracking.some((s) => s.quantity === 'lambda')).toBe(false);
  });
});

describe('correction table', () => {
  it('is empty for a healthy tune', () => {
    expect(run().corrections).toHaveLength(0);
  });

  it('retards ignition by at least what the knock controller took, plus a step', () => {
    const result = run({}, { knockRetardDeg: 2.3, knockAboveRpm: 4500 });
    const ignition = result.corrections.filter((c) => c.parameter === 'ignition');
    expect(ignition.length).toBeGreaterThan(0);
    for (const cell of ignition) {
      expect(cell.unit).toBe('deg');
      expect(cell.change).toBeLessThanOrEqual(-(cell.observed + CORRECTION_TIMING_MARGIN_DEG) + 1e-9);
      expect(cell.rpmHigh).toBeGreaterThan(4500);
    }
  });

  it('enriches a lean cell by the fuel needed to reach the reference', () => {
    const result = run({}, { leanLambda: 0.97, leanAboveRpm: 4800, lambdaTarget: 0.85 });
    const fuel = result.corrections.filter((c) => c.parameter === 'fuel');
    expect(fuel.length).toBeGreaterThan(0);
    for (const cell of fuel) {
      // 0.97 → 0.85 needs 0.97/0.85 − 1 ≈ 14% more fuel.
      expect(cell.change).toBeGreaterThanOrEqual((cell.observed / cell.reference - 1) * 100 - 1e-9);
      expect(cell.change).toBeGreaterThan(10);
    }
  });

  it('never aims for a leaner λ than the WOT reference, even if the map asks for one', () => {
    const result = run({}, { lambda: 0.95, lambdaTarget: 0.95 });
    const fuel = result.corrections.filter((c) => c.parameter === 'fuel');
    expect(fuel.length).toBeGreaterThan(0);
    for (const cell of fuel) expect(cell.reference).toBeLessThanOrEqual(0.85);
  });

  it('lowers an unreachable boost request to what the turbocharger delivers', () => {
    const result = run({}, { boostShortfall: 0.15, boostShortfallAboveRpm: 4500 });
    const boost = result.corrections.filter((c) => c.cause === 'boostShortfall');
    expect(boost.length).toBeGreaterThan(0);
    for (const cell of boost) expect(cell.change).toBeLessThan(0);
  });

  it('lists fuel rail droop as hardware, with no map value', () => {
    const result = run({}, { railDroopFraction: 0.08, railDroopAboveRpm: 4500 });
    const hardware = result.corrections.filter((c) => c.parameter === 'hardware');
    expect(hardware.length).toBeGreaterThan(0);
    for (const cell of hardware) expect(cell.change).toBeNaN();
  });

  it('never suggests more timing, less fuel or more boost', () => {
    // The rule the table exists under: a log can prove harm, not headroom.
    const result = run(
      {},
      {
        knockRetardDeg: 3,
        knockAboveRpm: 3500,
        leanLambda: 1.0,
        leanAboveRpm: 4000,
        boostShortfall: 0.15,
        boostShortfallAboveRpm: 4500,
        boostOvershoot: 0.2,
      },
    );
    expect(result.corrections.length).toBeGreaterThan(0);
    for (const cell of result.corrections) {
      if (cell.parameter === 'ignition') expect(cell.change).toBeLessThan(0);
      if (cell.parameter === 'fuel') expect(cell.change).toBeGreaterThan(0);
      if (cell.parameter === 'boost') expect(cell.change).toBeLessThan(0);
      expect(cell.confidence).toBeLessThanOrEqual(0.7225);
    }
  });

  it('places cells on the manifold-pressure axis when MAP was logged', () => {
    const result = run({}, { knockRetardDeg: 3, knockAboveRpm: 4000 });
    for (const cell of result.corrections) {
      expect(Number.isFinite(cell.loadLowKpa)).toBe(true);
      expect(cell.loadHighKpa - cell.loadLowKpa).toBe(20);
    }
  });
});

describe('safety margins', () => {
  it('measures a healthy λ margin against the lean threshold', () => {
    const result = run({}, { lambda: 0.85 });
    const lean = result.margins.filter((m) => m.limit === 'lean' && m.zone.rpmLow >= 3000);
    for (const cell of lean) {
      expect(cell.status).toBe('ok');
      expect(cell.margin.value).toBeCloseTo((DETECTOR.leanLambda - 0.85) / DETECTOR.leanLambda, 2);
    }
  });

  it('calls a zone tight when it came close without crossing', () => {
    // λ 0.90 against 0.91 fires no finding — and is one warm day from one.
    const result = run({}, { lambda: 0.9, lambdaTarget: 0.9 });
    expect(result.findings.some((f) => f.kind === 'lean')).toBe(false);
    const lean = result.margins.filter((m) => m.limit === 'lean' && m.zone.rpmLow >= 3000);
    expect(lean.every((m) => m.worstMargin < MARGIN_TIGHT_FRACTION)).toBe(true);
    expect(lean.some((m) => m.status === 'tight')).toBe(true);
  });

  it('marks a crossed limit as exceeded', () => {
    const result = run({}, { knockRetardDeg: 2, knockAboveRpm: 4000 });
    const knock = result.margins.find((m) => m.limit === 'knock' && m.zone.rpmLow === 5000);
    expect(knock?.status).toBe('exceeded');
  });

  it('reports a limit it could not measure as unavailable, not as safe', () => {
    const result = run({}, {});
    const egt = result.margins.filter((m) => m.limit === 'egt');
    expect(egt.every((m) => m.status === 'unavailable')).toBe(true);
  });
});

describe('logging advice', () => {
  it('asks for a knock channel when neither log had one', () => {
    const result = run({}, {}, ['Knock Retard']);
    const knock = result.loggingAdvice.find((a) => a.key === 'logging.knockRetard');
    expect(knock?.session).toBe('both');
    expect(knock?.severity).toBe('risk');
  });

  it('names the session that was missing it', () => {
    const before = importCsv(dropColumns(generateCsv({ seed: 1 }), ['Commanded Boost']), 'b.csv').session;
    const after = importCsv(generateCsv({ seed: 2 }), 'a.csv').session;
    const result = analyse(before, after, VEHICLE, { monteCarloDraws: 400 });
    expect(result.loggingAdvice.find((a) => a.key === 'logging.boostTarget')?.session).toBe('before');
  });

  it('flags a slow log', () => {
    const result = run({ sampleRateHz: 5 }, { sampleRateHz: 5 });
    expect(result.loggingAdvice.some((a) => a.key === 'logging.sampleRate')).toBe(true);
  });

  it('puts the dangerous omissions first', () => {
    const result = run({}, {}, ['Knock Retard', 'Lambda Target', 'Commanded Boost']);
    expect(result.loggingAdvice[0]?.severity).toBe('risk');
  });
});

describe('gain across the band', () => {
  it('reports an average gain with its own interval', () => {
    const result = run({ peakHp: 220 }, { peakHp: 260 });
    expect(result.gain.averageDelta.value).toBeGreaterThan(15);
    expect(result.gain.averageDelta.lo).toBeGreaterThan(0);
  });

  it('finds the low-end loss a peak figure hides', () => {
    // More peak power, less torque at the bottom: the peak says "better", the
    // band says where the car is actually driven got worse.
    const result = run(
      { peakHp: 250, lowEndDrop: 0.35 },
      { peakHp: 275, lowEndDrop: 0.6 },
    );
    expect(result.gain.delta.value).toBeGreaterThan(0);
    const loss = result.gain.bands.find((b) => b.kind === 'loss');
    expect(loss).toBeDefined();
    expect(loss?.rpmLow).toBeLessThan(3500);
    expect(result.gain.bands.some((b) => b.kind === 'gain' && b.rpmHigh > 4500)).toBe(true);
  });

  it('proves nothing on a placebo pair', () => {
    const result = run({ peakHp: 250 }, { peakHp: 250 });
    expect(result.gain.bands.some((b) => b.kind === 'gain' && b.rpmHigh - b.rpmLow > 1000)).toBe(false);
  });
});
