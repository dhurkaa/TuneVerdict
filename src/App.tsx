/**
 * Application shell and state.
 *
 * Two screens, one piece of state: either two sessions are loaded and analysed,
 * or they are not. Everything — parsing, resampling, segmentation, DTW alignment,
 * detection, Monte Carlo, report generation — runs here, in the browser, on the
 * main thread. The analysis has no backend, no database and no API key; the only
 * server code is the optional AI explanation endpoint (api/explain.ts), which
 * holds the operator's key so that no key ever reaches the browser.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImportScreen } from './components/ImportScreen';
import type { LoadedFile } from './components/FileDrop';
import { ResultScreen } from './components/ResultScreen';
import { Mark } from './components/ui';
import { VEHICLE_DEFAULTS } from './core/constants';
import { ImportError, importCsv } from './core/import';
import { AnalysisError, analyse } from './core/pipeline';
import { buildReport, downloadReport } from './report/buildReport';
import { LANGUAGE_NAMES, useI18n } from './i18n';
import type { Language, TranslationKey } from './i18n';
import type { AnalysisResult, VehicleParameters } from './core/types';
import type { AiSummary } from './components/AiSummaryPanel';
import { usePowerUnit } from './display/powerUnit';

type Slot = 'before' | 'after';

/**
 * A failure, kept as a key and its substitutions rather than as a finished
 * sentence. Translating at the point of failure would freeze the message in
 * whichever language was active at the time, and would make every function that
 * can fail depend on the translator — which is how switching language ends up
 * discarding a completed analysis.
 */
interface Failure {
  readonly key: string;
  readonly detail: Record<string, string | number>;
}

/** A slot's raw text is kept so the log can be re-read when the fuel type changes. */
interface Slotstate {
  readonly name: string;
  readonly text: string;
  readonly loaded: LoadedFile | null;
  readonly error: Failure | null;
  readonly busy: boolean;
}

const EMPTY_SLOT: Slotstate = { name: '', text: '', loaded: null, error: null, busy: false };

function toFailure(error: unknown, label: string): Failure {
  if (error instanceof ImportError || error instanceof AnalysisError) {
    return { key: error.key, detail: { label, ...error.detail } };
  }
  return { key: 'import.error.read', detail: { label } };
}

const DEFAULT_VEHICLE: VehicleParameters = {
  massKg: VEHICLE_DEFAULTS.massKg,
  massWeighed: false,
  dragAreaM2: VEHICLE_DEFAULTS.dragAreaM2,
  rollingResistance: VEHICLE_DEFAULTS.rollingResistance,
  drivetrainEfficiency: VEHICLE_DEFAULTS.drivetrainEfficiency,
  rotationalInertiaFactor: VEHICLE_DEFAULTS.rotationalInertiaFactor,
  fuel: 'gasoline',
  correctionStandard: 'SAE J1349',
};

