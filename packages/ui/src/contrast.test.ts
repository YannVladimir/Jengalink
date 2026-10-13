import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colors, contrastRatio, darkColors, statuses } from './tokens';

// WCAG AA: 4.5:1 for text, 3:1 for large text and the parts of controls and charts (1.4.3, 1.4.11).
const TEXT = 4.5;
const UI = 3;

const themes = [
  { name: 'light', c: colors, status: (s: keyof typeof statuses) => ({ color: statuses[s].color, soft: statuses[s].soft }) },
  { name: 'dark', c: darkColors, status: (s: keyof typeof statuses) => ({ color: statuses[s].darkColor, soft: statuses[s].darkSoft }) },
];

test('text on every background reaches 4.5:1, in light and dark', () => {
  const failures: string[] = [];
  for (const { name, c, status } of themes) {
    const pairs: [string, string, string][] = [
      ['ink / background', c.ink, c.background],
      ['ink / surface', c.ink, c.surface],
      ['ink / sunken', c.ink, c.surfaceSunken],
      ['muted / background', c.inkMuted, c.background],
      ['muted / surface', c.inkMuted, c.surface],
      ['muted / sunken', c.inkMuted, c.surfaceSunken],
      ['on-primary / primary', c.onPrimary, c.primary],
      ['primary text / surface', c.primary, c.surface],
      ['primary text / background', c.primary, c.background],
      ['primary text / primary-soft', c.primary, c.primarySoft],
      ['on-structure / structure', c.onStructure, c.structure],
      ['structure text / structure-soft', c.structure, c.structureSoft],
    ];
    for (const s of Object.keys(statuses) as (keyof typeof statuses)[]) {
      pairs.push([`${s} / its soft`, status(s).color, status(s).soft], [`${s} / surface`, status(s).color, c.surface]);
    }
    for (const [label, fg, bg] of pairs) {
      const r = contrastRatio(fg, bg);
      if (r < TEXT) failures.push(`${name} ${label}: ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('controls, focus rings and chart marks reach 3:1 against what is around them', () => {
  const failures: string[] = [];
  for (const { name, c } of themes) {
    for (const [label, fg, bg] of [
      ['focus ring / surface', c.focus, c.surface],
      ['focus ring / background', c.focus, c.background],
      ['accent mark / surface', c.accent, c.surface],
      ['strong border / surface', c.borderStrong, c.surface],
      ['placeholder / surface', c.inkSubtle, c.surface],
    ] as const) {
      const r = contrastRatio(fg, bg);
      if (r < UI) failures.push(`${name} ${label}: ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('the contrast formula matches known values', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF').toFixed(1), '21.0');
  assert.equal(contrastRatio('#777777', '#FFFFFF').toFixed(2), '4.48');
});
