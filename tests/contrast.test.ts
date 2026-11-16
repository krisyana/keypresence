import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/web/theme.css', 'utf8');
const vars = (block: string) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]));
const blockAfter = (marker: string) => {
  const i = css.indexOf(marker);
  const start = css.indexOf('{', i);
  return css.slice(start + 1, css.indexOf('}', start));
};
const light = vars(blockAfter(':root {'));
const darkAuto = { ...light, ...vars(blockAfter(":root:not([data-theme='light'])")) };
const darkManual = { ...light, ...vars(blockAfter(":root[data-theme='dark']")) };

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
export const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

// [foreground, background] pairs that the stylesheet actually renders as text.
const PAIRS: [string, string][] = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'],
  ['accent-ink', 'accent'], ['accent-text', 'surface'], ['accent-text', 'bg'], ['accent-text', 'surface-2'], ['accent-text', 'accent-soft'], ['text', 'accent-soft'],
  ['accent-soft-ink', 'accent-soft'], ['danger-soft-ink', 'danger-soft'], ['warn-soft-ink', 'warn-soft'], ['ok-soft-ink', 'ok-soft'],
  ['danger', 'surface'], ['danger', 'bg'], ['surface', 'danger'],
  ['side-ink', 'side-bg'], ['side-muted', 'side-bg'], ['side-active-ink', 'side-active'], ['side-ink', 'side-active'],
  ['hero-ink', 'hero-from'], ['hero-ink', 'hero-to'], ['toast-ink', 'toast-bg'],
];

// Non-text UI (WCAG 1.4.11): borders of controls, focus rings, chart marks, status icons. Need 3:1.
const NON_TEXT: [string, string][] = [
  ['input-border', 'surface'], ['input-border', 'bg'], ['accent-edge', 'surface'], ['accent-edge', 'bg'],
  ['focus', 'surface'], ['focus', 'bg'], ['focus', 'surface-2'],
  ['bar', 'surface'], ['bar-late', 'surface'],
  ['accent', 'side-bg'], ['accent', 'side-active'], ['toast-ok', 'toast-bg'], ['toast-bad', 'toast-bg'],
];

describe.each([['light', light], ['dark (auto)', darkAuto], ['dark (manual)', darkManual]])('WCAG AA contrast, %s theme', (_n, theme) => {
  it.each(PAIRS)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(theme[fg], `missing token ${fg}`).toBeTruthy();
    expect(theme[bg], `missing token ${bg}`).toBeTruthy();
    expect(ratio(theme[fg]!, theme[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe.each([['light', light], ['dark (auto)', darkAuto], ['dark (manual)', darkManual]])('WCAG 1.4.11 non-text contrast, %s theme', (_n, theme) => {
  it.each(NON_TEXT)('%s against %s is at least 3:1', (fg, bg) => {
    expect(theme[fg], `missing token ${fg}`).toBeTruthy();
    expect(theme[bg], `missing token ${bg}`).toBeTruthy();
    expect(ratio(theme[fg]!, theme[bg]!)).toBeGreaterThanOrEqual(3);
  });
});

it('uses the brand palette', () => {
  expect(light['accent']).toBe('#cca43b');
  expect(light['text']).toBe('#242f40');
  expect(light['side-bg']).toBe('#242f40');
  expect(light['border']).toBe('#e5e5e5');
});

it('the two dark definitions stay identical', () => {
  const keys = Object.keys(vars(blockAfter(":root[data-theme='dark']")));
  for (const k of keys) expect(darkAuto[k]).toBe(darkManual[k]);
});
