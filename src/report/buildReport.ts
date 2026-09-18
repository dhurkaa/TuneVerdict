/**
 * Composes an analysis result into the exported PDF.
 *
 * The report is the artefact that leaves the application, so it carries the same
 * discipline the screen does: no bare numbers, every finding with its evidence and
 * its confidence, and the protocol violations printed beside the verdict rather
 * than after it. It is written in whichever language the interface is in, since
 * the same i18n layer supplies both.
 */

import { CONFIDENCE, DISPLAY_PRECISION } from '../core/constants';
import type { AnalysisResult, Estimate, SessionSummary, UncertaintyBudget } from '../core/types';
import type { I18n, TranslationKey } from '../i18n';
import { PdfDocument, REPORT_COLOURS } from './pdf';

const BUDGET_KEY: Record<UncertaintyBudget['component'], TranslationKey> = {
  mass: 'result.uncertainty.component.mass',
  dragArea: 'result.uncertainty.component.dragArea',
  rollingResistance: 'result.uncertainty.component.rollingResistance',
  efficiency: 'result.uncertainty.component.efficiency',
  inertia: 'result.uncertainty.component.inertia',
};

export function buildReport(result: AnalysisResult, i18n: I18n): Blob {
  const { t, n, signed, formatDate } = i18n;
  const doc = new PdfDocument();

  const estimate = (value: Estimate, digits = DISPLAY_PRECISION.power, withSign = false): string => {
    const centre = withSign ? signed(value.value, digits) : n(value.value, digits);
    if (!Number.isFinite(value.sd)) return centre;
    const interval =
      Number.isFinite(value.lo) && Number.isFinite(value.hi)
        ? ` [${n(value.lo, digits)}, ${n(value.hi, digits)}]`
        : '';
    return `${centre} ± ${n(value.sd, digits)}${interval}`;
  };

  // --- title ---------------------------------------------------------------
  doc.text(t('report.title'), { font: 'Helvetica-Bold', size: 20 });
  doc.text(t('app.tagline'), { colour: REPORT_COLOURS.muted, size: 11 });
  doc.text(t('report.generated', { when: formatDate(result.computedAt) }), {
    colour: REPORT_COLOURS.muted,
    size: 9,
  });
  doc.space(6);
  doc.text(`${result.before.label}  ->  ${result.after.label}`, {
    colour: REPORT_COLOURS.muted,
    size: 9,
  });

  // --- verdict -------------------------------------------------------------
  doc.heading(t('report.section.verdict'));
  const verdictColour =
    result.validity.verdict === 'good'
      ? REPORT_COLOURS.signal
      : result.validity.verdict === 'mixed'
        ? REPORT_COLOURS.caution
        : result.validity.verdict === 'bad'
          ? REPORT_COLOURS.risk
          : REPORT_COLOURS.muted;
  doc.text(t(`result.verdict.${result.validity.verdict}` as TranslationKey), {
    font: 'Helvetica-Bold',
    size: 15,
    colour: verdictColour,
  });
  doc.text(t(`result.verdict.${result.validity.verdict}Body` as TranslationKey), {
    colour: REPORT_COLOURS.muted,
  });

  // --- gain ----------------------------------------------------------------
  doc.heading(t('report.section.gain'));
  doc.row(t('result.gain'), `${estimate(result.gain.delta, DISPLAY_PRECISION.power, true)} ${t('unit.hp')}`, {
    bold: true,
    colour: result.gain.significant ? REPORT_COLOURS.signal : REPORT_COLOURS.muted,
  });
  doc.row(
    t('result.gainPercent'),
    `${estimate(result.gain.deltaPercent, DISPLAY_PRECISION.gainPercent, true)} ${t('unit.percent')}`,
  );
  doc.row(t('result.peakBefore'), `${estimate(result.gain.peakBefore)} ${t('unit.hp')}`);
  doc.row(t('result.peakAfter'), `${estimate(result.gain.peakAfter)} ${t('unit.hp')}`);
  doc.row(
    result.gain.significant ? t('result.significant') : t('result.notSignificant'),
    t('result.pValue', { value: n(result.gain.pValue, 3) }),
  );

  // --- validity ------------------------------------------------------------
  doc.heading(t('report.section.validity'));
  doc.text(t('result.validity.formula'), { colour: REPORT_COLOURS.muted, size: 9 });
  doc.space(4);
  for (const factor of [
    { label: t('result.validity.gain'), value: result.validity.gain, colour: REPORT_COLOURS.signal },
    {
      label: t('result.validity.consistency'),
      value: result.validity.consistency,
      colour: REPORT_COLOURS.signal,
    },
    {
      label: t('result.validity.safety'),
      value: result.validity.safety,
      colour:
        result.validity.safety < 0.6
          ? REPORT_COLOURS.risk
          : result.validity.safety < 0.9
            ? REPORT_COLOURS.caution
            : REPORT_COLOURS.signal,
    },
  ]) {
    doc.row(factor.label, n(factor.value, DISPLAY_PRECISION.index));
    doc.bar(factor.value, factor.colour);
  }
  doc.row(t('result.validity.index'), n(result.validity.index, DISPLAY_PRECISION.index), { bold: true });

  // --- findings ------------------------------------------------------------
  doc.heading(t('report.section.findings'));
  if (result.recommendations.length === 0) {
    doc.text(t('result.findings.none'), { colour: REPORT_COLOURS.muted });
  } else {
    for (const recommendation of result.recommendations) {
      const { finding } = recommendation;
      const colour =
        finding.severity === 'risk'
          ? REPORT_COLOURS.risk
          : finding.severity === 'caution'
            ? REPORT_COLOURS.caution
            : REPORT_COLOURS.muted;
      doc.space(6);
      doc.text(
        `${t(`finding.${finding.kind}` as TranslationKey)} · ` +
          `${t('result.findings.zone', { low: finding.zone.rpmLow, high: finding.zone.rpmHigh })} · ` +
          `${t('result.findings.confidence')} ${n(finding.confidence, DISPLAY_PRECISION.confidence)}`,
        { font: 'Helvetica-Bold', size: 11, colour },
      );
      doc.text(t(recommendation.actionKey as TranslationKey), { indent: 10 });
      doc.text(`${t('result.findings.risk')}: ${t(recommendation.riskKey as TranslationKey)}`, {
        indent: 10,
        colour: REPORT_COLOURS.muted,
        size: 9,
      });
      doc.text(
        `${t('result.findings.pulls', {
          count: finding.evidence.pulls.length,
          total: finding.evidence.totalPulls,
        })} · ${t('result.findings.samples', {
          exceeding: finding.evidence.exceedingSamples,
          total: finding.evidence.zoneSamples,
        })}`,
        { indent: 10, colour: REPORT_COLOURS.muted, size: 9 },
      );
    }
  }

  // --- sessions ------------------------------------------------------------
  doc.heading(t('report.section.sessions'));
  sessionRows(doc, result.before, t('common.before'), i18n);
  doc.space(6);
  sessionRows(doc, result.after, t('common.after'), i18n);

  // --- uncertainty ---------------------------------------------------------
  doc.heading(t('report.section.uncertainty'));
  for (const entry of result.budget) {
    doc.row(t(BUDGET_KEY[entry.component]), `${n(entry.share * 100, 0)} ${t('unit.percent')}`);
  }
  doc.space(4);
  doc.text(
    t('result.uncertainty.cancellation', { factor: n(result.gain.commonModeCancellation, 1) }),
    { colour: REPORT_COLOURS.muted, size: 9 },
  );
  doc.text(
    t('result.uncertainty.ece', {
      ece: n(CONFIDENCE.expectedCalibrationError, 3),
      cap: n(CONFIDENCE.cap, 3),
    }),
    { colour: REPORT_COLOURS.muted, size: 9 },
  );
  if (result.budget[0]?.component === 'mass') {
    doc.text(t('result.uncertainty.massAdvice'), { colour: REPORT_COLOURS.caution, size: 9 });
  }

  // --- protocol ------------------------------------------------------------
  doc.heading(t('report.section.protocol'));
  if (result.violations.length === 0) {
    doc.text(t('protocol.none'), { colour: REPORT_COLOURS.signal });
  } else {
    for (const violation of result.violations) {
      const session = violation.detail.session;
      doc.text(
        t(violation.key as TranslationKey, {
          ...violation.detail,
          session:
            session === 'before' ? t('common.before') : session === 'after' ? t('common.after') : String(session ?? ''),
        }),
        {
          colour: violation.severity === 'risk' ? REPORT_COLOURS.risk : REPORT_COLOURS.caution,
          size: 9,
          indent: 6,
        },
      );
    }
  }

  // --- footer --------------------------------------------------------------
  doc.space(12);
  doc.rule();
  doc.text(t('report.footer'), { colour: REPORT_COLOURS.muted, size: 8 });
  doc.text(
    t('result.uncertainty.seed', { seed: result.seed, when: formatDate(result.computedAt) }),
    { colour: REPORT_COLOURS.muted, size: 8 },
  );
  doc.text(t('app.thesis'), { colour: REPORT_COLOURS.muted, size: 8 });

  return doc.toBlob();
}

