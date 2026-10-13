import type { AppLocale, MeResponse, OtpChannel, StartOtpResponse, UpdateMeRequest, VerifyOtpResponse } from '@jengalink/contracts';
import { ApiError, createJengaClient, request } from '@jengalink/contracts/client';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { clearOffline } from './offline-store';

export { ApiError };

// On a phone, set EXPO_PUBLIC_API_URL to http://<your-PC-LAN-IP>:3000.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const REFRESH_KEY = 'jengalink.refreshToken';
const PROFILE_KEY = 'jengalink.profile';

/** Values in the OS keychain/keystore; the web preview falls back to localStorage. */
const secure = (key: string) => ({
  get: () => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null) : SecureStore.getItemAsync(key)),
  set: (v: string) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.setItem(key, v)) : SecureStore.setItemAsync(key, v)),
  clear: () => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.removeItem(key)) : SecureStore.deleteItemAsync(key)),
});
const store = secure(REFRESH_KEY);
/** This phone's Expo push token, so signing out can stop its pushes (lib/push.tsx). */
export const pushTokenStore = secure('jengalink.pushToken');
/** The last profile seen, so the app opens offline instead of asking to sign in again. */
const profile = {
  ...secure(PROFILE_KEY),
  read: async (): Promise<MeResponse | null> => {
    try {
      const v = await secure(PROFILE_KEY).get();
      return v ? (JSON.parse(v) as MeResponse) : null;
    } catch {
      return null;
    }
  },
  save: (me: MeResponse) =>
    secure(PROFILE_KEY)
      .set(JSON.stringify(me))
      .catch(() => undefined),
};

/**
 * One refresh at a time: refresh tokens are single-use, so two parallel refreshes with the same
 * token look like theft to the server (reuse detection) and end the session.
 */
let refreshing: Promise<'ok' | 'offline' | 'ended'> | null = null;

/** Short-lived access token, kept in memory only. */
const session = { accessToken: null as string | null };

/** Typed client generated from the API's OpenAPI document. */
export const api = createJengaClient({ baseUrl: API_URL, getAccessToken: () => session.accessToken });

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: Status;
  user: MeResponse | null;
  startOtp: (channel: OtpChannel, destination: string, locale?: AppLocale) => Promise<StartOtpResponse>;
  verifyOtp: (challengeId: string, code: string, locale?: AppLocale) => Promise<VerifyOtpResponse>;
  updateMe: (patch: UpdateMeRequest) => Promise<void>;
  signOut: () => Promise<void>;
  /** Runs an authenticated call; on 401 refreshes the access token once and retries. */
  withRefresh: <T>(call: () => Promise<T>) => Promise<T>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<MeResponse | null>(null);

  /** 'ok', 'offline' (keep the saved session), or 'ended' (none saved, or the server said 401). */
  const refreshSession = useCallback((): Promise<'ok' | 'offline' | 'ended'> => {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }, []);
  const doRefresh = async (): Promise<'ok' | 'offline' | 'ended'> => {
    const refreshToken = await store.get();
    if (!refreshToken) return 'ended';
    try {
      const t = await request(() => api.POST('/v1/auth/refresh', { body: { refreshToken } }));
      session.accessToken = t.accessToken;
      await store.set(t.refreshToken);
      return 'ok';
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await store.clear();
        return 'ended';
      }
      return 'offline';
    }
  };
  const refresh = useCallback(async () => (await refreshSession()) === 'ok', [refreshSession]);

  const withRefresh = useCallback(
    async <T,>(call: () => Promise<T>): Promise<T> => {
      try {
        return await call();
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401 || !(await refresh())) throw err;
        return call();
      }
    },
    [refresh],
  );

  // Restore the session on launch, cache first: with a saved session and profile the app opens at
  // once (Home from the phone's copy) and the session is refreshed in the background; requests made
  // meanwhile wait for that refresh. Only a 401 from the server ends it (signed out elsewhere).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [saved, token] = await Promise.all([profile.read(), store.get()]);
      if (saved && token) {
        if (cancelled) return;
        setUser(saved);
        setStatus('signedIn');
        const outcome = await refreshSession();
        if (cancelled) return;
        if (outcome === 'ended') {
          await profile.clear();
          clearOffline();
          setUser(null);
          setStatus('signedOut');
        } else if (outcome === 'ok') {
          const me = await request(() => api.GET('/v1/me')).catch(() => null);
          if (me && !cancelled) {
            void profile.save(me);
            setUser(me);
          }
        }
        return;
      }
      const outcome = await refreshSession();
      let me: MeResponse | null = null;
      if (outcome === 'ok') me = await request(() => api.GET('/v1/me')).catch(() => profile.read());
      else if (outcome === 'offline') me = await profile.read();
      if (outcome === 'ended') await profile.clear();
      if (cancelled) return;
      if (me) void profile.save(me);
      setUser(me);
      setStatus(me ? 'signedIn' : 'signedOut');
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      withRefresh,
      startOtp: (channel, destination, locale) => request(() => api.POST('/v1/auth/otp/start', { body: { channel, destination, locale } })),
      verifyOtp: async (challengeId, code, locale) => {
        const res = await request(() => api.POST('/v1/auth/otp/verify', { body: { challengeId, code, locale, deviceName: `${Platform.OS} app` } }));
        session.accessToken = res.accessToken;
        await store.set(res.refreshToken);
        void profile.save(res.user);
        setUser(res.user);
        setStatus('signedIn');
        return res;
      },
      updateMe: async (patch) => {
        // If-Match: only applies if the profile has not changed since we read it (spec §19.1).
        const me = await withRefresh(() => request(() => api.PATCH('/v1/me', { body: patch, params: { header: { 'If-Match': `"${user?.revision ?? 0}"` } } })));
        void profile.save(me);
        setUser(me);
      },
      signOut: async () => {
        // This phone stops receiving the account's pushes before the session ends.
        const pushToken = await pushTokenStore.get();
        if (pushToken) await withRefresh(() => request(() => api.POST('/v1/me/push-devices/remove', { body: { token: pushToken } }))).catch(() => undefined);
        await pushTokenStore.clear();
        await withRefresh(() => request(() => api.POST('/v1/auth/logout'))).catch(() => undefined);
        session.accessToken = null;
        await store.clear();
        await profile.clear();
        // The device copy (drafts, queued updates, cached lists) ends with the session (spec §3.3).
        clearOffline();
        setUser(null);
        setStatus('signedOut');
      },
    }),
    [status, user, withRefresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
