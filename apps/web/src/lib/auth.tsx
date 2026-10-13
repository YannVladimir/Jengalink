import type { MeResponse } from '@jengalink/contracts';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, request, session, store } from './api';
import { AuthContext, type AuthState, type Status } from './auth-context';

let refreshing: Promise<boolean> | null = null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<MeResponse | null>(null);

  const refresh = useCallback(() => {
    // One refresh at a time: refresh tokens are single-use, and a parallel second use
    // looks like theft to the server (reuse detection), which ends the session.
    refreshing ??= doRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }, []);
  const doRefresh = async () => {
    const refreshToken = store.get();
    if (!refreshToken) return false;
    try {
      const t = await request(() => api.POST('/v1/auth/refresh', { body: { refreshToken } }));
      session.accessToken = t.accessToken;
      store.set(t.refreshToken);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) store.clear();
      return false;
    }
  };

  /** Runs an authenticated call; on 401 refreshes the access token once and retries. */
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await refresh();
      const me = ok ? await request(() => api.GET('/v1/me')).catch(() => null) : null;
      if (cancelled) return;
      setUser(me);
      setStatus(me ? 'signedIn' : 'signedOut');
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      withRefresh,
      startOtp: (channel, destination, locale) =>
        request(() => api.POST('/v1/auth/otp/start', { body: { channel, destination, locale } })),
      verifyOtp: async (challengeId, code, locale) => {
        const res = await request(() =>
          api.POST('/v1/auth/otp/verify', { body: { challengeId, code, locale, deviceName: 'Web browser' } }),
        );
        session.accessToken = res.accessToken;
        store.set(res.refreshToken);
        setUser(res.user);
        setStatus('signedIn');
        return res;
      },
      updateMe: async (patch) => {
        // If-Match: only applies if the profile has not changed since we read it (spec §19.1).
        const me = await withRefresh(() =>
          request(() =>
            api.PATCH('/v1/me', { body: patch, params: { header: { 'If-Match': `"${user?.revision ?? 0}"` } } }),
          ),
        );
        setUser(me);
      },
      signOut: async () => {
        await withRefresh(() => request(() => api.POST('/v1/auth/logout'))).catch(() => undefined);
        session.accessToken = null;
        store.clear();
        setUser(null);
        setStatus('signedOut');
      },
    }),
    [status, user, withRefresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
