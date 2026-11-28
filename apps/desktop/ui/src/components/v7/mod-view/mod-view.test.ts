// @vitest-environment jsdom
/* ModView (2b): the story (a tree in, the kit's parts and their states out) and the scene (what the person does comes back as `ui:mod`,
   a hotkey, a literal colour painted against its surface and again when the theme changes, a new tree drawn in place). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emit as busEmit } from '../../../core/bus';
import { kit } from '../index';
import type { UiEvents } from '../events';
import { MARK, SURFACE, TEXT, TINT, isLiteral, literalOn, parseLiteral, setTokenReader } from './colours';
import { hotkeyOk, modView } from './mod-view';
import type { ModViewOpts } from './mod-view';
import { matchesKey, modViewUpdate } from './behaviour';
import { h, LIMITS } from './tree';
import type { ModElement } from './tree';
import { sanitizeSvg } from './svg';

const { Box, Text, Button, Input, Select, Markdown, Code, Link, Svg } = h;
/* a dark theme, as the browser would resolve its tokens (jsdom has no cascade) */
const THEME: Record<string, string> = { '--bg-pane': '#161616', '--bg-3': '#1f1f1f', '--text': '#f5f5f5', '--text-dim': '#b4b4b4', '--text-quiet': '#9a9a9a', '--brass': '#c8a66a', '--ok-text': '#00ba69', '--red-text': '#ff6463', '--warn-text': '#e28600', '--add': '#00ba69' };
let theme = THEME;
beforeEach(() => { theme = { ...THEME }; setTokenReader((t) => theme[t] ?? null); });
afterEach(() => { setTokenReader(null); document.body.replaceChildren(); });

type Said = UiEvents['ui:mod'];
function view(tree: ModElement, o: Partial<ModViewOpts> = {}): { root: HTMLElement; events: Said[] } {
  const t = document.createElement('template');
  t.innerHTML = modView({ tree, ...o });
  const root = t.content.firstElementChild as HTMLElement;
  if (!root) throw new Error('the tree was refused');
  document.body.append(root);
  kit.wire(root);
  const events: Said[] = [];
  root.addEventListener('ui:mod', (e) => { events.push((e as CustomEvent<Said>).detail); });
  return { root, events };
}
const q = <T extends Element>(root: Element, sel: string): T => { const n = root.querySelector<T>(sel); if (!n) throw new Error('missing ' + sel); return n; };

