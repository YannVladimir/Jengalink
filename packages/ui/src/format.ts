// Formatting shared by every surface. Money is integer minor units in the API
// (spec §17.1); RWF has no minor unit in practice, so amounts here are whole francs.

/** "RWF 1,500,000" — the only way an amount is ever shown. */
export function formatRwf(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  return `${sign}RWF ${groupDigits(Math.abs(Math.round(amount)))}`;
}

/** 1500000 → "1,500,000". */
export function groupDigits(value: number | string): string {
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** What the user typed in an amount field → whole francs, or null when empty. */
export function parseAmount(text: string): number | null {
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

/** "Updated just now" / "5 min ago" / "3 h ago" / "2 days ago" / a date. */
export function formatUpdatedAgo(date: Date | string, now: Date = new Date()): string {
  const then = typeof date === 'string' ? new Date(date) : date;
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`;
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole percent, clamped to 0–100. */
export const percent = (part: number, whole: number) =>
  whole <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((part / whole) * 100)));

/** "+250722345678" → "+250 72 234 5678" (Rwandan numbers); other values unchanged. */
export function formatPhone(e164: string): string {
  const m = /^\+250(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+250 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
