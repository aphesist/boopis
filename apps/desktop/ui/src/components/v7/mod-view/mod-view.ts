/* ModView: its view (typed props to markup) and its contract. Its look is mod-view.css, its behaviour behaviour.ts, its stories and tests
   stand beside it (docs/kit/RULES.md).

   What a Claude Code mod draws (docs/MODS.md section 2): its element tree, drawn with the kit's own parts, so a mod looks native. One view
   for every place a mod draws into (2b, the lead's decisions for conflict 32): a tab of the Pane after its fixed tabs, the band in the
   held or queued strip's slot over the composer, a ToolRow in the thread. The tree is data (tree.ts); handlers never run here. A handler
   prop is an id; what the person does comes back as `ui:mod {type, id, value}` on the root (behaviour.ts), and the app sends it to the
   plugin. The view checks the tree (tree.ts `validateTree`) and draws nothing for one it refuses; the app asks first (`kit.modViewCheck`)
   and keeps its own drawing with the reason.

   Mapping, onto the kit:
     Box      a flex row (or column) on the spacing scale: a terminal cell is a step (1 --sp-2, 2 --sp-3, 3 --sp-4, 4 --sp-5, more --sp-6).
              A border is the hairline; backgroundColor draws a surface token. A Box with `progress` (0 to 100) or role 'progressbar' is
              ModProgress: the kit's ticks (the composer line's look), filled in proportion, or one tick travelling when nothing is known.
     Text     the type scale (xs 11, s 12, m 13, l 14); `mono` the mono face, `tabular` tabular figures.
     Button   the kit's Button at 28 (primary, ghost, secondary; role danger is the danger Button), or a tinted IconButton with no label.
              A `hotkey` that collides with the app's keys is dropped, never stolen; one that does not works while focus is inside.
     Input    the kit's Field (multiline from two rows), with a primary Button at 28 when it has a submit label.
     Select   the kit's SelectorItem (field), opening the kit's Menu.
     Markdown the kit's markdown, at the mod's size.
     Code     the kit's Well (its path over it, a line gutter from `startLine`, wrapped when asked); a diff is the kit's DiffView.
     Link     https only, the kit's InlineChip (cite); anything else is plain text that says so.
     Svg      sanitised (svg.ts), its colours through the same map as Text. */
