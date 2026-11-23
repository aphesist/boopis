import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { on } from '../core/bus';
import { KEYS, readJSON } from '../core/settings';
import { installPreset, presetTokens } from './testing';
import { CURRENT_ALPHA, RED_SOFT_ALPHA, EDITABLE, GUARD_LABELS, GUARD_PAIRS, PAIRS, PRESETS, blank, composite, guardColors, lum, parseColor, ratio, sanitize, skippedSentence, themeApi, toHex } from './theme';

describe('colour parsing', () => {
  it('reads the rgb() Chrome reports for a plain colour', () => {
    expect(parseColor('rgb(18, 17, 16)')).toEqual([18, 17, 16, 1]);
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual([255, 0, 0, 0.5]);
  });
  it('reads the color(srgb ...) Chrome reports for a color-mix(), channels 0 to 1', () => {
    const c = parseColor('color(srgb 0.5 0.25 1 / 0.4)');
    expect(c.map((v) => Math.round(v * 1000) / 1000)).toEqual([127.5, 63.75, 255, 0.4]);
    expect(parseColor('color(srgb 1 1 1)')[3]).toBe(1);
  });
  it('toHex rounds each channel', () => {
    expect(toHex([0, 127.5, 255])).toBe('#0080ff');
  });
});

describe('contrast maths (WCAG 2.x)', () => {
  it('black on white is 21:1 and the ratio is symmetric', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });
  it('the same colour is 1:1', () => { expect(ratio('#777777', '#777777')).toBeCloseTo(1, 5); });
  it('relative luminance of the primaries', () => {
    expect(lum('#ffffff')).toBeCloseTo(1, 5);
    expect(lum('#000000')).toBe(0);
    expect(lum('#ff0000')).toBeCloseTo(0.2126, 4);
  });
  it('a known pair: #767676 on white is the 4.5:1 boundary', () => {
    expect(ratio('#767676', '#ffffff')).toBeGreaterThan(4.5);
    expect(ratio('#777777', '#ffffff')).toBeLessThan(4.6);
  });
  it('composite lays a translucent colour over a solid one', () => {
    expect(composite([255, 255, 255, 0.5], [0, 0, 0, 1])).toBe('#808080');
    expect(composite([10, 20, 30, 1], [200, 200, 200, 1])).toBe('#0a141e');
  });
});

