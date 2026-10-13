import {
  colors,
  darkColors,
  fonts,
  mainButtonHeight,
  minTouchTarget,
  motion,
  radius,
  spacing,
  statuses,
  typeScale,
  type ColorTheme,
  type Status,
  type TypeStyle,
} from '../tokens';

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const themeVars = (theme: ColorTheme, dark: boolean) =>
  [
    ...Object.entries(theme).map(([k, v]) => `--jl-${kebab(k)}: ${v};`),
    ...(Object.keys(statuses) as Status[]).flatMap((s) => [
      `--jl-status-${s}: ${dark ? statuses[s].darkColor : statuses[s].color};`,
      `--jl-status-${s}-soft: ${dark ? statuses[s].darkSoft : statuses[s].soft};`,
    ]),
    `--jl-shadow-card: ${dark ? 'none' : '0 1px 2px rgba(28,36,48,.06), 0 1px 1px rgba(28,36,48,.04)'};`,
    `--jl-shadow-raised: ${dark ? '0 8px 24px rgba(0,0,0,.4)' : '0 6px 16px rgba(28,36,48,.10)'};`,
  ].join('\n  ');

const typeRule = (name: string, t: TypeStyle) => `.jl-text-${kebab(name)} {
  font-family: var(--jl-font-${t.family});
  font-weight: ${t.weight};
  font-size: ${t.size}px;
  line-height: ${t.lineHeight}px;
  letter-spacing: ${t.letterSpacing ?? 0}px;${t.tabularNums ? '\n  font-variant-numeric: tabular-nums;' : ''}
}`;

/** The whole web stylesheet, generated from tokens so it can never drift from mobile. */
export const jengaCss = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700&display=swap');

:root {
  --jl-font-heading: '${fonts.heading}', system-ui, sans-serif;
  --jl-font-body: '${fonts.body}', system-ui, sans-serif;
  ${themeVars(colors, false)}
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    ${themeVars(darkColors, true)}
    color-scheme: dark;
  }
}
:root[data-theme='dark'] {
  ${themeVars(darkColors, true)}
  color-scheme: dark;
}

*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--jl-background);
  color: var(--jl-ink);
  font-family: var(--jl-font-body);
  font-size: 16px;
  line-height: 24px;
  -webkit-font-smoothing: antialiased;
}
:focus-visible { outline: 3px solid var(--jl-focus); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }

${Object.entries(typeScale).map(([k, t]) => typeRule(k, t)).join('\n')}
.jl-muted { color: var(--jl-ink-muted); }

