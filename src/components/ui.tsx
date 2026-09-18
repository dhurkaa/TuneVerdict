/**
 * The shared component vocabulary.
 *
 * Small, unopinionated primitives rather than a UI framework: a panel, a label, a
 * figure that always carries its uncertainty, a badge with a severity tone. Every
 * interactive element here is a real `<button>`, `<a>` or `<input>` with a
 * `<label>` — never a click handler on a div, because a div cannot be reached by
 * keyboard and is not announced by a screen reader.
 */

import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import type { Estimate, Severity } from '../core/types';

export function Panel({
  title,
  lead,
  actions,
  children,
  id,
}: {
  title?: string;
  lead?: string;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}): JSX.Element {
  return (
    <section className="panel stack stack-3" aria-labelledby={id ? `${id}-title` : undefined} id={id}>
      {(title || actions) && (
        <header className="row-between">
          <div className="stack" style={{ gap: 4 }}>
            {title && <h2 id={id ? `${id}-title` : undefined}>{title}</h2>}
            {lead && <p style={{ color: 'var(--muted)', maxWidth: '68ch' }}>{lead}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Label({ children }: { children: ReactNode }): JSX.Element {
  return <span className="label">{children}</span>;
}

const TONE_CLASS: Record<Severity | 'muted', string> = {
  risk: 'tone-risk',
  caution: 'tone-caution',
  info: 'tone-ok',
  muted: 'tone-muted',
};

export function Badge({
  tone = 'muted',
  children,
}: {
  tone?: Severity | 'muted';
  children: ReactNode;
}): JSX.Element {
  return <span className={`badge ${TONE_CLASS[tone]}`}>{children}</span>;
}

/**
 * A figure with its uncertainty. There is no variant of this component that shows
 * a bare number, because nothing in this application is known to be exact and a
 * number printed alone claims that it is.
 */
export function Figure({
  estimate,
  unit,
  digits = 1,
  size = 'figure',
  signed = false,
  tone,
}: {
  estimate: Estimate;
  unit?: string;
  digits?: number;
  size?: 'headline' | 'figure';
  signed?: boolean;
  tone?: Severity | 'muted';
}): JSX.Element {
  const { n, signed: formatSigned, t } = useI18n();
  const hasInterval = Number.isFinite(estimate.lo) && Number.isFinite(estimate.hi);
  const value = signed ? formatSigned(estimate.value, digits) : n(estimate.value, digits);

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className={`${size} mono ${tone ? TONE_CLASS[tone] : ''}`}>
        {value}
        {unit && (
          <span
            className="mono"
            style={{ fontSize: '0.4em', color: 'var(--muted)', marginLeft: 6 }}
          >
            {unit}
          </span>
        )}
      </div>
      {Number.isFinite(estimate.sd) && (
        <div className="label mono" style={{ textTransform: 'none', letterSpacing: 0 }}>
          {t('result.plusMinus', { sd: n(estimate.sd, digits) })}
          {hasInterval && (
            <>
              {' · '}
              {t('result.interval', { lo: n(estimate.lo, digits), hi: n(estimate.hi, digits) })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A label/value pair, for the dense read-outs the result screen is made of. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Severity | 'muted';
}): JSX.Element {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <Label>{label}</Label>
      <div className={`mono ${tone ? TONE_CLASS[tone] : ''}`} style={{ fontSize: 18 }}>
        {value}
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/** A proportion drawn as a bar. Used for the validity factors and the budget. */
export function Meter({
  value,
  tone = 'info',
  label,
}: {
  value: number;
  tone?: Severity | 'muted';
  label: string;
}): JSX.Element {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const colour =
    tone === 'risk'
      ? 'var(--risk)'
      : tone === 'caution'
        ? 'var(--caution)'
        : tone === 'muted'
          ? 'var(--muted)'
          : 'var(--signal)';
  return (
    <div
      role="meter"
      aria-valuenow={Number(clamped.toFixed(2))}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-label={label}
      style={{
        height: 6,
        borderRadius: 3,
        background: 'var(--inset)',
        overflow: 'hidden',
      }}
    >
      <div style={{ width: `${clamped * 100}%`, height: '100%', background: colour }} />
    </div>
  );
}

/** The mark: a single triangle outline in the signal colour. */
export function Mark({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <path
        d="M16 6 L27 26 H5 Z"
        fill="none"
        stroke="var(--signal)"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}
