import type { AppLocale, MeResponse, OtpChannel, StartOtpResponse, UpdateMeRequest, VerifyOtpResponse } from '@jengalink/contracts';
import { createContext, useContext } from 'react';

export type Status = 'loading' | 'signedOut' | 'signedIn';

export interface AuthState {
  status: Status;
  user: MeResponse | null;
  startOtp: (channel: OtpChannel, destination: string, locale?: AppLocale) => Promise<StartOtpResponse>;
  verifyOtp: (challengeId: string, code: string, locale?: AppLocale) => Promise<VerifyOtpResponse>;
  updateMe: (patch: UpdateMeRequest) => Promise<void>;
  signOut: () => Promise<void>;
  /** Runs an authenticated call; on 401 refreshes the access token once and retries. */
  withRefresh: <T>(call: () => Promise<T>) => Promise<T>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
