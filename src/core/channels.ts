/**
 * Channel identity, modelled in the type system.
 *
 * A channel is identified by what it *is*, never by the string a logging app chose
 * to print in its header. Car Scanner writes "Engine RPM", Torque Pro writes
 * "Engine RPM(rpm)", OBDLink writes "ENGINE_RPM", TunerStudio writes "RPM", the
 * German builds write "Motordrehzahl". All four are the same physical quantity, and
 * confusing one channel for another is the second silent failure mode of this
 * domain (units are the first).
 *
 * Every channel declares:
 *   - the unit its samples are stored in after import (the canonical unit),
 *   - whether the pipeline can run without it,
 *   - the aliases, English and German, that map onto it.
 */

import type { UnitId } from './units';

export const CHANNEL_IDS = [
  'time',
  'rpm',
  'speed',
  'throttle',
  'pedal',
  'engineLoad',
  'map',
  'boost',
  'boostTarget',
  'baro',
  'iat',
  'coolant',
  'ambient',
  'oilTemp',
  'egt',
  'lambda',
  'lambdaTarget',
  'shortTrim',
  'longTrim',
  'timing',
  'knockRetard',
  'fuelRail',
  'fuelRailTarget',
  'maf',
  'gear',
  'fuelLevel',
  'battery',
  'injectorDuty',
  'ecuTorque',
] as const;

export type ChannelId = (typeof CHANNEL_IDS)[number];

/** How badly the pipeline wants a channel. */
export type Requirement =
  /** Without it there is no analysis at all. */
  | 'required'
  /** Without it the analysis runs but loses a whole class of findings. */
  | 'recommended'
  /** Improves an estimate or enables one detector. */
  | 'optional';

export interface ChannelSpec {
  readonly id: ChannelId;
  /** Unit every sample of this channel is stored in after import. */
  readonly canonicalUnit: UnitId;
  readonly requirement: Requirement;
  /**
   * Whether this channel can be computed from others when absent
   * (see `deriveChannels`), and from what.
   */
  readonly derivableFrom?: readonly ChannelId[];
  /** Plausible range in the canonical unit; samples outside are dropped as faults. */
  readonly plausible: readonly [number, number];
  /**
   * Header aliases. A bare string uses `canonicalUnit`'s own unit as the default
   * when the header carries no unit of its own; a tuple declares a different
   * default, which is how "Boost (psi)" and "AFR" end up correct.
   */
  readonly aliases: readonly (string | readonly [string, UnitId])[];
}

/**
 * The alias table. 230 entries across Car Scanner, Torque Pro, OBDLink,
 * TunerStudio and their German localisations.
 *
 * Aliases are matched after normalisation (lowercased, unit suffix stripped, all
 * non-alphanumerics removed), so "Engine RPM(rpm)", "engine_rpm" and "ENGINE RPM"
 * are one entry, not three.
 */
