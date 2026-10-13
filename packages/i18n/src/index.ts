// Translations for every JengaLink surface (apps, shared UI, API messages).
// English is the source; rw, fr and sw mirror its keys. Missing text falls back to English.
import { en } from './locales/en';
import { fr } from './locales/fr';
import { rw } from './locales/rw';
import { sw } from './locales/sw';

export const locales = ['en', 'rw', 'fr', 'sw'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/** The shape every catalog must have: same keys as English; strings or plural forms at the leaves. */
export type Catalog<T = typeof en> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends boolean
      ? boolean
      : T[K] extends { other: string }
        ? PluralForms
        : Catalog<T[K]>;
};

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | { other: string }
    ? `${P}${K}`
    : T[K] extends boolean
      ? never
      : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every translatable key, e.g. "auth.sendCode". Typos are compile errors. */
export type MessageKey = Leaves<Omit<typeof en, 'meta'>>;
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

export const catalogs: Record<Locale, Catalog> = { en, rw, fr, sw };

/** Name of each language in that language, for the picker. */
export const languageNames: Record<Locale, string> = {
  en: en.meta.name,
  rw: rw.meta.name,
  fr: fr.meta.name,
  sw: sw.meta.name,
};

/** False until a native speaker has reviewed the catalog. */
export const isReviewed = (locale: Locale) => catalogs[locale].meta.reviewed;

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (locales as readonly string[]).includes(value);

/** "fr-FR", "sw_KE", "kin", "rw-RW" → a supported locale, else the default. */
export function resolveLocale(tag: string | null | undefined): Locale {
  if (!tag) return defaultLocale;
  const base = tag.toLowerCase().split(/[-_]/)[0];
  if (base === 'kin') return 'rw';
  if (base === 'swa') return 'sw';
  if (base === 'fra' || base === 'fre') return 'fr';
  return isLocale(base) ? base : defaultLocale;
}

function lookup(catalog: Catalog, key: string): string | PluralForms | undefined {
  let node: unknown = catalog;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object' && typeof (node as PluralForms).other === 'string') return node as PluralForms;
  return undefined;
}

const pluralRules = new Map<Locale, Intl.PluralRules | null>();
function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  if (!pluralRules.has(locale)) {
    try {
      pluralRules.set(locale, new Intl.PluralRules(locale));
    } catch {
      pluralRules.set(locale, null);
    }
  }
  return pluralRules.get(locale)?.select(count) ?? (count === 1 ? 'one' : 'other');
}

const interpolate = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;

/** A translate function for one language. Unknown keys return the key itself (visible in testing). */
export function createTranslator(locale: Locale): Translate {
  return (key, params) => {
    const entry = lookup(catalogs[locale], key) ?? lookup(catalogs.en, key);
    if (entry === undefined) return key;
    if (typeof entry === 'string') return interpolate(entry, params);
    const count = Number(params?.count ?? 0);
    const exact = count === 0 && entry.zero ? entry.zero : undefined;
    return interpolate(exact ?? entry[pluralCategory(locale, count)] ?? entry.other, params);
  };
}

/** Intl locale for formatting; falls back when a runtime lacks data for a language (e.g. rw on some phones). */
export function intlLocale(locale: Locale): string {
  const wanted = { en: 'en-GB', rw: 'rw-RW', fr: 'fr-FR', sw: 'sw-KE' }[locale];
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([wanted]).length ? wanted : 'en-GB';
  } catch {
    return 'en-GB';
  }
}

/** "5 Oct" in the user's language. */
export const formatShortDate = (locale: Locale, iso: string | Date) =>
  new Date(iso).toLocaleDateString(intlLocale(locale), { day: 'numeric', month: 'short' });

/** "5 Oct 2026" in the user's language. */
export const formatDate = (locale: Locale, iso: string | Date, timeZone?: string) =>
  new Date(iso).toLocaleDateString(intlLocale(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone });

/** "3 Nov, 09:15" in the user's language (device time zone). */
export const formatDateTime = (locale: Locale, iso: string | Date) =>
  new Date(iso).toLocaleString(intlLocale(locale), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** "Mon" in the user's language. */
export const formatWeekday = (locale: Locale, iso: string | Date) =>
  new Date(iso).toLocaleDateString(intlLocale(locale), { weekday: 'short' });

/** "just now" / "5 min ago" / "3 h ago" / "2 days ago" / a date. */
export function formatUpdatedAgo(t: Translate, locale: Locale, date: Date | string, now: Date = new Date()): string {
  const then = typeof date === 'string' ? new Date(date) : date;
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (minutes < 1) return t('common.justNow');
  if (minutes < 60) return t('common.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('common.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('common.daysAgo', { count: days });
  return formatDate(locale, then);
}

/** "5 h" / "3 days": how long something has been waiting. */
export function formatDuration(t: Translate, iso: string, now = Date.now()): string {
  const hours = Math.floor((now - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return t('common.justNow');
  if (hours < 24) return t('common.durationHours', { count: hours });
  return t('common.durationDays', { count: Math.floor(hours / 24) });
}

export { en };
