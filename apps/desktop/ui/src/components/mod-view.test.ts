// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from './index';
import { emit } from '../core/bus';
import { MARK, SURFACE, TEXT, TINT, isLiteral, literalOn, parseLiteral, setTokenReader } from './mod-colors';
import { hotkeyOk, matchesKey, modView, modViewUpdate } from './mod-view';
import type { ModEvent, ModViewOpts } from './mod-view';
import { h, LIMITS } from './mod-tree';
import type { ModElement } from './mod-tree';
import { sanitizeSvg } from './mod-svg';

const { Box, Text, Button, Input, Select, Markdown, Code, Link, Svg } = h;
/* a dark theme, as the browser would resolve its tokens (jsdom has no cascade) */
const THEME: Record<string, string> = { '--bg-0': '#0c0b0a', '--bg-1': '#14130f', '--bg-2': '#1c1a17', '--text': '#e9e4da', '--text-dim': '#b4ada0', '--text-quiet': '#9a9386', '--brass': '#c8a66a', '--ok': '#7fb98a', '--del': '#d9776a', '--warn': '#d6b160', '--add': '#7fb98a' };
let theme = THEME;
beforeEach(() => { theme = { ...THEME }; setTokenReader((t) => theme[t] ?? null); });
afterEach(() => { setTokenReader(null); document.body.replaceChildren(); });

function view(tree: ModElement, o: Partial<ModViewOpts> = {}): { root: HTMLElement; events: ModEvent[] } {
  const events: ModEvent[] = [];
  const root = modView(tree, { dispatch: (e) => { events.push(e); }, ...o });
  if (!root) throw new Error('the tree was refused');
  document.body.append(root);
  return { root, events };
}
const q = <T extends Element>(root: Element, sel: string): T => { const n = root.querySelector<T>(sel); if (!n) throw new Error('missing ' + sel); return n; };

