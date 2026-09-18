/**
 * Stage 7: the explainable recommendation engine.
 *
 * A recommendation is a finding plus what to do about it. It is deliberately not
 * generated text: every recommendation is a key into the translation layer, so the
 * same evidence produces the same sentence in Albanian and in English, today and
 * next month. That reproducibility is the reason no language model appears
 * anywhere in this pipeline — a phrasing that drifts between runs would invalidate
 * the calibration that the thresholds rest on.
 */

import { CONFIDENCE } from './constants';
import type { Finding, FindingKind, Recommendation, Severity } from './types';

/** Action and risk keys per finding kind. Resolved by the i18n layer. */
const ADVICE: Record<FindingKind, { action: string; risk: string }> = {
  knock: { action: 'advice.knock.action', risk: 'advice.knock.risk' },
  lean: { action: 'advice.lean.action', risk: 'advice.lean.risk' },
  boostOvershoot: { action: 'advice.boostOvershoot.action', risk: 'advice.boostOvershoot.risk' },
  boostOscillation: {
    action: 'advice.boostOscillation.action',
    risk: 'advice.boostOscillation.risk',
  },
  fuelRailDroop: { action: 'advice.fuelRailDroop.action', risk: 'advice.fuelRailDroop.risk' },
  iatHeatSoak: { action: 'advice.iatHeatSoak.action', risk: 'advice.iatHeatSoak.risk' },
  egt: { action: 'advice.egt.action', risk: 'advice.egt.risk' },
  residualOutlier: { action: 'advice.residualOutlier.action', risk: 'advice.residualOutlier.risk' },
};

const SEVERITY_RANK: Record<Severity, number> = { risk: 0, caution: 1, info: 2 };

/**
 * Merge findings of the same kind in adjacent rpm zones.
 *
 * Knock from 4000 to 5500 rpm is one problem, not two. Reporting it twice would
 * both overstate the number of faults and double-count it in the safety score.
 */
export function mergeAdjacentZones(findings: readonly Finding[]): Finding[] {
  const byKey = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = `${finding.kind}|${finding.evidence.session}`;
    const list = byKey.get(key);
    if (list) list.push(finding);
    else byKey.set(key, [finding]);
  }

  const merged: Finding[] = [];
  for (const group of byKey.values()) {
    const sorted = [...group].sort((a, b) => a.zone.rpmLow - b.zone.rpmLow);
    let current = sorted[0];
    if (!current) continue;

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i] as Finding;
      if (next.zone.rpmLow <= current.zone.rpmHigh) {
        const pulls = Array.from(new Set([...current.evidence.pulls, ...next.evidence.pulls])).sort(
          (a, b) => a - b,
        );
        // The merged finding keeps the stronger evidence: the worse peak, the
        // wider zone, and the higher confidence, because the combined observation
        // is at least as convincing as either half.
        const takeNextPeak =
          Math.abs(next.evidence.peakValue - next.evidence.threshold) >
          Math.abs(current.evidence.peakValue - current.evidence.threshold);
        current = {
          ...current,
          severity: SEVERITY_RANK[next.severity] < SEVERITY_RANK[current.severity] ? next.severity : current.severity,
          zone: { rpmLow: current.zone.rpmLow, rpmHigh: Math.max(current.zone.rpmHigh, next.zone.rpmHigh) },
          evidence: {
            ...current.evidence,
            pulls,
            exceedingSamples: current.evidence.exceedingSamples + next.evidence.exceedingSamples,
            zoneSamples: current.evidence.zoneSamples + next.evidence.zoneSamples,
            peakValue: takeNextPeak ? next.evidence.peakValue : current.evidence.peakValue,
          },
          confidence: Math.max(current.confidence, next.confidence),
          confidenceTrace:
            next.confidence > current.confidence ? next.confidenceTrace : current.confidenceTrace,
        };
      } else {
        merged.push(current);
        current = next;
      }
    }
    merged.push(current);
  }

  return merged;
}

/**
 * Turn findings into recommendations, worst and most certain first.
 *
 * Findings below the confidence floor never reach this point, but the floor is
 * re-applied here so that the rule holds even if a caller assembles findings by
 * hand: the application never shows advice it cannot support.
 */
export function recommend(findings: readonly Finding[]): Recommendation[] {
  return mergeAdjacentZones(findings)
    .filter((finding) => finding.confidence >= CONFIDENCE.floor)
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return b.confidence - a.confidence;
    })
    .map((finding) => {
      const advice = ADVICE[finding.kind];
      return {
        id: `${finding.evidence.session}-${finding.kind}-${finding.zone.rpmLow}`,
        finding,
        actionKey: advice.action,
        riskKey: advice.risk,
        severity: finding.severity,
        confidence: finding.confidence,
      };
    });
}
