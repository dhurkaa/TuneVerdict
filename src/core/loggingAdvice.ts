/**
 * What to log next time.
 *
 * Every channel a log lacks removes a class of findings, and the absence of a
 * finding is easy to misread as the absence of a problem: a log with no knock
 * channel produces no knock finding, which says nothing about knock. This module
 * turns what was missing into a checklist for the next recording, each item
 * stating what its absence cost this analysis.
 *
 * Deliberately generic about *how* to add a channel: menu paths differ between
 * tools and versions, and a wrong instruction is worse than a general one.
 */

import type { ChannelId } from './channels';
import { TARGET_SAMPLE_RATE_HZ } from './constants';
import type { LoggingAdvice, Session, Severity, VehicleParameters } from './types';

type Fuel = VehicleParameters['fuel'];

interface Rule {
  readonly key: string;
  readonly channel: ChannelId;
  readonly severity: Severity | ((fuel: Fuel) => Severity);
  /** Whether this session triggers the rule. */
  readonly applies: (session: Session) => boolean;
  /**
   * Fuels the advice makes sense for. A compression-ignition engine has no spark
   * to retard and no ignition map, so asking a diesel log for knock retard or
   * ignition advance is advice that can never be followed.
   */
  readonly fuels?: readonly Fuel[];
}

const SPARK: readonly Fuel[] = ['gasoline', 'e85', 'lpg'];

const missing = (id: ChannelId) => (session: Session) => !session.channels.has(id);

const RULES: readonly Rule[] = [
  { key: 'logging.knockRetard', channel: 'knockRetard', severity: 'risk', applies: missing('knockRetard'), fuels: SPARK },
  { key: 'logging.lambda', channel: 'lambda', severity: 'risk', applies: missing('lambda'), fuels: SPARK },
  { key: 'logging.iat', channel: 'iat', severity: 'risk', applies: missing('iat') },
  {
    key: 'logging.baro',
    channel: 'baro',
    severity: 'caution',
    applies: (s) => s.provenance.get('baro') === 'assumed',
  },
  {
    key: 'logging.boostTarget',
    channel: 'boostTarget',
    severity: 'caution',
    applies: (s) => s.channels.has('boost') && !s.channels.has('boostTarget'),
  },
  {
    key: 'logging.boost',
    channel: 'map',
    severity: 'caution',
    applies: (s) => !s.channels.has('boost') && !s.channels.has('map'),
  },
  {
    key: 'logging.lambdaTarget',
    channel: 'lambdaTarget',
    severity: 'info',
    applies: (s) => s.channels.has('lambda') && !s.channels.has('lambdaTarget'),
    fuels: SPARK,
  },
  { key: 'logging.fuelRail', channel: 'fuelRail', severity: 'info', applies: missing('fuelRail') },
  {
    key: 'logging.fuelRailTarget',
    channel: 'fuelRailTarget',
    severity: 'info',
    applies: (s) => s.channels.has('fuelRail') && !s.channels.has('fuelRailTarget'),
  },
  { key: 'logging.timing', channel: 'timing', severity: 'info', applies: missing('timing'), fuels: SPARK },
  {
    // On a diesel the exhaust temperature is the limit the tune runs into first,
    // which is why it is a risk there and a useful extra on a petrol engine.
    key: 'logging.egt',
    channel: 'egt',
    severity: (fuel) => (fuel === 'diesel' ? 'risk' : 'info'),
    applies: missing('egt'),
  },
  {
    key: 'logging.lambdaTargetDiesel',
    channel: 'lambda',
    severity: 'caution',
    applies: missing('lambda'),
    fuels: ['diesel'],
  },
  { key: 'logging.coolant', channel: 'coolant', severity: 'info', applies: missing('coolant') },
  { key: 'logging.gear', channel: 'gear', severity: 'info', applies: missing('gear') },
];

const SEVERITY_ORDER: Record<Severity, number> = { risk: 0, caution: 1, info: 2 };

export function loggingAdvice(before: Session, after: Session, fuel: Fuel = 'gasoline'): LoggingAdvice[] {
  const out: LoggingAdvice[] = [];

  for (const rule of RULES) {
    if (rule.fuels && !rule.fuels.includes(fuel)) continue;
    const inBefore = rule.applies(before);
    const inAfter = rule.applies(after);
    if (!inBefore && !inAfter) continue;
    out.push({
      key: rule.key,
      channel: rule.channel,
      session: inBefore && inAfter ? 'both' : inBefore ? 'before' : 'after',
      severity: typeof rule.severity === 'function' ? rule.severity(fuel) : rule.severity,
      detail: {},
    });
  }

  const slow = [before, after]
    .map((session, i) => ({ session, which: i === 0 ? 'before' : 'after' }))
    .filter(({ session }) => session.sourceSampleRateHz < TARGET_SAMPLE_RATE_HZ * 0.95);
  if (slow.length > 0) {
    out.push({
      key: 'logging.sampleRate',
      channel: null,
      session: slow.length === 2 ? 'both' : (slow[0]?.which as 'before' | 'after'),
      severity: 'caution',
      detail: {
        rate: Math.round(Math.min(...slow.map(({ session }) => session.sourceSampleRateHz)) * 10) / 10,
        target: TARGET_SAMPLE_RATE_HZ,
      },
    });
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
