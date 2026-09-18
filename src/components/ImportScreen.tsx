/**
 * The import screen — the most important screen in the application.
 *
 * With no bundled demo data it is the only thing a new user sees, and it is where
 * everything can fail: an unknown schema, a sampling rate too low to resample
 * honestly, a missing key channel, two sessions from different gears. Its empty
 * state and its error states therefore get the same design attention as the
 * result screen, and none of them is a dead end: each says what went wrong, in
 * terms of the log rather than in terms of the code.
 */

import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import { FileDrop } from './FileDrop';
import type { LoadedFile } from './FileDrop';
import { SchemaReportPanel } from './SchemaReport';
import { VehicleForm } from './VehicleForm';
import { Mark, Panel } from './ui';
import type { VehicleParameters } from '../core/types';

const PROTOCOL_RULES: TranslationKey[] = [
  'protocol.rule.pulls',
  'protocol.rule.gear',
  'protocol.rule.rpm',
  'protocol.rule.road',
  'protocol.rule.temp',
  'protocol.rule.fuel',
  'protocol.rule.warm',
  'protocol.rule.rate',
];

export function ImportScreen({
  before,
  after,
  errors,
  busy,
  analysing,
  analysisError,
  vehicle,
  onVehicleChange,
  onFile,
  onClear,
  onAnalyse,
}: {
  before: LoadedFile | null;
  after: LoadedFile | null;
  errors: { before: string | null; after: string | null };
  busy: { before: boolean; after: boolean };
  analysing: boolean;
  analysisError: string | null;
  vehicle: VehicleParameters;
  onVehicleChange: (next: VehicleParameters) => void;
  onFile: (slot: 'before' | 'after', file: File) => void;
  onClear: (slot: 'before' | 'after') => void;
  onAnalyse: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const ready = before !== null && after !== null;
  const reports = [before?.report, after?.report].filter(
    (report): report is NonNullable<typeof report> => report != null,
  );

  return (
    <div className="stack stack-3">
      <Panel id="files" title={t('import.title')} lead={t('import.lead')}>
        <div className="grid-2">
          <FileDrop
            title={t('import.drop.before')}
            file={before}
            error={errors.before}
            busy={busy.before}
            onFile={(file) => onFile('before', file)}
            onClear={() => onClear('before')}
          />
          <FileDrop
            title={t('import.drop.after')}
            file={after}
            error={errors.after}
            busy={busy.after}
            onFile={(file) => onFile('after', file)}
            onClear={() => onClear('after')}
          />
        </div>

        <div className="row-between" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <p className="field-hint" style={{ maxWidth: '56ch' }}>
            {ready ? t('app.privacy') : t('import.waitingBoth')}
          </p>
          <button
            type="button"
            className="button button-primary"
            disabled={!ready || analysing}
            onClick={onAnalyse}
          >
            {analysing ? t('import.analysing') : t('import.analyse')}
          </button>
        </div>

        {analysisError && (
          <div className="inset bg-risk stack" role="alert" style={{ gap: 6 }}>
            <strong className="tone-risk">{t('import.error.title')}</strong>
            <p style={{ lineHeight: 1.5 }}>{analysisError}</p>
          </div>
        )}
      </Panel>

      {reports.length > 0 && <SchemaReportPanel reports={reports} />}

      <VehicleForm value={vehicle} onChange={onVehicleChange} />

      {!ready && <EmptyState />}
    </div>
  );
}

/**
 * The empty state. It is not a placeholder: it is where the measurement protocol
 * is taught, because a user who reads it before driving produces a comparable
 * pair of logs, and a user who does not produces two logs that cannot be
 * compared at all.
 */
function EmptyState(): JSX.Element {
  const { t } = useI18n();
  return (
    <Panel id="empty" title={t('import.empty.title')} lead={t('import.empty.body')}>
      <div className="inset stack">
        <div className="row" style={{ gap: 'var(--space-1)' }}>
          <Mark size={18} />
          <h3>{t('import.empty.protocol')}</h3>
        </div>
        <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: '1.1rem' }}>
          {PROTOCOL_RULES.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
