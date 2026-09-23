/**
 * A synthetic OBD-2 log generator — for tests only.
 *
 * NOT imported by the application. Hard constraint 1 says the app ships no sample
 * data and computes everything from what the user supplies; this module exists so
 * that the pipeline can be validated against a log whose true answer is known,
 * which is impossible with real logs. It lives under `testing/` and nothing in
 * `src/components` or `src/core` outside this folder may import it.
 *
 * The generator runs the road-load model *forwards*: it takes an engine power
 * curve and integrates the car's motion from it. The analyser then runs the same
 * model backwards from the resulting speed trace. If the two agree, the estimator
 * is unbiased; where they disagree, the difference is the error the thesis has to
 * account for.
 */

import { PHYSICS } from '../constants';
import { airDensity } from '../import';
import { vapourPressureKpa } from '../normalise';
import { makeRng } from '../stats';

export interface SyntheticOptions {
  /** Number of full-throttle pulls in the session. */
  pulls: number;
  /** True engine peak power, hp, before any atmospheric correction. */
  peakHp: number;
  rpmPeak: number;
  /**
   * Fraction of peak power lost at the bottom of the sweep. Raising it makes a
   * tune that trades low-end torque for top-end power.
   */
  lowEndDrop: number;
  /**
   * Optional engine torque curve as (rpm, N·m) points, linearly interpolated. When
   * given it replaces the generic power shape: a turbocharged engine is described
   * by its torque plateau, and a power shape that looks right can imply torque no
   * real engine makes.
   */
  torqueCurveNm?: readonly (readonly [number, number])[];
  rpmStart: number;
  rpmEnd: number;

  massKg: number;
  dragAreaM2: number;
  rollingResistance: number;
  drivetrainEfficiency: number;
  rotationalInertiaFactor: number;
  /** Gear ratio as rpm per m/s. ~150 is a typical 3rd gear. */
  gearRatio: number;

  baroKpa: number;
  iatC: number;
  /** Intake temperature added per pull — the heat-soak knob. */
  iatRisePerPull: number;
  coolantC: number;

  /** Boost the ECU settles at, kPa gauge, and the target it reports. */
  boostKpa: number;
  /** Fraction of target the boost spikes to at spool-up. 0 = none. */
  boostOvershoot: number;
  /** Ripple amplitude as a fraction of target. 0 = none. */
  boostRipple: number;
  /**
   * Fraction by which delivered boost falls short of target above
   * `boostShortfallAboveRpm` — a turbocharger out of flow at the top end. Ramps
   * in over 500 rpm. 0 = none.
   */
  boostShortfall: number;
  boostShortfallAboveRpm: number;

  /** λ the ECU requests. Logged as a target channel; defaults to `lambda`. */
  lambdaTarget?: number;

  lambda: number;
  /** Lambda applied above `leanAboveRpm`, if set — the lean-under-load fault. */
  leanLambda?: number;
  leanAboveRpm?: number;

  timingDeg: number;
  /** Knock retard applied above `knockAboveRpm`, if set. */
  knockRetardDeg?: number;
  knockAboveRpm?: number;

  /** Fuel rail pressure, kPa, and the fraction it droops by at the top end. */
  fuelRailKpa: number;
  railDroopFraction?: number;
  railDroopAboveRpm?: number;

  sampleRateHz: number;
  seed: number;
  /** Speed channel quantisation, km/h. Real OBD-2 speed is 1 km/h. */
  speedQuantisationKmh: number;
  /** Random noise on the speed channel, km/h (1σ). */
  speedNoiseKmh: number;

  /** Header language and CSV dialect. */
  locale: 'en' | 'de';
  /**
   * Which logging tool's header style to imitate. 'autotuner' writes what an
   * Autotuner / Bosch EDC log looks like: millisecond timestamps, absolute
   * "boost" pressure in mbar, rail pressure in bar, the logged gear and the ECU's
   * own calculated torque.
   */
  dialect: 'carScanner' | 'torque' | 'tunerStudio' | 'autotuner';

