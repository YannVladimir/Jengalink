import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTranslator, defaultLocale, type Locale, type Translate } from './index';

interface I18nValue {
  locale: Locale;
  t: Translate;
}

const I18nContext = createContext<I18nValue>({ locale: defaultLocale, t: createTranslator(defaultLocale) });

/** Provides the current language to every screen and shared component (web and mobile). */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: createTranslator(locale) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** `const { t, locale } = useI18n();` */
export const useI18n = (): I18nValue => useContext(I18nContext);
