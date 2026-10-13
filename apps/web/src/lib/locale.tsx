import { isLocale, resolveLocale, type Locale } from '@jengalink/i18n';
import { I18nProvider } from '@jengalink/i18n/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import { LocaleContext } from './locale-context';

const KEY = 'jengalink.locale';
const savedLocale = (): Locale | null => {
  try {
    const v = localStorage.getItem(KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
};

/**
 * The language: the signed-in user's profile, else this browser's last choice,
 * else the browser's own language. Changing it saves both places.
 */
export function LocaleRoot({ children }: { children: ReactNode }) {
  const { user, updateMe } = useAuth();
  const [local, setLocal] = useState<Locale>(() => savedLocale() ?? resolveLocale(navigator.language));
  const locale: Locale = user && isLocale(user.locale) ? user.locale : local;

  const setLocale = useCallback(
    async (next: Locale) => {
      setLocal(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* private mode */
      }
      if (user && user.locale !== next) await updateMe({ locale: next });
    },
    [user, updateMe],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </LocaleContext.Provider>
  );
}
