import { describe, expect, it } from 'vitest';
import { sharedAxes, smoothSample } from './scale';

describe('sharedAxes', () => {
  it('fits the axes to the data instead of starting at zero', () => {
    const axes = sharedAxes({ min: 314, max: 440 }, { min: 150, max: 219 });
    expect(axes.leftMin).toBeGreaterThan(200);
    expect(axes.leftMin).toBeLessThanOrEqual(314);
    expect(axes.leftMax).toBeGreaterThanOrEqual(440);
    expect(axes.rightMin).toBeLessThanOrEqual(150);
    expect(axes.rightMax).toBeGreaterThanOrEqual(219);
  });

  it('gives both axes the same gridlines', () => {
    const axes = sharedAxes({ min: 314, max: 440 }, { min: 150, max: 219 });
    expect((axes.leftMax - axes.leftMin) / axes.leftStep).toBeCloseTo(axes.intervals, 9);
    expect((axes.rightMax - axes.rightMin) / axes.rightStep).toBeCloseTo(axes.intervals, 9);
  });

  it('keeps zero as the floor for data that comes near it', () => {
    expect(sharedAxes({ min: 5, max: 400 }, { min: 2, max: 200 }).leftMin).toBe(0);
  });
});

describe('smoothSample', () => {
  it('passes through every point and never overshoots the data', () => {
    const points = [
      { x: 3200, y: 379 },
      { x: 3300, y: 382 },
      { x: 3400, y: 387 },
      { x: 3500, y: 385 },
      { x: 3600, y: 376 },
      { x: 3700, y: 330 },
    ];
    const dense = smoothSample(points);
    for (const p of points) expect(dense.some((d) => d.x === p.x && Math.abs(d.y - p.y) < 1e-9)).toBe(true);
    expect(Math.max(...dense.map((d) => d.y))).toBeCloseTo(387, 9);
    expect(Math.min(...dense.map((d) => d.y))).toBeCloseTo(330, 9);
  });
});