  /** Gear number written to the log (autotuner dialect). */
  gearNumber: number;
  /**
   * The ECU-reported torque as a multiple of the torque the engine really makes.
   * 1 = an honest torque model; 1.12 = a tune that claims 12% more than it
   * delivers (or a log edited to say so).
   */
  ecuTorqueClaimFactor: number;
}

export const DEFAULT_SYNTHETIC: SyntheticOptions = {
  pulls: 5,
  peakHp: 250,
  rpmPeak: 5000,
  lowEndDrop: 0.35,
  rpmStart: 2000,
  rpmEnd: 5500,

  massKg: 1500,
  dragAreaM2: 0.62,
  rollingResistance: 0.011,
  drivetrainEfficiency: 0.88,
  rotationalInertiaFactor: 1.06,
  gearRatio: 150,

  baroKpa: 101.325,
  iatC: 20,
  iatRisePerPull: 0,
  coolantC: 90,

  boostKpa: 120,
  boostOvershoot: 0,
  boostRipple: 0,
  boostShortfall: 0,
  boostShortfallAboveRpm: 4500,

  lambda: 0.85,
  timingDeg: 12,

  fuelRailKpa: 15000,

  sampleRateHz: 10,
  seed: 12345,
  speedQuantisationKmh: 1,
  speedNoiseKmh: 0.15,

  locale: 'en',
  dialect: 'carScanner',
  gearNumber: 3,
  ecuTorqueClaimFactor: 1,
};

/** Linear interpolation in an (rpm, N·m) torque curve. */
function torqueAt(rpm: number, curve: readonly (readonly [number, number])[]): number {
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (!first || !last) return 0;
  if (rpm <= first[0]) return first[1];
  if (rpm >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i] as readonly [number, number];
    const [r0, t0] = curve[i - 1] as readonly [number, number];
    if (rpm <= r1) return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
  }
  return last[1];
}

/**
 * Engine power at an rpm: from the torque curve when one is given, otherwise a
 * smooth peak at rpmPeak falling away either side — not a real engine, but its
 * true peak is known exactly, which is what a test needs.
 */
function enginePowerHp(rpm: number, o: SyntheticOptions): number {
  if (o.torqueCurveNm) {
    // P = T·ω, in hp.
    return (torqueAt(rpm, o.torqueCurveNm) * rpm * 2 * Math.PI) / 60 / PHYSICS.wattsPerHp;
  }
  const spanLow = o.rpmPeak - o.rpmStart;
  const spanHigh = Math.max(1, o.rpmEnd - o.rpmPeak);
  const x = rpm <= o.rpmPeak ? (rpm - o.rpmPeak) / spanLow : (rpm - o.rpmPeak) / spanHigh;
  // lowEndDrop down at the bottom of the sweep (35% by default), 8% down at the
  // top: the usual shape.
  const drop = rpm <= o.rpmPeak ? o.lowEndDrop : 0.08;
  return o.peakHp * (1 - drop * x * x);
}

interface Sample {
  t: number;
  rpm: number;
  speedKmh: number;
  throttle: number;
  mapKpa: number;
  baroKpa: number;
  boostKpa: number;
  boostTargetKpa: number;
  iatC: number;
  coolantC: number;
  ambientC: number;
  lambda: number;
  lambdaTarget: number;
  timingDeg: number;
  knockDeg: number;
  fuelRailKpa: number;
  fuelRailTargetKpa: number;
  fuelLevel: number;
  gear: number;
  /** The torque the ECU would log: the engine's true torque × the claim factor. */
  ecuTorqueNm: number;
}

