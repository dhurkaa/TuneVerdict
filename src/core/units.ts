/**
 * Units, modelled in the type system.
 *
 * The dangerous bugs in this domain are silent: bar read as kPa, °C added to K,
 * km/h integrated as m/s. None of them throw; they produce a plausible number that
 * is wrong by a factor. So conversion happens exactly once, at the import boundary,
 * and everything downstream works in the canonical unit of its quantity.
 *
 * Canonical units (SI where it does not fight the domain):
 *   time          s
 *   angular speed rpm      — the domain's own unit; converting to rad/s helps nobody
 *   speed         m/s
 *   pressure      kPa      — absolute unless the channel's name says gauge
 *   temperature   °C       — converted to K inside formulas that need it
 *   ratio         fraction — 0…1, never percent
 *   angle         °
 *   mass flow     g/s
 */

/** The physical quantities the importer knows how to convert. */
export type Quantity =
  | 'time'
  | 'angularSpeed'
  | 'speed'
  | 'pressure'
  | 'temperature'
  | 'ratio'
  | 'angle'
  | 'massFlow'
  | 'voltage'
  | 'count'
  | 'ratioDimensionless';

export type UnitId =
  // time
  | 's'
  | 'ms'
  | 'min'
  // angular speed
  | 'rpm'
  // speed
  | 'm/s'
  | 'km/h'
  | 'mph'
  // pressure
  | 'Pa'
  | 'kPa'
  | 'hPa'
  | 'mbar'
  | 'bar'
  | 'psi'
  | 'inHg'
  | 'mmHg'
  | 'atm'
  // temperature
  | 'C'
  | 'F'
  | 'K'
  // ratio
  | 'fraction'
  | 'percent'
  // angle
  | 'deg'
  | 'rad'
  // mass flow
  | 'g/s'
  | 'kg/h'
  | 'lb/min'
  // electrical
  | 'V'
  | 'mV'
  // countable (gear number, cylinder index)
  | 'count'
  // dimensionless
  | 'lambda'
  | 'afrGasoline'
  | 'afrDiesel'
  | 'afrE85'
  | 'afrLpg';

interface UnitSpec {
  readonly quantity: Quantity;
  /** value_in_canonical = value * scale + offset */
  readonly scale: number;
  readonly offset: number;
}

/**
 * Stoichiometric air-fuel ratios, used to turn a logged AFR into λ. Getting the
 * fuel wrong here is a 30% error on the lean detector, which is why the fuel type
 * is part of the unit rather than a global setting.
 */
export const STOICHIOMETRIC_AFR = {
  gasoline: 14.7,
  diesel: 14.5,
  e85: 9.765,
  lpg: 15.6,
} as const;