function sessionRows(
  doc: PdfDocument,
  summary: SessionSummary,
  title: string,
  { t, n }: I18n,
): void {
  doc.text(`${title} — ${summary.label}`, { font: 'Helvetica-Bold', size: 11 });
  doc.row(
    t('result.sessions.peak'),
    `${n(summary.peakPower.value, DISPLAY_PRECISION.power)} ± ${n(summary.peakPower.sd, DISPLAY_PRECISION.power)} ${t('unit.hp')}`,
  );
  doc.row(t('result.sessions.pullsAccepted'), `${summary.acceptedPulls}`);
  doc.row(t('result.sessions.pullsRejected'), `${summary.rejectedPulls}`);
  doc.row(t('result.sessions.gear'), summary.gear > 0 ? `${summary.gear}` : '-');
  doc.row(t('result.sessions.cv'), `${n(summary.cv * 100, 1)} ${t('unit.percent')}`);
  doc.row(t('result.sessions.iat'), `${n(summary.meanIatC, 1)} ${t('unit.celsius')}`);
  doc.row(t('result.sessions.iatRise'), `${n(summary.iatRiseC, 1)} ${t('unit.celsius')}`);
  doc.row(t('result.sessions.correction'), n(summary.meanCorrection, 4));
  doc.row(t('result.sessions.rate'), `${n(summary.sourceSampleRateHz, 1)} ${t('unit.hz')}`);
}

/** Hand the file to the browser. Nothing is uploaded: the Blob never leaves. */
export function downloadReport(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
