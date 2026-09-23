/**
 * Stage 1: import and schema recognition.
 *
 * This is the stage that decides whether the rest of the pipeline gets to run, and
 * it is the one the user actually sees. Its contract: recognise as much as it
 * honestly can, convert every recognised column into its canonical unit exactly
 * once, and report precisely what it did not understand. It never guesses a
 * channel it is unsure of, because a misidentified channel produces a confident
 * wrong verdict, which is worse than a refusal.
 */

import Papa from 'papaparse';
import {
  CHANNELS,
  REQUIRED_CHANNELS,
  RECOMMENDED_CHANNELS,
  channelSpec,
  resolveHeader,
  normaliseHeader,
} from './channels';
import type { ChannelId } from './channels';
import {
  ABSOLUTE_BOOST_BARO_FRACTION,
  ABSOLUTE_BOOST_CLOSED_PEDAL_KPA,
  CLOSED_PEDAL_FRACTION,
  MIN_ACCEPTED_SAMPLE_RATE_HZ,
  MS_TIMESTAMP_MIN_STEP,
  TARGET_SAMPLE_RATE_HZ,
  PHYSICS,
} from './constants';
import { estimateSampleRate, resampleLinear, uniformGrid } from './signal';
import { median, quantile } from './stats';
import { parseUnitFromHeader, toCanonical } from './units';
import type { UnitId } from './units';
import type { Provenance, SchemaReport, RecognisedColumn, Session } from './types';

export class ImportError extends Error {
  constructor(
    /** i18n key, so the message can be shown in Albanian or English. */
    readonly key: string,
    readonly detail: Record<string, string | number> = {},
  ) {
    super(key);
    this.name = 'ImportError';
  }
}

export interface ImportOptions {
  /** Fuel type, which decides how a logged AFR becomes λ. */
  readonly fuel?: 'gasoline' | 'diesel' | 'e85' | 'lpg';
}

export interface ImportOutcome {
  readonly session: Session;
  readonly report: SchemaReport;
}

// ---------------------------------------------------------------------------
// Number and time parsing
// ---------------------------------------------------------------------------

const MISSING_TOKENS = new Set(['', '-', 'na', 'n/a', 'nan', 'null', 'none', '--', '?']);

/**
 * Parse a number out of a CSV cell.
 *
 * Handles both decimal conventions: a German export writes "1.234,5" and an
 * English one writes "1,234.5". The separator that appears last is the decimal
 * point — the only rule that gets both right without knowing the locale.
 */
export function parseNumber(raw: string | number | null | undefined): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (raw == null) return NaN;
  const trimmed = raw.trim();
  if (MISSING_TOKENS.has(trimmed.toLowerCase())) return NaN;

  const stripped = trimmed.replace(/[^0-9eE+\-.,]/g, '');
  if (stripped === '') return NaN;

  const lastComma = stripped.lastIndexOf(',');
  const lastDot = stripped.lastIndexOf('.');
  let normalised: string;
  if (lastComma > lastDot) {
    normalised = stripped.replace(/\./g, '').replace(',', '.');
  } else {
    normalised = stripped.replace(/,/g, '');
  }
  const value = Number.parseFloat(normalised);
  return Number.isFinite(value) ? value : NaN;
}

/**
 * Parse a timestamp cell into seconds. Accepts a plain number (already seconds or
 * milliseconds), an ISO timestamp, or the "dd.MM.yyyy HH:mm:ss.SSS" form that the
 * German builds of Car Scanner produce.
 */
