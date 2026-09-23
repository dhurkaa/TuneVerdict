import { describe, expect, it } from 'vitest';
import { importCsv } from './import';
import { correctionFactor } from './normalise';
import { analyse, AnalysisError } from './pipeline';
import { DEFAULT_SYNTHETIC, generateCsv, truePeakHp } from './testing/synthetic';
import type { VehicleParameters } from './types';

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

/** What the analyser should report for a session generated with these options. */
function expectedCorrectedHp(overrides: Parameters<typeof generateCsv>[0] = {}): number {
  const options = { ...DEFAULT_SYNTHETIC, ...overrides };
  const factor = correctionFactor('SAE J1349', options.baroKpa, options.iatC).factor;
  return truePeakHp(options) * factor;
}

function run(
  beforeOverrides: Parameters<typeof generateCsv>[0] = {},
  afterOverrides: Parameters<typeof generateCsv>[0] = {},
) {
  const before = importCsv(generateCsv({ seed: 101, ...beforeOverrides }), 'before.csv');
  const after = importCsv(generateCsv({ seed: 202, ...afterOverrides }), 'after.csv');
  return analyse(before.session, after.session, VEHICLE, { monteCarloDraws: 1500 });
}

/** The same clean pair of sessions, analysed with a different vehicle description. */
function runWith(vehicle: VehicleParameters) {
  const before = importCsv(generateCsv({ seed: 101 }), 'before.csv');
  const after = importCsv(generateCsv({ seed: 202 }), 'after.csv');
  return analyse(before.session, after.session, vehicle, { monteCarloDraws: 1500 });
}

describe('end-to-end: segmentation', () => {
  it('finds every pull that was generated', () => {
    const result = run({ pulls: 5 }, { pulls: 5 });
    expect(result.before.acceptedPulls).toBe(5);
    expect(result.after.acceptedPulls).toBe(5);
  });

  it('classifies both sessions into the same gear', () => {
    const result = run();
    expect(result.before.gear).toBe(result.after.gear);
    expect(result.before.gear).toBeGreaterThan(0);
  });

  it('refuses to analyse a session with no usable pull at all', () => {
    // A log of part-throttle cruising contains nothing to measure power from.
    const csv = generateCsv({ seed: 101 });
    const lines = csv.split('\n');
    const throttleColumn = (lines[0] as string).split(',').findIndex((h) => h.startsWith('Throttle'));
    const cruise = lines
      .map((line, i) => {
        if (i === 0) return line;
        const cells = line.split(',');
        cells[throttleColumn] = '30.00';
        return cells.join(',');
      })
      .join('\n');
    const before = importCsv(cruise, 'cruise.csv');
    const after = importCsv(generateCsv({ seed: 202 }), 'after.csv');
    expect(() => analyse(before.session, after.session, VEHICLE, { monteCarloDraws: 200 })).toThrow(AnalysisError);
  });

  it('analyses a session with fewer pulls than the statistics need, and says the scatter was assumed', () => {
    const result = run({ pulls: 2 }, { pulls: 5 });
    expect(result.before.acceptedPulls).toBe(2);
    expect(result.violations.some((v) => v.key === 'protocol.assumedScatter')).toBe(true);
  });
});

describe('end-to-end: single-pull logs', () => {
  it('proves a real gain from one pull per session, using the assumed scatter', () => {
    const result = run({ pulls: 1, peakHp: 220 }, { pulls: 1, peakHp: 260 });
    expect(result.gain.significant).toBe(true);
    expect(result.gain.delta.lo).toBeGreaterThan(0);
  });

  it('does not call a small single-pull difference proven', () => {
    // One pull against one pull cannot resolve 2%: the assumed 3% scatter says so.
    const result = run({ pulls: 1, peakHp: 250 }, { pulls: 1, peakHp: 255 });
    expect(result.gain.significant).toBe(false);
  });

  it('widens the interval beyond what the parameters alone would give', () => {
    const single = run({ pulls: 1, peakHp: 220 }, { pulls: 1, peakHp: 260 });
    const many = run({ pulls: 5, peakHp: 220 }, { pulls: 5, peakHp: 260 });
    expect(single.gain.delta.sd).toBeGreaterThan(many.gain.delta.sd);
  });
});