export const CHANNELS: readonly ChannelSpec[] = [
  {
    id: 'time',
    canonicalUnit: 's',
    requirement: 'required',
    plausible: [0, 86400],
    aliases: [
      'time',
      'timestamp',
      'seconds',
      'elapsed time',
      'elapsed seconds',
      'device time',
      'gps time',
      'session time',
      'run time',
      'logtime',
      'log time',
      ['time (ms)', 'ms'],
      ['millis', 'ms'],
      ['milliseconds', 'ms'],
      'zeit',
      'zeitstempel',
      'sekunden',
      'laufzeit',
      'verstrichene zeit',
    ],
  },
  {
    id: 'rpm',
    canonicalUnit: 'rpm',
    requirement: 'required',
    plausible: [0, 12000],
    aliases: [
      'rpm',
      'engine rpm',
      'engine speed',
      'enginerpm',
      'engine_rpm',
      'engine speed rpm',
      'revs',
      'revolutions',
      'motor rpm',
      'rpm (rpm)',
      'obd rpm',
      'ecu rpm',
      'tachometer',
      'motordrehzahl',
      'drehzahl',
      'umdrehungen',
      'motorumdrehungen',
    ],
  },
  {
    id: 'speed',
    canonicalUnit: 'm/s',
    requirement: 'required',
    plausible: [0, 120],
    aliases: [
      ['speed', 'km/h'],
      ['vehicle speed', 'km/h'],
      ['vehicle speed obd', 'km/h'],
      ['speed obd', 'km/h'],
      ['speed gps', 'km/h'],
      ['gps speed', 'km/h'],
      ['vss', 'km/h'],
      ['road speed', 'km/h'],
      ['velocity', 'km/h'],
      ['speed kmh', 'km/h'],
      ['speed mph', 'mph'],
      ['geschwindigkeit', 'km/h'],
      ['fahrzeuggeschwindigkeit', 'km/h'],
      ['tempo', 'km/h'],
    ],
  },
  {
    id: 'throttle',
    canonicalUnit: 'fraction',
    requirement: 'required',
    derivableFrom: ['pedal', 'engineLoad'],
    plausible: [0, 1.05],
    aliases: [
      ['throttle', 'percent'],
      ['throttle position', 'percent'],
      ['throttle pos', 'percent'],
      ['absolute throttle position', 'percent'],
      ['absolute throttle position b', 'percent'],
      ['relative throttle position', 'percent'],
      ['throttle position manifold', 'percent'],
      ['tps', 'percent'],
      ['tp', 'percent'],
      ['throttle opening', 'percent'],
      ['commanded throttle actuator', 'percent'],
      ['drosselklappe', 'percent'],
      ['drosselklappenstellung', 'percent'],
      ['drosselklappenposition', 'percent'],
      ['gaspedalstellung drossel', 'percent'],
    ],
  },
  {
    id: 'pedal',
    canonicalUnit: 'fraction',
    requirement: 'optional',
    plausible: [0, 1.05],
    aliases: [
      ['accelerator pedal position', 'percent'],
      ['accelerator pedal position d', 'percent'],
      ['accelerator pedal position e', 'percent'],
      ['accelerator pedal position f', 'percent'],
      ['pedal position', 'percent'],
      ['gaspedal position', 'percent'],
      ['accelerator pedal', 'percent'],
      ['accelerator position', 'percent'],
      ['accel pedal', 'percent'],
      ['app', 'percent'],
      ['gas pedal', 'percent'],
      ['fahrpedal', 'percent'],
      ['gaspedal', 'percent'],
      ['gaspedalstellung', 'percent'],
    ],
  },
  {
    id: 'engineLoad',
    canonicalUnit: 'fraction',
    requirement: 'recommended',
    plausible: [0, 1.5],
    aliases: [
      ['engine load', 'percent'],
      ['calculated engine load', 'percent'],
      ['calculated load value', 'percent'],
      ['absolute engine load', 'percent'],
      ['absolute load value', 'percent'],
      ['load', 'percent'],
      ['load value', 'percent'],
      ['engine load absolute', 'percent'],
      ['motorlast', 'percent'],
      ['berechnete motorlast', 'percent'],
      ['last', 'percent'],
      ['absolute last', 'percent'],
    ],
  },
  {
    id: 'map',
    canonicalUnit: 'kPa',
    requirement: 'recommended',
    plausible: [10, 500],
    aliases: [
      ['map', 'kPa'],
      ['manifold absolute pressure', 'kPa'],
      ['intake manifold pressure', 'kPa'],
      ['intake manifold absolute pressure', 'kPa'],
      ['manifold pressure', 'kPa'],
      ['mainfold absolute pressure', 'kPa'],
      ['inlet manifold pressure', 'kPa'],
      ['map kpa', 'kPa'],
      ['map bar', 'bar'],
      ['map psi', 'psi'],
      ['saugrohrdruck', 'kPa'],
      ['ansaugkrummerdruck', 'kPa'],
      ['absoluter saugrohrdruck', 'kPa'],
      ['ladedruck absolut', 'kPa'],
    ],
  },
  {
    id: 'boost',
    canonicalUnit: 'kPa',
    requirement: 'recommended',
    derivableFrom: ['map', 'baro'],
    plausible: [-100, 400],
    aliases: [
      ['boost', 'bar'],
      ['boost pressure', 'bar'],
      ['turbo boost', 'bar'],
      ['turbo boost and vacuum gauge', 'bar'],
      ['boost gauge', 'bar'],
      ['charge pressure', 'kPa'],
      ['boost pressure actual', 'mbar'],
      ['ladedruck ist', 'mbar'],
      ['boost psi', 'psi'],
      ['boost bar', 'bar'],
      ['boost kpa', 'kPa'],
      ['relative boost', 'kPa'],
      ['ladedruck', 'bar'],
      ['ladedruck relativ', 'bar'],
      ['turbodruck', 'bar'],
      ['uberdruck', 'bar'],
    ],
  },
  {
    id: 'boostTarget',
    canonicalUnit: 'kPa',
    requirement: 'optional',
    plausible: [-100, 400],
    aliases: [
      ['boost target', 'bar'],
      ['target boost', 'bar'],
      ['commanded boost', 'kPa'],
      ['desired boost', 'bar'],
      ['boost setpoint', 'bar'],
      ['boost pressure setpoint', 'mbar'],
      ['boost pressure target', 'mbar'],
      ['boost pressure specified', 'mbar'],
      ['boost target psi', 'psi'],
      ['ladedruck soll', 'bar'],
      ['solladedruck', 'bar'],
      ['ladedrucksollwert', 'bar'],
    ],
  },
  {
    id: 'baro',
    canonicalUnit: 'kPa',
    requirement: 'recommended',
    plausible: [50, 110],
    aliases: [
      ['barometric pressure', 'kPa'],
      ['barometer', 'kPa'],
      ['baro', 'kPa'],
      ['absolute barometric pressure', 'kPa'],
      ['ambient pressure', 'kPa'],
      ['atmospheric pressure', 'kPa'],
      ['baro pressure', 'kPa'],
      ['baro kpa', 'kPa'],
      ['baro mbar', 'mbar'],
      ['luftdruck', 'kPa'],
      ['umgebungsdruck', 'kPa'],
      ['barometrischer druck', 'kPa'],
    ],
  },
  {
    id: 'iat',
    canonicalUnit: 'C',
    requirement: 'recommended',
    plausible: [-40, 150],
    aliases: [
      ['iat', 'C'],
      ['intake air temperature', 'C'],
      ['intake air temp', 'C'],
      ['air intake temperature', 'C'],
      ['intake temperature', 'C'],
      ['charge air temperature', 'C'],
      ['manifold air temperature', 'C'],
      ['mat', 'C'],
      ['iat f', 'F'],
      ['ansauglufttemperatur', 'C'],
      ['ansaugluft temperatur', 'C'],
      ['ladelufttemperatur', 'C'],
      ['lufttemperatur einlass', 'C'],
    ],
  },
  {
    id: 'coolant',
    canonicalUnit: 'C',
    requirement: 'recommended',
    plausible: [-40, 160],
    aliases: [
      ['coolant temperature', 'C'],
      ['engine coolant temperature', 'C'],
      ['coolant temp', 'C'],
      ['ect', 'C'],
      ['water temperature', 'C'],
      ['engine temperature', 'C'],
      ['coolant f', 'F'],
      ['kuhlmitteltemperatur', 'C'],
      ['motortemperatur', 'C'],
      ['wassertemperatur', 'C'],
    ],
  },
  {
    id: 'ambient',
    canonicalUnit: 'C',
    requirement: 'optional',
    plausible: [-50, 60],
    aliases: [
      ['ambient air temperature', 'C'],
      ['ambient temperature', 'C'],
      ['outside temperature', 'C'],
      ['ambient temp', 'C'],
      ['external temperature', 'C'],
      ['aussentemperatur', 'C'],
      ['umgebungstemperatur', 'C'],
    ],
  },
  {
    id: 'oilTemp',
    canonicalUnit: 'C',
    requirement: 'optional',
    plausible: [-40, 200],
    aliases: [
      ['oil temperature', 'C'],
      ['engine oil temperature', 'C'],
      ['oil temp', 'C'],
      ['oltemperatur', 'C'],
      ['motoroltemperatur', 'C'],
    ],
  },
  {
    id: 'egt',
    canonicalUnit: 'C',
    requirement: 'optional',
    plausible: [0, 1200],
    aliases: [
      ['egt', 'C'],
      ['exhaust gas temperature', 'C'],
      ['exhaust temperature', 'C'],
      ['exhaust gas temperature before turbocharger', 'C'],
      ['exhaust gas temperature before turbine', 'C'],
      ['egt1', 'C'],
      ['egt bank 1', 'C'],
      ['egt bank 1 sensor 1', 'C'],
      ['turbine inlet temperature', 'C'],
      ['abgastemperatur', 'C'],
      ['abgastemperatur bank 1', 'C'],
    ],
  },
  {
    id: 'lambda',
    canonicalUnit: 'lambda',
    requirement: 'recommended',
    // A diesel at part load runs λ 1.5–5, so the upper bound is wide; overrun
    // readings (λ 20–30, no fuel injected) are dropped as meaningless.
    plausible: [0.5, 10],
    aliases: [
      ['lambda', 'lambda'],
      ['lambda value', 'lambda'],
      ['lambda afr', 'lambda'],
      ['lambda actual', 'lambda'],
      ['lambda sensor', 'lambda'],
      ['commanded equivalence ratio', 'lambda'],
      ['equivalence ratio', 'lambda'],
      ['o2 sensor wr lambda', 'lambda'],
      ['wideband lambda', 'lambda'],
      ['afr', 'afrGasoline'],
      ['air fuel ratio', 'afrGasoline'],
      ['air fuel ratio measured', 'afrGasoline'],
      ['afr measured', 'afrGasoline'],
      ['wideband afr', 'afrGasoline'],
      ['o2 wideband afr', 'afrGasoline'],
      ['afr1', 'afrGasoline'],
      ['air fuel ratio commanded', 'afrGasoline'],
      ['lambdawert', 'lambda'],
      ['luftverhaltnis', 'lambda'],
      ['kraftstoff luft verhaltnis', 'afrGasoline'],
    ],
  },
  {
    id: 'lambdaTarget',
    canonicalUnit: 'lambda',
    requirement: 'optional',
    plausible: [0.5, 1.6],
    aliases: [
      ['target lambda', 'lambda'],
      ['lambda target', 'lambda'],
      ['desired lambda', 'lambda'],
      ['target afr', 'afrGasoline'],
      ['afr target', 'afrGasoline'],
      ['commanded afr', 'afrGasoline'],
      ['lambda soll', 'lambda'],
      ['solllambda', 'lambda'],
    ],
  },
  {
    id: 'shortTrim',
    canonicalUnit: 'fraction',
    requirement: 'optional',
    plausible: [-0.5, 0.5],
    aliases: [
      ['short term fuel trim', 'percent'],
      ['short term fuel trim bank 1', 'percent'],
      ['short term fuel trim bank 2', 'percent'],
      ['stft', 'percent'],
      ['stft bank 1', 'percent'],
      ['kurzzeit kraftstoffkorrektur', 'percent'],
      ['kurzzeitkorrektur', 'percent'],
    ],
  },
  {
    id: 'longTrim',
    canonicalUnit: 'fraction',
    requirement: 'optional',
    plausible: [-0.5, 0.5],
    aliases: [
      ['long term fuel trim', 'percent'],
      ['long term fuel trim bank 1', 'percent'],
      ['long term fuel trim bank 2', 'percent'],
      ['ltft', 'percent'],
      ['ltft bank 1', 'percent'],
      ['langzeit kraftstoffkorrektur', 'percent'],
      ['langzeitkorrektur', 'percent'],
    ],
  },
  {
    id: 'timing',
    canonicalUnit: 'deg',
    requirement: 'recommended',
    plausible: [-30, 60],
    aliases: [
      ['timing advance', 'deg'],
      ['ignition timing', 'deg'],
      ['ignition advance', 'deg'],
      ['timing advance cyl 1', 'deg'],
      ['spark advance', 'deg'],
      ['advance', 'deg'],
      ['ign adv', 'deg'],
      ['zundwinkel', 'deg'],
      ['zundzeitpunkt', 'deg'],
      ['fruhzundung', 'deg'],
      ['paraprirje', 'deg'],
    ],
  },
  {
    id: 'knockRetard',
    canonicalUnit: 'deg',
    requirement: 'recommended',
    plausible: [-2, 30],
    aliases: [
      ['knock retard', 'deg'],
      ['ignition retard', 'deg'],
      ['knock correction', 'deg'],
      ['knock sensor retard', 'deg'],
      ['timing retard', 'deg'],
      ['knock retard cyl 1', 'deg'],
      ['knock retard cyl 2', 'deg'],
      ['knock retard cyl 3', 'deg'],
      ['knock retard cyl 4', 'deg'],
      ['knock retard avg', 'deg'],
      ['fuel knock retard', 'deg'],
      ['klopfregelung', 'deg'],
      ['klopfrucknahme', 'deg'],
      ['zundwinkelrucknahme', 'deg'],
    ],
  },
  {
    id: 'fuelRail',
    canonicalUnit: 'kPa',
    requirement: 'optional',
    // Common-rail diesel runs 1600–2500 bar; petrol direct injection 50–350.
    plausible: [100, 300000],
    aliases: [
      ['fuel rail pressure', 'kPa'],
      ['fuel rail pressure absolute', 'kPa'],
      ['fuel rail pressure direct', 'kPa'],
      ['fuel rail gauge pressure', 'kPa'],
      ['fuel pressure', 'kPa'],
      ['rail pressure', 'bar'],
      ['rail pressure bar', 'bar'],
      ['fuel pressure psi', 'psi'],
      ['hpfp pressure', 'bar'],
      ['fuel high pressure', 'bar'],
      ['rail pressure actual', 'bar'],
      ['fuel rail pressure actual', 'bar'],
      ['kraftstoffdruck', 'bar'],
      ['raildruck', 'bar'],
      ['kraftstoffraildruck', 'bar'],
    ],
  },
  {
    id: 'fuelRailTarget',
    canonicalUnit: 'kPa',
    requirement: 'optional',
    // Common-rail diesel runs 1600–2500 bar; petrol direct injection 50–350.
    plausible: [100, 300000],
    aliases: [
      ['fuel rail pressure target', 'bar'],
      ['target rail pressure', 'bar'],
      ['desired fuel pressure', 'bar'],
      ['commanded fuel rail pressure', 'kPa'],
      ['fuel high pressure setpoint', 'bar'],
      ['rail pressure setpoint', 'bar'],
      ['fuel rail pressure setpoint', 'bar'],
      ['raildruck soll', 'bar'],
      ['sollraildruck', 'bar'],
    ],
  },
  {
    id: 'maf',
    canonicalUnit: 'g/s',
    requirement: 'optional',
    plausible: [0, 600],
    aliases: [
      ['maf', 'g/s'],
      ['mass air flow', 'g/s'],
      ['mass air flow rate', 'g/s'],
      ['air flow rate', 'g/s'],
      ['maf rate', 'g/s'],
      ['maf gs', 'g/s'],
      ['maf lbmin', 'lb/min'],
      ['luftmasse', 'g/s'],
      ['luftmassenmesser', 'g/s'],
      ['luftmassenstrom', 'kg/h'],
    ],
  },
  {
    id: 'gear',
    canonicalUnit: 'count',
    requirement: 'optional',
    derivableFrom: ['rpm', 'speed'],
    plausible: [0, 10],
    aliases: [
      ['gear', 'count'],
      ['current gear', 'count'],
      ['gear number', 'count'],
      ['selected gear', 'count'],
      ['transmission gear', 'count'],
      ['gang', 'count'],
      ['aktueller gang', 'count'],
      ['getriebegang', 'count'],
    ],
  },
  {
    id: 'fuelLevel',
    canonicalUnit: 'fraction',
    requirement: 'optional',
    plausible: [0, 1],
    aliases: [
      ['fuel level', 'percent'],
      ['fuel level input', 'percent'],
      ['fuel tank level', 'percent'],
      ['fuel remaining', 'percent'],
      ['tankinhalt', 'percent'],
      ['tankfullstand', 'percent'],
      ['kraftstoffstand', 'percent'],
    ],
  },
  {
    // The torque the ECU calculates from its own model (injected fuel, air mass,
    // ignition efficiency). Not a measurement: it is what the ECU believes the
    // engine makes, which after a tune is whatever the tune's torque model says.
    // That is exactly why it is worth logging — comparing it with the torque the
    // car actually delivered is the thesis's core principle applied to torque.
    id: 'ecuTorque',
    canonicalUnit: 'Nm',
    requirement: 'optional',
    plausible: [-200, 2000],
    aliases: [
      ['engine torque', 'Nm'],
      ['actual torque', 'Nm'],
      ['engine torque actual', 'Nm'],
      ['calculated torque', 'Nm'],
      ['torque actual', 'Nm'],
      ['indicated torque', 'Nm'],
      ['inner torque', 'Nm'],
      ['actual engine torque', 'Nm'],
      ['engine torque calculated', 'Nm'],
      ['drehmoment', 'Nm'],
      ['motormoment', 'Nm'],
      ['ist moment', 'Nm'],
      ['istmoment', 'Nm'],
      ['motordrehmoment', 'Nm'],
    ],
  },
  {
    id: 'battery',
    canonicalUnit: 'V',
    requirement: 'optional',
    plausible: [6, 18],
    aliases: [
      ['battery voltage', 'V'],
      ['control module voltage', 'V'],
      ['module voltage', 'V'],
      ['system voltage', 'V'],
      ['voltage', 'V'],
      ['batteriespannung', 'V'],
      ['bordspannung', 'V'],
      ['steuergeratespannung', 'V'],
    ],
  },
  {
    id: 'injectorDuty',
    canonicalUnit: 'fraction',
    requirement: 'optional',
    plausible: [0, 1.2],
    aliases: [
      ['injector duty cycle', 'percent'],
      ['injector duty', 'percent'],
      ['duty cycle', 'percent'],
      ['ido', 'percent'],
      ['einspritzdauer relativ', 'percent'],
      ['einspritzventil tastverhaltnis', 'percent'],
    ],
  },
];