describe('Box', () => {
  it('is a flex row that goes to a column, on the spacing scale: a terminal cell is a step, not a pixel', () => {
    const { root } = view(Box({ flexDirection: 'column', gap: 1, paddingX: 3, paddingY: 2, marginTop: 9, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', flexGrow: 1, width: 4, height: '50%', minWidth: 2 }));
    const s = q<HTMLElement>(root, '.mv-box').style;
    expect([s.flexDirection, s.gap, s.paddingTop, s.paddingLeft, s.paddingRight, s.marginTop]).toEqual(['column', 'var(--sp-2)', 'var(--sp-3)', 'var(--sp-4)', 'var(--sp-4)', 'var(--sp-6)']);
    expect([s.justifyContent, s.alignItems, s.flexWrap, s.flexGrow, s.width, s.height, s.minWidth]).toEqual(['space-between', 'center', 'wrap', '1', 'calc(4 * var(--sp-2))', '50%', 'calc(2 * var(--sp-2))']);
  });
  it('takes a border in the hairline and a background from the surface tokens, and a diff name as a 12% tint', () => {
    const { root } = view(Box(null, Box({ borderStyle: 'round', borderColor: 'claude' }), Box({ backgroundColor: 'raised' }), Box({ backgroundColor: 'diffAdded' }), Box({ backgroundColor: 'claude' })));
    const [bordered, raised, tint, solid] = [...root.querySelectorAll<HTMLElement>('.mv-box .mv-box')];
    expect(bordered?.classList.contains('mv-box--border')).toBe(true);
    expect(bordered?.style.getPropertyValue('--mv-border')).toBe('var(--brass)');
    expect(raised?.style.background).toBe('var(--bg-3)');
    expect(tint?.style.background).toContain('color-mix(in srgb, var(--add) 12%, transparent)');
    expect(solid?.style.background).toBe('var(--brass)');
  });
  it('names a group for assistive tech when it has a label, and ignores props it does not know', () => {
    const { root } = view(Box({ label: 'Totals', onClick: () => 1, zIndex: 9 }));
    const b = q(root, '.mv-box');
    expect([b.getAttribute('role'), b.getAttribute('aria-label')]).toEqual(['group', 'Totals']);
  });
  it('is dots, never a bar: a number is the determinate form and no number the indeterminate one (F18)', () => {
    const known = q(view(Box({ progress: 62, dots: 8, label: 'Indexing' })).root, '.mv-dots');
    expect([known.getAttribute('role'), known.getAttribute('aria-valuenow'), known.querySelectorAll('i[data-on]').length, known.querySelectorAll('i').length]).toEqual(['progressbar', '62', 5, 8]);
    const unknown = q(view(Box({ role: 'progressbar', progress: null, dots: 4 })).root, '.mv-dots[data-indeterminate]');
    expect(unknown.getAttribute('aria-busy')).toBe('true');
    expect(unknown.querySelector('.mv-dots__run')).toBeTruthy();
    expect(unknown.hasAttribute('aria-valuenow')).toBe(false);
    expect(q<HTMLElement>(unknown, '.mv-dots__run').style.getPropertyValue('--mv-run')).toBe('calc(3 * (4px + 6px))');
    expect(q(view(Box({ progress: 50, dots: 99 })).root, '.mv-dots').querySelectorAll('i').length).toBe(20);
  });
});

describe('Text', () => {
  it('draws the type scale, mono, tabular figures and the weight', () => {
    const { root } = view(Text({ size: 'xs', mono: true, tabular: true, bold: true, italic: true, underline: true, strikethrough: true, wrap: 'truncate' }, 'a', 2, Text({ dimColor: true }, 'b')));
    const t = q<HTMLElement>(root, '.mv-text');
    expect(t.classList.contains('mv-text--mono') && t.classList.contains('mv-text--tab') && t.classList.contains('mv-text--trunc')).toBe(true);
    expect([t.style.fontSize, t.style.fontWeight, t.style.fontStyle, t.style.textDecoration]).toEqual(['var(--fs-2xs)', '600', 'italic', 'underline line-through']);
    expect(t.textContent).toBe('a2b');
    expect(q<HTMLElement>(t, '.mv-text').style.color).toBe('var(--text-dim)');
  });
  it('draws a bare string or number child as text', () => {
    expect(view(Box(null, 'plain', 7 as unknown as string)).root.textContent).toBe('plain7');
  });
});

describe('Button', () => {
  it('is the library small button, and a press goes back by the handler id of {"$handler": id}', () => {
    const { root, events } = view(Button({ label: 'Re-run', onPress: { $handler: '0.h4' } }));
    const b = q<HTMLButtonElement>(root, 'button');
    expect(b.className).toContain('ui-btn');
    expect(b.className).toContain('ui-btn--s');
    b.click();
    expect(events).toEqual([{ type: 'ui.press', id: '0.h4' }]);
  });
  it('maps variant to the library variants, draws disabled, an icon and a pressed state; a danger role says so but is not red', () => {
    const { root } = view(Box(null, Button({ label: 'a', variant: 'primary' }), Button({ label: 'b', plain: true }), Button({ label: 'c', disabled: true }), Button({ label: 'd', icon: 'check', pressed: true }), Button({ label: 'e', role: 'danger' })));
    const [a, b, c, d, e] = [...root.querySelectorAll<HTMLButtonElement>('button')];
    expect(a?.classList.contains('ui-btn--primary')).toBe(true);
    expect(b?.classList.contains('ui-btn--ghost')).toBe(true);
    expect(c?.disabled).toBe(true);
    expect(d?.querySelector('svg.ui-icon')).toBeTruthy();
    expect(d?.getAttribute('aria-pressed')).toBe('true');
    expect(e?.getAttribute('aria-description')).toBe('Destructive');
  });
  it('takes its label from children, and a button with no label is a square named by aria-label', () => {
    const { root } = view(Box(null, Button({}, 'Go'), Button({ label: '', 'aria-label': 'Mark done', icon: 'check' })));
    const [a, b] = [...root.querySelectorAll<HTMLButtonElement>('button')];
    expect(a?.textContent).toBe('Go');
    expect(b?.classList.contains('mv-iconbtn')).toBe(true);
    expect(b?.getAttribute('aria-label')).toBe('Mark done');
  });
  it('drops a hotkey that collides with the app, and keeps one that does not: it works while focus is in the view, never elsewhere', () => {
    expect(['mod+k', 'enter', 'Escape', 'ctrl+k', 'x', '/'].map(hotkeyOk)).toEqual([false, false, false, false, false, false]);
    expect(['mod+r', 'alt+r', 'f5'].map(hotkeyOk)).toEqual([true, true, true]);
    const { root, events } = view(Box(null, Button({ label: 'Run', hotkey: 'alt+r', onPress: { $handler: 'r' } }), Button({ label: 'Find', hotkey: 'mod+k', onPress: { $handler: 'k' } })));
    const [run, find] = [...root.querySelectorAll<HTMLButtonElement>('button')];
    expect(run?.getAttribute('aria-keyshortcuts')).toContain('Alt');
    expect(find?.hasAttribute('aria-keyshortcuts')).toBe(false);
    run?.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', altKey: true, bubbles: true }));
    find?.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, metaKey: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', altKey: true, bubbles: true }));
    expect(events).toEqual([{ type: 'ui.press', id: 'r' }]);
    expect(matchesKey(new KeyboardEvent('keydown', { key: 'R', altKey: true, shiftKey: true }), 'alt+r')).toBe(false);
  });
});

describe('Input', () => {
  it('sends every change as ui.input and Enter as ui.submit, with the text', () => {
    const { root, events } = view(Input({ placeholder: 'Add a todo', value: 'x', onInput: { $handler: 'i' }, onSubmit: { $handler: 's' } }));
    const f = q<HTMLInputElement>(root, 'input.ui-input');
    expect([f.value, f.placeholder, f.getAttribute('aria-label')]).toEqual(['x', 'Add a todo', 'Add a todo']);
    f.value = 'xy'; f.dispatchEvent(new Event('input', { bubbles: true }));
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(events).toEqual([{ type: 'ui.input', id: 'i', value: 'xy' }, { type: 'ui.submit', id: 's', value: 'xy' }]);
  });
  it('is a textarea from two rows, and submits with ctrl or cmd and Enter only; a submit button submits too', () => {
    const { root, events } = view(Input({ rows: 3, submitLabel: 'Add', onSubmit: { $handler: 's' } }));
    const f = q<HTMLTextAreaElement>(root, 'textarea');
    expect(f.rows).toBe(3);
    f.value = 'a'; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(events).toEqual([]);
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    q<HTMLButtonElement>(root, 'button').click();
    expect(events).toEqual([{ type: 'ui.submit', id: 's', value: 'a' }, { type: 'ui.submit', id: 's', value: 'a' }]);
  });
  it('sends nothing for a handler it was not given', () => {
    const { root, events } = view(Input({ value: '' }));
    const f = q<HTMLInputElement>(root, 'input');
    f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(events).toEqual([]);
  });
});

describe('Select', () => {
  it('shows the current option, opens the library listbox and sends the chosen value as ui.select', () => {
    const { root, events } = view(Select({ options: [{ label: 'All tests', value: 'all' }, { label: 'Failing only', value: 'failing' }, 'plain'], value: 'failing', label: 'Show', onSelect: { $handler: 'sel' } }));
    const b = q<HTMLButtonElement>(root, 'button.mv-select');
    expect([b.textContent, b.getAttribute('aria-label'), b.getAttribute('aria-haspopup')]).toEqual(['Failing only', 'Show: Failing only', 'listbox']);
    b.click();
    const items = [...document.querySelectorAll<HTMLElement>('.ui-listbox .ui-option')];
    expect(items.map((i) => i.dataset['value'])).toEqual(['all', 'failing', 'plain']);
    expect(items[1]?.getAttribute('aria-selected')).toBe('true');
    items[0]?.click();
    expect(events).toEqual([{ type: 'ui.select', id: 'sel', value: 'all' }]);
  });
  it('shows the first option when the value is not among them, and nothing for no options', () => {
    expect(q(view(Select({ options: ['a', 'b'], value: 'zz' })).root, '.mv-select__v').textContent).toBe('a');
    expect(q(view(Select({})).root, '.mv-select__v').textContent).toBe('');
  });
});

describe('Markdown', () => {
  it('draws paragraphs, headings, lists, inline code, bold, italic and https links only', () => {
    const { root } = view(Markdown({ text: '# Title\n\nSome **bold** and *it* and `code` words.\n\n- one\n- two\n\n1. first\n\n[ok](https://ci.example.com/r?a=1&b=2) [bad](http://x.test) [js](javascript:alert(1))' }));
    expect(q(root, '.ui-md__h').textContent).toBe('Title');
    expect(q(root, 'strong').textContent).toBe('bold');
    expect(q(root, 'em').textContent).toBe('it');
    expect(q(root, 'code.ui-code').textContent).toBe('code');
    expect([...root.querySelectorAll('ul li')].map((l) => l.textContent)).toEqual(['one', 'two']);
    expect(root.querySelectorAll('ol li').length).toBe(1);
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a.ui-link')];
    expect(links.map((a) => [a.textContent, a.getAttribute('href'), a.rel])).toEqual([['ok', 'https://ci.example.com/r?a=1&b=2', 'noopener noreferrer']]);
  });
  it('escapes markup: a mod cannot put HTML in a tree', () => {
    const { root } = view(Markdown({ text: '<img src=x onerror=alert(1)> <b>x</b>' }));
    expect(root.querySelector('img, b')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('Code', () => {
  it('draws the session well with a path line, a gutter from startLine, and PASS or FAIL in their tokens', () => {
    const { root } = view(Code({ source: ' PASS  a.test.ts\n FAIL  b.test.ts\nplain', path: 'npm test', startLine: 10 }));
    expect(q(root, '.mv-code__path').textContent).toBe('npm test');
    expect([...root.querySelectorAll('.mv-code__n')].map((n) => n.textContent)).toEqual(['10', '11', '12']);
    expect(q(root, '.mv-code__pass').textContent).toBe('PASS');
    expect(q(root, '.mv-code__fail').textContent).toBe('FAIL');
    expect(q(root, 'pre').getAttribute('aria-label')).toBe('Code, npm test');
  });
  it('draws a diff with the lines it adds and removes named for screen readers', () => {
    const { root } = view(Code({ source: '@@ -1 +1 @@\n-old\n+new\n same', format: 'diff' }));
    const rows = [...root.querySelectorAll<HTMLElement>('.mv-code__l')];
    expect(rows.map((r) => r.dataset['d'] ?? '')).toEqual(['hunk', 'del', 'add', '']);
    expect(rows[1]?.textContent).toContain('removed: ');
    expect(rows[2]?.textContent).toContain('added: ');
  });
  it('takes its text from children and wraps when asked', () => {
    const { root } = view(Code({ wrap: true }, 'a\nb'));
    expect(root.querySelector('.mv-code--wrap')).toBeTruthy();
    expect(root.querySelectorAll('.mv-code__l').length).toBe(2);
  });
});

describe('Link', () => {
  it('opens https only, in a new context without a referrer; anything else is plain text that says so', () => {
    const { root } = view(Box(null, Link({ href: 'https://example.com/x', label: 'site' }), Link({ href: 'http://example.com' }, 'plain http'), Link({ href: 'javascript:alert(1)', label: 'js' }), Link({ href: 'not a url', label: 'bad' })));
    const a = root.querySelectorAll<HTMLAnchorElement>('a');
    expect(a.length).toBe(1);
    expect([a[0]?.target, a[0]?.rel]).toEqual(['_blank', 'noopener noreferrer']);
    expect([...root.querySelectorAll<HTMLElement>('span.mv-text')].map((s) => [s.textContent, s.dataset['tip']])).toEqual([['plain http', 'Only https links open'], ['js', 'Only https links open'], ['bad', 'Only https links open']]);
  });
});

describe('Svg: the sanitiser', () => {
  const page = (inner: string): string => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="99" height="99">' + inner + '</svg>';
  it('keeps what is drawn and drops the size, so the graphic fits the width', () => {
    const out = sanitizeSvg(page('<rect x="1" y="1" width="4" height="4" fill="none"/><path d="M0 0L5 5" stroke="subtle"/><text x="1" y="9">1</text>')) ?? '';
    expect(out).toContain('viewBox="0 0 10 10"');
    expect(out).not.toContain('width="99"');
    expect(out).toContain('<rect');
    expect(out).toContain('stroke: var(--text-quiet)');
    expect(out).toContain('var(--mono)');
  });
  it('drops script, foreignObject, image, use, style, links and event handlers with their children', () => {
    const out = sanitizeSvg(page('<script>alert(1)</script><foreignObject><div>x</div></foreignObject><image href="https://x.test/a.png"/><use href="#a"/><style>*{}</style><a href="https://x.test"><rect width="1" height="1"/></a><circle r="2" onclick="alert(1)" onload="x()" href="https://x.test" style="fill:red" class="c"/>')) ?? '';
    for (const bad of ['script', 'foreignObject', '<image', '<use', '<style', '<a ', 'onclick', 'onload', 'href', 'style="fill', 'class=', 'alert']) expect(out).not.toContain(bad);
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
    const w = q<HTMLElement>(root, '.mv-svg');
    expect([w.getAttribute('role'), w.getAttribute('aria-label'), w.style.maxHeight]).toEqual(['img', 'Chart', 'calc(4 * var(--sp-2))']);
    expect(q(w, 'svg').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('colour stays in theme (owner decision, 19 November 2026)', () => {
  it('maps Claude Code names onto tokens: claude is --text-strong as text and --brass as a mark, brass is never text', () => {
    expect(TEXT['claude']).toBe('--text-strong');
    expect(MARK['claude']).toBe('--brass');
    expect([TEXT['success'], TEXT['error'], TEXT['warning'], TEXT['subtle'], TEXT['inactive'], TEXT['text']]).toEqual(['--ok', '--del', '--warn', '--text-quiet', '--text-quiet', '--text']);
    expect([TEXT['diffAdded'], TEXT['diffRemoved'], TINT['diffAdded'], TINT['diffRemoved']]).toEqual(['--add', '--del', '--add', '--del']);
    expect([SURFACE['surface-0'], SURFACE['surface-1'], SURFACE['raised'], SURFACE['inset']]).toEqual(['--bg-0', '--bg-3', '--bg-3', '--bg-0']);
    expect(['red', 'green', 'yellow'].map((n) => TEXT[n])).toEqual(['--del', '--ok', '--warn']);
    expect(Object.values(TEXT).includes('--brass')).toBe(false);
  });
  it('draws a name as a token and an unknown name as the quiet default of its role', () => {
    const { root } = view(Box({ borderStyle: 'single', borderColor: 'nonsense' }, Text({ color: 'success' }, 'ok'), Text({ color: 'nonsense' }, 'x')));
    const [ok, unk] = [...root.querySelectorAll<HTMLElement>('.mv-text')];
    expect(ok?.style.color).toBe('var(--ok)');
    expect(unk?.style.color).toBe('var(--text)');
    expect(q<HTMLElement>(root, '.mv-box').style.getPropertyValue('--mv-border')).toBe('var(--line)');
  });
  it('keeps a literal as given only when it holds 4.5:1 for text and 3:1 for marks on its surface, else the nearest token', () => {
    expect(isLiteral('#abc') && isLiteral('#aabbcc') && isLiteral('rgb(1, 2, 3)') && !isLiteral('red') && !isLiteral('hsl(1 2% 3%)')).toBe(true);
    expect(parseLiteral('#abc')).toEqual([170, 187, 204]);
    expect(parseLiteral('rgb(300 2 3)')).toEqual([255, 2, 3]);
    expect(parseLiteral('nope')).toBeNull();
    expect(literalOn('#ffffff', 'text', 'frame')).toBe('#ffffff');                       // white on the frame: 18:1
    expect(literalOn('#2a2926', 'text', 'frame')).toMatch(/^var\(--/);                    // nearly the frame: replaced
    expect(literalOn('#2a2926', 'text', 'frame')).toBe('var(--text-quiet)');             // by the nearest token that holds 4.5:1
    expect(literalOn('#6b665b', 'mark', 'frame')).toBe('#6b665b');                        // 3.25:1: enough for a mark
    expect(literalOn('#6b665b', 'text', 'frame')).toMatch(/^var\(--/);                    // and not for text
    expect(literalOn('#4a4640', 'mark', 'frame')).toMatch(/^var\(--/);                    // 1.98:1: not enough for either
  });
  it('re-reads the surface for each place: the same literal passes on one surface and not on another', () => {
    theme['--bg-2'] = '#ffffff'; theme['--bg-1'] = '#101010';
    expect(literalOn('#f0f0f0', 'text', 'frame')).toBe('#f0f0f0');
    expect(literalOn('#f0f0f0', 'text', 'ground')).toMatch(/^var\(--/);
  });
  it('draws a literal in a tree through the contrast rule, and draws it again when the theme changes', () => {
    const { root } = view(Text({ color: '#2a2926' }, 'dim'), { surface: 'frame' });
    const t = q<HTMLElement>(root, '.mv-text');
    expect(t.style.color).toBe('var(--text-quiet)');
    theme['--bg-1'] = '#f4f1ea';   // a light theme: the same literal now reads
    emit('hx:theme', { preset: 'bone', scheme: 'light' });
    expect(t.style.color).toBe('rgb(42, 41, 38)');
    theme['--bg-1'] = '#14130f';
    emit('hx:theme', { preset: 'catalog', scheme: 'dark' });
    expect(t.style.color).toBe('var(--text-quiet)');
  });
  it('colours an Svg stroke and fill, and a Box background, as marks', () => {
    const { root } = view(Box({ backgroundColor: '#14130f' }, Svg({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="#14130f"/></svg>' })), { surface: 'frame' });
    expect(q<HTMLElement>(root, '.mv-box').style.background).toMatch(/var\(--/);
    expect(q<SVGElement>(root, 'rect').style.fill).toMatch(/var\(--/);
  });
});

describe('the view', () => {
  it('refuses a tree that fails validation: null, and the reason goes to onInvalid', () => {
    const why: string[] = [];
    expect(modView(Box(null, { type: 'Client', props: {} }), { onInvalid: (r) => { why.push(r); } })).toBeNull();
    expect(modView(h.Text(null, 'x'.repeat(LIMITS.chars + 1)), { onInvalid: (r) => { why.push(r); } })).toBeNull();
    expect(why).toEqual(['unknown element Client', 'more than 100000 characters']);
  });
  it('is a labelled group on the surface it was asked for', () => {
    const { root } = view(Text(null, 'x'), { surface: 'inset', label: 'Tests' });
    expect([root.dataset['surface'], root.getAttribute('role'), root.getAttribute('aria-label')]).toEqual(['inset', 'group', 'Tests']);
    expect(view(Text(null, 'x')).root.dataset['surface']).toBe('frame');
  });
  it('draws a new tree in place and keeps focus and the caret in the field that is still there', () => {
    const tree = (v: string, n: number): ModElement => Box(null, Text(null, 'n=' + n), Input({ value: v, onInput: { $handler: 'i' } }));
    const { root } = view(tree('hello', 1));
    const f = q<HTMLInputElement>(root, 'input');
    f.focus(); f.setSelectionRange(2, 4);
    expect(modViewUpdate(root as never, tree('hello', 2))).toBe(true);
    const g = q<HTMLInputElement>(root, 'input');
    expect(g).not.toBe(f);
    expect([document.activeElement === g, g.selectionStart, g.selectionEnd, root.textContent]).toEqual([true, 2, 4, 'n=2']);
  });
  it('keeps the old drawing when the new tree is refused', () => {
    const { root } = view(Text(null, 'old'));
    const refused = vi.fn();
    expect(modViewUpdate(root as never, { type: 'Nope' }, { onInvalid: refused })).toBe(false);
    expect(root.textContent).toBe('old');
    expect(refused).toHaveBeenCalledOnce();
  });
  it('is the library: ui.modView, with the mod glyph and name as one unit', () => {
    expect(typeof ui.modView).toBe('function');
    expect(typeof ui.modView.update).toBe('function');
    const by = document.createElement('div'); by.innerHTML = ui.html.mod('test-runner');
    expect([by.querySelector('.mv-by__n')?.textContent, !!by.querySelector('svg.mv-by__g')]).toEqual(['test-runner', true]);
    expect(ui.icons.includes('mod')).toBe(true);
    expect(ui.html.mod('<b>x</b>')).not.toContain('<b>');
  });
});

describe('handler round trips: what the user does goes back by id, whatever the element', () => {
  it('a tree with one of each interactive element sends exactly the ids it was given', () => {
    const { root, events } = view(Box(null,
      Button({ label: 'b', onPress: { $handler: 'p' } }),
      Input({ onInput: { $handler: 'in' }, onSubmit: { $handler: 'su' } }),
      Select({ options: ['a', 'b'], onSelect: { $handler: 'se' } })));
    q<HTMLButtonElement>(root, 'button.ui-btn').click();
    const f = q<HTMLInputElement>(root, 'input');
    f.value = 'v'; f.dispatchEvent(new Event('input', { bubbles: true }));
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    q<HTMLButtonElement>(root, 'button.mv-select').click();
    document.querySelectorAll<HTMLElement>('.ui-listbox .ui-option')[1]?.click();
    expect(events).toEqual([{ type: 'ui.press', id: 'p' }, { type: 'ui.input', id: 'in', value: 'v' }, { type: 'ui.submit', id: 'su', value: 'v' }, { type: 'ui.select', id: 'se', value: 'b' }]);
  });
});