describe('story: ModView', () => {
  it('is a group on the surface it stands on, and draws nothing for a tree the limits refuse', () => {
    const { root } = view(Box({}), { surface: 'band', label: 'Tests, test-runner mod' });
    expect([root.getAttribute('data-kit'), root.dataset['surface'], root.getAttribute('role'), root.getAttribute('aria-label')]).toEqual(['ModView', 'band', 'group', 'Tests, test-runner mod']);
    expect(modView({ tree: { type: 'Client', props: {}, children: [] } })).toBe('');
    expect(kit.modViewCheck({ type: 'Client' })).toEqual({ ok: false, reason: expect.stringContaining('unknown element') });
    let deep: ModElement = Text({}, 'x');
    for (let i = 0; i < LIMITS.depth + 1; i++) deep = Box({}, deep);
    expect(kit.modViewCheck(deep).ok).toBe(false);
  });
  it('Box: a flex row that goes to a column, on the spacing scale (a terminal cell is a step, not a pixel)', () => {
    const { root } = view(Box({ flexDirection: 'column', gap: 1, paddingX: 3, paddingY: 2, marginTop: 9, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', flexGrow: 1, width: 4, height: '50%', minWidth: 2 }));
    const s = q<HTMLElement>(root, '.k7-mv__box').style;
    expect([s.flexDirection, s.gap, s.paddingTop, s.paddingLeft, s.paddingRight, s.marginTop]).toEqual(['column', 'var(--sp-2)', 'var(--sp-3)', 'var(--sp-4)', 'var(--sp-4)', 'var(--sp-6)']);
    expect([s.justifyContent, s.alignItems, s.flexWrap, s.flexGrow, s.width, s.height, s.minWidth]).toEqual(['space-between', 'center', 'wrap', '1', 'calc(4 * var(--sp-2))', '50%', 'calc(2 * var(--sp-2))']);
  });
  it('Box: a border in the hairline, a background from the surface tokens, a diff name as a 12% tint, a label as a group', () => {
    const { root } = view(Box(null, Box({ borderStyle: 'round', borderColor: 'claude' }), Box({ backgroundColor: 'raised' }), Box({ backgroundColor: 'diffAdded' }), Box({ backgroundColor: 'claude', label: 'Totals' })));
    const [bordered, raised, tint, solid] = [...root.querySelectorAll<HTMLElement>('.k7-mv__box .k7-mv__box')];
    expect([bordered?.hasAttribute('data-border'), bordered?.style.getPropertyValue('--mv-border')]).toEqual([true, 'var(--brass)']);
    expect(raised?.style.background).toBe('var(--bg-3)');
    expect(tint?.style.background).toContain('color-mix(in srgb, var(--add) 12%, transparent)');
    expect([solid?.style.background, solid?.getAttribute('role'), solid?.getAttribute('aria-label')]).toEqual(['var(--brass)', 'group', 'Totals']);
  });
  it('ModProgress: the kit\'s ticks, never a bar; a number fills them in proportion, no number has one travel (F18)', () => {
    const known = q(view(Box({ progress: 62, dots: 8, label: 'Indexing' })).root, '[data-kit-part~="ModProgress"]');
    expect([known.getAttribute('role'), known.getAttribute('aria-valuenow'), known.querySelectorAll('i[data-on]').length, known.querySelectorAll('i').length, known.getAttribute('aria-label')]).toEqual(['progressbar', '62', 5, 8, 'Indexing']);
    const unknown = q(view(Box({ role: 'progressbar', progress: null, dots: 4 })).root, '[data-kit-part~="ModProgress"][data-indeterminate]');
    expect([unknown.getAttribute('aria-busy'), unknown.hasAttribute('aria-valuenow'), !!unknown.querySelector('.k7-mv__run')]).toEqual(['true', false, true]);
    expect(q(view(Box({ progress: 50, dots: 99 })).root, '[data-kit-part~="ModProgress"]').querySelectorAll('i').length).toBe(20);
    expect(document.querySelectorAll('progress, meter').length).toBe(0);
  });
  it('Text: the type scale, mono, tabular figures, the weight, the cut; a bare string or number is text', () => {
    const { root } = view(Box(null, Text({ size: 'l', bold: true, mono: true, tabular: true, italic: true, underline: true, wrap: 'truncate' }, 'a'), 'plain', 42));
    const [t, s, n] = [...root.querySelectorAll<HTMLElement>('.k7-mv__text')];
    expect([t?.style.fontSize, t?.style.fontWeight, t?.style.fontStyle, t?.style.textDecoration, t?.hasAttribute('data-mono'), t?.hasAttribute('data-tab'), t?.dataset['wrap']]).toEqual(['var(--fs-m)', '600', 'italic', 'underline', true, true, 'cut']);
    expect([s?.textContent, n?.textContent]).toEqual(['plain', '42']);
  });
  it('Button: the kit\'s Button at 28 in its variants (role danger is the danger Button), disabled, pressed; no label is a tinted IconButton', () => {
    const { root } = view(Box(null, Button({ variant: 'primary' }, 'Go'), Button({ plain: true, label: 'Skip' }), Button({ role: 'danger', label: 'Clear' }), Button({ disabled: true, pressed: true, label: 'Off' }), Button({ 'aria-label': 'Add', icon: 'plus' })));
    const b = [...root.querySelectorAll<HTMLButtonElement>('button')];
    expect(b.map((x) => x.getAttribute('data-kit') + ':' + x.dataset['variant'])).toEqual(['Button:primary', 'Button:ghost', 'Button:danger', 'Button:secondary', 'IconButton:tinted']);
    expect(b.slice(0, 4).every((x) => x.dataset['size'] === '28')).toBe(true);
    expect([b[3]?.disabled, b[3]?.getAttribute('aria-pressed'), b[4]?.getAttribute('aria-label')]).toEqual([true, 'true', 'Add']);
  });
  it('Input: the kit\'s Field (multiline from two rows) with a primary Button when it has a submit label; Select: the kit\'s SelectorItem', () => {
    const { root } = view(Box(null, Input({ placeholder: 'Filter', submitLabel: 'Go', onSubmit: { $handler: 's' } }), Input({ rows: 3, value: 'x' }), Select({ label: 'Show', value: 'b', options: ['a', { label: 'Bee', value: 'b' }] })));
    expect(q(root, 'input.k7-field__input').getAttribute('placeholder')).toBe('Filter');
    expect(q<HTMLTextAreaElement>(root, 'textarea.k7-field__input').rows).toBe(3);
    expect(q(root, '[data-mv-send]').getAttribute('data-variant')).toBe('primary');
    const sel = q(root, '[data-kit~="SelectorItem"]');
    expect([sel.getAttribute('aria-label'), sel.getAttribute('aria-haspopup')]).toEqual(['Show: Bee', 'menu']);
  });
  it('Markdown: the kit\'s prose, escaped (a mod cannot put HTML in a tree), https links only', () => {
    const { root } = view(Markdown({ text: '**bold** `code` <img src=x onerror=alert(1)> [ok](https://a.test) [no](http://a.test)' }));
    expect(root.querySelector('img, [onerror]')).toBeNull();
    expect(q(root, 'strong').textContent).toBe('bold');
    expect([...root.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://a.test']);
  });
  it('Code: the kit\'s Well with its path, a gutter from startLine, wrapped when asked; a diff is the kit\'s DiffView', () => {
    const { root } = view(Box(null, Code({ path: 'src/a.ts', startLine: 9, wrap: true }, 'one\ntwo\n'), Code({ format: 'diff', path: 'b.ts' }, '@@ -1 +1 @@\n-old\n+new')));
    const w = q(root, '[data-kit~="Well"]');
    expect([q(w, '.k7-well__head').textContent, [...w.querySelectorAll('.k7-well__n')].map((n) => n.textContent), w.hasAttribute('data-wrap')]).toEqual(['src/a.ts', ['9', '10'], true]);
    const d = q(root, '[data-kit~="DiffView"]');
    expect(d.textContent).toContain('b.ts');
    expect(d.textContent).toContain('new');
  });
  it('Link: https opens in a new context without a referrer (the kit\'s cite chip); anything else is plain text that says so', () => {
    const { root } = view(Box(null, Link({ href: 'https://a.test/x' }, 'Run'), Link({ href: 'javascript:alert(1)', label: 'Bad' })));
    const a = q<HTMLAnchorElement>(root, 'a');
    expect([a.getAttribute('href'), a.target, a.rel, a.textContent]).toEqual(['https://a.test/x', '_blank', 'noopener noreferrer', 'Run']);
    expect(root.querySelectorAll('a').length).toBe(1);
    expect(root.querySelector('[data-tip="Only https links open"]')?.textContent).toBe('Bad');
  });
  it('drops a hotkey that collides with the app\'s keys, and keeps one that does not', () => {
    expect([hotkeyOk('mod+k'), hotkeyOk('ctrl+K'), hotkeyOk('enter'), hotkeyOk('mod+r'), hotkeyOk(''), hotkeyOk(3)]).toEqual([false, false, false, true, false, false]);
    const { root } = view(Box(null, Button({ hotkey: 'mod+k', onPress: { $handler: 'a' } }, 'A'), Button({ hotkey: 'mod+r', onPress: { $handler: 'b' } }, 'B')));
    const [a, b] = [...root.querySelectorAll('button')];
    expect([a?.hasAttribute('data-mv-hotkey'), b?.getAttribute('data-mv-hotkey'), b?.getAttribute('data-kbd')]).toEqual([false, 'mod+r', 'mod+r']);
  });
});

describe('story: the sanitiser', () => {
  const page = (inner: string): string => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="99" height="99">' + inner + '</svg>';
  it('keeps what is drawn and drops the size, so the graphic fits the width; its words are mono and quiet', () => {
    const out = sanitizeSvg(page('<rect x="1" y="1" width="4" height="4" fill="none"/><path d="M0 0L5 5" stroke="subtle"/><text x="1" y="9">1</text>')) ?? '';
    expect(out).toContain('viewBox="0 0 10 10"');
    expect(out).not.toContain('width="99"');
    expect(out).toContain('<rect');
    expect(out).toContain('stroke:var(--text-quiet)');
    expect(out).toContain('var(--mono)');
  });
  it('drops script, foreignObject, image, use, style, links and event handlers with their children', () => {
    const out = sanitizeSvg(page('<script>alert(1)</script><foreignObject><div>x</div></foreignObject><image href="https://x.test/a.png"/><use href="#a"/><style>*{}</style><a href="https://x.test"><rect width="1" height="1"/></a><circle r="2" onclick="alert(1)" onload="x()" href="https://x.test" style="fill:red" class="c"/>')) ?? '';
    for (const bad of ['script', 'foreignObject', '<image', '<use', '<style', '<a ', 'onclick', 'onload', 'href', 'fill:red', 'class=', 'alert']) expect(out).not.toContain(bad);
    expect(out).toContain('<circle');
  });
  it('keeps an internal url(#id) reference and drops any other reference, data: and javascript: values', () => {
    const out = sanitizeSvg(page('<defs><linearGradient id="g"><stop offset="0" stop-color="claude"/></linearGradient></defs><rect width="1" height="1" fill="url(#g)"/><rect width="2" height="2" clip-path="url(https://evil.test/x)"/><rect width="3" height="3" transform="javascript:alert(1)"/><rect width="4" height="4" opacity="data:text/html,x"/>')) ?? '';
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('<linearGradient');
    for (const bad of ['evil.test', 'javascript:', 'data:']) expect(out).not.toContain(bad);
  });
  it('is null for what is not an svg: not XML, another root, a parse error', () => {
    expect(sanitizeSvg('<svg')).toBeNull();
    expect(sanitizeSvg('<div>x</div>')).toBeNull();
    expect(sanitizeSvg('')).toBeNull();
    expect(sanitizeSvg('<script xmlns="http://www.w3.org/2000/svg"/>')).toBeNull();
  });
  it('draws a graphic that cannot be drawn as a quiet sentence, and a good one as an image named by its label', () => {
    expect(view(Svg({ svg: '<oops' })).root.textContent).toContain('This graphic can’t be drawn');
    const { root } = view(Svg({ svg: page('<rect width="1" height="1"/>'), label: 'Chart', height: 4 }));
    const w = q<HTMLElement>(root, '.k7-mv__svg');
    expect([w.getAttribute('role'), w.getAttribute('aria-label'), w.style.maxHeight]).toEqual(['img', 'Chart', 'calc(4 * var(--sp-2))']);
    expect(q(w, 'svg').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('story: colour stays in theme (owner decision, 19 November 2026)', () => {
  it('maps Claude Code names onto the v7 tokens: claude is --text-strong as text and the theme\'s accent as a mark, never text', () => {
    expect([TEXT['claude'], MARK['claude']]).toEqual(['--text-strong', '--brass']);
    expect([TEXT['success'], TEXT['error'], TEXT['warning'], TEXT['subtle'], TEXT['inactive'], TEXT['text']]).toEqual(['--ok-text', '--red-text', '--warn-text', '--text-quiet', '--text-quiet', '--text']);
    expect([MARK['success'], MARK['error'], MARK['warning']]).toEqual(['--ok', '--red', '--warn']);
    expect([TEXT['diffAdded'], TEXT['diffRemoved'], TINT['diffAdded'], TINT['diffRemoved']]).toEqual(['--add', '--del', '--add', '--del']);
    expect([SURFACE['surface-0'], SURFACE['surface-1'], SURFACE['raised'], SURFACE['inset']]).toEqual(['--bg-0', '--bg-3', '--bg-3', '--bg-0']);
    expect(Object.values(TEXT).includes('--brass')).toBe(false);
  });
  it('draws a name as its token and an unknown name as the quiet default of its role', () => {
    const { root } = view(Box({ borderStyle: 'single', borderColor: 'nonsense' }, Text({ color: 'success' }, 'ok'), Text({ color: 'nonsense' }, 'x')));
    const [ok, unk] = [...root.querySelectorAll<HTMLElement>('.k7-mv__text')];
    expect([ok?.style.color, unk?.style.color]).toEqual(['var(--ok-text)', 'var(--text)']);
    expect(q<HTMLElement>(root, '.k7-mv__box').style.getPropertyValue('--mv-border')).toBe('var(--line)');
  });
  it('keeps a literal as given only when it holds 4.5:1 for text and 3:1 for marks on its surface, else the nearest token', () => {
    expect(isLiteral('#abc') && isLiteral('#aabbcc') && isLiteral('rgb(1, 2, 3)') && !isLiteral('red') && !isLiteral('hsl(1 2% 3%)')).toBe(true);
    expect([parseLiteral('#abc'), parseLiteral('rgb(300 2 3)'), parseLiteral('nope')]).toEqual([[170, 187, 204], [255, 2, 3], null]);
    expect(literalOn('#ffffff', 'text', 'pane')).toBe('#ffffff');
    expect(literalOn('#2a2926', 'text', 'pane')).toMatch(/^var\(--/);   // nearly the pane: the nearest token that holds 4.5:1
    expect(literalOn('#6b665b', 'mark', 'pane')).toBe('#6b665b');
    expect(literalOn('#6b665b', 'text', 'pane')).toMatch(/^var\(--/);
    expect(literalOn('#3a3a3a', 'mark', 'pane')).toMatch(/^var\(--/);
  });
  it('reads the surface for each place: the same literal passes on one surface and not on another', () => {
    theme['--bg-3'] = '#ffffff';
    expect(literalOn('#f0f0f0', 'text', 'pane')).toBe('#f0f0f0');
    expect(literalOn('#f0f0f0', 'text', 'row')).toMatch(/^var\(--/);
  });
});

describe('scene: ModView', () => {
  it('a press goes back as ui:mod by the handler id of {"$handler": id}; a disabled button sends nothing', () => {
    const { root, events } = view(Box(null, Button({ onPress: { $handler: '0.h1' } }, 'Go'), Button({ disabled: true, onPress: { $handler: 'x' } }, 'No'), Button({}, 'None')));
    for (const b of root.querySelectorAll('button')) b.click();
    expect(events).toEqual([{ type: 'ui.press', id: '0.h1' }]);
  });
  it('a Field sends every change as ui.input and Enter as ui.submit; a multiline one submits with ctrl or cmd Enter; its Button submits too', () => {
    const { root, events } = view(Box(null, Input({ onInput: { $handler: 'i' }, onSubmit: { $handler: 's' }, submitLabel: 'Go' }), Input({ rows: 2, onSubmit: { $handler: 'm' } })));
    const f = q<HTMLInputElement>(root, 'input');
    f.value = 'ab'; f.dispatchEvent(new Event('input', { bubbles: true }));
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    q<HTMLButtonElement>(root, '[data-mv-send]').click();
    const t = q<HTMLTextAreaElement>(root, 'textarea');
    t.value = 'x'; t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(events).toEqual([{ type: 'ui.input', id: 'i', value: 'ab' }, { type: 'ui.submit', id: 's', value: 'ab' }, { type: 'ui.submit', id: 's', value: 'ab' }, { type: 'ui.submit', id: 'm', value: 'x' }]);
  });
  it('a Select opens the kit\'s Menu, its current choice checked, and sends the chosen value as ui.select', () => {
    const { root, events } = view(Select({ label: 'Show', value: 'all', options: [{ label: 'All', value: 'all' }, { label: 'Failing only', value: 'failing' }], onSelect: { $handler: 'w' } }));
    q<HTMLButtonElement>(root, '[data-kit~="SelectorItem"]').click();
    const menu = q(document.body, '.k7-menu[data-floating]');
    expect(menu.querySelector('[aria-checked="true"]')?.textContent).toContain('All');
    [...menu.querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]')].find((r) => r.textContent?.includes('Failing'))?.click();
    expect(events).toEqual([{ type: 'ui.select', id: 'w', value: 'failing' }]);
    kit.closeMenu();
  });
  it('a hotkey works while focus is inside the view, and never elsewhere', () => {
    const { root, events } = view(Box(null, Button({ hotkey: 'mod+r', onPress: { $handler: 'b' } }, 'B')));
    const k = (target: EventTarget): void => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true })); };
    const spy = vi.fn(); document.addEventListener('ui:mod', spy);
    k(document.body);
    expect(events).toEqual([]);
    k(q(root, 'button'));
    expect(events.length).toBe(1);
    expect(matchesKey(new KeyboardEvent('keydown', { key: 'r', shiftKey: true }), 'shift+r')).toBe(true);
    expect(matchesKey(new KeyboardEvent('keydown', { key: 'r' }), 'shift+r')).toBe(false);
    document.removeEventListener('ui:mod', spy);
  });
  it('paints a literal through the contrast rule against its surface, and again when the theme changes', () => {
    const { root } = view(Box(null, Text({ color: '#2a2926' }, 'dim'), Svg({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="#161616"/></svg>' })), { surface: 'pane' });
    const t = q<HTMLElement>(root, '.k7-mv__text');
    expect(t.style.color).toMatch(/^var\(--/);
    expect(q<SVGElement>(root, 'rect').style.fill).toMatch(/var\(--/);
    theme['--bg-pane'] = '#f4f1ea';   // a light theme: the same literal now reads
    busEmit('hx:theme', { preset: 'bone', scheme: 'light' });
    expect(t.style.color).toBe('rgb(42, 41, 38)');
  });
  it('draws a new tree in place and keeps focus and the caret in the field that is still there; a refused tree keeps the old drawing', () => {
    const { root } = view(Box(null, Input({ value: 'hello' })));
    const f = q<HTMLInputElement>(root, 'input');
    f.focus(); f.setSelectionRange(2, 3);
    expect(modViewUpdate(root, Box(null, Input({ value: 'hello world' }), Text({}, 'new')))).toBe(true);
    const g = q<HTMLInputElement>(root, 'input');
    expect([g.value, document.activeElement === g, g.selectionStart, g.selectionEnd, root.textContent?.includes('new')]).toEqual(['hello world', true, 2, 3, true]);
    expect(modViewUpdate(root, { type: 'Client' })).toBe(false);
    expect(root.querySelector('input')).toBe(g);
  });
});