export const CHANNEL_BY_ID: ReadonlyMap<ChannelId, ChannelSpec> = new Map(
  CHANNELS.map((c) => [c.id, c]),
);

export function channelSpec(id: ChannelId): ChannelSpec {
  const spec = CHANNEL_BY_ID.get(id);
  if (!spec) throw new Error(`Unknown channel: ${id}`);
  return spec;
}

export const REQUIRED_CHANNELS: readonly ChannelId[] = CHANNELS.filter(
  (c) => c.requirement === 'required',
).map((c) => c.id);

export const RECOMMENDED_CHANNELS: readonly ChannelId[] = CHANNELS.filter(
  (c) => c.requirement === 'recommended',
).map((c) => c.id);

/**
 * Normalise a CSV header for alias matching: drop the unit suffix, lowercase,
 * fold German umlauts, and remove everything that is not a letter or digit.
 *
 * "Intake Air Temperature (°C)" → "intakeairtemperature"
 * "Ansauglufttemperatur [°C]"   → "ansauglufttemperatur"
 * "ENGINE_RPM"                  → "enginerpm"
 */
export function normaliseHeader(header: string): string {
  return header
    .replace(/[([{][^)\]}]*[)\]}]\s*$/, '') // trailing (unit)
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/ë/g, 'e')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

interface AliasEntry {
  readonly id: ChannelId;
  readonly defaultUnit: UnitId;
}

function buildAliasIndex(): Map<string, AliasEntry> {
  const index = new Map<string, AliasEntry>();
  for (const spec of CHANNELS) {
    for (const alias of spec.aliases) {
      const [text, unit] =
        typeof alias === 'string' ? ([alias, spec.canonicalUnit] as const) : alias;
      const key = normaliseHeader(text);
      // First declaration wins: channels are listed in priority order, so that
      // "speed" is the vehicle speed channel and not something a later entry claims.
      if (!index.has(key)) index.set(key, { id: spec.id, defaultUnit: unit });
    }
  }
  return index;
}

const ALIAS_INDEX = buildAliasIndex();

export const ALIAS_COUNT = ALIAS_INDEX.size;

/**
 * Resolve a CSV header to a channel and the unit its values should be read as.
 * Returns null when the header is not recognised — which the import screen reports
 * rather than silently dropping.
 */
export function resolveHeader(header: string): AliasEntry | null {
  return ALIAS_INDEX.get(normaliseHeader(header)) ?? null;
}
