/**
 * Stage 4: condition normalisation.
 *
 * Without this the comparison has no scientific value. A car makes more power on a
 * cold morning than on a hot afternoon, and more at sea level than in Prishtina at
 * 650 m — differences of 5–8% that dwarf many real tuning gains. Correcting both
 * sessions to a common reference atmosphere is what turns "the after log looks
 * better" into a measurement.
 *
 * Two standards are supported because the thesis is written in a region that uses
 * both: SAE J1349 (US, dry-air reference, 990 hPa / 25 °C) and DIN 70020
 * (European, total-pressure reference, 1013 hPa / 20 °C). DIN produces the larger
 * numbers, which is why a magazine figure and a dyno printout rarely agree.
 */

import {
  ASSUMED_RELATIVE_HUMIDITY,
  CORRECTION_FACTOR_VALID_MAX,
  CORRECTION_FACTOR_VALID_MIN,
  DIN70020_REF_PRESSURE_KPA,
  DIN70020_REF_TEMPERATURE_K,
  J1349_A,
  J1349_B,
  J1349_REF_DRY_PRESSURE_KPA,
  J1349_REF_TEMPERATURE_K,
  MAGNUS_A,
  MAGNUS_B,
  MAGNUS_C,
} from './constants';
import { celsiusToKelvin } from './units';
import type { CorrectionFactor, VehicleParameters } from './types';

/**
 * Saturation vapour pressure over water, in kPa (Magnus form, Alduchov & Eskridge
 * 1996). Needed because J1349 references *dry* air: the water in the air displaces
 * oxygen, and on a humid 30 °C day that is worth about 1% of the correction.
 */
export function saturationVapourPressureKpa(temperatureC: number): number {
  if (!Number.isFinite(temperatureC)) return 0;
  const hPa = MAGNUS_A * Math.exp((MAGNUS_B * temperatureC) / (MAGNUS_C + temperatureC));
  return hPa / 10;
}

/** Partial pressure of water vapour, kPa. */
export function vapourPressureKpa(
  temperatureC: number,
  relativeHumidity = ASSUMED_RELATIVE_HUMIDITY,
): number {
  return saturationVapourPressureKpa(temperatureC) * relativeHumidity;
}

/**
 * The atmospheric correction factor for one pull.
 *
 * Applied multiplicatively to power: P_corrected = P_measured · factor.
 *
 * `inValidBand` is not cosmetic. J1349 declares itself valid only for factors in
 * 0.93…1.07; beyond that the linear form stops describing the engine. A factor of
 * 1.12 does not mean "add 12%", it means the two sessions were recorded in
 * conditions too different to reconcile — and the UI says so instead of quietly
 * multiplying the difference away.
 */
export function correctionFactor(
  standard: VehicleParameters['correctionStandard'],
  baroKpa: number,
  intakeTempC: number,
  relativeHumidity = ASSUMED_RELATIVE_HUMIDITY,
): CorrectionFactor {
  const tK = celsiusToKelvin(intakeTempC);
  const pVapour = vapourPressureKpa(intakeTempC, relativeHumidity);
  const dryPressureKpa = Math.max(1, baroKpa - pVapour);

  let factor: number;
  if (standard === 'SAE J1349') {
    factor =
      J1349_A * ((J1349_REF_DRY_PRESSURE_KPA / dryPressureKpa) * Math.sqrt(tK / J1349_REF_TEMPERATURE_K)) -
      J1349_B;
  } else {
    // DIN 70020 references total pressure, not dry air.
    factor = (DIN70020_REF_PRESSURE_KPA / baroKpa) * Math.sqrt(tK / DIN70020_REF_TEMPERATURE_K);
  }

  return {
    standard,
    factor,
    inValidBand: factor >= CORRECTION_FACTOR_VALID_MIN && factor <= CORRECTION_FACTOR_VALID_MAX,
    dryPressureKpa,
    intakeTempC,
  };
}

/**
 * Sensitivity of the correction factor to intake temperature, per °C, evaluated at
 * the given conditions. Used by the protocol check to say what a 5 °C difference
 * between the two sessions is actually worth in horsepower, rather than asserting
 * that it matters.
 */
export function correctionSensitivityPerC(
  standard: VehicleParameters['correctionStandard'],
  baroKpa: number,
  intakeTempC: number,
): number {
  const h = 0.5;
  const lo = correctionFactor(standard, baroKpa, intakeTempC - h).factor;
  const hi = correctionFactor(standard, baroKpa, intakeTempC + h).factor;
  return (hi - lo) / (2 * h);
}