const UNITS: Record<UnitId, UnitSpec> = {
  // time → s
  s: { quantity: 'time', scale: 1, offset: 0 },
  ms: { quantity: 'time', scale: 1e-3, offset: 0 },
  min: { quantity: 'time', scale: 60, offset: 0 },

  // angular speed → rpm
  rpm: { quantity: 'angularSpeed', scale: 1, offset: 0 },

  // speed → m/s
  'm/s': { quantity: 'speed', scale: 1, offset: 0 },
  'km/h': { quantity: 'speed', scale: 1 / 3.6, offset: 0 },
  mph: { quantity: 'speed', scale: 0.44704, offset: 0 },

  // pressure → kPa
  Pa: { quantity: 'pressure', scale: 1e-3, offset: 0 },
  kPa: { quantity: 'pressure', scale: 1, offset: 0 },
  hPa: { quantity: 'pressure', scale: 0.1, offset: 0 },
  mbar: { quantity: 'pressure', scale: 0.1, offset: 0 },
  bar: { quantity: 'pressure', scale: 100, offset: 0 },
  psi: { quantity: 'pressure', scale: 6.894757293168361, offset: 0 },
  inHg: { quantity: 'pressure', scale: 3.386389, offset: 0 },
  mmHg: { quantity: 'pressure', scale: 0.1333224, offset: 0 },
  atm: { quantity: 'pressure', scale: 101.325, offset: 0 },

  // temperature → °C
  C: { quantity: 'temperature', scale: 1, offset: 0 },
  F: { quantity: 'temperature', scale: 5 / 9, offset: -32 * (5 / 9) },
  K: { quantity: 'temperature', scale: 1, offset: -273.15 },

  // ratio → fraction
  fraction: { quantity: 'ratio', scale: 1, offset: 0 },
  percent: { quantity: 'ratio', scale: 0.01, offset: 0 },

  // angle → °
  deg: { quantity: 'angle', scale: 1, offset: 0 },
  rad: { quantity: 'angle', scale: 180 / Math.PI, offset: 0 },

  // mass flow → g/s
  'g/s': { quantity: 'massFlow', scale: 1, offset: 0 },
  'kg/h': { quantity: 'massFlow', scale: 1000 / 3600, offset: 0 },
  'lb/min': { quantity: 'massFlow', scale: 453.59237 / 60, offset: 0 },

  // electrical → V
  V: { quantity: 'voltage', scale: 1, offset: 0 },
  mV: { quantity: 'voltage', scale: 1e-3, offset: 0 },

  // countable → itself
  count: { quantity: 'count', scale: 1, offset: 0 },

  // dimensionless → λ
  lambda: { quantity: 'ratioDimensionless', scale: 1, offset: 0 },
  afrGasoline: { quantity: 'ratioDimensionless', scale: 1 / STOICHIOMETRIC_AFR.gasoline, offset: 0 },
  afrDiesel: { quantity: 'ratioDimensionless', scale: 1 / STOICHIOMETRIC_AFR.diesel, offset: 0 },
  afrE85: { quantity: 'ratioDimensionless', scale: 1 / STOICHIOMETRIC_AFR.e85, offset: 0 },
  afrLpg: { quantity: 'ratioDimensionless', scale: 1 / STOICHIOMETRIC_AFR.lpg, offset: 0 },
};

export function quantityOf(unit: UnitId): Quantity {
  return UNITS[unit].quantity;
}

/**
 * Convert a value from `unit` into the canonical unit of its quantity.
 * Returns NaN unchanged so that missing samples stay missing.
 */
export function toCanonical(value: number, unit: UnitId): number {
  if (!Number.isFinite(value)) return NaN;
  const spec = UNITS[unit];
  return value * spec.scale + spec.offset;
}

/** Convert out of the canonical unit, for display only. */
export function fromCanonical(value: number, unit: UnitId): number {
  if (!Number.isFinite(value)) return NaN;
  const spec = UNITS[unit];
  return (value - spec.offset) / spec.scale;
}

/** Convert between two units of the same quantity. Throws if they disagree. */
export function convert(value: number, from: UnitId, to: UnitId): number {
  if (UNITS[from].quantity !== UNITS[to].quantity) {
    throw new Error(
      `Refusing to convert ${from} (${UNITS[from].quantity}) to ${to} (${UNITS[to].quantity})`,
    );
  }
  return fromCanonical(toCanonical(value, from), to);
}

export const celsiusToKelvin = (c: number): number => c + 273.15;
export const kelvinToCelsius = (k: number): number => k - 273.15;

/**
 * Unit strings as they actually appear in exported CSV headers, mapped to the unit
 * they mean. Keys are normalised by `normaliseUnitToken` before lookup.
 *
 * German exports (Car Scanner and Torque both localise) write `km/h`, `°C`, `%`,
 * `U/min`, `Grad`; TunerStudio writes `PSI`, `DegC`, `AFR`.
 */
