import { describe, expect, it } from 'vitest';
import {
  STOICHIOMETRIC_AFR,
  convert,
  celsiusToKelvin,
  fromCanonical,
  parseUnitFromHeader,
  toCanonical,
  unitFromToken,
} from './units';

describe('unit conversion', () => {
  it('converts speed to m/s', () => {
    expect(toCanonical(100, 'km/h')).toBeCloseTo(27.7778, 4);
    expect(toCanonical(60, 'mph')).toBeCloseTo(26.8224, 4);
  });

  it('converts pressure to kPa', () => {
    expect(toCanonical(1, 'bar')).toBeCloseTo(100, 6);
    expect(toCanonical(14.5038, 'psi')).toBeCloseTo(100, 2);
    expect(toCanonical(1013, 'mbar')).toBeCloseTo(101.3, 6);
  });

  it('converts temperature with the offset, not just the scale', () => {
    // The bug this guards against: treating °F as a pure scale factor.
    expect(toCanonical(32, 'F')).toBeCloseTo(0, 6);
    expect(toCanonical(212, 'F')).toBeCloseTo(100, 6);
    expect(toCanonical(273.15, 'K')).toBeCloseTo(0, 6);
  });

  it('round-trips through the canonical unit', () => {
    for (const [value, unit] of [
      [123.4, 'km/h'],
      [2.5, 'bar'],
      [-17.5, 'F'],
      [45, 'percent'],
    ] as const) {
      expect(fromCanonical(toCanonical(value, unit), unit)).toBeCloseTo(value, 6);
    }
  });

  it('turns AFR into lambda using the fuel stoichiometry', () => {
    expect(toCanonical(STOICHIOMETRIC_AFR.gasoline, 'afrGasoline')).toBeCloseTo(1, 6);
    expect(toCanonical(STOICHIOMETRIC_AFR.e85, 'afrE85')).toBeCloseTo(1, 6);
    // 12.5:1 on petrol is rich; the same number on E85 is lean. Getting the fuel
    // wrong here is the difference between "on target" and "about to melt a piston".
    expect(toCanonical(12.5, 'afrGasoline')).toBeCloseTo(0.8503, 4);
    expect(toCanonical(12.5, 'afrE85')).toBeCloseTo(1.2801, 4);
  });

  it('refuses to convert between different quantities', () => {
    expect(() => convert(1, 'bar', 'km/h')).toThrow();
  });

  it('keeps NaN as NaN rather than inventing a zero', () => {
    expect(toCanonical(NaN, 'kPa')).toBeNaN();
  });

  it('agrees with the Kelvin helper', () => {
    expect(celsiusToKelvin(25)).toBeCloseTo(298.15, 6);
  });
});

describe('unit parsing from headers', () => {
  it('reads a bracketed unit', () => {
    expect(parseUnitFromHeader('Intake Air Temperature (°C)')).toBe('C');
    expect(parseUnitFromHeader('Vehicle Speed [km/h]')).toBe('km/h');
    expect(parseUnitFromHeader('Engine RPM (rpm)')).toBe('rpm');
  });

  it('reads German unit spellings', () => {
    expect(parseUnitFromHeader('Motordrehzahl (U/min)')).toBe('rpm');
    expect(parseUnitFromHeader('Ladedruck (bar)')).toBe('bar');
  });

  it('reads a trailing suffix', () => {
    expect(parseUnitFromHeader('MAP_kPa')).toBe('kPa');
    expect(parseUnitFromHeader('boost psi')).toBe('psi');
  });

  it('returns null when the header carries no unit', () => {
    expect(parseUnitFromHeader('Lambda')).toBeNull();
  });

  it('normalises tool-specific spellings', () => {
    expect(unitFromToken('DegC')).toBe('C');
    expect(unitFromToken('PSI')).toBe('psi');
    expect(unitFromToken('%')).toBe('percent');
  });
});