describe('contrast maths against known pairs', () => {
  it('WCAG 2.x examples: #767676 on white is 4.54, #777777 is 4.48, #949494 is 3.03, pure red on white is 4.00, pure blue 8.59', () => {
    expect(ratio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(ratio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(ratio('#949494', '#ffffff')).toBeCloseTo(3.03, 2);
    expect(ratio('#ff0000', '#ffffff')).toBeCloseTo(4.0, 2);
    expect(ratio('#0000ff', '#ffffff')).toBeCloseTo(8.59, 2);
  });
  it('the design system’s own table (5.4): Card catalog text on the frame 14.89, meta on the frame 5.69, Bone text on the frame 13.04', () => {
    expect(ratio('#e9e4da', '#121110')).toBeCloseTo(14.89, 1);
    expect(ratio('#958c7f', '#121110')).toBeCloseTo(5.69, 1);
    expect(ratio('#23201c', '#ebe6dc')).toBeCloseTo(13.04, 1);
  });
});

describe('the contrast guard (a mod’s colours that would make text hard to read are not applied)', () => {
  const catalog = presetTokens('catalog');
  const base = (t: string): string | null => catalog[t] ?? null;
  it('checks only pairs that carry text, at the design system’s floors', () => {
    expect(GUARD_PAIRS.length).toBeGreaterThan(20);
    for (const [fg, bg, min] of GUARD_PAIRS) { expect(min).toBe(4.5); expect(`${fg} ${bg}`).not.toMatch(/mark-off|line-field|--brass|--icon|--red\b(?!-)/); }
    expect(GUARD_PAIRS.some(([fg, bg]) => fg === '--text' && bg === '--bg-2')).toBe(true);
    expect(GUARD_PAIRS.some(([fg, bg]) => fg === '--text-quiet' && bg === '--bg-3')).toBe(true);
    expect(GUARD_PAIRS.some(([fg, bg]) => fg === '--text-on-light' && bg === '--selected')).toBe(true);
    for (const t of Object.keys(GUARD_LABELS)) expect(EDITABLE).toContain(t);
  });
  it('--current is the text colour at the share the guard assumes (tokens.css is the source)', () => {
    const css = readFileSync('src/styles/tokens.css', 'utf8');
    expect(css).toContain('--current: color-mix(in srgb, var(--text) ' + CURRENT_ALPHA * 100 + '%, transparent)');
  });
  it('--red-soft is attention red at the share the guard assumes (the wash under a message to the person)', () => {
    const css = readFileSync('src/styles/tokens.css', 'utf8');
    expect(css).toContain('--red-soft: color-mix(in srgb, var(--red) ' + Math.round(RED_SOFT_ALPHA * 1000) / 10 + '%, transparent)');
  });
  it('each preset’s own colours pass, so nothing a user already has is ever skipped', () => {
    for (const id of ['catalog', 'graphite', 'bone', 'typewriter'] as const) {
      const g = guardColors(presetTokens(id), () => null);
      expect([id, g.skipped]).toEqual([id, []]);
      expect(Object.keys(g.applied).length).toBe(Object.keys(presetTokens(id)).length);
    }
  });
  it('a complete light theme over a dark one holds together: nothing is skipped', () => {
    const g = guardColors(presetTokens('bone'), base);
    expect(g.skipped).toEqual([]);
  });
  it('a partial theme with dark text on a dark frame skips exactly the text, and the rest applies', () => {
    const g = guardColors({ '--text': '#1a1a1a', '--brass': '#b8a4f0', '--bg-2': '#201e31' }, base);
    expect(g.skipped).toEqual([{ token: '--text', label: 'text on surface' }]);
    expect(g.applied).toEqual({ '--brass': '#b8a4f0', '--bg-2': '#201e31' });
  });
  it('quiet text, dim text and strong text are each held to the surfaces they sit on', () => {
    expect(guardColors({ '--text-quiet': '#222222' }, base).skipped.map((x) => x.token)).toEqual(['--text-quiet']);
    expect(guardColors({ '--text-dim': '#222222' }, base).skipped.map((x) => x.token)).toEqual(['--text-dim']);
    expect(guardColors({ '--text-strong': '#222222' }, base).skipped.map((x) => x.token)).toEqual(['--text-strong']);
    expect(guardColors({ '--text-quiet': '#a59d90' }, base).skipped).toEqual([]);   // a lighter quiet text is fine
  });
  it('ink on the selected fill: ink too close to the fill is skipped, and so is a fill too close to the theme’s own ink', () => {
    expect(guardColors({ '--text-on-light': '#e0e0e0' }, base).skipped.map((x) => x.token)).toEqual(['--text-on-light']);
    expect(guardColors({ '--selected': '#101010' }, base).skipped.map((x) => x.token)).toEqual(['--selected']);   // a dark fill would sink the theme's own dark ink
  });
  it('a surface that would bury the theme’s own text is the colour skipped (its text is not the mod’s)', () => {
    const g = guardColors({ '--bg-2': '#f4f0e8', '--brass': '#b8a4f0' }, base);
    expect(g.skipped).toEqual([{ token: '--bg-2', label: 'the ground' }]);
    expect(g.applied).toEqual({ '--brass': '#b8a4f0' });
  });
  it('a colour that fails only because of another one the mod gave is checked again once that one is gone', () => {
    /* dark text and a light ground: the text fails on the theme's dark frames and goes; the ground then fails under the theme's own light text and goes too */
    const g = guardColors({ '--text': '#1a1a1a', '--bg-2': '#f4f0e8' }, base);
    expect(g.skipped.map((x) => x.token)).toEqual(['--text', '--bg-2']);
    expect(g.applied).toEqual({});
  });
  it('lists what it left out in plain words, in a fixed order, singular or plural', () => {
    const two = guardColors({ '--text-quiet': '#222222', '--text': '#111111' }, base);
    expect(skippedSentence(two.skipped)).toBe('Skipped 2 colours that would make text hard to read: text on surface, quiet text.');
    expect(skippedSentence(guardColors({ '--text-quiet': '#222222' }, base).skipped)).toBe('Skipped 1 colour that would make text hard to read: quiet text.');
    expect(skippedSentence([])).toBeNull();
  });
  it('a token the theme cannot resolve is unknown, never a failure: its pairs are not checked', () => {
    expect(guardColors({ '--text': '#1a1a1a' }, () => null)).toEqual({ applied: { '--text': '#1a1a1a' }, skipped: [] });
  });
});

describe('the contrast table', () => {
  it('every pair names two tokens and a floor of 3 or 4.5 (WCAG 1.4.3 and 1.4.11)', () => {
    expect(PAIRS.length).toBeGreaterThan(30);
    for (const [fg, bg, min, label] of PAIRS) { expect(fg).toMatch(/^--/); expect(bg).toMatch(/^--/); expect([3, 4.5]).toContain(min); expect(label.length).toBeGreaterThan(3); }
  });
  it('the dock pairs include inactive marks at 3:1 on black', () => {
    expect(PAIRS.some(([fg, , min, , scope]) => fg === '--mark-off' && scope === 'dock' && min === 3)).toBe(true);
  });
  it('contrast() reports every pair with a ratio (the browser resolves the tokens)', () => {
    const rows = themeApi.contrast();
    expect(rows).toHaveLength(PAIRS.length);
    for (const r of rows) expect(typeof r.pass).toBe('boolean');
  });
});

describe('importing a theme', () => {
  it('sanitize keeps a known preset, #rrggbb colours of editable tokens, known fonts and modes', () => {
    const t = sanitize({ preset: 'bone', colors: { '--text': '#ABCDEF', bg: '#000', '--brass': 'red', '--bg-1': '#101010' }, sans: 'Geist', mono: 'Nope', case: 'lower', corners: 'weird', density: 'compact', extra: 1 });
    expect(t).toEqual({ ...blank(), preset: 'bone', colors: { '--text': '#abcdef', '--bg-1': '#101010' }, sans: 'Geist', case: 'lower', density: 'compact' });
  });
  it('sanitize rejects what is not an object, and falls back to the default preset', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize('x')).toBeNull();
    expect(sanitize({ preset: 'nope' })?.preset).toBe('catalog');
  });
  it('importJSON refuses text that is not a boopis theme, with a precise message', () => {
    expect(() => themeApi.importJSON('{oops')).toThrow('not valid JSON');
    expect(() => themeApi.importJSON('{"preset":"bone"}')).toThrow('boopis-theme');
  });
  it('the four presets exist and each names its fonts', () => {
    expect(Object.keys(PRESETS)).toEqual(['catalog', 'graphite', 'bone', 'typewriter']);
    expect(PRESETS.typewriter.case).toBe('lower');
    expect(PRESETS.typewriter.corners).toBe('round');
  });
  it('every editable colour is a custom property', () => { for (const t of EDITABLE) expect(t).toMatch(/^--[a-z0-9-]+$/); });
});