describe('end-to-end: power estimation', () => {
  it('recovers the true peak power of a known synthetic engine', () => {
    const result = run();
    const expected = expectedCorrectedHp();
    // The road-load model is inverted from a quantised speed trace, so exactness is
    // not on offer; what matters is that the bias is small relative to the
    // uncertainty the application itself reports.
    expect(result.after.peakPower.value).toBeGreaterThan(expected * 0.94);
    expect(result.after.peakPower.value).toBeLessThan(expected * 1.06);
  });

  it('reports an interval that contains its own point estimate', () => {
    const result = run();
    expect(result.after.peakPower.lo).toBeLessThan(result.after.peakPower.value);
    expect(result.after.peakPower.hi).toBeGreaterThan(result.after.peakPower.value);
    expect(result.after.peakPower.sd).toBeGreaterThan(0);
  });

  it('measures a real gain and calls it significant', () => {
    const result = run({ peakHp: 220 }, { peakHp: 260 });
    expect(result.gain.delta.value).toBeGreaterThan(30);
    expect(result.gain.delta.value).toBeLessThan(50);
    expect(result.gain.significant).toBe(true);
    expect(result.gain.delta.lo).toBeGreaterThan(0);
  });

  it('does not invent a gain between two sessions of the same tune', () => {
    // The placebo case. Same engine, different seeds — the answer must be "no
    // proven difference", not a small confident one.
    const result = run({ peakHp: 250, seed: 1 }, { peakHp: 250, seed: 2 });
    expect(Math.abs(result.gain.delta.value)).toBeLessThan(5);
    expect(result.gain.significant).toBe(false);
    expect(result.validity.verdict).toBe('inconclusive');
  });

  it('cancels common-mode error, so the difference is better determined than either figure', () => {
    const result = run({ peakHp: 220 }, { peakHp: 260 });
    // Both sessions are the same car on the same road: the mass, drag and
    // efficiency errors are shared and largely cancel in the difference.
    expect(result.gain.commonModeCancellation).toBeGreaterThan(1.5);
  });

  it('puts mass at the top of the uncertainty budget when the car was not weighed', () => {
    // This reproduces the reference budget: mass 62%, efficiency 31%. It is the
    // evidence behind the instruction the UI gives the user — weigh the car, do
    // not assume its mass.
    const result = runWith({ ...VEHICLE, massWeighed: false });
    expect(result.budget[0]?.component).toBe('mass');
    expect(result.budget[0]?.share).toBeGreaterThan(0.5);
    expect(result.budget[1]?.component).toBe('efficiency');
    const total = result.budget.reduce((sum, b) => sum + b.share, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('makes drivetrain efficiency the leading term once the car has been weighed', () => {
    // Weighing the car moves mass from a 5% guess to a 1.44% measurement, at which
    // point it is no longer what limits the answer.
    const result = runWith({ ...VEHICLE, massWeighed: true });
    expect(result.budget[0]?.component).toBe('efficiency');
  });

  it('reports a tighter absolute figure when the car has been weighed', () => {
    const guessed = runWith({ ...VEHICLE, massWeighed: false });
    const weighed = runWith({ ...VEHICLE, massWeighed: true });
    expect(weighed.after.peakPower.sd).toBeLessThan(guessed.after.peakPower.sd);
  });
});

describe('end-to-end: torque', () => {
  it('recovers the true peak torque and where it sits', () => {
    const options = { ...DEFAULT_SYNTHETIC };
    const factor = correctionFactor('SAE J1349', options.baroKpa, options.iatC).factor;
    // True torque curve of the synthetic engine, T = P / ω, over the compared range.
    let trueTorque = 0;
    let trueRpm = 0;
    for (let rpm = 2400; rpm <= 5300; rpm += 10) {
      const x = rpm <= options.rpmPeak ? (rpm - options.rpmPeak) / (options.rpmPeak - options.rpmStart) : (rpm - options.rpmPeak) / (options.rpmEnd - options.rpmPeak);
      const drop = rpm <= options.rpmPeak ? options.lowEndDrop : 0.08;
      const hp = options.peakHp * (1 - drop * x * x) * factor;
      const torque = (hp * 745.699872 * 60) / (2 * Math.PI * rpm);
      if (torque > trueTorque) {
        trueTorque = torque;
        trueRpm = rpm;
      }
    }
    const result = run();
    expect(result.gain.peakTorqueAfter.value).toBeGreaterThan(trueTorque * 0.94);
    expect(result.gain.peakTorqueAfter.value).toBeLessThan(trueTorque * 1.06);
    expect(Math.abs(result.gain.peakRpm.torqueAfter - trueRpm)).toBeLessThanOrEqual(400);
    expect(result.gain.peakTorqueAfter.lo).toBeLessThan(result.gain.peakTorqueAfter.value);
  });

  it('puts the torque peak below the power peak, as on every real engine', () => {
    const result = run();
    expect(result.gain.peakRpm.torqueAfter).toBeLessThan(result.gain.peakRpm.powerAfter);
  });

  it('measures a torque gain alongside the power gain', () => {
    const result = run({ peakHp: 220 }, { peakHp: 260 });
    expect(result.gain.torqueDelta.value).toBeGreaterThan(0);
    expect(result.gain.torqueDelta.lo).toBeGreaterThan(0);
  });
});

describe('end-to-end: reproducibility', () => {
  it('produces an identical result from identical input', () => {
    // The thesis rests on this: same log, same answer tomorrow.
    const a = run({ peakHp: 230 }, { peakHp: 255 });
    const b = run({ peakHp: 230 }, { peakHp: 255 });
    expect(a.seed).toBe(b.seed);
    expect(a.gain.delta.value).toBe(b.gain.delta.value);
    expect(a.gain.delta.lo).toBe(b.gain.delta.lo);
    expect(a.validity.index).toBe(b.validity.index);
  });
});

describe('end-to-end: detectors', () => {
  it('raises no finding on a clean pair of sessions', () => {
    // Zero false alarms is the calibrated behaviour; a detector that fires on a
    // healthy log is worse than no detector.
    const result = run();
    const serious = result.findings.filter((f) => f.severity !== 'info');
    expect(serious).toHaveLength(0);
  });

  it('detects knock in the after session and localises it', () => {
    const result = run({}, { knockRetardDeg: 3, knockAboveRpm: 4500 });
    const knock = result.findings.find((f) => f.kind === 'knock' && f.evidence.session === 'after');
    expect(knock).toBeDefined();
    expect(knock?.severity).toBe('risk');
    expect(knock?.zone.rpmHigh).toBeGreaterThan(4500);
    expect(knock?.evidence.pulls.length).toBeGreaterThanOrEqual(3);
  });

  it('detects a lean mixture under load', () => {
    const result = run({}, { leanLambda: 0.97, leanAboveRpm: 4800 });
    const lean = result.findings.find((f) => f.kind === 'lean' && f.evidence.session === 'after');
    expect(lean).toBeDefined();
    expect(lean?.evidence.peakValue).toBeGreaterThan(0.91);
  });

  it('detects fuel rail droop at the top end', () => {
    const result = run({}, { railDroopFraction: 0.08, railDroopAboveRpm: 4500 });
    const droop = result.findings.find((f) => f.kind === 'fuelRailDroop');
    expect(droop).toBeDefined();
  });

  it('detects boost oscillation', () => {
    const result = run({}, { boostRipple: 0.09 });
    const ripple = result.findings.find((f) => f.kind === 'boostOscillation');
    expect(ripple).toBeDefined();
  });

  it('detects intake heat-soak across a session', () => {
    const result = run({}, { iatRisePerPull: 5 });
    const soak = result.findings.find((f) => f.kind === 'iatHeatSoak');
    expect(soak).toBeDefined();
    expect(soak?.severity).toBe('caution');
  });

  it('never reports a confidence above the Wilson ceiling', () => {
    const result = run({}, { knockRetardDeg: 12, knockAboveRpm: 3000, leanLambda: 1.15, leanAboveRpm: 3000 });
    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      // Ten correct answers out of ten prove accuracy above 0.7225, not above 1.00.
      expect(finding.confidence).toBeLessThanOrEqual(0.7225);
    }
  });
});

describe('end-to-end: validity card', () => {
  it('scores a clean gain well', () => {
    const result = run({ peakHp: 220 }, { peakHp: 255 });
    expect(result.validity.gain).toBeGreaterThan(0.5);
    expect(result.validity.safety).toBe(1);
    expect(result.validity.verdict).toBe('good');
  });

  it('lets a safety finding override a large gain', () => {
    // The product is the argument: a big gain must not buy off knock.
    const clean = run({ peakHp: 220 }, { peakHp: 260 });
    const knocking = run({ peakHp: 220 }, { peakHp: 260, knockRetardDeg: 4, knockAboveRpm: 3500 });
    expect(knocking.validity.safety).toBeLessThan(clean.validity.safety);
    expect(knocking.validity.index).toBeLessThan(clean.validity.index);
  });
});

describe('end-to-end: protocol validation', () => {
  it('flags a temperature mismatch between sessions', () => {
    const result = run({ iatC: 18 }, { iatC: 34 });
    const violation = result.violations.find((v) => v.key === 'protocol.iatMismatch');
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe('risk');
  });

  it('flags a gear mismatch between sessions', () => {
    // Same car, different gear: the single most likely way to get a confident
    // wrong answer.
    const result = run({ gearRatio: 150 }, { gearRatio: 115 });
    const violation = result.violations.find(
      (v) => v.key === 'protocol.gearMismatch' || v.key === 'protocol.ratioMismatch',
    );
    expect(violation).toBeDefined();
  });

  it('flags fewer pulls than the protocol asks for', () => {
    const result = run({ pulls: 3 }, { pulls: 5 });
    expect(result.violations.some((v) => v.key === 'protocol.fewerPullsThanProtocol')).toBe(true);
  });

  it('is quiet when the protocol was followed', () => {
    const result = run();
    expect(result.violations).toHaveLength(0);
  });
});
