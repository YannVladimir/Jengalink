// How long Home took to show the project after the app started (Phase 6: under 2 s from cache on a
// cheap Android phone). Measured on the phone itself and shown in More, so a pilot device can be checked.

/** Milliseconds since the JS bundle started (performance.now() counts from there in Hermes and browsers). */
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

let homeReadyMs: number | null = null;

/** Called once, when Home first draws a project. */
export function markHomeReady() {
  if (homeReadyMs !== null) return;
  homeReadyMs = Math.round(now());
  if (__DEV__) console.log(`[perf] Home ready ${homeReadyMs} ms after start`);
  if (typeof window !== 'undefined') (window as unknown as { __homeReadyMs?: number }).__homeReadyMs = homeReadyMs;
}

export const homeReadyAfter = () => homeReadyMs;