const UNIT_TOKENS: Record<string, UnitId> = {
  // time
  s: 's', sec: 's', secs: 's', second: 's', seconds: 's', sekunden: 's', sek: 's',
  ms: 'ms', millis: 'ms', milliseconds: 'ms',
  min: 'min', mins: 'min', minutes: 'min', minuten: 'min',
  // angular speed
  rpm: 'rpm', umin: 'rpm', upm: 'rpm', revmin: 'rpm', '1min': 'rpm', drehzahl: 'rpm',
  // speed
  ms1: 'm/s', metressecond: 'm/s', meterssecond: 'm/s',
  kmh: 'km/h', kph: 'km/h', kmph: 'km/h', kmhr: 'km/h', stundenkilometer: 'km/h',
  mph: 'mph', mih: 'mph', milesperhour: 'mph',
  // pressure
  pa: 'Pa', pascal: 'Pa',
  kpa: 'kPa', kilopascal: 'kPa',
  hpa: 'hPa', hektopascal: 'hPa',
  mbar: 'mbar', millibar: 'mbar', mb: 'mbar',
  bar: 'bar',
  psi: 'psi', psig: 'psi', lbin2: 'psi',
  inhg: 'inHg', hginch: 'inHg',
  mmhg: 'mmHg', torr: 'mmHg',
  atm: 'atm',
  // temperature
  c: 'C', degc: 'C', celsius: 'C', celcius: 'C', gradc: 'C', grad: 'C',
  f: 'F', degf: 'F', fahrenheit: 'F',
  k: 'K', kelvin: 'K',
  // ratio
  '': 'fraction', fraction: 'fraction', ratio: 'fraction',
  '%': 'percent', percent: 'percent', pct: 'percent', prozent: 'percent',
  // angle
  deg: 'deg', degree: 'deg', degrees: 'deg', btdc: 'deg', crankdegrees: 'deg', kw: 'deg',
  rad: 'rad', radians: 'rad',
  // mass flow
  gs: 'g/s', gramssecond: 'g/s', gsec: 'g/s',
  kgh: 'kg/h', kghr: 'kg/h',
  lbmin: 'lb/min',
  // electrical
  v: 'V', volt: 'V', volts: 'V',
  mv: 'mV', millivolt: 'mV', millivolts: 'mV',
  // dimensionless
  lambda: 'lambda', l: 'lambda',
  afr: 'afrGasoline', afrgasoline: 'afrGasoline', afrpetrol: 'afrGasoline',
  afrdiesel: 'afrDiesel',
  afre85: 'afrE85',
  afrlpg: 'afrLpg',
};

/** Strip decoration so that `(°C)`, `[ °C ]` and `DegC` all reach the same key. */
export function normaliseUnitToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/°/g, '')
    .replace(/[²³]/g, (m) => (m === '²' ? '2' : '3'))
    .replace(/[^a-z0-9%]/g, '');
}

/**
 * Parse a unit out of a CSV header such as `Engine RPM (rpm)`,
 * `Intake Air Temperature [°C]` or `MAP_kPa`. Returns null when the header carries
 * no unit — in which case the channel's declared default applies.
 */
export function parseUnitFromHeader(header: string): UnitId | null {
  const bracketed = header.match(/[([{]([^)\]}]*)[)\]}]\s*$/);
  const candidates: string[] = [];
  if (bracketed && bracketed[1] !== undefined) candidates.push(bracketed[1]);
  const trailing = header.match(/[_\s-]([a-zA-Z°%/]{1,10})\s*$/);
  if (trailing && trailing[1] !== undefined) candidates.push(trailing[1]);

  for (const candidate of candidates) {
    const token = normaliseUnitToken(candidate);
    if (token === '') continue;
    const unit = UNIT_TOKENS[token];
    if (unit) return unit;
  }
  return null;
}

/** Look a unit token up directly, for tests and for manual overrides in the UI. */
export function unitFromToken(token: string): UnitId | null {
  return UNIT_TOKENS[normaliseUnitToken(token)] ?? null;
}