import { iconNames } from '../../icons';
import { markdownHTML } from '../../markdown';
import { button } from '../button/button';
import { diffView } from '../diff-view/diff-view';
import type { DiffLine } from '../diff-view/diff-view';
import { field } from '../field/field';
import { iconButton } from '../icon-button/icon-button';
import { inlineChip } from '../inline-chip/inline-chip';
import { selectorItem } from '../selector-item/selector-item';
import { attrs, esc, idFrom, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { well } from '../well/well';
import { defineContract } from '../contract';
import { MARK, SURFACE, TINT, colourOf, isLiteral } from './colours';
import type { Surface } from './colours';
import { cleanSvg } from './svg';
import { handlerId, textOf, validateTree } from './tree';
import type { ModChild, ModElement } from './tree';

export const MOD_SURFACES = ['pane', 'row', 'band'] as const;
export interface ModViewOpts {
  /** the mod's element tree, as it came from the plugin */ tree: unknown;
  /** where it stands: a tab of the Pane (`pane`, the default), a ToolRow in the thread (`row`), the band over the composer (`band`) */ surface?: U<Surface>;
  /** its name as a group, for a screen reader ("Tests, test-runner mod") */ label?: U<string>;
  attrs?: U<Attrs>;
}
type Props = Readonly<Record<string, unknown>>;
const num = (v: unknown): number => +(v as number) || 0;
const str = (v: unknown): string => (v == null ? '' : String(v));
const kidsOf = (n: ModElement): ModChild[] => (n.children == null ? [] : Array.isArray(n.children) ? [...n.children as readonly ModChild[]] : [n.children as ModChild]);

/* terminal cells to the spacing scale */
const STEP = ['0', 'var(--sp-2)', 'var(--sp-3)', 'var(--sp-4)', 'var(--sp-5)', 'var(--sp-6)'] as const;
const sp = (n: unknown): string => STEP[Math.max(0, Math.min(STEP.length - 1, Math.round(num(n))))] ?? '0';
/** a width or height counted in cells: one cell is 8px */
const cell = (n: unknown): string => 'calc(' + num(n) + ' * var(--sp-2))';
const size = (v: unknown): string | null => (typeof v === 'number' ? cell(v) : /^\d+(\.\d+)?%$/.test(String(v)) ? String(v) : null);
const SIZE_VAR: Readonly<Record<string, string>> = { xs: '--fs-2xs', s: '--fs-xs', m: '--fs-s', l: '--fs-m', xl: '--fs-l', small: '--fs-xs', large: '--fs-m', '2xs': '--fs-2xs' };
const weight = (w: unknown, bold: unknown): number | null => (bold ? 600 : w == null ? null : typeof w === 'number' ? (w >= 600 ? 600 : w >= 500 ? 500 : 400) : w === 'bold' ? 600 : w === 'medium' ? 500 : 400);
const FLEX: Readonly<Record<string, string>> = { start: 'flex-start', end: 'flex-end', 'flex-start': 'flex-start', 'flex-end': 'flex-end', center: 'center', stretch: 'stretch', baseline: 'baseline', 'space-between': 'space-between', 'space-around': 'space-around' };
/** keys the app owns: a mod's hotkey that collides is dropped, never stolen (MODS section 2) */
export const RESERVED: readonly string[] = ['mod+k', 'mod+b', 'mod+shift+b', 'mod+i', 'mod+.', 'mod+,', 'mod+[', 'mod+]', 'mod+shift+o', 'mod+enter', 'enter', 'esc', 'escape', 'tab', 'alt+1', 'alt+2', 'alt+v', 'alt+a', 'mod+g', 'x', 'c', 'g', '[', ']', '/'];
export const normKey = (k: string): string => String(k).toLowerCase().replace(/ctrl|cmd|meta/g, 'mod');
export const hotkeyOk = (k: unknown): k is string => typeof k === 'string' && k !== '' && !RESERVED.includes(normKey(k));

/** what a node writes as its colours and its own style: the style attribute, and the literals the behaviour paints */
class Paint {
  style: string[] = []; lits: string[] = [];
  set(prop: string, value: string): void { this.style.push(prop + ':' + value); }
  colour(prop: string, name: unknown, role: 'text' | 'mark'): void { const c = colourOf(prop, name, role); if (c.style) this.style.push(c.style); if (c.lit) this.lits.push(c.lit); }
  attrs(): Attrs { return { style: this.style.length ? this.style.join(';') : null, 'data-mv-lit': this.lits.length ? this.lits.join(';') : null }; }
}

function build(node: ModChild, path: string): string {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return buildText({ type: 'Text', props: {}, children: [node] }, path);
  const p = node.props ?? {}, kids = kidsOf(node);
  switch (node.type) {
    case 'Box': return buildBox(p, kids, path);
    case 'Text': return buildText(node, path);
    case 'Button': return buildButton(p, kids, path);
    case 'Input': return buildInput(p, path);
    case 'Select': return buildSelect(p, path);
    case 'Markdown': return markdownHTML(p['text'] != null ? str(p['text']) : textOf(kids), { httpsOnly: true }, { class: 'k7-mv__md' });
    case 'Code': return buildCode(p, kids);
    case 'Link': return buildLink(p, kids);
    case 'Svg': return buildSvg(p);
    default: return '';
  }
}

/* ModProgress: the kit's ticks, filled in proportion; one tick travelling when nothing is known (F18: dots, never a bar) */
function buildProgress(p: Props): string {
  const n = Math.max(3, Math.min(20, Math.round(num(p['dots'])) || 10)), known = p['progress'] != null && isFinite(+(p['progress'] as number));
  const pct = known ? Math.max(0, Math.min(100, num(p['progress']))) : null, on = pct == null ? 0 : Math.round(pct / 100 * n);
  const paint = new Paint();
  paint.set('--mv-n', String(n));
  if (p['flexGrow'] != null) paint.set('flex-grow', String(Math.max(0, num(p['flexGrow']))));
  const label = str(p['aria-label']) || str(p['label']) || 'Progress';
  return '<span class="k7-mv__progress"' + partAttrs('ModProgress', {
    role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': pct == null ? null : String(Math.round(pct)),
    'aria-busy': pct == null ? 'true' : null, 'data-indeterminate': pct == null ? '' : null, ...paint.attrs()
  }) + '>' + Array.from({ length: n }, (_, i) => '<i' + (i < on ? ' data-on' : '') + '></i>').join('') + (pct == null ? '<i class="k7-mv__run"></i>' : '') + '</span>';
}

function buildBox(p: Props, kids: readonly ModChild[], path: string): string {
  if (p['role'] === 'progressbar' || p['progress'] !== undefined) return buildProgress(p);
  const paint = new Paint();
  const dir = p['flexDirection'];
  if (dir === 'column' || dir === 'column-reverse' || dir === 'row-reverse') paint.set('flex-direction', String(dir));
  const or = (a: unknown, b: unknown): unknown => (a != null ? a : b);
  const steps: Array<[string, unknown]> = [['gap', p['gap']], ['column-gap', p['columnGap']], ['row-gap', p['rowGap']], ['padding', p['padding']],
    ['padding-left', or(p['paddingLeft'], p['paddingX'])], ['padding-right', or(p['paddingRight'], p['paddingX'])], ['padding-top', or(p['paddingTop'], p['paddingY'])], ['padding-bottom', or(p['paddingBottom'], p['paddingY'])],
    ['margin', p['margin']], ['margin-left', or(p['marginLeft'], p['marginX'])], ['margin-right', or(p['marginRight'], p['marginX'])], ['margin-top', or(p['marginTop'], p['marginY'])], ['margin-bottom', or(p['marginBottom'], p['marginY'])]];
  for (const [k, v] of steps) if (v != null) paint.set(k, sp(v));
  const jc = FLEX[str(p['justifyContent'])], ai = FLEX[str(p['alignItems'])], as = FLEX[str(p['alignSelf'])];
  if (jc) paint.set('justify-content', jc);
  if (ai) paint.set('align-items', ai);
  if (as) paint.set('align-self', as);
  if (p['flexWrap'] === 'wrap') paint.set('flex-wrap', 'wrap');
  if (p['flexGrow'] != null) paint.set('flex-grow', String(Math.max(0, num(p['flexGrow']))));
  if (p['flexShrink'] != null) paint.set('flex-shrink', String(Math.max(0, num(p['flexShrink']))));
  const w = size(p['width']), h = size(p['height']), mw = size(p['minWidth']);
  if (w) paint.set('width', w);
  if (h) paint.set('height', h);
  if (mw) paint.set('min-width', mw);
  let border = false, filled = false;
  if (p['borderStyle']) { border = true; if (p['borderColor']) paint.colour('--mv-border', p['borderColor'], 'mark'); }
  if (p['backgroundColor']) {
    const name = str(p['backgroundColor']);
    const surf = SURFACE[name], tint = TINT[name], mark = MARK[name];
    if (surf) paint.set('background', 'var(' + surf + ')');
    else if (/^diff/.test(name) && tint) paint.set('background', 'color-mix(in srgb, var(' + tint + ') 12%, transparent)');   /* a diff background is a tint, as the session draws it */
    else if (mark) paint.set('background', 'var(' + mark + ')');   /* any other name is a solid mark: a bar, a swatch */
    else if (isLiteral(name)) paint.colour('background', name, 'mark');
    else paint.set('background', 'var(--hover)');
    filled = true;
  }
  if (p['overflow'] === 'hidden') paint.set('overflow', 'hidden');
  const lab = str(p['aria-label']) || str(p['label']);
  return '<div class="k7-mv__box"' + attrs({ 'data-border': border ? '' : null, 'data-filled': filled ? '' : null, role: lab ? 'group' : null, 'aria-label': lab || null, ...paint.attrs() }) + '>' +
    kids.map((c, i) => build(c, path + '.' + i)).join('') + '</div>';
}

function buildText(node: ModElement, path: string): string {
  const p = node.props ?? {}, paint = new Paint();
  const sz = SIZE_VAR[str(p['size'])];
  if (sz) paint.set('font-size', 'var(' + sz + ')');
  const wt = weight(p['weight'], p['bold']);
  if (wt) paint.set('font-weight', String(wt));
  if (p['italic']) paint.set('font-style', 'italic');
  const dec = [p['underline'] && 'underline', p['strikethrough'] && 'line-through'].filter(Boolean).join(' ');
  if (dec) paint.set('text-decoration', dec);
  if (p['dimColor'] && !p['color']) paint.set('color', 'var(--text-dim)');
  if (p['color']) paint.colour('color', p['color'], 'text');
  const wrap = str(p['wrap']);
  const inner = kidsOf(node).map((c, i) => (c == null || c === false || c === true ? '' : typeof c === 'string' || typeof c === 'number' ? esc(String(c)) : build(c, path + '.' + i))).join('');
  return '<span class="k7-mv__text"' + attrs({ 'data-mono': p['mono'] ? '' : null, 'data-tab': p['tabular'] ? '' : null, 'data-inverse': p['inverse'] ? '' : null,
    'data-wrap': /^truncate/.test(wrap) ? 'cut' : wrap === 'nowrap' || wrap === 'none' ? 'none' : null, ...paint.attrs() }) + '>' + inner + '</span>';
}

function buildButton(p: Props, kids: readonly ModChild[], path: string): string {
  const label = p['label'] != null ? str(p['label']) : textOf(kids);
  const danger = p['role'] === 'danger' || p['role'] === 'destructive';
  const variant = danger ? 'danger' : p['variant'] === 'primary' ? 'primary' : (p['plain'] || p['variant'] === 'plain' || p['variant'] === 'ghost') ? 'ghost' : 'secondary';
  const key = hotkeyOk(p['hotkey']) ? p['hotkey'] : null;
  const icon = typeof p['icon'] === 'string' && iconNames.includes(p['icon']) ? p['icon'] : null;
  const id = handlerId(p['onPress']);
  const a: Attrs = { 'data-mv-key': path, 'data-mv-press': id, 'data-mv-hotkey': key, 'aria-pressed': p['pressed'] == null ? null : String(!!p['pressed']), 'aria-keyshortcuts': key };
  if (!label) return iconButton({ icon: icon ?? 'plus', label: str(p['aria-label']) || 'Button', variant: 'tinted', disabled: !!p['disabled'], ...(key ? { keys: key } : {}), attrs: a });   /* a button with no label is a square, named by its aria-label */
  return button({ label, variant, size: 28, disabled: !!p['disabled'], ...(icon ? { icon } : {}), ...(key ? { keys: key, tip: label } : {}), attrs: { ...a, 'aria-label': p['aria-label'] ? str(p['aria-label']) : null } });
}

function buildInput(p: Props, path: string): string {
  const rows = num(p['rows']), multi = rows > 1;
  const id = idFrom('k7-mv-in', path + str(p['placeholder']) + str(p['label']));
  const onInput = handlerId(p['onInput']), onSubmit = handlerId(p['onSubmit']);
  const f = field({ id, kind: multi ? 'multiline' : 'text', ...(multi ? { rows: Math.min(8, rows) } : {}), value: str(p['value']), placeholder: str(p['placeholder']),
    ariaLabel: str(p['aria-label']) || str(p['label']) || str(p['placeholder']) || 'Input', attrs: { autocomplete: 'off', spellcheck: 'false', 'data-mv-key': path, 'data-mv-input': onInput, 'data-mv-submit': onSubmit, 'data-mv-multi': multi ? '' : null } });
  const submit = p['submitLabel'] ? button({ label: str(p['submitLabel']), variant: 'primary', size: 28, attrs: { 'data-mv-key': path + 's', 'data-mv-send': onSubmit, 'data-mv-for': id } }) : '';
  return '<div class="k7-mv__input">' + f + submit + '</div>';
}

interface Option { label: string; value: string }
function buildSelect(p: Props, path: string): string {
  const raw = Array.isArray(p['options']) ? p['options'] as unknown[] : [];
  const opts: Option[] = raw.map((o) => (o && typeof o === 'object'
    ? { label: str((o as Props)['label'] ?? (o as Props)['value']), value: str((o as Props)['value'] ?? (o as Props)['label']) }
    : { label: str(o), value: str(o) }));
  const cur = opts.find((o) => o.value === str(p['value'])) ?? opts[0] ?? { label: '', value: '' };
  const lab = str(p['aria-label']) || str(p['label']) || 'Choose';
  return selectorItem({ variant: 'field', label: lab, value: cur.label, attrs: { 'data-mv-key': path, 'data-mv-select': handlerId(p['onSelect']), 'data-mv-options': JSON.stringify(opts), 'data-mv-value': cur.value } });
}

function buildCode(p: Props, kids: readonly ModChild[]): string {
  const src = (p['source'] != null ? str(p['source']) : textOf(kids)).replace(/\n$/, '');
  const path = str(p['path']);
  if (p['format'] === 'diff') {
    const lines: DiffLine[] = src.split('\n').filter((l) => !/^(\+\+\+|---) /.test(l)).map((l) => (/^\+/.test(l) ? { sign: '+', text: l.slice(1) } : /^-/.test(l) ? { sign: '-', text: l.slice(1) } : { sign: ' ', text: /^ /.test(l) ? l.slice(1) : l }));
    return diffView({ path: path || 'Diff', lines, body: 'group' });
  }
  const start = p['startLine'] != null ? Math.max(0, Math.round(num(p['startLine']))) : undefined;
  return well({ text: src, ...(path ? { path } : {}), ...(start != null ? { start } : {}), ...(p['wrap'] ? { wrap: true } : {}), label: path ? 'Code, ' + path : 'Code' });
}

function buildLink(p: Props, kids: readonly ModChild[]): string {
  const href = str(p['href']);
  const label = p['label'] != null ? str(p['label']) : (textOf(kids) || href);
  let ok = false;
  try { ok = new URL(href).protocol === 'https:'; } catch { ok = false; }
  if (!ok) return '<span class="k7-mv__text"' + attrs({ 'data-tip': 'Only https links open', 'aria-description': 'Only https links open' }) + '>' + esc(label) + '</span>';
  return inlineChip({ kind: 'cite', text: label, href });
}

function buildSvg(p: Props): string {
  const svg = cleanSvg(p['svg'] != null ? p['svg'] : p['source']);
  if (!svg) return '<div class="k7-mv__svg"><span class="k7-mv__text" data-quiet>This graphic can’t be drawn</span></div>';
  const h = p['height'] != null ? (typeof p['height'] === 'number' ? cell(p['height']) : str(p['height'])) : null;
  return '<div class="k7-mv__svg"' + attrs({ role: 'img', 'aria-label': str(p['label']) || str(p['aria-label']) || 'Graphic', style: h && /^[\w.%() *+-]+$/.test(h) ? 'max-height:' + h : null }) + '>' + svg + '</div>';
}

/** draws a mod's tree; nothing for a tree that fails validation (`kit.modViewCheck` says why) */
export function modView(o: ModViewOpts): string {
  if (!validateTree(o.tree).ok) return '';
  return '<div class="k7-mv"' + kitAttrs('ModView', { 'data-surface': o.surface ?? 'pane', role: o.label ? 'group' : null, 'aria-label': o.label, ...(o.attrs ?? {}) }) + '>' + build(o.tree as ModElement, '0') + '</div>';
}

/** what ModView promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<ModViewOpts>({
  name: 'ModView',
  folder: 'mod-view',
  layer: 'block',
  summary: 'What a Claude Code mod draws, its element tree, in the kit\'s own parts: in a tab of the Pane, in the band over the composer, or in a ToolRow in the thread. What the person does goes back to the mod by handler id.',
  exports: ['modView'],
  props: {
    tree: 'the mod\'s element tree as the plugin sent it (Box, Text, Button, Input, Select, Markdown, Code, Link, Svg); a tree that fails the limits draws nothing',
    surface: 'pane (the default), row or band: the surface it stands on, which a literal colour is read against',
    label: 'its name as a group, for a screen reader',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: ['ui:mod'],
  states: ['data-surface', 'aria-valuenow', 'aria-busy', 'data-indeterminate', 'aria-pressed'],
  parts: ['ModProgress', 'k7-mv__box', 'k7-mv__text', 'k7-mv__input', 'k7-mv__svg', 'k7-mv__md'],
  tokens: [
    '--dur-breathe', '--ease-io', '--fs-s', '--fs-xs', '--gap-s', '--hair', '--hl', '--lh-s', '--mark-off', '--mono', '--r-field',
    '--r-pill', '--r-xs', '--selected', '--sp-1', '--sp-2', '--sp-3', '--text', '--text-dim', '--text-on-light', '--text-quiet', '--tick',
    '--track-s'
  ],
  a11y: 'A group named by its label. Its Buttons, Fields and SelectorItems are the kit\'s, each named; progress is a role="progressbar" with its value, or aria-busy while nothing is known. A mod\'s hotkey works while focus is inside it and never takes one of the app\'s keys.',
  boards: []
});