/** Integrate one pull and return its samples. */
function simulatePull(o: SyntheticOptions, pullIndex: number, tStart: number, rng: ReturnType<typeof makeRng>): Sample[] {
  const iat = o.iatC + o.iatRisePerPull * pullIndex;
  const rho = airDensity(o.baroKpa, iat, vapourPressureKpa(iat));
  const dtInner = 0.002; // fine integration, then sampled at the logging rate
  const sampleEvery = Math.max(1, Math.round(1 / (o.sampleRateHz * dtInner)));

  let v = o.rpmStart / o.gearRatio;
  let t = 0;
  const samples: Sample[] = [];
  let step = 0;

  while (v * o.gearRatio < o.rpmEnd && t < 60) {
    const rpm = v * o.gearRatio;
    const hp = enginePowerHp(rpm, o);
    const wheelWatts = hp * PHYSICS.wattsPerHp * o.drivetrainEfficiency;
    const force = wheelWatts / Math.max(v, 1);
    const drag = 0.5 * rho * o.dragAreaM2 * v * v;
    const rolling = o.rollingResistance * o.massKg * PHYSICS.gravity;
    const accel = (force - drag - rolling) / (o.massKg * o.rotationalInertiaFactor);

    if (step % sampleEvery === 0) {
      samples.push(sampleAt(o, rpm, v, tStart + t, iat, rng));
    }
    v += accel * dtInner;
    t += dtInner;
    step++;
  }
  return samples;
}

function sampleAt(
  o: SyntheticOptions,
  rpm: number,
  v: number,
  t: number,
  iat: number,
  rng: ReturnType<typeof makeRng>,
): Sample {
  const speedKmh = v * 3.6 + rng.normal() * o.speedNoiseKmh;
  const quantised =
    o.speedQuantisationKmh > 0
      ? Math.round(speedKmh / o.speedQuantisationKmh) * o.speedQuantisationKmh
      : speedKmh;

  // Boost: spools over the first 800 rpm of the sweep, then holds, with optional
  // overshoot at the end of the spool and optional ripple on the plateau.
  const spool = Math.min(1, (rpm - o.rpmStart) / 800);
  let boost = o.boostKpa * spool;
  if (o.boostOvershoot > 0 && spool > 0.7 && spool < 1) {
    boost += o.boostKpa * o.boostOvershoot * Math.sin(((spool - 0.7) / 0.3) * Math.PI);
  }
  if (o.boostRipple > 0 && spool >= 1) {
    boost += o.boostKpa * o.boostRipple * Math.sin(rpm / 60) * Math.SQRT2;
  }
  if (o.boostShortfall > 0 && rpm > o.boostShortfallAboveRpm) {
    const ramp = Math.min(1, (rpm - o.boostShortfallAboveRpm) / 500);
    boost -= o.boostKpa * o.boostShortfall * ramp;
  }

  const lean =
    o.leanLambda !== undefined && o.leanAboveRpm !== undefined && rpm >= o.leanAboveRpm;
  const knocking =
    o.knockRetardDeg !== undefined && o.knockAboveRpm !== undefined && rpm >= o.knockAboveRpm;
  const drooping =
    o.railDroopFraction !== undefined &&
    o.railDroopAboveRpm !== undefined &&
    rpm >= o.railDroopAboveRpm;

  return {
    t,
    rpm: Math.round(rpm),
    speedKmh: quantised,
    throttle: 0.98,
    mapKpa: o.baroKpa + boost,
    baroKpa: o.baroKpa,
    boostKpa: boost,
    boostTargetKpa: o.boostKpa,
    iatC: iat,
    coolantC: o.coolantC,
    ambientC: o.iatC,
    lambda: lean ? (o.leanLambda as number) : o.lambda,
    lambdaTarget: o.lambdaTarget ?? o.lambda,
    timingDeg: o.timingDeg - (knocking ? (o.knockRetardDeg as number) : 0),
    knockDeg: knocking ? (o.knockRetardDeg as number) : 0,
    fuelRailKpa: drooping
      ? o.fuelRailKpa * (1 - (o.railDroopFraction as number))
      : o.fuelRailKpa,
    fuelRailTargetKpa: o.fuelRailKpa,
    fuelLevel: 0.7,
    gear: o.gearNumber,
    ecuTorqueNm: ((enginePowerHp(rpm, o) * PHYSICS.wattsPerHp * 60) / (2 * Math.PI * rpm)) * o.ecuTorqueClaimFactor,
  };
}

