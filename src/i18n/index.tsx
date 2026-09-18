/**
 * The i18n layer.
 *
 * Albanian is the thesis language and the application default; English is the
 * repository language and the fallback. The choice is switchable at runtime and
 * remembered, because a thesis defence and a workshop are different audiences.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { en } from './en';
import type { TranslationKey } from './en';
import { sq } from './sq';

export type Language = 'sq' | 'en';

const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = { sq, en };

export const LANGUAGE_NAMES: Record<Language, string> = {
  sq: 'Shqip',
  en: 'English',
};

/** Locale used for every number the interface prints. */
const NUMBER_LOCALE: Record<Language, string> = { sq: 'sq-AL', en: 'en-GB' };

export type Substitutions = Record<string, string | number>;

export interface I18n {
  readonly language: Language;
  readonly setLanguage: (language: Language) => void;
  /** Translate a key, substituting `{name}` placeholders. */
  readonly t: (key: TranslationKey, values?: Substitutions) => string;
  /** Format a number with a fixed number of decimals, in the active locale. */
  readonly n: (value: number, digits?: number) => string;
  /** Format a number with an explicit sign — used for gains, where it matters. */
  readonly signed: (value: number, digits?: number) => string;
  readonly formatDate: (iso: string) => string;
}

const I18nContext = createContext<I18n | null>(null);

const STORAGE_KEY = 'tuneverdict.language';

function initialLanguage(): Language {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'sq' || stored === 'en') return stored;
  }
  if (typeof navigator !== 'undefined' && navigator.language.startsWith('en')) return 'en';
  return 'sq';
}

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // A browser with storage disabled still gets a working application; the
      // language simply resets on reload.
    }
  }, [language]);

  const setLanguage = useCallback((next: Language) => setLanguageState(next), []);

  const t = useCallback(
    (key: TranslationKey, values?: Substitutions): string => {
      const template = DICTIONARIES[language][key] ?? en[key] ?? key;
      if (!values) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = values[name];
        return value === undefined ? match : String(value);
      });
    },
    [language],
  );

  const n = useCallback(
    (value: number, digits = 1): string => {
      if (!Number.isFinite(value)) return '—';
      return value.toLocaleString(NUMBER_LOCALE[language], {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    },
    [language],
  );

  const signed = useCallback(
    (value: number, digits = 1): string => {
      if (!Number.isFinite(value)) return '—';
      const formatted = n(Math.abs(value), digits);
      // An explicit plus sign is not decoration here: "+36.1 hp" and "36.1 hp"
      // read differently when the number beside them might have been negative.
      return `${value >= 0 ? '+' : '−'}${formatted}`;
    },
    [n],
  );

  const formatDate = useCallback(
    (iso: string): string => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return iso;
      return date.toLocaleString(NUMBER_LOCALE[language], {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    },
    [language],
  );

  const value = useMemo<I18n>(
    () => ({ language, setLanguage, t, n, signed, formatDate }),
    [language, setLanguage, t, n, signed, formatDate],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside an I18nProvider');
  return context;
}

export type { TranslationKey };
