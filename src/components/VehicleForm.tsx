/**
 * The car's description, compact.
 *
 * Power is inferred from how hard the car accelerated, so these values are half the
 * measurement. Mass carries most of the uncertainty budget, which is why it leads
 * the row and has the only checkbox; the parameters a tuner rarely changes (drag
 * area, rolling resistance, drivetrain efficiency, inertia) fold away under
 * "Advanced" rather than filling the screen.
 */

import { useId } from 'react';
import { useI18n } from '../i18n';
import { Field } from './ui';
import type { VehicleParameters } from '../core/types';

export function VehicleForm({
  value,
  onChange,
}: {
  value: VehicleParameters;
  onChange: (next: VehicleParameters) => void;
}): JSX.Element {
  const { t } = useI18n();
  const ids = {
    mass: useId(),
    weighed: useId(),
    drag: useId(),
    rolling: useId(),
    efficiency: useId(),
    inertia: useId(),
    fuel: useId(),
    standard: useId(),
  };

  const set = <K extends keyof VehicleParameters>(key: K, next: VehicleParameters[K]): void =>
    onChange({ ...value, [key]: next });

  const number = (raw: string, fallback: number): number => {
    const parsed = Number.parseFloat(raw.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return (
    <div className="stack" style={{ gap: 'var(--space-1)' }}>
      <div className="car-row">
        <Field label={`${t('import.vehicle.mass')} (${t('unit.kg')})`} htmlFor={ids.mass}>
          <input
            id={ids.mass}
            type="number"
            inputMode="decimal"
            min={400}
            max={5000}
            step={1}
            value={value.massKg}
            onChange={(event) => set('massKg', number(event.target.value, value.massKg))}
          />
        </Field>
        <div className="row" style={{ height: 'var(--control-height)', gap: 8 }}>
          <input
            id={ids.weighed}
            type="checkbox"
            checked={value.massWeighed}
            onChange={(event) => set('massWeighed', event.target.checked)}
          />
          <label htmlFor={ids.weighed} style={{ whiteSpace: 'nowrap' }}>
            {t('import.vehicle.massWeighed')}
          </label>
        </div>
        <Field label={t('import.vehicle.fuel')} htmlFor={ids.fuel}>
          <select
            id={ids.fuel}
            value={value.fuel}
            onChange={(event) => set('fuel', event.target.value as VehicleParameters['fuel'])}
          >
            <option value="gasoline">{t('import.fuel.gasoline')}</option>
            <option value="diesel">{t('import.fuel.diesel')}</option>
            <option value="e85">{t('import.fuel.e85')}</option>
            <option value="lpg">{t('import.fuel.lpg')}</option>
          </select>
        </Field>
        <Field label={t('import.vehicle.standard')} htmlFor={ids.standard}>
          <select
            id={ids.standard}
            value={value.correctionStandard}
            onChange={(event) =>
              set('correctionStandard', event.target.value as VehicleParameters['correctionStandard'])
            }
          >
            <option value="SAE J1349">SAE J1349</option>
            <option value="DIN 70020">DIN 70020</option>
          </select>
        </Field>
      </div>
      <span className="field-hint">{t('import.vehicle.massShortHint')}</span>

      <details>
        <summary>{t('import.vehicle.advanced')}</summary>
        <div className="stack" style={{ marginTop: 'var(--space-2)' }}>
          <div className="car-row" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <Field label={`${t('import.vehicle.dragArea')} (m²)`} htmlFor={ids.drag}>
              <input
                id={ids.drag}
                type="number"
                inputMode="decimal"
                min={0.2}
                max={2}
                step={0.01}
                value={value.dragAreaM2}
                onChange={(event) => set('dragAreaM2', number(event.target.value, value.dragAreaM2))}
              />
            </Field>
            <Field label={t('import.vehicle.rolling')} htmlFor={ids.rolling}>
              <input
                id={ids.rolling}
                type="number"
                inputMode="decimal"
                min={0.005}
                max={0.03}
                step={0.001}
                value={value.rollingResistance}
                onChange={(event) => set('rollingResistance', number(event.target.value, value.rollingResistance))}
              />
            </Field>
            <Field label={t('import.vehicle.efficiency')} htmlFor={ids.efficiency}>
              <input
                id={ids.efficiency}
                type="number"
                inputMode="decimal"
                min={0.6}
                max={0.98}
                step={0.01}
                value={value.drivetrainEfficiency}
                onChange={(event) =>
                  set('drivetrainEfficiency', number(event.target.value, value.drivetrainEfficiency))
                }
              />
            </Field>
            <Field label={t('import.vehicle.inertia')} htmlFor={ids.inertia}>
              <input
                id={ids.inertia}
                type="number"
                inputMode="decimal"
                min={1}
                max={1.3}
                step={0.01}
                value={value.rotationalInertiaFactor}
                onChange={(event) =>
                  set('rotationalInertiaFactor', number(event.target.value, value.rotationalInertiaFactor))
                }
              />
            </Field>
          </div>
          <p className="field-hint">{t('import.vehicle.massHint')}</p>
          <p className="field-hint">{t('import.vehicle.fuelHint')}</p>
          <p className="field-hint">{t('import.vehicle.standardHint')}</p>
        </div>
      </details>
    </div>
  );
}
