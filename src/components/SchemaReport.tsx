/**
 * What the importer understood, and what it did not.
 *
 * This panel exists because the honest answer to "did it work?" is rarely yes or
 * no. A log can import perfectly and still be missing the one channel that would
 * have caught a lean mixture, and the user needs to know that before reading a
 * verdict rather than after acting on one.
 */

import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import { Badge, Label, Panel } from './ui';
import type { ChannelId } from '../core/channels';
import type { SchemaReport as SchemaReportData } from '../core/types';

function channelName(id: ChannelId): TranslationKey {
  return `channel.${id}` as TranslationKey;
}

export function SchemaReportPanel({
  reports,
}: {
  reports: readonly SchemaReportData[];
}): JSX.Element {
  const { t, n } = useI18n();

  return (
    <Panel id="schema" title={t('import.schema.title')}>
      <div className="grid-2">
        {reports.map((report) => (
          <div key={report.label} className="stack" style={{ gap: 'var(--space-2)' }}>
            <div className="row-between">
              <span className="mono" style={{ fontSize: 15, wordBreak: 'break-all' }}>
                {report.label}
              </span>
              <Badge>{report.detectedFormat}</Badge>
            </div>

            <Group label={t('import.schema.recognised')}>
              <ul className="stack" style={{ gap: 4, margin: 0, padding: 0, listStyle: 'none' }}>
                {report.recognised.map((column) => (
                  <li key={column.header} className="row-between" style={{ gap: 'var(--space-2)' }}>
                    <span>{t(channelName(column.channel))}</span>
                    <span className="mono field-hint" style={{ textAlign: 'right' }}>
                      {column.header} · {column.unit}
                    </span>
                  </li>
                ))}
              </ul>
            </Group>

            {report.derived.length > 0 && (
              <Group label={t('import.schema.derived')}>
                <ul className="stack" style={{ gap: 4, margin: 0, padding: 0, listStyle: 'none' }}>
                  {report.derived.map((entry) => (
                    <li key={entry.channel}>
                      {t(channelName(entry.channel))}{' '}
                      <span className="field-hint">
                        {t('import.schema.derivedFrom', {
                          channels: entry.from.map((c) => t(channelName(c))).join(' − '),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </Group>
            )}

            {report.assumed.length > 0 && (
              <Group label={t('import.schema.assumed')}>
                <ul className="stack" style={{ gap: 4, margin: 0, padding: 0, listStyle: 'none' }}>
                  {report.assumed.map((entry) => (
                    <li key={entry.channel} className="field-hint">
                      {t(entry.reason as TranslationKey)}
                    </li>
                  ))}
                </ul>
              </Group>
            )}

            {report.missingRecommended.length > 0 && (
              <Group label={t('import.schema.missingRecommended')} tone="caution">
                <p className="field-hint">{t('import.schema.missingHint')}</p>
                <ul className="row" style={{ flexWrap: 'wrap', gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
                  {report.missingRecommended.map((id) => (
                    <li key={id}>
                      <Badge tone="caution">{t(channelName(id))}</Badge>
                    </li>
                  ))}
                </ul>
              </Group>
            )}

            {report.unrecognised.length > 0 && (
              <Group label={t('import.schema.unrecognised')}>
                <p className="field-hint">{t('import.schema.unrecognisedHint')}</p>
                <p className="mono field-hint" style={{ wordBreak: 'break-word' }}>
                  {report.unrecognised.join(' · ')}
                </p>
              </Group>
            )}

            {report.droppedSamples > 0 && (
              <p className="field-hint">
                {t('import.schema.dropped', { count: n(report.droppedSamples, 0) })}
              </p>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Group({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: 'caution';
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="inset stack" style={{ gap: 'var(--space-1)' }}>
      <div className={tone === 'caution' ? 'tone-caution' : undefined}>
        <Label>{label}</Label>
      </div>
      {children}
    </div>
  );
}
