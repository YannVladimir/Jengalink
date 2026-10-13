import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  catalogs,
  createTranslator,
  formatUpdatedAgo,
  isReviewed,
  locales,
  resolveLocale,
} from './index';

type Tree = { [k: string]: string | boolean | Tree };

/** Every leaf path with its text (plural forms flattened as path#form). */
function leaves(node: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(node)) {
    if (k === 'meta') continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(path, v);
    else if (typeof v === 'object') for (const [p, t] of leaves(v, path)) out.set(p, t);
  }
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const baseKey = (path: string) => path.replace(/\.(zero|one|two|few|many|other)$/, '');

const english = leaves(catalogs.en as unknown as Tree);

for (const locale of locales.filter((l) => l !== 'en')) {
  test(`${locale}: has every English message, with the same placeholders`, () => {
    const other = leaves(catalogs[locale] as unknown as Tree);
    const missing = [...english.keys()].filter((k) => !other.has(k) && !k.endsWith('.one'));
    assert.deepEqual(missing, [], `${locale} is missing: ${missing.join(', ')}`);
    const extra = [...other.keys()].filter((k) => !english.has(k) && !english.has(`${baseKey(k)}.other`));
    assert.deepEqual(extra, [], `${locale} has unknown keys: ${extra.join(', ')}`);
    for (const [k, text] of other) {
      const source = english.get(k) ?? english.get(`${baseKey(k)}.other`)!;
      // Plural "one" forms may omit {count}; everything else must keep the same placeholders.
      if (k.endsWith('.one')) continue;
      assert.equal(placeholders(text), placeholders(source), `${locale} ${k}: placeholders differ`);
    }
  });
}

test('translates with placeholders and falls back to English', () => {
  const fr = createTranslator('fr');
  assert.equal(fr('auth.sendCode'), 'Envoyer le code');
  assert.equal(fr('claim.approve', { amount: 'RWF 3,000,000' }), 'Approuver RWF 3,000,000');
  assert.equal(createTranslator('rw')('common.appName'), 'JengaLink');
});

test('picks plural forms by language rules', () => {
  assert.equal(createTranslator('en')('home.decisions', { count: 1 }), '1 decision needs you');
  assert.equal(createTranslator('en')('home.decisions', { count: 2 }), '2 decisions need you');
  assert.equal(createTranslator('fr')('home.decisions', { count: 2 }), '2 décisions vous attendent');
  assert.equal(createTranslator('sw')('home.decisions', { count: 3 }), 'Maamuzi 3 yanakusubiri');
});

test('maps device languages to the four supported ones', () => {
  assert.equal(resolveLocale('fr-FR'), 'fr');
  assert.equal(resolveLocale('sw_KE'), 'sw');
  assert.equal(resolveLocale('kin'), 'rw');
  assert.equal(resolveLocale('rw-RW'), 'rw');
  assert.equal(resolveLocale('de-DE'), 'en');
  assert.equal(resolveLocale(undefined), 'en');
});

test('formats "updated ago" in each language', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const five = new Date('2026-10-08T11:55:00Z');
  assert.equal(formatUpdatedAgo(createTranslator('en'), 'en', five, now), '5 min ago');
  assert.equal(formatUpdatedAgo(createTranslator('fr'), 'fr', five, now), 'il y a 5 min');
  assert.equal(formatUpdatedAgo(createTranslator('sw'), 'sw', five, now), 'dakika 5 zilizopita');
});

test('flags translations that still need native-speaker review', () => {
  assert.equal(isReviewed('en'), true);
  for (const l of ['rw', 'fr', 'sw'] as const) assert.equal(isReviewed(l), false);
});