export function parseTimestamp(raw: string | number | null | undefined): number {
  if (typeof raw !== 'string') return parseNumber(raw);

  const text = raw.trim();

  // Date-like strings must be recognised *before* the numeric path. Stripping the
  // separators out of "01.05.2026 12:00:01.500" leaves a string that parses
  // perfectly well as the number 1.05 — a silent failure that would turn a Torque
  // "Device Time" column into a two-second session.
  const looksLikeDate = /[:T]/.test(text) || (text.match(/[.\-/]/g) ?? []).length >= 2;
  if (!looksLikeDate) {
    const numeric = parseNumber(text);
    if (Number.isFinite(numeric)) return numeric;
  }

  const german = text.match(
    /^(\d{1,2})[.](\d{1,2})[.](\d{4})[ T](\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/,
  );
  if (german) {
    const [, d, mo, y, h, mi, s, ms] = german;
    const date = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!, ms ? +ms.padEnd(3, '0') : 0);
    return date / 1000;
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed / 1000;

  // A date-like string that no date parser accepted: fall back to the numeric
  // reading rather than losing the column entirely.
  return parseNumber(text);
}

/**
 * Timestamps arrive in seconds, milliseconds or epoch milliseconds depending on
 * the tool. Rescale to seconds.
 *
 * The span alone is not enough: an Autotuner or ECU-flasher log is often only
 * 20–30 seconds long, so its millisecond timestamps span ~20 000 — well inside
 * what a minutes-long log in seconds would span. The sample interval is the
 * reliable signal: no datalogger worth analysing samples less often than every
 * MS_TIMESTAMP_MIN_STEP seconds, so a median step that large means the column is
 * in milliseconds. Without this, a 20 Hz Autotuner log reads as one sample every
 * 48 seconds and is rejected as too slow.
 */
function normaliseTimeScale(times: number[]): number[] {
  const finiteTimes = times.filter(Number.isFinite);
  if (finiteTimes.length < 2) return times;
  const span = Math.max(...finiteTimes) - Math.min(...finiteTimes);
  const steps: number[] = [];
  for (let i = 1; i < finiteTimes.length; i++) {
    const step = (finiteTimes[i] as number) - (finiteTimes[i - 1] as number);
    if (step > 0) steps.push(step);
  }
  steps.sort((a, b) => a - b);
  const medianStep = steps.length > 0 ? (steps[Math.floor(steps.length / 2)] as number) : NaN;
  const scale = span > 100000 || medianStep >= MS_TIMESTAMP_MIN_STEP ? 1e-3 : 1;
  const t0 = Math.min(...finiteTimes) * scale;
  return times.map((t) => (Number.isFinite(t) ? t * scale - t0 : NaN));
}

// ---------------------------------------------------------------------------
// Header row detection
// ---------------------------------------------------------------------------

/**
 * Find the header row. TunerStudio writes a title line and then a units line
 * around its header; some Car Scanner exports lead with a metadata block. The
 * header is whichever of the first rows resolves the most channels — a criterion
 * that does not need to know which tool wrote the file.
 */
function findHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 12);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    if (row.length < 2) continue;
    let score = 0;
    for (const cell of row) {
      if (resolveHeader(cell)) score += 2;
      else if (cell.trim() !== '' && Number.isNaN(Number(cell))) score += 0;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** A best-effort name for the source tool, shown in the schema report. */
function detectFormat(headers: readonly string[]): string {
  const keys = new Set(headers.map(normaliseHeader));
  if (keys.has('devicetime')) return 'Torque Pro';
  if (keys.has('gpstime') || keys.has('gpsspeed')) return 'Torque Pro / OBDLink';
  if (keys.has('time') && keys.has('enginerpm') && keys.has('vehiclespeed')) return 'Car Scanner';
  if (keys.has('zeit') || keys.has('motordrehzahl')) return 'Car Scanner (DE)';
  if (keys.has('rpm') && (keys.has('map') || keys.has('afr'))) return 'TunerStudio';
  return 'generic CSV';
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

interface Column {
  readonly header: string;
  readonly channel: ChannelId;
  readonly unit: UnitId;
  readonly values: number[];
  validSamples: number;
}

export function importCsv(text: string, label: string, options: ImportOptions = {}): ImportOutcome {
  const parsed = Papa.parse<string[]>(text.trim(), {
    skipEmptyLines: 'greedy',
    delimiter: '', // PapaParse sniffs ',', ';' and tab, which covers every target tool
  });

  const rows = (parsed.data as string[][]).filter((r) => r.length > 1);
  if (rows.length < 2) throw new ImportError('import.error.empty', { label });

  const headerIndex = findHeaderRow(rows);
  const headers = (rows[headerIndex] ?? []).map((h) => String(h ?? '').trim());
  const dataRows = rows.slice(headerIndex + 1);
  if (dataRows.length < 10) throw new ImportError('import.error.tooFewRows', { label, rows: dataRows.length });

  // --- resolve columns -----------------------------------------------------
  const columns: Column[] = [];
  const unrecognised: string[] = [];
  const claimed = new Set<ChannelId>();

  headers.forEach((header, columnIndex) => {
    if (header === '') return;
    const match = resolveHeader(header);
    if (!match) {
      unrecognised.push(header);
      return;
    }
    // A second column claiming an already-claimed channel is reported as
    // unrecognised rather than silently overwriting the first. Torque exports both
    // "Speed (OBD)" and "Speed (GPS)"; the first listed alias wins by design.
    if (claimed.has(match.id)) {
      unrecognised.push(header);
      return;
    }
    claimed.add(match.id);

    const headerUnit = parseUnitFromHeader(header);
    const unit = resolveUnit(headerUnit ?? match.defaultUnit, options.fuel);
    const spec = channelSpec(match.id);
    const [min, max] = spec.plausible;

    const values: number[] = new Array(dataRows.length);
    let valid = 0;
    for (let r = 0; r < dataRows.length; r++) {
      const cell = (dataRows[r] ?? [])[columnIndex];
      const raw = match.id === 'time' ? parseTimestamp(cell) : parseNumber(cell);
      if (!Number.isFinite(raw)) {
        values[r] = NaN;
        continue;
      }
      const converted = match.id === 'time' ? raw : toCanonical(raw, unit);
      // Out-of-range samples are sensor faults, not measurements: an IAT of 1200 °C
      // or a speed of 900 km/h is a dropout code, and averaging it in would move
      // the result by more than the tune does.
      if (match.id !== 'time' && (converted < min || converted > max)) {
        values[r] = NaN;
        continue;
      }
      values[r] = converted;
      valid++;
    }
    columns.push({ header, channel: match.id, unit, values, validSamples: valid });
  });

  // --- time base -----------------------------------------------------------
  const timeColumn = columns.find((c) => c.channel === 'time');
  if (!timeColumn) throw new ImportError('import.error.noTime', { label });

  const times = normaliseTimeScale(timeColumn.values);
  const sourceRateHz = estimateSampleRate(times.filter(Number.isFinite));
  if (!Number.isFinite(sourceRateHz)) throw new ImportError('import.error.noTime', { label });
  if (sourceRateHz < MIN_ACCEPTED_SAMPLE_RATE_HZ) {
    throw new ImportError('import.error.sampleRate', {
      label,
      rate: Number(sourceRateHz.toFixed(2)),
      minimum: MIN_ACCEPTED_SAMPLE_RATE_HZ,
    });
  }

  const finiteTimes = times.filter(Number.isFinite);
  const grid = uniformGrid(0, Math.max(...finiteTimes), TARGET_SAMPLE_RATE_HZ);

  // --- resample ------------------------------------------------------------
  const channels = new Map<ChannelId, Float64Array>();
  const provenance = new Map<ChannelId, Provenance>();
  let droppedSamples = 0;

  for (const column of columns) {
    if (column.channel === 'time') continue;
    droppedSamples += column.values.length - column.validSamples;
    channels.set(column.channel, resampleLinear(times, column.values, grid));
    provenance.set(column.channel, 'measured');
  }
  channels.set('time', grid);
  provenance.set('time', 'measured');

  // --- derive what is missing but computable -------------------------------
  const derived: { channel: ChannelId; from: readonly ChannelId[] }[] = [];
  const assumed: { channel: ChannelId; reason: string }[] = [];
  deriveChannels(channels, provenance, derived, assumed, grid.length);

  const missingRequired = REQUIRED_CHANNELS.filter((id) => !channels.has(id));
  if (missingRequired.length > 0) {
    throw new ImportError('import.error.missingRequired', {
      label,
      channels: missingRequired.join(', '),
    });
  }
  const missingRecommended = RECOMMENDED_CHANNELS.filter((id) => !channels.has(id));

  const session: Session = {
    label,
    t: grid,
    channels,
    provenance,
    sourceSampleRateHz: sourceRateHz,
    sourceRowCount: dataRows.length,
    durationS: grid.length > 0 ? (grid[grid.length - 1] as number) : 0,
  };

  const recognised: RecognisedColumn[] = columns.map((c) => ({
    header: c.header,
    channel: c.channel,
    unit: c.unit,
    validSamples: c.validSamples,
  }));

  const report: SchemaReport = {
    label,
    detectedFormat: detectFormat(headers),
    sourceSampleRateHz: sourceRateHz,
    rowCount: dataRows.length,
    recognised,
    unrecognised,
    derived,
    assumed,
    missingRequired,
    missingRecommended,
    droppedSamples,
  };

  return { session, report };
}

/**
 * Pick the unit a column's values should be read as. The fuel type only matters
 * for AFR columns, where it changes λ by up to 33% between petrol and E85 — which
 * is the difference between "lean and dangerous" and "exactly on target".
 */
function resolveUnit(unit: UnitId, fuel: ImportOptions['fuel']): UnitId {
  if (!fuel || fuel === 'gasoline') return unit;
  if (unit !== 'afrGasoline') return unit;
  switch (fuel) {
    case 'diesel':
      return 'afrDiesel';
    case 'e85':
      return 'afrE85';
    case 'lpg':
      return 'afrLpg';
    default:
      return unit;
  }
}

/**
 * Fill channels that can be computed from others.
 *
 * Every derivation is recorded, because a derived channel carries less confidence
 * than a measured one and the recommendation engine needs to know which it had.
 */
function deriveChannels(
  channels: Map<ChannelId, Float64Array>,
  provenance: Map<ChannelId, Provenance>,
  derived: { channel: ChannelId; from: readonly ChannelId[] }[],
  assumed: { channel: ChannelId; reason: string }[],
  n: number,
): void {
  // Barometric pressure: without it, boost cannot be separated from MAP and the
  // J1349 correction has no pressure term. Assuming sea level is a real
  // assumption with a real cost, so it is recorded as one.
  if (!channels.has('baro')) {
    const baro = new Float64Array(n).fill(101.325);
    channels.set('baro', baro);
    provenance.set('baro', 'assumed');
    assumed.push({ channel: 'baro', reason: 'import.assumed.baroSeaLevel' });
  }

  // A "boost" column that sits near ambient pressure when the engine is barely
  // loaded is absolute manifold pressure under another name (Bosch EDC/MED
  // loggers, Autotuner among them, call it "Boost pressure"). Read as gauge it
  // would report 1.1 bar of boost at part throttle, so it is moved to MAP and
  // boost is recomputed as gauge pressure — and the report says so.
  const loggedBoost = channels.get('boost');
  const baroNow = channels.get('baro');
  if (loggedBoost && baroNow && provenance.get('boost') === 'measured' && boostIsAbsolute(loggedBoost, baroNow, channels)) {
    {
      if (!channels.has('map')) {
        channels.set('map', loggedBoost);
        provenance.set('map', 'measured');
      }
      const toGauge = (absolute: Float64Array): Float64Array => {
        const gauge = new Float64Array(n).fill(NaN);
        for (let i = 0; i < n; i++) {
          const a = absolute[i] as number;
          const b = baroNow[i] as number;
          if (Number.isFinite(a) && Number.isFinite(b)) gauge[i] = a - b;
        }
        return gauge;
      };
      channels.set('boost', toGauge(loggedBoost));
      provenance.set('boost', 'derived');
      derived.push({ channel: 'boost', from: ['map', 'baro'] });
      assumed.push({ channel: 'boost', reason: 'import.assumed.absoluteBoost' });
      const target = channels.get('boostTarget');
      if (target) channels.set('boostTarget', toGauge(target));
    }
  }

  // Boost = MAP − barometric. Gauge pressure is what a tuner reasons about.
  if (!channels.has('boost') && channels.has('map') && channels.has('baro')) {
    const map = channels.get('map') as Float64Array;
    const baro = channels.get('baro') as Float64Array;
    const boost = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const m = map[i] as number;
      const b = baro[i] as number;
      if (Number.isFinite(m) && Number.isFinite(b)) boost[i] = m - b;
    }
    channels.set('boost', boost);
    provenance.set('boost', 'derived');
    derived.push({ channel: 'boost', from: ['map', 'baro'] });
  }

  // MAP from boost, for logs that record only gauge pressure.
  if (!channels.has('map') && channels.has('boost') && channels.has('baro')) {
    const boost = channels.get('boost') as Float64Array;
    const baro = channels.get('baro') as Float64Array;
    const map = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const bo = boost[i] as number;
      const ba = baro[i] as number;
      if (Number.isFinite(bo) && Number.isFinite(ba)) map[i] = bo + ba;
    }
    channels.set('map', map);
    provenance.set('map', 'derived');
    derived.push({ channel: 'map', from: ['boost', 'baro'] });
  }

  // Throttle from the accelerator pedal. Not the same signal on a drive-by-wire
  // car, but for WOT detection — the only thing throttle is used for — the pedal
  // is the better one anyway: it is what the driver did.
  if (!channels.has('throttle') && channels.has('pedal')) {
    channels.set('throttle', channels.get('pedal') as Float64Array);
    provenance.set('throttle', 'derived');
    derived.push({ channel: 'throttle', from: ['pedal'] });
  }

  // Gear is deliberately NOT derived here. The rpm/speed quotient is a ratio, not
  // an ordinal, and writing it into a channel declared as a gear number would put
  // a value of 147 where the rest of the pipeline expects 3. Segmentation clusters
  // the quotient into gears once the pulls are known (see segment.ts).
}