export function App(): JSX.Element {
  const i18n = useI18n();
  const { t } = i18n;
  const { unit: powerUnit } = usePowerUnit();

  const [slots, setSlots] = useState<Record<Slot, Slotstate>>({
    before: EMPTY_SLOT,
    after: EMPTY_SLOT,
  });
  const [vehicle, setVehicle] = useState<VehicleParameters>(DEFAULT_VEHICLE);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [analysisFailure, setAnalysisFailure] = useState<Failure | null>(null);

  const describe = useCallback(
    (failure: Failure | null): string | null =>
      failure === null ? null : t(failure.key as TranslationKey, failure.detail),
    [t],
  );

  const readInto = useCallback(
    (name: string, text: string, fuel: VehicleParameters['fuel']): Slotstate => {
      try {
        const { session, report } = importCsv(text, name, { fuel });
        return { name, text, loaded: { name, session, report }, error: null, busy: false };
      } catch (error) {
        return { name, text, loaded: null, error: toFailure(error, name), busy: false };
      }
    },
    [],
  );

  const handleFile = useCallback(
    async (slot: Slot, file: File): Promise<void> => {
      setSlots((current) => ({ ...current, [slot]: { ...EMPTY_SLOT, name: file.name, busy: true } }));
      setResult(null);
      setAnalysisFailure(null);
      try {
        const text = await file.text();
        setSlots((current) => ({ ...current, [slot]: readInto(file.name, text, vehicle.fuel) }));
      } catch (error) {
        setSlots((current) => ({
          ...current,
          [slot]: { ...EMPTY_SLOT, name: file.name, error: toFailure(error, file.name) },
        }));
      }
    },
    [readInto, vehicle.fuel],
  );

  // A logged AFR column means something different on E85 than on petrol, so the
  // fuel type is not a display setting — changing it re-reads both logs.
  useEffect(() => {
    setSlots((current) => {
      const next = { ...current };
      let changed = false;
      for (const slot of ['before', 'after'] as Slot[]) {
        const state = current[slot];
        if (state.text === '') continue;
        next[slot] = readInto(state.name, state.text, vehicle.fuel);
        changed = true;
      }
      return changed ? next : current;
    });
    setResult(null);
  }, [vehicle.fuel, readInto]);

  const handleClear = useCallback((slot: Slot): void => {
    setSlots((current) => ({ ...current, [slot]: EMPTY_SLOT }));
    setResult(null);
    setAnalysisFailure(null);
  }, []);

  const handleAnalyse = useCallback((): void => {
    const before = slots.before.loaded;
    const after = slots.after.loaded;
    if (!before || !after) return;

    setAnalysing(true);
    setAnalysisFailure(null);
    // Yield a frame so the button can show its working state before the main
    // thread is occupied by the Monte Carlo.
    window.setTimeout(() => {
      try {
        setResult(analyse(before.session, after.session, vehicle));
      } catch (error) {
        setResult(null);
        setAnalysisFailure(toFailure(error, before.name));
      } finally {
        setAnalysing(false);
      }
    }, 30);
  }, [slots, vehicle]);

  const handleExport = useCallback((): void => {
    if (!result) return;
    setExporting(true);
    window.setTimeout(() => {
      try {
        const summary = aiSummary && aiSummary.resultId === result.computedAt ? aiSummary : null;
        const blob = buildReport(result, i18n, summary, powerUnit);
        const stamp = result.computedAt.slice(0, 10);
        downloadReport(blob, `tuneverdict-${stamp}.pdf`);
      } finally {
        setExporting(false);
      }
    }, 30);
  }, [result, i18n, aiSummary, powerUnit]);

  const errors = useMemo(
    () => ({ before: describe(slots.before.error), after: describe(slots.after.error) }),
    [slots.before.error, slots.after.error, describe],
  );
  const busy = useMemo(
    () => ({ before: slots.before.busy, after: slots.after.busy }),
    [slots.before.busy, slots.after.busy],
  );

  return (
    <div className="app">
      <Header />
      <main className="container" style={{ paddingBottom: 'var(--space-4)', flex: 1 }}>
        {result ? (
          <ResultScreen
            result={result}
            onBack={() => setResult(null)}
            onExport={handleExport}
            exporting={exporting}
            aiSummary={aiSummary}
            onAiSummary={setAiSummary}
          />
        ) : (
          <ImportScreen
            before={slots.before.loaded}
            after={slots.after.loaded}
            errors={errors}
            busy={busy}
            analysing={analysing}
            analysisError={describe(analysisFailure)}
            vehicle={vehicle}
            onVehicleChange={setVehicle}
            onFile={(slot, file) => void handleFile(slot, file)}
            onClear={handleClear}
            onAnalyse={handleAnalyse}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

function Header(): JSX.Element {
  const { t, language, setLanguage } = useI18n();
  const [theme, setTheme] = useTheme();

  return (
    <header
      className="no-print"
      style={{ borderBottom: '1px solid var(--line)', marginBottom: 'var(--space-4)' }}
    >
      <div
        className="container row-between"
        style={{ paddingTop: 'var(--space-3)', paddingBottom: 'var(--space-3)', flexWrap: 'wrap' }}
      >
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <Mark size={26} />
          <div className="stack" style={{ gap: 2 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>
              {t('app.title')}
            </h1>
            <span className="field-hint">{t('app.tagline')}</span>
          </div>
        </div>

        <div className="row">
          <label className="visually-hidden" htmlFor="language">
            {t('app.language')}
          </label>
          <select
            id="language"
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
            style={{ width: 'auto', height: 36 }}
          >
            {(Object.keys(LANGUAGE_NAMES) as Language[]).map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button-small"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={t(theme === 'dark' ? 'app.theme.toLight' : 'app.theme.toDark')}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </div>
    </header>
  );
}

function Footer(): JSX.Element {
  const { t } = useI18n();
  return (
    <footer
      className="no-print"
      style={{ borderTop: '1px solid var(--line)', padding: 'var(--space-3) 0' }}
    >
      <div className="container stack" style={{ gap: 4 }}>
        <span className="field-hint">{t('app.privacy')}</span>
        <span className="field-hint">{t('app.thesis')}</span>
      </div>
    </footer>
  );
}

type Theme = 'dark' | 'light';

/**
 * Dark is the default because curves read better on it and the work happens on a
 * laptop in a workshop. Light exists because dark screenshots print as a smudge
 * in an A4 thesis, so the choice is remembered rather than asked for twice.
 */
function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem('tuneverdict.theme');
      if (stored === 'dark' || stored === 'light') return stored;
    } catch {
      // Storage unavailable; the default is still correct.
    }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('tuneverdict.theme', theme);
    } catch {
      // Ignored: a working application matters more than a remembered preference.
    }
  }, [theme]);

  return [theme, setTheme];
}
