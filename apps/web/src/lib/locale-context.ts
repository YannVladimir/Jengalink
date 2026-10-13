import type { Locale } from '@jengalink/i18n';
import { createContext, useContext } from 'react';

export const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => Promise<void> }>({
  locale: 'en',
  setLocale: async () => {},
});

export const useLocale = () => useContext(LocaleContext);