/**
 * Whether a column logged as "boost" is really absolute manifold pressure.
 *
 * Primary test, when the pedal was ever released: gauge boost with the pedal
 * released is at or below zero (a diesel's turbo idles near ambient, a petrol
 * engine pulls vacuum), while absolute pressure reads 30–100 kPa, or more on
 * overrun. Fallback, for a log that never lifts: absolute pressure never drops
 * much below ambient on a diesel, so a quiet level near ambient is absolute.
 */
function boostIsAbsolute(
  boost: Float64Array,
  baro: Float64Array,
  channels: Map<ChannelId, Float64Array>,
): boolean {
  const pedal = channels.get('throttle') ?? channels.get('pedal');
  if (pedal) {
    const released: number[] = [];
    for (let i = 0; i < boost.length; i++) {
      const p = pedal[i] as number;
      const b = boost[i] as number;
      if (Number.isFinite(p) && Number.isFinite(b) && p < CLOSED_PEDAL_FRACTION) released.push(b);
    }
    if (released.length >= 5) return median(released) > ABSOLUTE_BOOST_CLOSED_PEDAL_KPA;
  }
  const quiet = quantile(boost, 0.05);
  const ambient = median(baro);
  return Number.isFinite(quiet) && Number.isFinite(ambient) && quiet >= ABSOLUTE_BOOST_BARO_FRACTION * ambient;
}

/** Air density from barometric pressure, temperature and assumed humidity. */
export function airDensity(pressureKpa: number, temperatureC: number, vapourKpa: number): number {
  if (!Number.isFinite(pressureKpa) || !Number.isFinite(temperatureC)) {
    return PHYSICS.fallbackAirDensity;
  }
  const tK = temperatureC + 273.15;
  const pDry = Math.max(0, pressureKpa - vapourKpa) * 1000;
  const pVapour = Math.max(0, vapourKpa) * 1000;
  return pDry / (PHYSICS.airGasConstant * tK) + pVapour / (PHYSICS.vapourGasConstant * tK);
}

/** The channels the pipeline found, for the import screen's coverage display. */
export function channelCoverage(session: Session): {
  channel: ChannelId;
  requirement: string;
  provenance: Provenance | 'missing';
}[] {
  return CHANNELS.map((spec) => ({
    channel: spec.id,
    requirement: spec.requirement,
    provenance: session.channels.has(spec.id)
      ? (session.provenance.get(spec.id) as Provenance)
      : ('missing' as const),
  }));
}
