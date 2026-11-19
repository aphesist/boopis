/* The mod view: `modView(tree, opts)` draws a Claude Code mod's element tree with the library, so a mod looks native.
   One renderer for every surface a mod draws into: a pane, the band above the composer, a placed transcript row.
   A typed port of v6's `HX.ui.modView` (design/v6/components/mod-view.js, owner-approved): the same element mapping, the same
   colour map, the same sanitiser and limits. The tree is data (mod-tree.ts); handlers never run here. A handler prop is an
   id, and the view answers with `opts.dispatch({type, id, value})`; the mods module sends that back to the plugin.

   modView(tree, {surface, dispatch, label, onInvalid})
     surface   'frame' (a pane, on --bg-1) | 'ground' (a placed row, on --bg-2) | 'inset' (the band, on --bg-0)
     dispatch  ({type: 'ui.press' | 'ui.input' | 'ui.select' | 'ui.submit', id, value}) what the user did, by handler id
   -> .mv-root, or null when the tree fails validation (the host keeps its own drawing and logs). `modViewUpdate` draws a new
   tree in place and keeps focus and the caret.

   Mapping:
     Box      a flex container on the spacing scale. A terminal cell becomes a step: 1 is --sp-2, 2 is --sp-3, 3 is --sp-4,
              4 is --sp-5, more is --sp-6. Borders are the hairline; backgroundColor draws a surface token.
     Text     the type scale (xs 11, s 13, m 14, l 16); `mono` is --mono, `tabular` tabular figures.
     Button   the library's button (variant and role become its variants). A `hotkey` that collides with the app's keys is
              dropped, never stolen; one that does not works while focus is inside the view.
     Input    the field of FORMS.md (.ui-input). Select: the card layer's picker pattern, with the library's menu.
     Markdown paragraphs, lists, inline code, bold, italic and https links, through the library's prose.
     Code     the session's well (mono 11, --bg-0), with a line gutter, a path line and a diff format.
     Link     https: only; anything else is plain text.
     Svg      sanitised (no script, no foreignObject, no external references), colours through the same map as Text.
     Progress a Box with `progress` (0 to 100) or role 'progressbar' is drawn as dots, never a bar (F18): `progress` a number is
              the determinate form (dots filled in proportion, the library's measure row), a missing or null `progress` the
              indeterminate one (one dot travelling along the row). `dots` sets the count (default 10, 3 to 20). */
import { on } from '../core/bus';
import { esc, isMac } from '../core/dom';
import { logger } from '../core/log';
import { html } from './html';
import { iconNames } from './icons';
import { menu } from './layer';
import { MARK, SURFACE, TINT, isLiteral, paintColor } from './mod-colors';
import type { Lit, PaintCtx, Surface } from './mod-colors';
import { cleanSvg } from './mod-svg';
import { LIMITS, handlerId, textOf, validateTree } from './mod-tree';
import type { ModChild, ModElement } from './mod-tree';
import { hydrateOne } from './wire';
import { frag } from '../core/dom';

const log = logger('mod-view');

export type ModEventType = 'ui.press' | 'ui.input' | 'ui.select' | 'ui.submit';
/** what the user did, by the handler id of the element used */
export interface ModEvent { type: ModEventType; id: string; value?: string }
export interface ModViewOpts {
  surface?: Surface | undefined;
  dispatch?: ((ev: ModEvent) => void) | undefined;
  label?: string | undefined;
  /** the tree failed validation: why (the default logs it) */
  onInvalid?: ((reason: string) => void) | undefined;
}
export interface ModRoot extends HTMLElement { _mv?: { lits: Lit[]; opts: ModViewOpts; keys: Hotkey[] } }

interface Hotkey { spec: string; run(): void; disabled: boolean }
interface Ctx extends PaintCtx { dispatch: (ev: ModEvent) => void; keys: Hotkey[] }
type Props = Readonly<Record<string, unknown>>;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const num = (v: unknown): number => +(v as number) || 0;
const str = (v: unknown): string => (v == null ? '' : String(v));

