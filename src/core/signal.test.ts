import { describe, expect, it } from 'vitest';
import {
  detrendLinear,
  estimateSampleRate,
  localQuadratic,
  resampleLinear,
  resampleOnAxis,
  rms,
  uniformGrid,
} from './signal';

describe('resampling', () => {
  it('interpolates onto a uniform grid', () => {
    const t = [0, 0.2, 0.4];
    const v = [0, 2, 4];
    const grid = uniformGrid(0, 0.4, 10);
    const out = resampleLinear(t, v, grid);
    expect(Array.from(out)).toEqual([0, 1, 2, 3, 4]);
  });

  it('refuses to interpolate across a long gap', () => {
    // Bridging a 2 s dropout at 10 Hz would fabricate twenty samples of exactly
    // the transient the detectors look for.
    const t = [0, 0.1, 2.1, 2.2];
    const v = [10, 10, 50, 50];
    const grid = uniformGrid(0, 2.2, 10);
    const out = resampleLinear(t, v, grid, 0.5);
    expect(out[10]).toBeNaN(); // 1.0 s, mid-gap
    expect(out[1]).toBeCloseTo(10, 6);
    expect(out[22]).toBeCloseTo(50, 6);
  });

  it('estimates the sample rate from the median interval', () => {
    const t = [0, 0.1, 0.2, 0.3, 30, 30.1, 30.2];
    // A single long pause must not halve the reported rate.
    expect(estimateSampleRate(t)).toBeCloseTo(10, 6);
  });
});

describe('local quadratic fit', () => {
  it('recovers the derivative of a known ramp', () => {
    const dt = 0.1;
    const n = 50;
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) values[i] = 3 * (i * dt); // 3 m/s²
    const { slope } = localQuadratic(values, dt, 5);
    expect(slope[25]).toBeCloseTo(3, 6);
  });

  it('recovers the derivative of a quadratic exactly', () => {
    const dt = 0.1;
    const n = 60;
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      values[i] = 2 + 1.5 * t + 0.5 * t * t;
    }
    const { slope, value } = localQuadratic(values, dt, 5);
    const t = 30 * dt;
    expect(slope[30]).toBeCloseTo(1.5 + t, 6);
    expect(value[30]).toBeCloseTo(2 + 1.5 * t + 0.5 * t * t, 6);
  });

  it('suppresses quantisation noise in the derivative', () => {
    // A constant 2 m/s² ramp, quantised to 1 km/h like a real OBD-2 speed channel.
    const dt = 0.1;
    const n = 100;
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const v = 20 + 2 * (i * dt);
      raw[i] = Math.round((v * 3.6) / 1) / 3.6;
    }
    const { slope } = localQuadratic(raw, dt, 5);
    for (let i = 20; i < 80; i++) {
      expect(Math.abs((slope[i] as number) - 2)).toBeLessThan(0.6);
    }
  });

  it('survives NaN gaps', () => {
    const values = new Float64Array([1, 2, NaN, 4, 5, 6, 7]);
    const { slope } = localQuadratic(values, 1, 2);
    expect(Number.isFinite(slope[3] as number)).toBe(true);
  });
});

describe('detrending', () => {
  it('removes a ramp and keeps the ripple', () => {
    const values: number[] = [];
    for (let i = 0; i < 100; i++) values.push(10 + 0.5 * i + Math.sin(i / 3));
    const residual = detrendLinear(values);
    expect(Math.abs(rms(residual) - Math.SQRT1_2)).toBeLessThan(0.1);
  });

  it('flattens a pure ramp to nothing', () => {
    const values = Array.from({ length: 50 }, (_, i) => 3 * i + 7);
    expect(rms(detrendLinear(values))).toBeLessThan(1e-9);
  });
});

describe('resampling onto an axis', () => {
  it('puts a curve on a common rpm axis', () => {
    const rpm = [2000, 3000, 4000];
    const power = [100, 200, 260];
    const out = resampleOnAxis(rpm, power, [2000, 2500, 3000, 3500, 4000]);
    expect(Array.from(out)).toEqual([100, 150, 200, 230, 260]);
  });

  it('returns NaN outside the covered range rather than extrapolating', () => {
    const out = resampleOnAxis([3000, 4000], [200, 250], [2000, 3500, 5000]);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeCloseTo(225, 6);
    expect(out[2]).toBeNaN();
  });
});
