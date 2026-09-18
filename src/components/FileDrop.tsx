/**
 * One of the two file slots.
 *
 * With no bundled demo data this is the only thing a new user sees, so its empty
 * state and its error state get as much attention as the result screen. The input
 * is a real `<input type="file">` behind a `<label>`: drag-and-drop is an
 * addition, never the only way in, because a drop target cannot be operated from
 * a keyboard.
 */

import { useId, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { Badge, Label } from './ui';
import type { SchemaReport, Session } from '../core/types';

export interface LoadedFile {
  readonly name: string;
  readonly session: Session;
  readonly report: SchemaReport;
}

export function FileDrop({
  title,
  file,
  error,
  busy,
  onFile,
  onClear,
}: {
  title: string;
  file: LoadedFile | null;
  error: string | null;
  busy: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
}): JSX.Element {
  const { t, n } = useI18n();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: React.DragEvent): void => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  };

  const tone = error ? 'risk' : file ? 'info' : 'muted';

  return (
    <div
      className="card stack"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        borderColor: dragging ? 'var(--signal)' : error ? 'var(--risk)' : 'var(--line)',
        borderStyle: file ? 'solid' : 'dashed',
        minHeight: 168,
      }}
    >
      <div className="row-between">
        <Label>{title}</Label>
        {file && <Badge tone={tone}>{file.report.detectedFormat}</Badge>}
      </div>

      {!file && !busy && (
        <div className="stack" style={{ gap: 'var(--space-2)', paddingTop: 'var(--space-1)' }}>
          <p style={{ color: 'var(--muted)' }}>{t('import.drop.hint')}</p>
          <div>
            <label className="button button-small" htmlFor={inputId}>
              {t('import.drop.browse')}
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="visually-hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) onFile(chosen);
                // Reset, so that choosing the same file twice still fires a change.
                event.target.value = '';
              }}
            />
          </div>
        </div>
      )}

      {busy && <p style={{ color: 'var(--muted)' }}>{t('import.drop.reading')}</p>}

      {file && !busy && (
        <div className="stack" style={{ gap: 'var(--space-2)' }}>
          <div className="mono" style={{ fontSize: 15, wordBreak: 'break-all' }}>
            {file.name}
          </div>
          <dl className="grid-2" style={{ margin: 0, gap: 'var(--space-1) var(--space-2)' }}>
            <Pair term={t('import.file.rows')} value={n(file.report.rowCount, 0)} />
            <Pair
              term={t('import.file.rate')}
              value={`${n(file.report.sourceSampleRateHz, 1)} ${t('unit.hz')}`}
            />
            <Pair
              term={t('import.file.duration')}
              value={`${n(file.session.durationS, 0)} ${t('unit.seconds')}`}
            />
            <Pair
              term={t('import.file.channels')}
              value={n(file.report.recognised.length, 0)}
            />
          </dl>
          <div className="row">
            <label className="button button-small" htmlFor={inputId}>
              {t('import.drop.replace')}
            </label>
            <input
              id={inputId}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="visually-hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) onFile(chosen);
                event.target.value = '';
              }}
            />
            <button type="button" className="button button-small button-quiet" onClick={onClear}>
              {t('import.drop.remove')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="tone-risk" role="alert" style={{ lineHeight: 1.5 }}>
          {error}
        </p>
      )}
    </div>
  );
}

function Pair({ term, value }: { term: string; value: string | number }): JSX.Element {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <dt className="label">{term}</dt>
      <dd className="mono" style={{ margin: 0 }}>
        {value}
      </dd>
    </div>
  );
}