/* terminal cells to the spacing scale */
const STEP = ['0', 'var(--sp-2)', 'var(--sp-3)', 'var(--sp-4)', 'var(--sp-5)', 'var(--sp-6)'] as const;
const sp = (n: unknown): string => STEP[Math.max(0, Math.min(STEP.length - 1, Math.round(num(n))))] ?? '0';
/** a width or height counted in cells: one cell is 8px */
const cell = (n: unknown): string => 'calc(' + num(n) + ' * var(--sp-2))';
const size = (v: unknown): string | null => (typeof v === 'number' ? cell(v) : /^\d+(\.\d+)?%$/.test(String(v)) ? String(v) : null);

/* re-read every literal when the theme changes (a surface or a token moved) */
const LIVE = new Set<ModRoot>();
const retint = (): void => { for (const r of LIVE) { if (!r.isConnected) { LIVE.delete(r); continue; } for (const l of r._mv?.lits ?? []) l.apply(); } };
on('hx:theme', retint);

/* ───────────── Markdown (the session's prose) ───────────── */
function inlineMd(t: string): string {
  let s = esc(t);
  s = s.replace(/`([^`]+)`/g, '<code class="ui-code">$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_m, label: string, href: string) => '<a class="mv-link" href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
  return s;
}
function markdown(text: string): HTMLElement {
  const root = el('div', 'ui-prose mv-md');
  const lines = String(text).replace(/\r/g, '').split('\n');
  let para: string[] = [], list: { ord: boolean; el: HTMLElement } | null = null;
  const flush = (): void => {
    if (para.length) { const p = el('p'); p.innerHTML = inlineMd(para.join(' ')); root.append(p); para = []; }
    if (list) { root.append(list.el); list = null; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) { flush(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { flush(); const h = el('p', 'mv-md__h'); h.innerHTML = inlineMd(m[2] ?? ''); root.append(h); continue; }
    if ((m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line))) {
      const ord = /\d/.test(m[1] ?? '');
      if (!list || list.ord !== ord) { flush(); list = { ord, el: el(ord ? 'ol' : 'ul') }; }
      const li = el('li'); li.innerHTML = inlineMd(m[2] ?? ''); list.el.append(li); continue;
    }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  return root;
}

/* ───────────── builders ───────────── */
const SIZE_VAR: Readonly<Record<string, string>> = { xs: '--fs-2xs', s: '--fs-xs', m: '--fs-s', l: '--fs-m', xl: '--fs-l', small: '--fs-xs', large: '--fs-m', '2xs': '--fs-2xs' };
const weight = (w: unknown, bold: unknown): number | null => (bold ? 600 : w == null ? null : typeof w === 'number' ? (w >= 600 ? 600 : w >= 500 ? 500 : 400) : w === 'bold' ? 600 : w === 'medium' ? 500 : 400);
const FLEX: Readonly<Record<string, string>> = { start: 'flex-start', end: 'flex-end', 'flex-start': 'flex-start', 'flex-end': 'flex-end', center: 'center', stretch: 'stretch', baseline: 'baseline', 'space-between': 'space-between', 'space-around': 'space-around' };
/** keys the app owns: a mod's hotkey that collides is dropped, never stolen (MODS section 2) */
export const RESERVED: readonly string[] = ['mod+k', 'mod+b', 'mod+shift+b', 'mod+i', 'mod+.', 'mod+,', 'mod+[', 'mod+]', 'mod+shift+o', 'mod+enter', 'enter', 'esc', 'escape', 'tab', 'alt+1', 'alt+2', 'alt+v', 'alt+a', 'mod+g', 'x', 'c', 'g', '[', ']', '/'];
const normKey = (k: string): string => String(k).toLowerCase().replace(/ctrl|cmd|meta/g, 'mod');
export const hotkeyOk = (k: unknown): k is string => typeof k === 'string' && k !== '' && !RESERVED.includes(normKey(k));
/** does a key event match a spec such as 'mod+r'? `mod` is the platform's command key */
export function matchesKey(e: KeyboardEvent, spec: string): boolean {
  const parts = normKey(spec).split('+'), key = parts.pop() ?? '';
  const want = { mod: parts.includes('mod'), shift: parts.includes('shift'), alt: parts.includes('alt') };
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const other = isMac ? e.ctrlKey : e.metaKey;
  if (other || mod !== want.mod || e.shiftKey !== want.shift || e.altKey !== want.alt) return false;
  return e.key.toLowerCase() === key;
}

function build(node: ModChild, ctx: Ctx, path: string): Node | null {
  if (node == null || node === false || node === true) return null;
  if (typeof node === 'string' || typeof node === 'number') return buildText({ type: 'Text', props: {}, children: [node] }, ctx, path);
  const p = node.props ?? {}, kids = node.children == null ? [] : Array.isArray(node.children) ? [...node.children as readonly ModChild[]] : [node.children as ModChild];
  switch (node.type) {
    case 'Box': return buildBox(p, kids, ctx, path);
    case 'Text': return buildText(node, ctx, path);
    case 'Button': return buildButton(p, kids, ctx, path);
    case 'Input': return buildInput(p, ctx, path);
    case 'Select': return buildSelect(p, ctx, path);
    case 'Markdown': return markdown(p['text'] != null ? str(p['text']) : textOf(kids));
    case 'Code': return buildCode(p, kids);
    case 'Link': return buildLink(p, kids);
    case 'Svg': return buildSvg(p, ctx);
    default: return null;
  }
}

/* progress is dots (F18): the library's measure row, filled in proportion; or one dot travelling when nothing is known */
function buildProgress(p: Props): HTMLElement {
  const n = Math.max(3, Math.min(20, Math.round(num(p['dots'])) || 10)), known = p['progress'] != null && isFinite(+(p['progress'] as number));
  const pct = known ? Math.max(0, Math.min(100, num(p['progress']))) : null;
  const b = frag(html.measure({ variant: 'row', used: pct == null ? 0 : pct, total: 100, dots: n, label: str(p['label']) || 'Progress' }));
  b.classList.add('mv-dots'); b.setAttribute('role', 'progressbar'); b.setAttribute('aria-valuemin', '0'); b.setAttribute('aria-valuemax', '100');
  b.setAttribute('aria-label', str(p['aria-label']) || str(p['label']) || 'Progress');
  if (pct != null) b.setAttribute('aria-valuenow', String(Math.round(pct)));
  else {
    b.setAttribute('aria-busy', 'true'); b.dataset['indeterminate'] = '';
    const run = el('i', 'mv-dots__run'); run.style.setProperty('--mv-run', 'calc(' + (n - 1) + ' * (4px + 6px))'); b.append(run);   /* the dot and the library's gap: 4px and 6px */
  }
  if (p['flexGrow'] != null) b.style.flexGrow = String(Math.max(0, num(p['flexGrow'])));
  if (p['alignSelf']) b.style.alignSelf = 'center';
  return b;
}

function buildBox(p: Props, kids: readonly ModChild[], ctx: Ctx, path: string): HTMLElement {
  if (p['role'] === 'progressbar' || p['progress'] !== undefined) return buildProgress(p);
  const b = el('div', 'mv-box'), s = b.style;
  const dir = p['flexDirection'];
  if (dir === 'column' || dir === 'column-reverse' || dir === 'row-reverse') s.flexDirection = dir;
  if (p['gap'] != null) s.gap = sp(p['gap']);
  if (p['columnGap'] != null) s.columnGap = sp(p['columnGap']);
  if (p['rowGap'] != null) s.rowGap = sp(p['rowGap']);
  const pad = (k: 'padding' | 'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom' | 'margin' | 'marginLeft' | 'marginRight' | 'marginTop' | 'marginBottom', v: unknown): void => { if (v != null) s[k] = sp(v); };
  const or = (a: unknown, b2: unknown): unknown => (a != null ? a : b2);
  pad('padding', p['padding']); pad('paddingLeft', or(p['paddingLeft'], p['paddingX'])); pad('paddingRight', or(p['paddingRight'], p['paddingX']));
  pad('paddingTop', or(p['paddingTop'], p['paddingY'])); pad('paddingBottom', or(p['paddingBottom'], p['paddingY']));
  pad('margin', p['margin']); pad('marginLeft', or(p['marginLeft'], p['marginX'])); pad('marginRight', or(p['marginRight'], p['marginX']));
  pad('marginTop', or(p['marginTop'], p['marginY'])); pad('marginBottom', or(p['marginBottom'], p['marginY']));
  const jc = FLEX[str(p['justifyContent'])], ai = FLEX[str(p['alignItems'])], as = FLEX[str(p['alignSelf'])];
  if (jc) s.justifyContent = jc;
  if (ai) s.alignItems = ai;
  if (as) s.alignSelf = as;
  if (p['flexWrap'] === 'wrap') s.flexWrap = 'wrap';
  if (p['flexGrow'] != null) s.flexGrow = String(Math.max(0, num(p['flexGrow'])));
  if (p['flexShrink'] != null) s.flexShrink = String(Math.max(0, num(p['flexShrink'])));
  const w = size(p['width']), h = size(p['height']), mw = size(p['minWidth']);
  if (w) s.width = w;
  if (h) s.height = h;
  if (mw) s.minWidth = mw;
  if (p['borderStyle']) { b.classList.add('mv-box--border'); if (p['borderColor']) paintColor(b, '--mv-border', p['borderColor'], 'mark', ctx); }
  if (p['backgroundColor']) {
    const name = str(p['backgroundColor']);
    const surf = SURFACE[name], tint = TINT[name], mark = MARK[name];
    if (surf) s.background = 'var(' + surf + ')';
    else if (/^diff/.test(name) && tint) s.background = 'color-mix(in srgb, var(' + tint + ') 12%, transparent)';   /* a diff background is a tint, as the session draws it */
    else if (mark) s.background = 'var(' + mark + ')';   /* any other name is a solid mark: a bar, a swatch */
    else if (isLiteral(name)) { b.classList.add('mv-box--fill'); paintColor(b, 'background', name, 'mark', ctx); }
    else s.background = 'var(--hover)';
    b.classList.add('mv-box--filled');
  }
  if (p['overflow'] === 'hidden') s.overflow = 'hidden';
  const lab = str(p['aria-label']) || str(p['label']);
  if (lab) { b.setAttribute('role', 'group'); b.setAttribute('aria-label', lab); }
  kids.forEach((c, i) => { const n = build(c, ctx, path + '.' + i); if (n) b.append(n); });
  return b;
}

function buildText(node: ModElement, ctx: Ctx, path: string): HTMLElement {
  const p = node.props ?? {}, t = el('span', 'mv-text'), s = t.style;
  const sz = SIZE_VAR[str(p['size'])];
  if (p['mono']) t.classList.add('mv-text--mono');
  if (p['tabular']) t.classList.add('mv-text--tab');
  if (sz) s.fontSize = 'var(' + sz + ')';
  const wt = weight(p['weight'], p['bold']);
  if (wt) s.fontWeight = String(wt);
  if (p['italic']) s.fontStyle = 'italic';
  const dec = [p['underline'] && 'underline', p['strikethrough'] && 'line-through'].filter(Boolean).join(' ');
  if (dec) s.textDecoration = dec;
  if (p['dimColor'] && !p['color']) s.color = 'var(--text-dim)';
  if (p['color']) paintColor(t, 'color', p['color'], 'text', ctx);
  if (p['inverse']) t.classList.add('mv-text--inverse');
  if (p['wrap'] === 'truncate' || p['wrap'] === 'truncate-end' || p['wrap'] === 'truncate-middle') t.classList.add('mv-text--trunc');
  if (p['wrap'] === 'nowrap' || p['wrap'] === 'none') t.classList.add('mv-text--nowrap');
  const kids = node.children == null ? [] : Array.isArray(node.children) ? [...node.children as readonly ModChild[]] : [node.children as ModChild];
  kids.forEach((c, i) => {
    if (c == null || c === false || c === true) return;
    if (typeof c === 'string' || typeof c === 'number') t.append(document.createTextNode(String(c)));
    else { const n = build(c, ctx, path + '.' + i); if (n) t.append(n); }
  });
  return t;
}

function buildButton(p: Props, kids: readonly ModChild[], ctx: Ctx, path: string): HTMLElement {
  const label = p['label'] != null ? str(p['label']) : textOf(kids);
  const variant = p['variant'] === 'primary' ? 'primary' : (p['plain'] || p['variant'] === 'plain' || p['variant'] === 'ghost') ? 'ghost' : 'secondary';
  const key = hotkeyOk(p['hotkey']) ? p['hotkey'] : null;
  const icon = typeof p['icon'] === 'string' && iconNames.includes(p['icon']) ? p['icon'] : null;
  const b = frag<HTMLButtonElement>(html.button({ label, variant, size: 's', disabled: !!p['disabled'], ...(icon ? { icon } : {}), ...(key ? { keys: key, tip: label } : {}) }));
  hydrateOne(b);
  if (!label) { b.querySelector('span')?.remove(); b.classList.add('mv-iconbtn'); }   /* a button with no label is a square, as a checkbox is */
  if (p['pressed'] != null) b.setAttribute('aria-pressed', String(!!p['pressed']));
  /* role 'danger' has no red button in the system (red is for what you owe); it draws as a secondary and says so to a screen reader */
  if (p['role'] === 'danger' || p['role'] === 'destructive') b.setAttribute('aria-description', 'Destructive');
  if (p['aria-label']) b.setAttribute('aria-label', str(p['aria-label']));
  b.setAttribute('data-mv-key', path);
  const id = handlerId(p['onPress']);
  const press = (): void => { if (id != null) ctx.dispatch({ type: 'ui.press', id }); };
  b.addEventListener('click', press);
  if (key) ctx.keys.push({ spec: key, run: press, get disabled() { return b.disabled; } });
  return b;
}

function buildInput(p: Props, ctx: Ctx, path: string): HTMLElement {
  const rows = num(p['rows']), multi = rows > 1;
  const wrap = el('div', 'mv-input');
  const f: HTMLInputElement | HTMLTextAreaElement = multi ? el('textarea', 'ui-input') : el('input', 'ui-input');
  if (f instanceof HTMLInputElement) f.type = 'text'; else f.rows = Math.min(8, rows);
  f.placeholder = str(p['placeholder']); f.value = str(p['value']);
  f.setAttribute('aria-label', str(p['aria-label']) || str(p['label']) || str(p['placeholder']) || 'Input'); f.setAttribute('autocomplete', 'off'); f.spellcheck = false;
  f.setAttribute('data-mv-key', path);
  const onInput = handlerId(p['onInput']), onSubmit = handlerId(p['onSubmit']);
  f.addEventListener('input', () => { if (onInput != null) ctx.dispatch({ type: 'ui.input', id: onInput, value: f.value }); });
  const submit = (): void => { if (onSubmit != null) ctx.dispatch({ type: 'ui.submit', id: onSubmit, value: f.value }); };
  f.addEventListener('keydown', ((e: KeyboardEvent) => { if (e.key === 'Enter' && !e.isComposing && (!multi || e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }) as EventListener);
  wrap.append(f);
  if (p['submitLabel']) {
    const b = frag<HTMLButtonElement>(html.button({ label: str(p['submitLabel']), size: 's', variant: 'primary' })); hydrateOne(b);
    b.setAttribute('data-mv-key', path + 's'); b.addEventListener('click', submit); wrap.append(b);
  }
  return wrap;
}

interface Option { label: string; value: string }
function buildSelect(p: Props, ctx: Ctx, path: string): HTMLElement {
  const raw = Array.isArray(p['options']) ? p['options'] as unknown[] : [];
  const opts: Option[] = raw.map((o) => (o && typeof o === 'object'
    ? { label: str((o as Props)['label'] ?? (o as Props)['value']), value: str((o as Props)['value'] ?? (o as Props)['label']) }
    : { label: str(o), value: str(o) }));
  const cur = opts.find((o) => o.value === str(p['value'])) ?? opts[0] ?? { label: '', value: '' };
  const b = el('button', 'ui-input mv-select');
  b.type = 'button'; b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); b.setAttribute('data-mv-key', path);
  const lab = str(p['aria-label']) || str(p['label']) || 'Choose';
  b.setAttribute('aria-label', lab + ': ' + cur.label);
  b.append(el('span', 'mv-select__v', cur.label)); b.insertAdjacentHTML('beforeend', html.icon('chevron-down', { size: 's' }));
  const id = handlerId(p['onSelect']);
  b.addEventListener('click', () => {
    menu.open(b, opts.map((o) => ({ label: o.label, value: o.value, checked: o.value === cur.value })), {
      label: lab, align: 'start', onSelect: (v) => { b.setAttribute('aria-expanded', 'false'); if (id != null) ctx.dispatch({ type: 'ui.select', id, value: v }); }
    });
  });
  return b;
}

function buildCode(p: Props, kids: readonly ModChild[]): HTMLElement {
  const src = (p['source'] != null ? str(p['source']) : textOf(kids)).replace(/\n$/, '');
  const wrap = el('div', 'mv-code' + (p['wrap'] ? ' mv-code--wrap' : ''));
  const path = str(p['path']);
  if (path) wrap.append(el('div', 'mv-code__path ui-mono', path));
  const body = el('pre', 'mv-code__pre ui-mono'); body.tabIndex = 0; body.setAttribute('aria-label', path ? 'Code, ' + path : 'Code');
  const start = p['startLine'] != null ? num(p['startLine']) : null;
  src.split('\n').forEach((line, i) => {
    const row = el('span', 'mv-code__l');
    if (p['format'] === 'diff') {
      const d = /^\+(?!\+\+)/.test(line) ? 'add' : /^-(?!--)/.test(line) ? 'del' : /^@@/.test(line) ? 'hunk' : '';
      if (d) row.dataset['d'] = d;
      row.append(el('span', 'mv-code__sg', d === 'add' ? '+' : d === 'del' ? '−' : ' '), document.createTextNode(d === 'hunk' ? line : line.slice(d ? 1 : 0)));
      if (d === 'add' || d === 'del') row.insertAdjacentHTML('afterbegin', '<span class="ui-sr">' + (d === 'add' ? 'added: ' : 'removed: ') + '</span>');
    } else {
      if (start != null) row.append(el('span', 'mv-code__n', String(start + i)));
      const m = /^(\s*)(PASS|FAIL|✓|✗)(.*)$/.exec(line);   /* test output: a pass or a fail word takes its token */
      if (m && p['format'] !== 'plain') {
        row.append(document.createTextNode(m[1] ?? ''));
        row.append(el('span', 'mv-code__' + (m[2] === 'PASS' || m[2] === '✓' ? 'pass' : 'fail'), m[2]), document.createTextNode(m[3] ?? ''));
      } else row.append(document.createTextNode(line));
    }
    body.append(row);
  });
  wrap.append(body);
  return wrap;
}

function buildLink(p: Props, kids: readonly ModChild[]): HTMLElement {
  const href = str(p['href']);
  const label = p['label'] != null ? str(p['label']) : (textOf(kids) || href);
  let ok = false;
  try { ok = new URL(href).protocol === 'https:'; } catch { ok = false; }
  if (!ok) { const s = el('span', 'mv-text', label); s.title = 'Only https links open'; return s; }
  const a = el('a', 'mv-link', label);
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}

function buildSvg(p: Props, ctx: Ctx): HTMLElement {
  const svg = cleanSvg(p['svg'] != null ? p['svg'] : p['source'], ctx);
  const wrap = el('div', 'mv-svg');
  if (!svg) { wrap.append(el('span', 'mv-text mv-text--quiet', 'This graphic can’t be drawn')); return wrap; }
  wrap.setAttribute('role', 'img'); wrap.setAttribute('aria-label', str(p['label']) || str(p['aria-label']) || 'Graphic');
  if (p['height'] != null) wrap.style.maxHeight = typeof p['height'] === 'number' ? cell(p['height']) : str(p['height']);
  svg.setAttribute('aria-hidden', 'true');
  wrap.append(svg);
  return wrap;
}

/* ───────────── the view ───────────── */
function paint(root: ModRoot, tree: ModElement, opts: ModViewOpts): void {
  const ctx: Ctx = { surface: opts.surface ?? 'frame', dispatch: opts.dispatch ?? (() => undefined), lits: [], keys: [] };
  const n = build(tree, ctx, '0');
  root.replaceChildren(...(n ? [n] : []));
  root._mv = { lits: ctx.lits, opts, keys: ctx.keys };
  LIVE.add(root);
}
const onKey = (e: KeyboardEvent): void => {
  const root = e.currentTarget as ModRoot;
  for (const k of root._mv?.keys ?? []) if (!k.disabled && matchesKey(e, k.spec)) { e.preventDefault(); k.run(); return; }
};

/** draws a tree; null when it fails validation (`onInvalid` says why, else it is logged) */
export function modView(tree: unknown, opts: ModViewOpts = {}): ModRoot | null {
  const v = validateTree(tree);
  if (!v.ok) { if (opts.onInvalid) opts.onInvalid(v.reason); else log.warn('tree skipped: ' + v.reason); return null; }
  const root = el('div', 'mv-root') as ModRoot;
  root.dataset['surface'] = opts.surface ?? 'frame';
  if (opts.label) { root.setAttribute('role', 'group'); root.setAttribute('aria-label', opts.label); }
  root.addEventListener('keydown', onKey);
  paint(root, tree as ModElement, opts);
  return root;
}
/** draws a new tree in place; focus and the caret survive when the same control is still there. False when the tree was refused */
export function modViewUpdate(root: ModRoot, tree: unknown, opts: ModViewOpts = {}): boolean {
  const next: ModViewOpts = { ...(root._mv?.opts ?? {}), ...opts };
  const v = validateTree(tree);
  if (!v.ok) { if (next.onInvalid) next.onInvalid(v.reason); else log.warn('tree skipped: ' + v.reason); return false; }
  const a = document.activeElement as (HTMLInputElement & HTMLTextAreaElement) | null;
  const key = a && root.contains(a) ? a.getAttribute('data-mv-key') : null;
  const sel = key && a && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] as const : null;
  paint(root, tree as ModElement, next);
  if (key) {
    const n = root.querySelector<HTMLInputElement>('[data-mv-key="' + key + '"]');
    if (n) {
      n.focus({ preventScroll: true });
      if (sel && n.setSelectionRange) { try { n.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ } }
    }
  }
  return true;
}
export { LIMITS };
export { sanitizeSvg } from './mod-svg';
export { h, validateTree } from './mod-tree';
export type { ModChild, ModElement } from './mod-tree';
export * as modColors from './mod-colors';
