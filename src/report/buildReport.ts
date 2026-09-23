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
import type { PdfSeries } from './pdf';
import { convertEstimate, convertHp } from '../display/powerUnit';
import type { PowerUnit } from '../display/powerUnit';
import { sharedAxes, smoothSample } from '../display/scale';
import { metricDigits, roundForDisplay } from '../display/healthFormat';
import { hpToTorqueNm } from '../core/power';

const BUDGET_KEY: Record<UncertaintyBudget['component'], TranslationKey> = {
  mass: 'result.uncertainty.component.mass',
  dragArea: 'result.uncertainty.component.dragArea',
  rollingResistance: 'result.uncertainty.component.rollingResistance',
  efficiency: 'result.uncertainty.component.efficiency',
  inertia: 'result.uncertainty.component.inertia',
};

export function buildReport(
  result: AnalysisResult,
  i18n: I18n,
  aiSummary: { text: string; model: string } | null = null,
  unit: PowerUnit = 'PS',
): Blob {
  const { t, n, signed, formatDate } = i18n;
  const doc = new PdfDocument();
  const pw = (e: Estimate): Estimate => convertEstimate(e, unit);

  const estimate = (value: Estimate, digits: number = DISPLAY_PRECISION.power, withSign = false): string => {
    const centre = withSign ? signed(value.value, digits) : n(value.value, digits);
    if (!Number.isFinite(value.sd)) return centre;
    const interval =
      Number.isFinite(value.lo) && Number.isFinite(value.hi) ? ` [${n(value.lo, digits)}, ${n(value.hi, digits)}]` : '';
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
  if (result.ecu) {
    // The ECU's own figures lead when the logs carry them; the measured verdict
    // follows as the cross-check.
    const ecu = result.ecu;
    doc.text(
      `${t('headline.ecuVerdict')}: ${signed(convertHp(ecu.powerDelta, unit), 0)} ${unit} · ${signed(ecu.torqueDelta, 0)} Nm`,
      {
        font: 'Helvetica-Bold',
        size: 15,
        colour: ecu.powerDelta > 0 ? REPORT_COLOURS.signal : REPORT_COLOURS.muted,
      },
    );
    doc.text(t('headline.ecuBasis', { count: ecu.points.length }), {
      colour: REPORT_COLOURS.muted,
    });
    doc.text(t('keypoints.ecu'), { font: 'Helvetica-Bold', size: 10 });
  }
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

  // --- AI key messages, clearly separated from the verdict ------------------
  if (aiSummary && aiSummary.text.trim()) {
    doc.heading(t('report.section.aiSummary'));
    for (const line of aiSummary.text.split('\n')) {
      if (line.trim()) doc.text(line.trim(), { size: 9 });
    }
    doc.text(aiSummary.model, { colour: REPORT_COLOURS.muted, size: 8 });
  }

  // --- torque and power chart: the page a tuner looks at first -------------
  doc.heading(t('chart.title'));
  drawTuningChart(doc, result, unit, t);
  const g = result.gain;
  if (result.ecu) {
    const ecu = result.ecu;
    const hpText = (hp: number) => `${n(convertHp(hp, unit), 0)} ${unit}`;
    doc.row(
      t('common.before'),
      `${n(ecu.peakBefore.value, 0)} Nm @ ${ecu.peakBefore.rpm}  ·  ${hpText(ecu.peakPowerBefore.value)} @ ${ecu.peakPowerBefore.rpm} ${t('unit.rpm')}`,
    );
    doc.row(
      t('common.after'),
      `${n(ecu.peakAfter.value, 0)} Nm @ ${ecu.peakAfter.rpm}  ·  ${hpText(ecu.peakPowerAfter.value)} @ ${ecu.peakPowerAfter.rpm} ${t('unit.rpm')}`,
      { bold: true },
    );
    doc.text(t('chart.ecuNote'), { colour: REPORT_COLOURS.muted, size: 8 });
    doc.text(`${t('chart.source.measured')}:`, {
      font: 'Helvetica-Bold',
      size: 9,
    });
  }
  doc.row(
    t('common.before'),
    `${n(g.peakTorqueBefore.value, 0)} Nm @ ${g.peakRpm.torqueBefore}  ·  ${n(pw(g.peakBefore).value, 0)} ${unit} @ ${g.peakRpm.powerBefore} ${t('unit.rpm')}`,
  );
  doc.row(
    t('common.after'),
    `${n(g.peakTorqueAfter.value, 0)} Nm @ ${g.peakRpm.torqueAfter}  ·  ${n(pw(g.peakAfter).value, 0)} ${unit} @ ${g.peakRpm.powerAfter} ${t('unit.rpm')}`,
    { bold: true },
  );

  // --- what the ECU claims against what the car delivered -----------------
  if (result.ecu) {
    const ecu = result.ecu;
    doc.heading(t('report.section.ecu'));
    doc.row(
      t('chart.source.ecu'),
      `${n(ecu.peakBefore.value, 0)} Nm @ ${ecu.peakBefore.rpm}  ->  ${n(ecu.peakAfter.value, 0)} Nm @ ${ecu.peakAfter.rpm} ${t('unit.rpm')}`,
    );
    doc.row(t('report.ecu.reported'), `${signed(ecu.reportedChange.value, 0)} Nm`);
    if (!ecu.measuredReliable && Number.isFinite(ecu.measuredOffset)) {
      doc.text(
        t('keypoints.ecuModelOff', {
          offset: signed(100 * ecu.measuredOffset, 0),
        }),
        {
          colour: REPORT_COLOURS.caution,
          size: 9,
        },
      );
    }
    doc.row(t('report.ecu.measured'), `${estimate(ecu.measuredChange, 0, true)} Nm`, { bold: true });
    if (ecu.agreement !== 'undetermined') {
      doc.text(
        t(
          ecu.agreement === 'notDelivered'
            ? 'keypoints.ecuNotDelivered'
            : ecu.agreement === 'exceeds'
              ? 'keypoints.ecuExceeds'
              : 'keypoints.ecuConfirmed',
          {
            reported: signed(ecu.reportedChange.value, 0),
            measured: `${signed(ecu.measuredChange.value, 0)} ±${n(ecu.measuredChange.sd, 0)}`,
          },
        ),
        {
          colour:
            ecu.agreement === 'confirmed'
              ? REPORT_COLOURS.signal
              : ecu.agreement === 'notDelivered'
                ? REPORT_COLOURS.risk
                : REPORT_COLOURS.caution,
          size: 9,
        },
      );
    }
    doc.text(t('chart.ecuNote'), { colour: REPORT_COLOURS.muted, size: 8 });
  }

  // --- car health check ------------------------------------------------------
  {
    const health = result.health;
    const statusColour = (status: string) =>
      status === 'good'
        ? REPORT_COLOURS.signal
        : status === 'watch'
          ? REPORT_COLOURS.caution
          : status === 'concern'
            ? REPORT_COLOURS.risk
            : REPORT_COLOURS.muted;
    doc.heading(t('health.title'));
    doc.row(
      t('health.score'),
      `${Number.isFinite(health.score) ? n(health.score, 0) : '-'} / 100 · ${t(`health.label.${health.label}` as TranslationKey)}` +
        (Number.isFinite(health.scoreBefore)
          ? `  (${t('health.scoreStock', { score: n(health.scoreBefore, 0) })})`
          : ''),
      { bold: true },
    );
    for (const system of health.systems) {
      doc.row(
        t(`health.system.${system.id}` as TranslationKey),
        `${t(`health.status.${system.status}` as TranslationKey)}  ·  ${t('health.stock', {
          status: t(`health.status.${system.statusBefore}` as TranslationKey),
        })}`,
        { colour: statusColour(system.status) },
      );
      const measured = system.metrics
        .map((m) => {
          const digits = metricDigits(m);
          return `${t(m.key as TranslationKey)}: ${n(roundForDisplay(m.value, digits), digits)} ${m.unit}`;
        })
        .join(' · ');
      if (measured) doc.text(measured, { colour: REPORT_COLOURS.muted, size: 8 });
    }
  }

  // --- gain ----------------------------------------------------------------
  doc.heading(t('report.section.gain'));
  doc.row(t('result.gain'), `${estimate(pw(result.gain.delta), DISPLAY_PRECISION.power, true)} ${unit}`, {
    bold: true,
    colour: result.gain.significant ? REPORT_COLOURS.signal : REPORT_COLOURS.muted,
  });
  doc.row(`${t('chart.gain')} (${t('chart.torque')})`, `${estimate(g.torqueDelta, 0, true)} Nm`, {
    bold: true,
    colour: REPORT_COLOURS.torque,
  });
  doc.row(
    t('result.gainPercent'),
    `${estimate(result.gain.deltaPercent, DISPLAY_PRECISION.gainPercent, true)} ${t('unit.percent')}`,
  );
  doc.row(t('result.peakBefore'), `${estimate(pw(result.gain.peakBefore))} ${unit}`);
  doc.row(t('result.peakAfter'), `${estimate(pw(result.gain.peakAfter))} ${unit}`);
  doc.row(`${t('chart.torque')}, ${t('common.before')}`, `${estimate(g.peakTorqueBefore, 0)} Nm`);
  doc.row(`${t('chart.torque')}, ${t('common.after')}`, `${estimate(g.peakTorqueAfter, 0)} Nm`);
  doc.row(
    result.gain.significant ? t('result.significant') : t('result.notSignificant'),
    t('result.pValue', { value: n(result.gain.pValue, 3) }),
  );

  // --- validity ------------------------------------------------------------
  doc.heading(t('report.section.validity'));
  doc.text(t('result.validity.formula'), {
    colour: REPORT_COLOURS.muted,
    size: 9,
  });
  doc.space(4);
  for (const factor of [
    {
      label: t('result.validity.gain'),
      value: result.validity.gain,
      colour: REPORT_COLOURS.signal,
    },
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

  // --- gain across the band -------------------------------------------------
  doc.heading(t('report.section.bands'));
  doc.row(
    t('result.bands.average'),
    `${estimate(pw(result.gain.averageDelta), DISPLAY_PRECISION.power, true)} ${unit}`,
  );
  for (const band of result.gain.bands) {
    doc.row(
      t('result.bands.band', { low: band.rpmLow, high: band.rpmHigh }),
      `${t(`result.bands.kind.${band.kind}` as TranslationKey)} · ${t('result.bands.mean', {
        delta: signed(convertHp(band.meanDelta, unit), DISPLAY_PRECISION.power),
        unit,
      })}`,
      {
        colour:
          band.kind === 'gain'
            ? REPORT_COLOURS.signal
            : band.kind === 'loss'
              ? REPORT_COLOURS.risk
              : REPORT_COLOURS.muted,
      },
    );
  }
  if (result.gain.bands.some((band) => band.kind === 'loss')) {
    doc.text(t('result.bands.lossWarning'), {
      colour: REPORT_COLOURS.caution,
      size: 9,
    });
  }

  // --- suggested map changes ------------------------------------------------
  doc.heading(t('report.section.corrections'));
  if (result.corrections.length === 0) {
    doc.text(t('result.corrections.none'), { colour: REPORT_COLOURS.signal });
  } else {
    doc.text(t('result.corrections.caveat'), {
      colour: REPORT_COLOURS.caution,
      size: 9,
    });
    doc.space(4);
    for (const cell of result.corrections) {
      const load = Number.isFinite(cell.loadLowKpa)
        ? `${n(cell.loadLowKpa, 0)}-${n(cell.loadHighKpa, 0)} ${t('unit.kpa')}`
        : t('result.corrections.anyLoad');
      const change =
        cell.parameter === 'hardware'
          ? t('result.corrections.hardwareChange')
          : `${cell.change > 0 ? '+' : '-'}${n(Math.abs(cell.change), cell.unit === 'deg' ? 1 : 0)}${
              cell.unit === 'deg' ? '°' : cell.unit === 'percent' ? '%' : ` ${t('unit.kpa')}`
            }`;
      doc.row(
        `${t(`result.corrections.parameter.${cell.parameter}` as TranslationKey)} · ${cell.rpmLow}-${cell.rpmHigh} ${t('unit.rpm')} · ${load}`,
        `${change}  (${t('result.corrections.confidence')} ${n(cell.confidence, DISPLAY_PRECISION.confidence)})`,
        {
          bold: true,
          colour: cell.parameter === 'hardware' ? REPORT_COLOURS.risk : REPORT_COLOURS.caution,
        },
      );
    }
  }

  // --- requested vs delivered ----------------------------------------------
  doc.heading(t('report.section.tracking'));
  const afterTracking = result.tracking.filter((series) => series.session === 'after');
  if (afterTracking.length === 0) {
    doc.text(t('result.tracking.none'), {
      colour: REPORT_COLOURS.muted,
      size: 9,
    });
  } else {
    for (const series of afterTracking) {
      const zones = series.zones
        .map((zone) => {
          const status = t(`result.tracking.status.${zone.status}` as TranslationKey);
          if (!Number.isFinite(zone.error.value)) return `${zone.zone.rpmLow}-${zone.zone.rpmHigh}: ${status}`;
          const error =
            series.quantity === 'timing' ? `${signed(zone.error.value, 1)}°` : `${signed(zone.error.value * 100, 1)}%`;
          return `${zone.zone.rpmLow}-${zone.zone.rpmHigh}: ${status} (${error})`;
        })
        .join('; ');
      doc.text(`${t(`result.tracking.quantity.${series.quantity}` as TranslationKey)} — ${zones}`, { size: 9 });
    }
  }

  // --- margins -----------------------------------------------------------------
  doc.heading(t('report.section.margins'));
  const notOk = result.margins.filter((m) => m.status === 'tight' || m.status === 'exceeded');
  if (notOk.length === 0) {
    doc.text(t('result.margins.explain'), {
      colour: REPORT_COLOURS.muted,
      size: 9,
    });
  } else {
    for (const cell of notOk) {
      doc.row(
        `${t(`result.margins.limit.${cell.limit}` as TranslationKey)} · ${cell.zone.rpmLow}-${cell.zone.rpmHigh} ${t('unit.rpm')}`,
        `${n(cell.worstMargin * 100, 0)}% · ${t(`result.margins.status.${cell.status}` as TranslationKey)}`,
        {
          colour: cell.status === 'exceeded' ? REPORT_COLOURS.risk : REPORT_COLOURS.caution,
        },
      );
    }
    doc.text(t('result.margins.explain'), {
      colour: REPORT_COLOURS.muted,
      size: 8,
    });
  }

  // --- sessions ------------------------------------------------------------
  doc.heading(t('report.section.sessions'));
  sessionRows(doc, result.before, t('common.before'), i18n, unit);
  doc.space(6);
  sessionRows(doc, result.after, t('common.after'), i18n, unit);

  // --- uncertainty ---------------------------------------------------------
  doc.heading(t('report.section.uncertainty'));
  for (const entry of result.budget) {
    doc.row(t(BUDGET_KEY[entry.component]), `${n(entry.share * 100, 0)} ${t('unit.percent')}`);
  }
  doc.space(4);
  doc.text(
    t('result.uncertainty.cancellation', {
      factor: n(result.gain.commonModeCancellation, 1),
    }),
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
    doc.text(t('result.uncertainty.massAdvice'), {
      colour: REPORT_COLOURS.caution,
      size: 9,
    });
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

  // --- logging advice ------------------------------------------------------
  doc.heading(t('report.section.logging'));
  if (result.loggingAdvice.length === 0) {
    doc.text(t('result.logging.none'), { colour: REPORT_COLOURS.signal });
  } else {
    for (const item of result.loggingAdvice) {
      const who =
        item.session === 'both'
          ? t('result.logging.both')
          : t(item.session === 'before' ? 'common.before' : 'common.after');
      doc.text(`${who}: ${t(item.key as TranslationKey, item.detail)}`, {
        size: 9,
        indent: 6,
        colour:
          item.severity === 'risk'
            ? REPORT_COLOURS.risk
            : item.severity === 'caution'
              ? REPORT_COLOURS.caution
              : REPORT_COLOURS.text,
      });
    }
  }

  // --- footer --------------------------------------------------------------
  doc.space(12);
  doc.rule();
  doc.text(t('report.footer'), { colour: REPORT_COLOURS.muted, size: 8 });
  doc.text(
    t('result.uncertainty.seed', {
      seed: result.seed,
      when: formatDate(result.computedAt),
    }),
    { colour: REPORT_COLOURS.muted, size: 8 },
  );
  doc.text(t('app.thesis'), { colour: REPORT_COLOURS.muted, size: 8 });

  return doc.toBlob();
}

function sessionRows(doc: PdfDocument, summary: SessionSummary, title: string, { t, n }: I18n, unit: PowerUnit): void {
  doc.text(`${title} — ${summary.label}`, { font: 'Helvetica-Bold', size: 11 });
  doc.row(
    t('result.sessions.peak'),
    `${n(convertHp(summary.peakPower.value, unit), DISPLAY_PRECISION.power)} ± ${n(convertHp(summary.peakPower.sd, unit), DISPLAY_PRECISION.power)} ${unit}`,
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

/**
 * The torque and power chart, drawn into the PDF with the same axes and rules as
 * the screen: torque on the left in N·m, power on the right, before dashed and
 * after solid, each with its interval as a band.
 */
function drawTuningChart(doc: PdfDocument, result: AnalysisResult, unit: PowerUnit, t: I18n['t']): void {
  const scale = (e: Estimate, f: number): Estimate => ({
    value: e.value * f,
    sd: e.sd * f,
    lo: e.lo * f,
    hi: e.hi * f,
  });
  // The ECU's full-load curve when the logs carry it, as on screen; otherwise
  // the curve measured from acceleration.
  const rows = result.ecu
    ? result.ecu.points.map((p) => {
        const hpPerNm = 1 / hpToTorqueNm(1, p.rpm);
        return {
          rpm: p.rpm,
          tb: p.before,
          ta: p.after,
          pb: convertEstimate(scale(p.before, hpPerNm), unit),
          pa: convertEstimate(scale(p.after, hpPerNm), unit),
        };
      })
    : result.curve
        .filter((p) => Number.isFinite(p.before.value) && Number.isFinite(p.after.value))
        .map((p) => ({
          rpm: p.rpm,
          tb: scale(p.before, hpToTorqueNm(1, p.rpm)),
          ta: scale(p.after, hpToTorqueNm(1, p.rpm)),
          pb: convertEstimate(p.before, unit),
          pa: convertEstimate(p.after, unit),
        }));
  if (rows.length < 2) return;

  const rangeOf = (values: number[]) => {
    const finite = values.filter(Number.isFinite);
    return { min: Math.min(...finite), max: Math.max(...finite) };
  };
  const axes = sharedAxes(
    rangeOf(rows.flatMap((r) => [r.tb.value, r.ta.value, r.ta.lo, r.ta.hi])),
    rangeOf(rows.flatMap((r) => [r.pb.value, r.pa.value, r.pa.lo, r.pa.hi])),
  );

  const line = (pick: (r: (typeof rows)[number]) => Estimate) =>
    smoothSample(rows.filter((r) => Number.isFinite(pick(r).value)).map((r) => ({ x: r.rpm, y: pick(r).value })));
  const band = (pick: (r: (typeof rows)[number]) => Estimate) =>
    rows
      .filter((r) => Number.isFinite(pick(r).lo) && Number.isFinite(pick(r).hi))
      .map((r) => ({ x: r.rpm, lo: pick(r).lo, hi: pick(r).hi }));

  const series: PdfSeries[] = [
    {
      axis: 'left',
      colour: REPORT_COLOURS.torque,
      dashed: true,
      width: 1,
      points: line((r) => r.tb),
    },
    {
      axis: 'right',
      colour: REPORT_COLOURS.signal,
      dashed: true,
      width: 1,
      points: line((r) => r.pb),
    },
    {
      axis: 'left',
      colour: REPORT_COLOURS.torque,
      dashed: false,
      width: 1.6,
      points: line((r) => r.ta),
      band: band((r) => r.ta),
    },
    {
      axis: 'right',
      colour: REPORT_COLOURS.signal,
      dashed: false,
      width: 1.6,
      points: line((r) => r.pa),
      band: band((r) => r.pa),
    },
  ];

  const xMin = rows[0]!.rpm;
  const xMax = rows[rows.length - 1]!.rpm;
  const step = xMax - xMin > 2000 ? 500 : 250;
  const xTicks: number[] = [];
  for (let v = Math.ceil(xMin / step) * step; v <= xMax; v += step) xTicks.push(v);

  doc.chart({
    height: 230,
    xMin,
    xMax,
    xTicks,
    xLabel: t('result.chart.rpm'),
    intervals: axes.intervals,
    leftMin: axes.leftMin,
    leftMax: axes.leftMax,
    leftStep: axes.leftStep,
    leftLabel: 'Nm',
    leftColour: REPORT_COLOURS.torque,
    rightMin: axes.rightMin,
    rightMax: axes.rightMax,
    rightStep: axes.rightStep,
    rightLabel: unit,
    rightColour: REPORT_COLOURS.signal,
    series,
  });
  doc.text(
    `${t('chart.torque')} (Nm) / ${t('chart.power')} (${unit}) · ${t('common.before')} - - -  ${t('common.after')} ——`,
    { size: 8, colour: REPORT_COLOURS.muted },
  );
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