describe('theme presets', () => {
  it('preset() sets the attributes on <html> and exportJSON round-trips the choice', () => {
    themeApi.preset('typewriter');
    expect(document.documentElement.dataset['hxPreset']).toBe('typewriter');
    expect(document.documentElement.dataset['hxCase']).toBe('lower');
    expect(document.documentElement.dataset['hxCorners']).toBe('round');
    expect(JSON.parse(themeApi.exportJSON())).toMatchObject({ format: 'boopis-theme', version: 1, preset: 'typewriter', case: 'lower' });
    themeApi.preset('catalog');
  });
  it('an override equal to the preset is dropped, so the preset stays meaningful', () => {
    themeApi.preset('catalog');
    themeApi.set({ corners: 'default' });
    expect(themeApi.get().corners).toBeNull();
    themeApi.set({ corners: 'sharp' });
    expect(themeApi.get().corners).toBe('sharp');
    themeApi.reset();
    expect(themeApi.get().corners).toBeNull();
  });
});

describe('previewing colours (a mod offers a theme: DESIGN-SYSTEM.md 5.2 and 14.29)', () => {
  const root = document.documentElement;
  const saved = (): unknown => readJSON(KEYS.theme);
  const seen: boolean[] = [];
  const off = on('hx:theme-preview', (e) => seen.push(e.previewing));
  const unstyle = installPreset('catalog');   // jsdom has no stylesheet: the guard needs the colours a browser would resolve
  beforeEach(() => { themeApi.endPreview(false); themeApi.reset(); themeApi.preset('catalog'); seen.length = 0; });
  afterAll(() => { off(); unstyle(); themeApi.endPreview(false); themeApi.preset('catalog'); });

  it('shows a patch over the saved theme without saving it, and says so', () => {
    const before = JSON.stringify(saved());
    expect(themeApi.previewing()).toBe(false);
    themeApi.preview({ colors: { '--brass': '#B8A4F0', '--text': '#e7e4f2' } });
    expect(themeApi.previewing()).toBe(true);
    expect(root.style.getPropertyValue('--brass')).toBe('#b8a4f0');
    expect(root.style.getPropertyValue('--text')).toBe('#e7e4f2');
    expect(themeApi.get().colors).toEqual({});   // get() is the saved theme while a preview shows
    expect(JSON.stringify(saved())).toBe(before);
    expect(seen).toEqual([true]);
  });
  it('gives the saved theme back at once on endPreview(false), and says so', () => {
    themeApi.set({ colors: { '--brass': '#112233' } });
    themeApi.preview({ colors: { '--brass': '#b8a4f0' } });
    expect(themeApi.endPreview(false)).toBe(true);
    expect(themeApi.previewing()).toBe(false);
    expect(root.style.getPropertyValue('--brass')).toBe('#112233');
    expect(themeApi.get().colors['--brass']).toBe('#112233');
    expect(seen).toEqual([true, false]);
  });
  it('keeps what it showed on endPreview(true): it becomes the theme and is saved', () => {
    themeApi.preview({ colors: { '--brass': '#b8a4f0' } });
    expect(themeApi.endPreview(true)).toBe(true);
    expect(themeApi.previewing()).toBe(false);
    expect(root.style.getPropertyValue('--brass')).toBe('#b8a4f0');
    expect((saved() as { colors: Record<string, string> }).colors['--brass']).toBe('#b8a4f0');
  });
  it('is one preview at a time: another preview patches the saved theme again, never the first patch', () => {
    themeApi.preview({ colors: { '--brass': '#b8a4f0' } });
    themeApi.preview({ colors: { '--text': '#e7e4f2' } });
    expect(root.style.getPropertyValue('--brass')).toBe('');
    expect(root.style.getPropertyValue('--text')).toBe('#e7e4f2');
    themeApi.endPreview(false);
    expect(root.style.getPropertyValue('--text')).toBe('');
  });
  it('takes only what a theme may have: an unknown token or a colour that is not #rrggbb is left out', () => {
    themeApi.preview({ colors: { '--nope': '#ffffff', '--brass': 'red', '--text': '#e7e4f2' } });
    expect(root.style.getPropertyValue('--text')).toBe('#e7e4f2');
    expect([root.style.getPropertyValue('--nope'), root.style.getPropertyValue('--brass')]).toEqual(['', '']);
  });
  it('has nothing to end when nothing is previewing', () => {
    expect(themeApi.endPreview(true)).toBe(false);
    expect(seen).toEqual([]);
  });
  it('every other change restores first: a preset, a setting, a reset, an import', () => {
    const text = themeApi.exportJSON();
    for (const change of [() => themeApi.preset('graphite'), () => themeApi.set({ corners: 'round' }), () => themeApi.reset(), () => themeApi.importJSON(text)]) {
      themeApi.preset('catalog');
      themeApi.preview({ colors: { '--brass': '#b8a4f0' } });
      change();
      expect(themeApi.previewing()).toBe(false);
      expect(root.style.getPropertyValue('--brass')).not.toBe('#b8a4f0');
    }
  });
  it('does not show a colour that would make text hard to read, says which it left out, and the theme’s own token stays', () => {
    const g = themeApi.preview({ colors: { '--text': '#1a1a1a', '--brass': '#b8a4f0' } });
    expect(g.skipped.map((x) => x.token)).toEqual(['--text']);
    expect(g.applied).toEqual({ '--brass': '#b8a4f0' });
    expect(root.style.getPropertyValue('--text')).toBe('');
    expect(root.style.getPropertyValue('--brass')).toBe('#b8a4f0');
    expect(themeApi.previewing()).toBe(true);
  });
  it('Keep stores only what was applied', () => {
    themeApi.preview({ colors: { '--text': '#1a1a1a', '--brass': '#b8a4f0' } });
    themeApi.endPreview(true);
    const colors = (saved() as { colors: Record<string, string> }).colors;
    expect(colors).toEqual({ '--brass': '#b8a4f0' });
    expect(root.style.getPropertyValue('--text')).toBe('');
  });
  it('a patch kept with no preview showing is checked the same way before it is stored', () => {
    const g = themeApi.keep({ '--text-quiet': '#222222', '--brass': '#b8a4f0' });
    expect(g.skipped.map((x) => x.token)).toEqual(['--text-quiet']);
    expect((saved() as { colors: Record<string, string> }).colors).toEqual({ '--brass': '#b8a4f0' });
  });
  it('a new preview reads the saved theme, not the colours the last one showed', () => {
    themeApi.preview({ colors: { '--bg-2': '#f4f0e8' } });   // would bury the theme's light text: left out
    expect(root.style.getPropertyValue('--bg-2')).toBe('');
    themeApi.preview({ colors: { '--brass': '#b8a4f0' } });
    expect(root.style.getPropertyValue('--bg-2')).toBe('');
    expect(root.style.getPropertyValue('--brass')).toBe('#b8a4f0');
  });
  it('Reject, Esc and every other way a preview ends restore the saved theme just as with a skipped colour', () => {
    themeApi.set({ colors: { '--brass': '#112233' } });
    themeApi.preview({ colors: { '--text': '#1a1a1a', '--brass': '#b8a4f0' } });
    expect(themeApi.endPreview(false)).toBe(true);
    expect(root.style.getPropertyValue('--brass')).toBe('#112233');
    expect(themeApi.get().colors).toEqual({ '--brass': '#112233' });
  });
});