/** A coast between pulls: throttle closed, decelerating, so the segmenter can split. */
function simulateCoast(o: SyntheticOptions, last: Sample, tStart: number, seconds: number): Sample[] {
  const samples: Sample[] = [];
  const steps = Math.round(seconds * o.sampleRateHz);
  const dt = 1 / o.sampleRateHz;
  let v = last.speedKmh / 3.6;
  for (let i = 0; i < steps; i++) {
    v = Math.max(o.rpmStart / o.gearRatio, v - 2.5 * dt);
    samples.push({
      ...last,
      t: tStart + i * dt,
      rpm: Math.round(v * o.gearRatio),
      speedKmh: Math.round(v * 3.6),
      throttle: 0.04,
      mapKpa: 35,
      boostKpa: -60,
      lambda: 1.0,
      knockDeg: 0,
      ecuTorqueNm: -40,
    });
  }
  return samples;
}

/** Build a whole session: pull, coast, pull, coast … */
export function generateSession(overrides: Partial<SyntheticOptions> = {}): Sample[] {
  const o: SyntheticOptions = { ...DEFAULT_SYNTHETIC, ...overrides };
  const rng = makeRng(o.seed);
  const samples: Sample[] = [];
  let t = 2;

  for (let p = 0; p < o.pulls; p++) {
    const pull = simulatePull(o, p, t, rng);
    samples.push(...pull);
    const last = pull[pull.length - 1];
    if (!last) continue;
    t = last.t + 1 / o.sampleRateHz;
    const coast = simulateCoast(o, last, t, 8);
    samples.push(...coast);
    const lastCoast = coast[coast.length - 1];
    t = (lastCoast ? lastCoast.t : t) + 1 / o.sampleRateHz;
  }
  return samples;
}

type HeaderSet = Partial<Record<keyof Sample, string>>;

const AUTOTUNER_HEADERS: HeaderSet = {
  t: 'timestamp',
  rpm: 'Engine speed (RPM)',
  speedKmh: 'Vehicle speed (km/h)',
  throttle: 'Gaspedal position (%)',
  mapKpa: 'Boost pressure (mbar)',
  boostTargetKpa: 'Boost pressure setpoint (mbar)',
  baroKpa: 'Ambient pressure (hPa)',
  iatC: 'Intake air temperature (C)',
  coolantC: 'Engine coolant temperature (C)',
  ambientC: 'Ambient air temperature (C)',
  lambda: 'Lambda (AFR) (\u03bb)',
  fuelRailKpa: 'Fuel high pressure (bar)',
  fuelRailTargetKpa: 'Fuel high pressure setpoint (bar)',
  gear: 'Gear (-)',
  ecuTorqueNm: 'Engine torque (Nm)',
};

const HEADERS: Record<
  Exclude<SyntheticOptions['dialect'], 'autotuner'>,
  Record<SyntheticOptions['locale'], HeaderSet>
