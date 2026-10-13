// API access for the web workspace: the typed client (generated from the API's
// OpenAPI document), the current access token, and the refresh-token store.
import { createJengaClient } from '@jengalink/contracts/client';

export { ApiError, request } from '@jengalink/contracts/client';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const REFRESH_KEY = 'jengalink.refreshToken';

// Pilot: the refresh token is kept in localStorage. Once hosting is chosen (Phase 6),
// move it to an httpOnly cookie on the API domain so page scripts cannot read it.
export const store = {
  get: () => {
    try {
      return localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  set: (v: string) => {
    try {
      localStorage.setItem(REFRESH_KEY, v);
    } catch {
      /* private mode: session lasts until the tab closes */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* nothing stored */
    }
  },
};

/** Short-lived access token, kept in memory only. */
export const session = { accessToken: null as string | null };

/** Every call is type-checked against the API contract. */
export const api = createJengaClient({ baseUrl: API_URL, getAccessToken: () => session.accessToken });