/* Button: one main action per screen, large and orange. */
.jl-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: ${spacing.sm}px;
  min-height: ${minTouchTarget}px; padding: 0 ${spacing.lg}px;
  border: 1px solid transparent; border-radius: ${radius.md}px;
  font: 600 15px/20px var(--jl-font-body); cursor: pointer; text-decoration: none;
  transition: background ${motion.fast}ms, border-color ${motion.fast}ms, transform ${motion.fast}ms;
}
.jl-btn:active:not(:disabled) { transform: scale(.98); }
.jl-btn:disabled { cursor: not-allowed; opacity: .5; }
.jl-btn--lg { min-height: ${mainButtonHeight}px; padding: 0 ${spacing.xl}px; font-size: 16px; border-radius: ${radius.lg}px; }
.jl-btn--block { display: flex; width: 100%; }
.jl-btn--primary { background: var(--jl-primary); color: var(--jl-on-primary); }
.jl-btn--primary:hover:not(:disabled) { background: var(--jl-primary-pressed); }
.jl-btn--secondary { background: var(--jl-surface); color: var(--jl-ink); border-color: var(--jl-border-strong); }
.jl-btn--secondary:hover:not(:disabled) { background: var(--jl-surface-sunken); }
.jl-btn--ghost { background: transparent; color: var(--jl-primary); padding: 0 ${spacing.sm}px; }
.jl-btn--ghost:hover:not(:disabled) { background: var(--jl-primary-soft); }
.jl-btn--danger { background: var(--jl-status-problem); color: #fff; }
.jl-spin { animation: jl-spin .8s linear infinite; }
@keyframes jl-spin { to { transform: rotate(360deg); } }

/* Card */
.jl-card {
  background: var(--jl-surface); border: 1px solid var(--jl-border);
  border-radius: ${radius.lg}px; box-shadow: var(--jl-shadow-card); padding: ${spacing.lg}px;
}
.jl-card--flush { padding: 0; overflow: hidden; }
.jl-card__head { display: flex; align-items: center; justify-content: space-between; gap: ${spacing.md}px; margin-bottom: ${spacing.md}px; }
.jl-card__title { margin: 0; }
.jl-card--flush > .jl-card__head { padding: ${spacing.lg}px ${spacing.lg}px 0; }

/* Status badge: colour + icon + word, never colour alone. */
.jl-badge {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 8px;
  border-radius: ${radius.pill}px; font: 600 13px/18px var(--jl-font-body); white-space: nowrap;
}
${(Object.keys(statuses) as Status[])
  .map((s) => `.jl-badge--${s} { color: var(--jl-status-${s}); background: var(--jl-status-${s}-soft); }`)
  .join('\n')}

/* Money */
.jl-money { font-variant-numeric: tabular-nums; white-space: nowrap; }
.jl-money__cur { font-size: .62em; font-weight: 600; color: var(--jl-ink-muted); margin-right: .3em; letter-spacing: .02em; vertical-align: .12em; }

/* Amount input */
.jl-field { display: flex; flex-direction: column; gap: 6px; }
.jl-field__label { font: 500 14px/20px var(--jl-font-body); }
.jl-field__hint { font: 400 13px/18px var(--jl-font-body); color: var(--jl-ink-muted); }
.jl-field__error { font: 500 13px/18px var(--jl-font-body); color: var(--jl-status-problem); }
.jl-amount {
  display: flex; align-items: center; gap: ${spacing.sm}px; height: 56px; padding: 0 ${spacing.lg}px;
  background: var(--jl-surface); border: 1.5px solid var(--jl-border-strong); border-radius: ${radius.md}px;
  transition: border-color ${motion.fast}ms, box-shadow ${motion.fast}ms;
}
.jl-amount:focus-within { border-color: var(--jl-primary); box-shadow: 0 0 0 4px var(--jl-primary-soft); }
.jl-amount--error { border-color: var(--jl-status-problem); }
.jl-amount__cur { font: 600 14px/20px var(--jl-font-body); color: var(--jl-ink-muted); }
.jl-amount input {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--jl-ink);
  font: 600 22px/28px var(--jl-font-body); font-variant-numeric: tabular-nums;
}

/* States: loading, empty, error, offline, no permission */
.jl-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: ${spacing.sm}px; padding: ${spacing.xxl}px ${spacing.xl}px; }
.jl-state__icon {
  display: grid; place-items: center; width: 56px; height: 56px; margin-bottom: ${spacing.sm}px;
  border-radius: ${radius.pill}px; background: var(--jl-surface-sunken); color: var(--jl-ink-muted);
}
.jl-state--error .jl-state__icon { background: var(--jl-status-problem-soft); color: var(--jl-status-problem); }
.jl-state--offline .jl-state__icon { background: var(--jl-status-waiting-soft); color: var(--jl-status-waiting); }
.jl-state__title { margin: 0; }
.jl-state__msg { margin: 0 0 ${spacing.sm}px; color: var(--jl-ink-muted); max-width: 34ch; }
.jl-banner {
  display: flex; align-items: center; gap: ${spacing.sm}px; padding: 10px ${spacing.lg}px;
  border-radius: ${radius.md}px; font: 500 14px/20px var(--jl-font-body);
  background: var(--jl-status-waiting-soft); color: var(--jl-status-waiting);
}
.jl-skeleton {
  border-radius: ${radius.sm}px;
  background: linear-gradient(90deg, var(--jl-surface-sunken) 25%, var(--jl-border) 50%, var(--jl-surface-sunken) 75%);
  background-size: 200% 100%; animation: jl-shimmer 1.4s ease-in-out infinite;
}
@keyframes jl-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
/* Infographics */
.jl-viz { margin: 0; }
.jl-viz__caption { margin: ${spacing.sm}px 0 0; font: 400 14px/20px var(--jl-font-body); color: var(--jl-ink-muted); }
.jl-ring { position: relative; flex: none; }
.jl-ring svg { display: block; }
.jl-ring__center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.jl-ring__label { font: 500 13px/18px var(--jl-font-body); color: var(--jl-ink-muted); margin-top: 2px; }
.jl-legend { display: flex; flex-direction: column; gap: 8px; font-size: 14px; line-height: 20px; color: var(--jl-ink-muted); }
.jl-legend span { display: inline-flex; align-items: center; gap: 8px; }
.jl-legend i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.jl-legend b { color: var(--jl-ink); font-weight: 600; font-variant-numeric: tabular-nums; }