> = {
  carScanner: {
    en: {
      t: 'Time',
      rpm: 'Engine RPM (rpm)',
      speedKmh: 'Vehicle Speed (km/h)',
      throttle: 'Throttle Position (%)',
      mapKpa: 'Intake Manifold Pressure (kPa)',
      baroKpa: 'Barometric Pressure (kPa)',
      boostKpa: 'Boost (kPa)',
      boostTargetKpa: 'Commanded Boost (kPa)',
      iatC: 'Intake Air Temperature (°C)',
      coolantC: 'Coolant Temperature (°C)',
      ambientC: 'Ambient Air Temperature (°C)',
      lambda: 'Lambda',
      lambdaTarget: 'Lambda Target',
      timingDeg: 'Timing Advance (°)',
      knockDeg: 'Knock Retard (°)',
      fuelRailKpa: 'Fuel Rail Pressure (kPa)',
      fuelRailTargetKpa: 'Fuel Rail Pressure Target (kPa)',
      fuelLevel: 'Fuel Level (%)',
    },
    de: {
      t: 'Zeit',
      rpm: 'Motordrehzahl (U/min)',
      speedKmh: 'Geschwindigkeit (km/h)',
      throttle: 'Drosselklappe (%)',
      mapKpa: 'Saugrohrdruck (kPa)',
      baroKpa: 'Luftdruck (kPa)',
      boostKpa: 'Ladedruck (kPa)',
      boostTargetKpa: 'Ladedruck Soll (kPa)',
      iatC: 'Ansauglufttemperatur (°C)',
      coolantC: 'Kühlmitteltemperatur (°C)',
      ambientC: 'Außentemperatur (°C)',
      lambda: 'Lambdawert',
      lambdaTarget: 'Lambda Soll',
      timingDeg: 'Zündwinkel (°)',
      knockDeg: 'Klopfregelung (°)',
      fuelRailKpa: 'Kraftstoffdruck (kPa)',
      fuelRailTargetKpa: 'Raildruck Soll (kPa)',
      fuelLevel: 'Tankinhalt (%)',
    },
  },
  torque: {
    en: {
      t: 'Device Time',
      rpm: 'Engine RPM(rpm)',
      speedKmh: 'Speed (OBD)(km/h)',
      throttle: 'Absolute Throttle Position B(%)',
      mapKpa: 'Manifold Absolute Pressure(kPa)',
      baroKpa: 'Barometric Pressure(kPa)',
      boostKpa: 'Turbo Boost(kPa)',
      boostTargetKpa: 'Commanded Boost(kPa)',
      iatC: 'Intake Air Temperature(°C)',
      coolantC: 'Engine Coolant Temperature(°C)',
      ambientC: 'Ambient Air Temperature(°C)',
      lambda: 'O2 Sensor WR Lambda',
      lambdaTarget: 'Target Lambda',
      timingDeg: 'Timing Advance(°)',
      knockDeg: 'Knock Retard(°)',
      fuelRailKpa: 'Fuel Rail Pressure(kPa)',
      fuelRailTargetKpa: 'Target Rail Pressure(kPa)',
      fuelLevel: 'Fuel Level(%)',
    },
    de: {
      t: 'Zeit',
      rpm: 'Drehzahl(U/min)',
      speedKmh: 'Fahrzeuggeschwindigkeit(km/h)',
      throttle: 'Drosselklappenstellung(%)',
      mapKpa: 'Absoluter Saugrohrdruck(kPa)',
      baroKpa: 'Umgebungsdruck(kPa)',
      boostKpa: 'Turbodruck(kPa)',
      boostTargetKpa: 'Sollladedruck(kPa)',
      iatC: 'Ladelufttemperatur(°C)',
      coolantC: 'Motortemperatur(°C)',
      ambientC: 'Umgebungstemperatur(°C)',
      lambda: 'Luftverhältnis',
      lambdaTarget: 'Solllambda',
      timingDeg: 'Zündzeitpunkt(°)',
      knockDeg: 'Zündwinkelrücknahme(°)',
      fuelRailKpa: 'Raildruck(kPa)',
      fuelRailTargetKpa: 'Sollraildruck(kPa)',
      fuelLevel: 'Tankfüllstand(%)',
    },
  },
  tunerStudio: {
    en: {
      t: 'Time',
      rpm: 'RPM',
      speedKmh: 'Vehicle Speed',
      throttle: 'TPS',
      mapKpa: 'MAP',
      baroKpa: 'Baro',
      boostKpa: 'Boost',
      boostTargetKpa: 'Boost Target',
      iatC: 'MAT',
      coolantC: 'Coolant Temperature',
      ambientC: 'Ambient Temperature',
      lambda: 'AFR',
      lambdaTarget: 'AFR Target',
      timingDeg: 'Ignition Advance',
      knockDeg: 'Knock Correction',
      fuelRailKpa: 'Fuel Pressure (kPa)',
      fuelRailTargetKpa: 'Desired Fuel Pressure (kPa)',
      fuelLevel: 'Fuel Level',
    },
    de: {
      t: 'Zeit',
      rpm: 'Drehzahl',
      speedKmh: 'Geschwindigkeit',
      throttle: 'Drosselklappe',
      mapKpa: 'Saugrohrdruck',
      baroKpa: 'Luftdruck',
      boostKpa: 'Ladedruck',
      boostTargetKpa: 'Solladedruck',
      iatC: 'Ansauglufttemperatur',
      coolantC: 'Kühlmitteltemperatur',
      ambientC: 'Außentemperatur',
      lambda: 'AFR',
      lambdaTarget: 'AFR Target',
      timingDeg: 'Zündwinkel',
      knockDeg: 'Klopfrücknahme',
      fuelRailKpa: 'Kraftstoffdruck (kPa)',
      fuelRailTargetKpa: 'Sollraildruck (kPa)',
      fuelLevel: 'Tankinhalt',
    },
  },
};

