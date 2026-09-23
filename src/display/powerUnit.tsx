/**
 * The unit power is shown in: PS (the default — what European tuners, map-pack
 * viewers and dyno sheets quote), mechanical hp, or kW.
 *
 * The pipeline computes in hp and never changes; this is a display conversion
 * only, applied at the last moment. Every factor here is a positive constant, so
 * an interval converts exactly: the bounds scale with the value.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PHYSICS } from '../core/constants';
import type { Estimate } from '../core/types';

export type PowerUnit = 'PS' | 'hp' | 'kW';

export const POWER_UNITS: readonly PowerUnit[] = ['PS', 'hp', 'kW'];

/** Multiply a value in mechanical hp by this to get the unit. */
export const FROM_HP: Record<PowerUnit, number> = {
  PS: PHYSICS.wattsPerHp / PHYSICS.wattsPerPs,
  hp: 1,
  kW: PHYSICS.wattsPerHp / 1000,
};

export function convertHp(value: number, unit: PowerUnit): number {
  return value * FROM_HP[unit];
}

export function convertEstimate(estimate: Estimate, unit: PowerUnit): Estimate {
  const f = FROM_HP[unit];
  return { value: estimate.value * f, sd: estimate.sd * f, lo: estimate.lo * f, hi: estimate.hi * f };
}

interface PowerUnitContext {
  readonly unit: PowerUnit;
  readonly setUnit: (unit: PowerUnit) => void;
  readonly power: (hp: number) => number;
  readonly powerEstimate: (estimate: Estimate) => Estimate;
}

const Context = createContext<PowerUnitContext | null>(null);
const STORAGE_KEY = 'tuneverdict.powerUnit';

function initial(): PowerUnit {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'PS' || stored === 'hp' || stored === 'kW') return stored;
  } catch {
    // Storage unavailable: the default is still right.
  }
  return 'PS';
}

export function PowerUnitProvider({ children }: { children: ReactNode }): JSX.Element {
  const [unit, setUnitState] = useState<PowerUnit>(initial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, unit);
    } catch {
      // Not remembered, but still applied.
    }
  }, [unit]);

  const setUnit = useCallback((next: PowerUnit) => setUnitState(next), []);
  const power = useCallback((hp: number) => convertHp(hp, unit), [unit]);
  const powerEstimate = useCallback((e: Estimate) => convertEstimate(e, unit), [unit]);

  const value = useMemo(() => ({ unit, setUnit, power, powerEstimate }), [unit, setUnit, power, powerEstimate]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePowerUnit(): PowerUnitContext {
  const context = useContext(Context);
  if (!context) throw new Error('usePowerUnit must be used inside a PowerUnitProvider');
  return context;
}

/** Segmented control for the power unit. Real buttons, one pressed at a time. */
export function PowerUnitToggle({ label }: { label: string }): JSX.Element {
  const { unit, setUnit } = usePowerUnit();
  return (
    <div className="segmented" role="group" aria-label={label}>
      {POWER_UNITS.map((option) => (
        <button
          key={option}
          type="button"
          className={option === unit ? 'is-active' : undefined}
          aria-pressed={option === unit}
          onClick={() => setUnit(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