.jl-tower svg { display: block; overflow: visible; }
.jl-tower__name { font: 600 15px var(--jl-font-body); }
.jl-tower__status { font: 500 12px var(--jl-font-body); }
.jl-tower__block.is-tappable { cursor: pointer; }
.jl-tower__block.is-tappable:hover rect { filter: brightness(0.97); }
.jl-tower__block:focus-visible { outline: none; }
.jl-tower__block:focus-visible rect { stroke: var(--jl-focus); stroke-width: 3; }

.jl-moneybar svg { display: block; border-radius: 6px; }
.jl-moneybar__legend { display: grid; gap: 8px; margin: ${spacing.md}px 0 0; }
.jl-moneybar__legend > div { display: flex; justify-content: space-between; gap: ${spacing.md}px; }
.jl-moneybar__legend dt { display: inline-flex; align-items: center; gap: 8px; color: var(--jl-ink-muted); }
.jl-moneybar__legend dd { margin: 0; font-weight: 600; }
.jl-swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.jl-swatch--paid { background: var(--jl-status-paid); }
.jl-swatch--approved { background: var(--jl-status-approved); }
.jl-swatch--remaining { background: var(--jl-surface-sunken); box-shadow: inset 0 0 0 1px var(--jl-border-strong); }

.jl-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); }
.jl-step { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; }
.jl-step__line { position: absolute; top: 13px; right: 50%; width: 100%; height: 3px; background: var(--jl-border); z-index: 0; }
.jl-step--done .jl-step__line, .jl-step--disputed .jl-step__line { background: var(--jl-status-paid); }
.jl-step__dot {
  position: relative; z-index: 1; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 999px;
  background: var(--jl-surface); border: 2px solid var(--jl-border-strong); color: var(--jl-surface);
}
.jl-step--done .jl-step__dot { background: var(--jl-status-paid); border-color: var(--jl-status-paid); }
.jl-step--current .jl-step__dot { border-color: var(--jl-status-waiting); box-shadow: 0 0 0 4px var(--jl-status-waiting-soft); }
.jl-step--disputed .jl-step__dot { background: var(--jl-status-problem); border-color: var(--jl-status-problem); }
.jl-step__label { font: 600 14px/20px var(--jl-font-body); margin-top: 4px; }
.jl-step--upcoming .jl-step__label { color: var(--jl-ink-muted); font-weight: 500; }
.jl-step__date { font: 400 13px/18px var(--jl-font-body); color: var(--jl-ink-muted); }
.jl-step--disputed .jl-step__date { color: var(--jl-status-problem); font-weight: 600; }

.jl-wallet__head { display: flex; align-items: center; gap: ${spacing.md}px; margin-bottom: ${spacing.md}px; }
.jl-wallet__head > div { display: flex; flex-direction: column; }
.jl-wallet__icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: var(--jl-structure-soft); color: var(--jl-structure); }
.jl-wallet__who { font-size: 13px; line-height: 18px; color: var(--jl-ink-muted); }
.jl-wallet__rows { margin: 0; display: grid; gap: 2px; }
.jl-wallet__rows > div { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-top: 1px solid var(--jl-border); }
.jl-wallet__rows > div:first-child { border-top: 0; }
.jl-wallet__rows dt { display: inline-flex; align-items: center; gap: 6px; color: var(--jl-ink-muted); }
.jl-wallet__rows dd { margin: 0; font-weight: 600; }
.jl-wallet__rows .is-explain { margin-top: 4px; padding: 10px 12px; border: 0; border-radius: 10px; background: var(--jl-status-waiting-soft); }
.jl-wallet__rows .is-explain dt, .jl-wallet__rows .is-explain dd { color: var(--jl-status-waiting); font-weight: 600; }
.jl-wallet__rows .is-ok dt { color: var(--jl-status-paid); }

.jl-updated { display: inline-flex; align-items: center; gap: 4px; font: 400 13px/18px var(--jl-font-body); color: var(--jl-ink-muted); }
`;