const KEYS: (keyof Sample)[] = [
  't',
  'rpm',
  'speedKmh',
  'throttle',
  'mapKpa',
  'baroKpa',
  'boostKpa',
  'boostTargetKpa',
  'iatC',
  'coolantC',
  'ambientC',
  'lambda',
  'lambdaTarget',
  'timingDeg',
  'knockDeg',
  'fuelRailKpa',
  'fuelRailTargetKpa',
  'fuelLevel',
];

/** Render a session as CSV in the requested dialect. */
export function generateCsv(overrides: Partial<SyntheticOptions> = {}): string {
  const o: SyntheticOptions = { ...DEFAULT_SYNTHETIC, ...overrides };
  const samples = generateSession(o);
  const autotuner = o.dialect === 'autotuner';
  const headers: HeaderSet = autotuner ? AUTOTUNER_HEADERS : HEADERS[o.dialect as Exclude<SyntheticOptions['dialect'], 'autotuner'>][o.locale];
  const keys = (autotuner ? (Object.keys(AUTOTUNER_HEADERS) as (keyof Sample)[]) : KEYS).filter((k) => headers[k]);
  const delimiter = o.locale === 'de' && !autotuner ? ';' : ',';
  const decimal = o.locale === 'de' && !autotuner ? ',' : '.';

  const format = (key: keyof Sample, sample: Sample): string => {
    let value = sample[key];
    if (autotuner) {
      // Autotuner's units: ms, absolute mbar, hPa, bar.
      if (key === 't') return Math.round(value * 1000).toString();
      if (key === 'mapKpa') value = value * 10;
      if (key === 'boostTargetKpa') value = (value + sample.baroKpa) * 10;
      if (key === 'baroKpa') value = value * 10;
      if (key === 'fuelRailKpa' || key === 'fuelRailTargetKpa') value = value / 100;
    }
    // Percent channels are written as percentages; λ as AFR where the dialect says so.
    if (key === 'throttle' || key === 'fuelLevel') value = value * 100;
    if ((key === 'lambda' || key === 'lambdaTarget') && o.dialect === 'tunerStudio') value = value * 14.7;
    const digits = key === 'rpm' ? 0 : key === 'lambda' || key === 'lambdaTarget' ? 3 : 2;
    return value.toFixed(digits).replace('.', decimal);
  };

  const lines: string[] = [];
  lines.push(keys.map((k) => headers[k]).join(delimiter));
  for (const sample of samples) {
    lines.push(keys.map((k) => format(k, sample)).join(delimiter));
  }
  return lines.join('\n');
}

/** The true peak engine power of a generated session, hp, before correction. */
export function truePeakHp(overrides: Partial<SyntheticOptions> = {}): number {
  const o: SyntheticOptions = { ...DEFAULT_SYNTHETIC, ...overrides };
  let peak = 0;
  for (let rpm = o.rpmStart; rpm <= o.rpmEnd; rpm += 10) {
    peak = Math.max(peak, enginePowerHp(rpm, o));
  }
  return peak;
}
