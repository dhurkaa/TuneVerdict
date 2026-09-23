/**
 * Optional AI explanation of a finished result.
 *
 * This sits strictly *after* the pipeline, as the phrasing layer CLAUDE.md allows
 * ("a cosmetic layer on top of an already-produced result, never part of the
 * pipeline"). The model receives the finished summary — numbers, findings,
 * suggested changes — and answers questions about it. It never sees the CSV files,
 * and nothing it writes feeds back into any number, finding or verdict: the
 * calibrated analysis is the result, and the explanation is labelled as not part
 * of it.
 *
 * This module builds the finished result the model is given. The instructions live
 * in prompts.ts and are applied by the server; the request is sent by client.ts.
 */

import type { AnalysisResult } from '../core/types';
import type { I18n, TranslationKey } from '../i18n';

const r = (value: number, digits = 1): number | null => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

const est = (e: { value: number; lo: number; hi: number }, digits = 1) => ({
  value: r(e.value, digits),
  lo95: r(e.lo, digits),
  hi95: r(e.hi, digits),
});

/**
 * The finished result as compact JSON, with every user-facing sentence already
 * translated — so the model explains the same advice the screen shows, word for
 * word, rather than paraphrasing a key name.
 */
export function resultContext(result: AnalysisResult, { t }: Pick<I18n, 't'>): string {
  const summary = {
    verdict: {
      kind: result.validity.verdict,
      headline: t(`result.verdict.${result.validity.verdict}` as TranslationKey),
      validityIndex: r(result.validity.index, 2),
      factors: {
        gain: r(result.validity.gain, 2),
        consistency: r(result.validity.consistency, 2),
        safety: r(result.validity.safety, 2),
      },
    },
    power_hp: {
      peakBefore: est(result.gain.peakBefore),
      peakAfter: est(result.gain.peakAfter),
      gain: est(result.gain.delta),
      gainPercent: est(result.gain.deltaPercent),
      averageGainAcrossBand: est(result.gain.averageDelta),
      significant: result.gain.significant,
      pValue: r(result.gain.pValue, 3),
      bands: result.gain.bands.map((b) => ({
        rpm: `${b.rpmLow}-${b.rpmHigh}`,
        kind: b.kind,
        meanDeltaHp: r(b.meanDelta),
      })),
      correctionStandard: result.vehicle.correctionStandard,
      peakRpm: result.gain.peakRpm,
    },
    ecuReportedTorque: result.ecu
      ? {
          note: "Primary basis of the result: the ECU's own full-load torque from the logs, every gear. The measured figures are a cross-check from acceleration.",
          peakBeforeNm: r(result.ecu.peakBefore.value, 0),
          peakAfterNm: r(result.ecu.peakAfter.value, 0),
          peakPowerBeforeHp: r(result.ecu.peakPowerBefore.value, 0),
          peakPowerAfterHp: r(result.ecu.peakPowerAfter.value, 0),
          measuredStockOffsetPercent: r(100 * result.ecu.measuredOffset, 0),
          measuredReliable: result.ecu.measuredReliable,
          reportedChangeNm: r(result.ecu.reportedChange.value, 0),
          measuredChangeNm: est(result.ecu.measuredChange, 0),
          agreement: result.ecu.agreement,
        }
      : null,
    torque_nm: {
      peakBefore: est(result.gain.peakTorqueBefore, 0),
      peakAfter: est(result.gain.peakTorqueAfter, 0),
      gain: est(result.gain.torqueDelta, 0),
    },
    findings: result.recommendations.map((rec) => ({
      finding: t(`finding.${rec.finding.kind}` as TranslationKey),
      session: rec.finding.evidence.session,
      rpm: `${rec.finding.zone.rpmLow}-${rec.finding.zone.rpmHigh}`,
      severity: rec.severity,
      confidence: r(rec.confidence, 2),
      pullsAffected: `${rec.finding.evidence.pulls.length} of ${rec.finding.evidence.totalPulls}`,
      worstValue: r(rec.finding.evidence.peakValue, 3),
      threshold: r(rec.finding.evidence.threshold, 3),
      channel: `${rec.finding.evidence.channel} (${rec.finding.evidence.channelProvenance})`,
      whatToDo: t(rec.actionKey as TranslationKey),
      riskIfIgnored: t(rec.riskKey as TranslationKey),
    })),
    suggestedMapChanges: result.corrections.map((c) => ({
      table: c.parameter,
      rpm: `${c.rpmLow}-${c.rpmHigh}`,
      manifoldPressureKpa: Number.isFinite(c.loadLowKpa) ? `${c.loadLowKpa}-${c.loadHighKpa}` : 'any',
      change: c.parameter === 'hardware' ? 'hardware check' : `${r(c.change)} ${c.unit}`,
      cause: c.cause,
      observed: r(c.observed, 3),
      reference: r(c.reference, 3),
      confidence: r(c.confidence, 2),
    })),
    requestedVsDelivered: result.tracking
      .filter((s) => s.session === 'after')
      .map((s) => ({
        quantity: s.quantity,
        request: s.requestSource,
        zones: s.zones.map((z) => ({
          rpm: `${z.zone.rpmLow}-${z.zone.rpmHigh}`,
          status: z.status,
          error: s.quantity === 'timing' ? `${r(z.error.value)} deg` : `${r(z.error.value * 100)} % of request`,
        })),
      })),
    marginsNotOk: result.margins
      .filter((m) => m.status === 'tight' || m.status === 'exceeded')
      .map((m) => ({
        limit: m.limit,
        rpm: `${m.zone.rpmLow}-${m.zone.rpmHigh}`,
        worstMarginPercent: r(m.worstMargin * 100),
        status: m.status,
      })),
    protocolViolations: result.violations.map((v) => ({
      severity: v.severity,
      text: t(v.key as TranslationKey, {
        ...v.detail,
        session:
          v.detail.session === 'before'
            ? t('common.before')
            : v.detail.session === 'after'
              ? t('common.after')
              : String(v.detail.session ?? ''),
      }),
    })),
    loggingAdvice: result.loggingAdvice.map((a) => ({
      session: a.session,
      text: t(a.key as TranslationKey, a.detail),
    })),
    uncertaintyBudget: result.budget.map((b) => ({
      component: b.component,
      sharePercent: r(b.share * 100, 0),
    })),
    sessions: (['before', 'after'] as const).map((which) => {
      const s = result[which];
      return {
        session: which,
        file: s.label,
        pullsUsed: s.acceptedPulls,
        pullsRejected: s.rejectedPulls,
        gear: s.gear,
        gearIsRelative: s.gearIsRelative,
        pullToPullVariationPercent: r(s.cv * 100),
        meanIntakeAirC: r(s.meanIatC),
        intakeAirRiseC: r(s.iatRiseC),
        meanCorrectionFactor: r(s.meanCorrection, 4),
        sampleRateHz: r(s.sourceSampleRateHz),
      };
    }),
    health: {
      score: r(result.health.score, 0),
      scoreStock: r(result.health.scoreBefore, 0),
      label: result.health.label,
      systems: result.health.systems.map((system) => ({
        id: system.id,
        name: t(`health.system.${system.id}` as TranslationKey),
        status: system.status,
        statusBefore: system.statusBefore,
        measured: system.metrics.map((m) => ({
          what: t(m.key as TranslationKey),
          value: `${r(m.value, m.unit === 'λ' ? 2 : 1)} ${m.unit}`,
          status: m.status,
          ...(m.limit !== undefined ? { limit: `${r(m.limit, 2)} ${m.unit}` } : {}),
        })),
        findings: system.findings.map((kind) => t(`finding.${kind}` as TranslationKey)),
      })),
    },
    vehicle: {
      massKg: result.vehicle.massKg,
      massWeighed: result.vehicle.massWeighed,
      fuel: result.vehicle.fuel,
    },
  };
  return JSON.stringify(summary);
}

export interface Turn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}
