import { isLocale, resolveLocale, type Locale } from '@jengalink/i18n';
import { I18nProvider } from '@jengalink/i18n/react';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useAuth } from './auth';

const KEY = 'jengalink.locale';
const saved = {
  get: async (): Promise<string | null> =>
    Platform.OS === 'web' ? (globalThis.localStorage?.getItem(KEY) ?? null) : SecureStore.getItemAsync(KEY),
  set: async (v: string) =>
    Platform.OS === 'web' ? globalThis.localStorage?.setItem(KEY, v) : SecureStore.setItemAsync(KEY, v),
};

const deviceLocale = (): Locale => resolveLocale(getLocales()[0]?.languageTag);

const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => Promise<void> }>({
  locale: 'en',
  setLocale: async () => {},
});

/**
 * Chooses the language: the signed-in user's profile, else the last choice on
 * this phone, else the phone's own language. Changing it saves both places.
 */
export function LocaleRoot({ children }: { children: ReactNode }) {
  const { user, updateMe } = useAuth();
  const [local, setLocal] = useState<Locale>(deviceLocale);

  useEffect(() => {
    void saved.get().then((v) => {
      if (isLocale(v)) setLocal(v);
    });
  }, []);

  const locale: Locale = user && isLocale(user.locale) ? user.locale : local;

  const setLocale = useCallback(
    async (next: Locale) => {
      setLocal(next);
      await saved.set(next);
      if (user && user.locale !== next) await updateMe({ locale: next });
    },
    [user, updateMe],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </LocaleContext.Provider>
  );
}

export const useLocale = () => useContext(LocaleContext);
