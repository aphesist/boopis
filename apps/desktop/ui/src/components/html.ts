/* String templates: `html.<name>(opts)` for modules that build innerHTML (cards, dock). The element factories in
   index.ts wrap these and wire the behaviours, so there is one markup for every primitive. Class names and DOM output
   are the v6 library's, so components.css ports 1:1. No colour, family or size lives here. */
import { attrs, cx, esc, nid } from '../core/dom';
import type { Attrs } from '../core/dom';
import { ariaKeys } from '../core/keys';
import { combo, comboKbds, kbd, keys } from './kbd';
import { botState } from './bot-state';
import type { BotLike } from './bot-state';
import { icon } from './icons';
import { logoHTML } from './logo';
import { modelName } from './model-name';
import { signinButton } from './signin-button';
import { arrowHTML, isKnownModel, markHTML, modelHTML, routeHTML } from './model-mark';
import type { ModelRef } from './model-mark';
import { orbHtml } from './orb';
import { stack } from './stack';
import { modelEntries, selectHTML, toEntries } from './select-html';
import type { SelectEntry } from './select-html';
import { scroll } from './scroll';
import { tabs } from './tabs';
import { STATUS_DOT, STATUS_WORD } from './child';
import type { ChildOpts } from './child';
import { search } from './search';

type U<T> = T | undefined;

const code = (text: string): string => '<code class="ui-code">' + esc(text) + '</code>';
/** inline `code` in a data string -> chips; everything else escaped */
const inline = (text: string): string => esc(text).replace(/`([^`]+)`/g, '<code class="ui-code">$1</code>');
const stamp = (text: string, o?: { attrs?: Attrs }): string => '<span class="ui-stamp"' + attrs(o?.attrs) + '>' + esc(text) + '</span>';
const dot = (kind?: string, o: { size?: string; label?: string; show?: boolean } = {}): string =>
  '<span class="' + cx('ui-dot', kind && 'ui-dot--' + kind, o.size === 's' && 'ui-dot--s') + '"' + (o.label ? ' role="img" aria-label="' + esc(o.label) + '"' : ' aria-hidden="true"') + (o.show ? ' data-show' : '') + '></span>';
const capacity = (spent: string, cap: string, o?: { label?: string }): string =>
  '<span class="ui-capacity"' + attrs({ role: 'img', 'aria-label': o?.label ?? (spent + ' of ' + cap + ' spent') }) + '><b>' + esc(spent) + '</b> of ' + esc(cap) + '</span>';

export interface ButtonOpts {
  label: string; variant?: U<'secondary' | 'primary' | 'ghost'>; size?: U<'m' | 's'>; icon?: U<string>; keys?: U<string>; showKeys?: U<boolean>;
  disabled?: U<boolean>; tip?: U<string>; action?: U<string>; type?: U<string>; class?: U<string>; attrs?: U<Attrs>;
}
function button(o: ButtonOpts): string {
  return '<button type="' + (o.type ?? 'button') + '" class="' + cx('ui-btn', o.variant && o.variant !== 'secondary' && 'ui-btn--' + o.variant, o.size === 's' && 'ui-btn--s', o.class) + '"' +
    attrs({ disabled: o.disabled, 'data-action': o.action, 'data-tip': o.tip, 'data-kbd': o.tip && o.keys, 'aria-keyshortcuts': o.keys && ariaKeys(o.keys), ...o.attrs }) + '>' +
    (o.icon ? icon(o.icon) : '') + '<span>' + esc(o.label) + '</span>' + (o.keys && o.showKeys ? '<span class="ui-btn__kbd">' + keys(o.keys) + '</span>' : '') + '</button>';
}
export interface IconButtonOpts {
  icon: string; label: string; keys?: U<string>; pressed?: U<boolean>; expanded?: U<boolean>; haspopup?: U<string>; size?: U<'s'>; window?: U<boolean>;
  tipPos?: U<string>; tip?: U<string | false>; disabled?: U<boolean>; action?: U<string>; class?: U<string>; attrs?: U<Attrs>;
}
function iconButton(o: IconButtonOpts): string {
  return '<button type="button" class="' + cx('ui-ib', o.window && 'ui-ib--window', o.size === 's' && 'ui-ib--s', o.class) + '"' +
    attrs({ 'aria-label': o.label, 'data-tip': o.tip === false ? null : (o.tip || o.label), 'data-kbd': o.keys, 'data-tip-pos': o.tipPos, 'aria-keyshortcuts': o.keys && ariaKeys(o.keys),
      'aria-pressed': o.pressed == null ? null : String(!!o.pressed), 'aria-expanded': o.expanded == null ? null : String(!!o.expanded), 'aria-haspopup': o.haspopup, disabled: o.disabled, 'data-action': o.action, ...o.attrs }) + '>' + icon(o.icon) + '</button>';
}
/** send: `corner` sets it into its container's corner (.ui-corner: concentric, inset by the container's rule) */
const send = (o: { running?: boolean; disabled?: boolean; corner?: boolean } = {}): string => {
  const run = !!o.running;
  return '<button type="button" class="' + cx('ui-send', o.corner && 'ui-corner') + '" data-ui="send"' + attrs({ 'aria-label': run ? 'Stop' : 'Send', 'data-tip': run ? 'Stop' : 'Send', 'data-kbd': run ? 'mod+period' : 'enter', 'aria-keyshortcuts': run ? ariaKeys('mod+.') : 'Enter', disabled: o.disabled && !run }) + '>' + icon(run ? 'stop' : 'send') + '</button>';
};
export interface HoldOpts { label?: U<string>; ms?: U<number>; fill?: U<'dots' | 'solid'>; hintId?: U<string>; ariaLabel?: U<string>; attrs?: U<Attrs>; doneLabel?: U<string>; announce?: U<(t: string) => void> }
/** hold to approve. Wire with hold.wire(el) or hydrate(). */
function hold(o: HoldOpts = {}): string {
  const id = o.hintId || nid('hold');
  const label = o.label || 'Hold to approve';
  return '<button type="button" class="ui-btn ui-hold" data-ui="hold" data-state="idle"' + attrs({ 'data-ms': o.ms, 'data-fill': o.fill, 'aria-describedby': id, 'aria-label': o.ariaLabel, ...o.attrs }) + '>' +
    '<span class="ui-hold__solid" aria-hidden="true"></span><canvas class="ui-hold__fx" aria-hidden="true"></canvas>' +
    '<span class="ui-hold__label">' + esc(label) + '</span><span class="ui-hold__label ui-hold__label--on" aria-hidden="true">' + esc(label) + '</span></button>' +
    '<span class="ui-sr" id="' + id + '">Press and hold for one second, hold the space bar, or press enter twice</span>';
}
/** a native checkbox */
const switchHtml = (o: { id?: U<string>; checked?: U<boolean>; disabled?: U<boolean>; label?: U<string>; name?: U<string> }): string =>
  '<input type="checkbox" role="switch" class="ui-switch" data-ui="switch"' + attrs({ id: o.id, checked: !!o.checked, disabled: o.disabled, 'aria-label': o.label, name: o.name }) + '>';

export interface SegOption { value: string; label?: U<string>; dot?: U<boolean>; icon?: U<string>; ariaLabel?: U<string>; tip?: U<string>; keys?: U<string> }
export interface SegmentedOpts { options: readonly SegOption[]; value?: U<string | null>; mode?: U<'tabs' | 'radio'>; label?: U<string>; /** named by a visible label instead (a settings row's label id); replaces `label` */ labelledby?: U<string>; size?: U<'s'>; vertical?: U<boolean>; fill?: U<boolean>; class?: U<string>; controls?: U<Record<string, string>>; attrs?: U<Attrs> }
function segmented(o: SegmentedOpts): string {
  const opts = o.options;
  const i = Math.max(0, opts.findIndex((x) => x.value === o.value));
  const tabs = o.mode !== 'radio';
  return '<div class="' + cx('ui-seg', o.size === 's' && 'ui-seg--s', o.vertical && 'ui-seg--vertical', o.fill && 'ui-seg--fill', o.class) + '" data-ui="seg" role="' + (tabs ? 'tablist' : 'radiogroup') + '"' +
    attrs({ 'aria-label': o.labelledby ? null : o.label, 'aria-labelledby': o.labelledby, 'aria-orientation': o.vertical ? 'vertical' : null, style: '--n:' + opts.length + ';--i:' + i, ...o.attrs }) + '><span class="ui-seg__thumb" aria-hidden="true"></span>' +
    opts.map((x, j) => '<button type="button" class="ui-seg__opt" role="' + (tabs ? 'tab' : 'radio') + '" data-value="' + esc(x.value) + '"' +
      attrs({ [tabs ? 'aria-selected' : 'aria-checked']: String(j === i), tabindex: j === i ? '0' : '-1', 'aria-controls': o.controls?.[x.value], 'aria-label': x.ariaLabel, 'data-tip': x.tip, 'data-kbd': x.keys }) + '>' +
      (x.icon ? icon(x.icon, { size: 'm' }) : '') + (x.label != null ? '<span>' + esc(x.label) + '</span>' : '') + (x.dot != null ? dot('attention', { show: !!x.dot }) : '') + '</button>').join('') + '</div>';
}
export interface ChipOpts { label?: U<string>; /** a model: its provider's mark leads, and the label defaults to the name */ model?: U<ModelRef>; modelColor?: U<'mono' | 'brand'>; icon?: U<string>; pressed?: U<boolean>; mono?: U<boolean>; haspopup?: U<string>; expanded?: U<boolean>; option?: U<boolean>; checked?: U<boolean>; tip?: U<string>; value?: U<string>; tabindex?: U<string>; class?: U<string>; attrs?: U<Attrs> }
function chip(o: ChipOpts): string {
  const option = !!o.option;
  return '<button type="button" class="' + cx('ui-chip', (o.mono || (o.model && o.mono !== false)) && 'ui-chip--mono', option && 'ui-chip--option', o.class) + '" data-ui="chip"' +
    attrs({ role: option ? 'radio' : null, 'aria-checked': option ? String(!!o.checked) : null, 'aria-pressed': !option && o.pressed != null ? String(!!o.pressed) : null,
      'aria-haspopup': o.haspopup, 'aria-expanded': o.haspopup ? String(!!o.expanded) : null, 'data-tip': o.tip, 'data-value': o.value, tabindex: o.tabindex, ...o.attrs }) + '>' +
    (o.model ? markHTML(o.model, { size: 14, color: o.modelColor ?? 'mono' }) : o.icon ? icon(o.icon) : '') + '<span>' + esc(o.label ?? (o.model ? modelName(o.model) : '')) + '</span>' + (o.haspopup ? icon('chevron-down', { size: 's' }) : '') + '</button>';
}
const chipGroup = (o: { options: readonly { label: string; value: string }[]; value?: U<string | null>; label?: U<string> }): string =>
  '<div class="ui-chips" role="radiogroup" data-ui="options"' + attrs({ 'aria-label': o.label }) + '>' +
  o.options.map((x) => chip({ label: x.label, value: x.value, option: true, checked: x.value === o.value, tabindex: x.value === o.value ? '0' : '-1' })).join('') + '</div>';

const stateWord = (b: BotLike, o?: { showIdle?: boolean }): string => {
  const s = botState(b);
  if (s.key === 'idle' && !o?.showIdle) return '';
  return '<span class="ui-state"' + (s.tone !== 'none' ? ' data-tone="' + s.tone + '"' : '') + '>' + esc(s.word) + '</span>';
};

export interface RowOpts { title?: U<string>; titleHTML?: U<string>; sub?: U<string | null>; end?: U<string>; endTone?: U<string | null>; lead?: U<string>; current?: U<boolean>; archived?: U<boolean>; acts?: U<string>; attrs?: U<Attrs>; tag?: U<string>; class?: U<string>; value?: U<string>; tabindex?: U<string> }
function row(o: RowOpts): string {
  const two = o.sub != null;
  const tag = o.tag || 'button';
  const r = '<' + tag + (tag === 'button' ? ' type="button"' : '') + ' class="' + cx('ui-row', two && 'ui-row--2', o.class) + '"' +
    attrs({ 'aria-current': o.current ? 'true' : null, 'data-archived': o.archived, 'data-value': o.value, tabindex: o.tabindex, ...o.attrs }) + '>' +
    '<span class="ui-row__lead">' + (o.lead ?? '') + '</span>' +
    '<span class="ui-row__text"><span class="ui-row__title">' + (o.titleHTML ?? esc(o.title)) + '</span>' + (two ? ' <span class="ui-row__sub">' + esc(o.sub) + '</span>' : '') + '</span>' +
    (o.end ? ' <span class="ui-row__end"' + attrs({ 'data-tone': o.endTone, 'data-swap': o.acts ? '' : null }) + '>' + o.end + '</span>' : '') + '</' + tag + '>';
  return o.acts ? '<li class="ui-row-wrap">' + r + '<span class="ui-row__acts">' + o.acts + '</span></li>' : '<li>' + r + '</li>';
}
/** the glyph column: running breathes, attention is red, current and idle is brass, else nothing */
const leadFor = (o: { attention?: U<boolean>; running?: U<boolean>; current?: U<boolean> }): string => (o.attention ? dot('attention') : o.running ? dot('run') : o.current ? dot('here') : '');
function group(o: { label: string; collapsible?: U<boolean>; expanded?: U<boolean>; rows?: U<string>; id?: U<string> }): string {
  const id = o.id || nid('grp');
  const head = o.collapsible
    ? '<button type="button" class="ui-group__head" data-ui="group" aria-expanded="' + (o.expanded !== false) + '" aria-controls="' + id + '"><span>' + esc(o.label) + '</span>' + icon('chevron') + '</button>'
    : '<div class="ui-group__head" id="' + id + '-h">' + esc(o.label) + '</div>';
  return '<div class="ui-group" role="group" aria-label="' + esc(o.label) + '">' + head + '<ul class="ui-rows" id="' + id + '" data-ui="rows">' + (o.rows ?? '') + '</ul></div>';
}

export type Station = readonly [model: string, rule?: string];
export interface LadderOpts { stations?: U<readonly Station[]>; current?: U<number>; variant?: U<'line' | 'list'>; label?: U<string>; off?: U<boolean>; ground?: U<string> }
function ladder(o: LadderOpts): string {
  const L = o.stations ?? [], cur = o.current ?? 0;
  const st = (i: number): string => (i < cur ? 'past' : i === cur ? 'now' : 'next');
  const style = o.ground ? '--ui-ladder-ground:' + o.ground : null;
  if (o.variant === 'list') {
    return '<ol class="ui-ladder ui-ladder--list"' + attrs({ 'aria-label': o.label || 'Model ladder', 'data-off': o.off, style }) + '>' + L.map((x, i) =>
      '<li' + (i === cur ? ' aria-current="step"' : '') + '><span class="ui-ladder__mark"><i class="ui-ladder__st" data-s="' + st(i) + '"></i></span>' +
      '<span class="ui-ladder__name">' + markHTML(x[0], { size: 14 }) + esc(modelName(x[0]) || x[0]) + '</span><span class="ui-ladder__rule">' + esc(x[1] ?? '') + '</span></li>').join('') + '</ol>';
  }
  const name = L[cur] ? L[cur][0] : '';
  return '<span class="ui-ladder" role="img"' + attrs({ 'aria-label': (o.label || 'Model ladder') + ', station ' + (cur + 1) + ' of ' + L.length + (name ? ': ' + (modelName(name) || name) : ''), 'data-off': o.off, style }) + '>' +
    L.map((_, i) => '<i class="ui-ladder__st" data-s="' + st(i) + '"></i>').join('') + '</span>';
}

export type MeasurePart = readonly [label: string, n: number];
export interface MeasureOpts { used?: U<number>; total: number; dots?: U<number>; variant?: U<'strip' | 'row' | 'grid'>; parts?: U<readonly MeasurePart[]>; label?: U<string>; cols?: U<number> }
function measure(o: MeasureOpts): string {
  const n = o.dots || (o.variant === 'grid' ? 40 : 8), per = o.total / n;
  let cells = '';
  if (o.parts) {
    let acc = 0, k = 0;
    const edges = o.parts.map((p) => (acc += p[1]));
    for (let i = 0; i < n; i++) { const mid = (i + 0.5) * per; while (k < edges.length && mid > (edges[k] ?? 0)) k++; cells += k < edges.length ? '<i data-p="' + Math.min(k, 3) + '"></i>' : '<i></i>'; }
  } else {
    const on = Math.round((o.used ?? 0) / per);
    for (let i = 0; i < n; i++) cells += i < on ? '<i data-on></i>' : '<i></i>';
  }
  const pct = Math.round((o.used != null ? o.used : (o.parts ?? []).reduce((a, p) => a + p[1], 0)) / o.total * 100);
  return '<span class="' + cx('ui-measure', 'ui-measure--' + (o.variant || 'strip')) + '" role="img"' + attrs({ 'aria-label': (o.label || 'Context') + ' ' + pct + '% used', style: o.cols ? '--cols:' + o.cols : null }) + '>' + cells + '</span>';
}
const legend = (parts: readonly MeasurePart[], fmt?: (n: number) => string): string =>
  '<ul class="ui-legend">' + parts.map((p, i) => '<li><i style="background:var(' + ['--text', '--text-dim', '--text-quiet', '--text-faint'][Math.min(i, 3)] + ')"></i><span>' + esc(p[0]) + '</span><b>' + esc(fmt ? fmt(p[1]) : p[1]) + '</b></li>').join('') + '</ul>';

export interface PageDef { id: string; label?: U<string>; attention?: U<boolean> }
function pages(o: { pages: readonly PageDef[]; current?: U<string>; interactive?: U<boolean>; label?: U<string> }): string {
  const P = o.pages;
  if (!o.interactive) return '<span class="ui-pages ui-pages--still" role="img" aria-label="' + esc(o.label || ('Page ' + (P.findIndex((p) => p.id === o.current) + 1) + ' of ' + P.length)) + '">' + P.map((p) => '<span class="ui-pages__dot"' + (p.id === o.current ? ' data-current' : '') + (p.attention ? ' data-attention' : '') + '><i></i></span>').join('') + '</span>';   /* still: an image named by its label; the dots carry no ARIA state */
  return '<span class="ui-pages" role="tablist" data-ui="pages"' + attrs({ 'aria-label': o.label || 'Pages' }) + '>' + P.map((p) => '<button type="button" class="ui-pages__dot" role="tab" data-value="' + esc(p.id) + '"' +
    attrs({ 'aria-selected': String(p.id === o.current), tabindex: p.id === o.current ? '0' : '-1', 'aria-label': (p.label ?? '') + (p.attention ? ', needs you' : ''), 'data-attention': p.attention, 'data-tip': p.label }) + '><i></i></button>').join('') + '</span>';
}

const request = (text: string): string => '<div class="ui-request">' + esc(text) + '</div>';
const disclosure = (o: { label: string; controls?: U<string>; expanded?: U<boolean> }): string =>
  '<button type="button" class="ui-disclosure" data-ui="disclosure"' + attrs({ 'aria-expanded': String(!!o.expanded), 'aria-controls': o.controls }) + '>' + icon('chevron') + '<span>' + esc(o.label) + '</span></button>';
/** a call-number line: text, or a model drawn with its mark (`via`: the arrow that leads it) */
export type CallLine = string | { model: string; via?: U<string>; size?: U<number> };
export interface EntryOpts { kind?: U<'user' | 'agent' | 'bot' | 'mod'>; who?: U<string>; callno?: U<readonly CallLine[]>; body?: U<string>; steps?: U<{ count: number; id: string; open?: boolean }>; label?: U<string> }
/** an agent's call number starts with its model, then '→ model' for each step up the ladder: those leading string lines are
    read as models when they name a known family (a time or a cost never does) */
function leadingModels(o: EntryOpts): CallLine[] {
  const out = [...(o.callno ?? [])];
  if (o.kind !== 'agent') return out;
  for (let i = 0; i < out.length; i++) {
    const l = out[i];
    if (l === undefined || typeof l === 'object') continue;
    const m = /^\s*(→|->)\s*(.+)$/.exec(l), name = m ? (m[2] ?? '') : l;
    if ((i === 0) === !!m || !isKnownModel(name)) break;
    out[i] = m ? { model: name, via: m[1] ?? '→' } : { model: name };
  }
  return out;
}
function callLine(l: CallLine, i: number, who: boolean): string {
  if (typeof l === 'object') return '<span>' + (l.via ? arrowHTML(l.via) : '') + modelHTML(l.model, { size: l.size ?? 14 }) + '</span>';
  return i === 0 && !who ? '<b>' + esc(l) + '</b>' : '<span>' + esc(l) + '</span>';
}
function entry(o: EntryOpts): string {
  const lines = leadingModels(o).map((l, i) => callLine(l, i, !!o.who)).join('');
  const steps = o.steps ? disclosure({ label: o.steps.count + ' steps', controls: o.steps.id, expanded: o.steps.open }) : '';
  return '<article class="ui-entry"' + attrs({ 'data-kind': o.kind, 'aria-label': o.label }) + '><div class="ui-callno">' + (o.who ? '<span class="' + cx('ui-callno__who', o.kind === 'user' && 'is-you') + '">' + o.who + '</span>' : '') + lines + steps + '</div>' +
    '<div class="ui-entry__body">' + (o.body ?? '') + '</div></article>';
}
export interface StepItem { title: string; mono?: U<boolean>; meta?: U<readonly string[] | null>; time?: U<string>; kind?: U<'step' | 'fail' | 'escalate'> }
const steps = (items: readonly StepItem[], o?: { id?: U<string>; hidden?: U<boolean> }): string =>
  '<ol class="ui-steps"' + attrs({ id: o?.id, hidden: o?.hidden, 'aria-label': 'Steps' }) + '>' + items.map((s) =>
    '<li class="ui-step" data-kind="' + esc(s.kind ?? 'step') + '"><span class="ui-step__mark"><i></i></span><span class="ui-step__title' + (s.mono ? ' ui-mono' : '') + '">' + esc(s.title) +
    (s.meta ? '<span class="ui-step__meta">' + s.meta.map((m) => '<span>' + esc(m) + '</span>').join('') + '</span>' : '') + '</span><span class="ui-step__time">' + esc(s.time ?? '') + '</span></li>').join('') + '</ol>';
/** the blank inside a sentence: a button; the card layer owns the popover */
const blank = (o: { answer?: U<string> } = {}): string => {
  const a = o.answer ?? '';
  return '<button type="button" class="ui-blank"' + attrs({ 'data-answered': a ? '' : null, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': a ? 'Answer: ' + a + '. Change it' : 'Answer the open question, waiting for you' }) + '><span class="ui-blank__gap">' + esc(a) + '</span>' + (a ? '' : stamp('waiting for you', { attrs: { 'aria-hidden': 'true' } })) + '</button>';
};
function section(o: { label: string; meta?: U<string>; open?: U<boolean>; body?: U<string>; id?: U<string>; name?: U<string> }): string {
  const id = o.id || nid('sec');
  return '<div class="ui-sec" role="group"' + attrs({ 'aria-labelledby': id + '-h', 'data-name': o.name }) + '><button type="button" class="ui-sec__head" data-ui="section" id="' + id + '-h" aria-expanded="' + (!!o.open) + '" aria-controls="' + id + '">' +
    '<span class="ui-sec__label">' + esc(o.label) + '</span><span class="ui-sec__meta">' + (o.meta ?? '') + '</span>' + icon('chevron') + '</button><div class="ui-sec__body" id="' + id + '">' + (o.body ?? '') + '</div></div>';
}

export interface MenuItem {
  label?: string; /** a model: a brand mark leads the label (a menu of models is the picker) */ model?: ModelRef; modelColor?: 'mono' | 'brand'; value?: string | number; desc?: string; icon?: string; keys?: string; checked?: boolean; mono?: boolean; disabled?: boolean; stamp?: string;
  role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox'; lead?: string; content?: boolean; title?: string; foot?: string;
}
export type MenuEntry = MenuItem | '-';
export const itemValue = (x: MenuItem): string => String(x.value != null ? x.value : x.label);
function menuItems(items: readonly MenuEntry[], o: { multi?: boolean | undefined } = {}): string {
  const radio = items.some((x) => x !== '-' && x.checked != null);
  return items.map((x) => {
    if (x === '-') return '<div class="ui-menu__sep" role="separator"></div>';
    if (x.title) return '<div class="ui-menu__title" role="presentation">' + esc(x.title) + '</div>';
    if (x.foot) return '<div class="ui-menu__foot">' + esc(x.foot) + '</div>';
    const role = x.role ?? (radio ? (o.multi ? 'menuitemcheckbox' : 'menuitemradio') : 'menuitem');
    return '<button type="button" class="ui-menu__item" role="' + role + '"' + attrs({ 'aria-checked': role === 'menuitem' ? null : String(!!x.checked), 'data-value': itemValue(x), disabled: x.disabled, tabindex: '-1', 'aria-keyshortcuts': x.keys && ariaKeys(x.keys) }) + '>' +
      '<span class="ui-menu__glyph">' + (role !== 'menuitem' ? (x.checked ? icon('check') : '') : (x.lead ?? (x.icon ? icon(x.icon) : ''))) + '</span>' +
      '<span class="ui-menu__text"><span class="' + cx('ui-menu__label', x.mono && 'ui-mono') + '"' + (x.content || x.model ? ' data-content' : '') + '>' + (x.model ? markHTML(x.model, { size: 16, color: x.modelColor ?? 'brand' }) : '') + esc(x.label) + '</span>' + (x.desc ? '<span class="ui-menu__desc">' + esc(x.desc) + '</span>' : '') + '</span>' +
      (x.stamp ? stamp(x.stamp) : '') + (x.keys ? keys(x.keys) : '') + '</button>';
  }).join('');
}
export interface FieldOpts { id?: U<string>; name?: U<string>; label?: U<string>; hint?: U<string>; error?: U<string>; /** 'select' draws the library's select; 'model' is the model picker (options are model ids, grouped by provider) */ kind?: U<'text' | 'textarea' | 'select' | 'model'>; type?: U<string>; value?: U<string>; placeholder?: U<string>; mono?: U<boolean>; raised?: U<boolean>; options?: U<readonly (string | SelectEntry)[]>; disabled?: U<boolean> }
function field(o: FieldOpts): string {
  const id = o.id || nid('fld'), hid = id + '-hint';
  const common: Attrs = { id, name: o.name, placeholder: o.placeholder, 'aria-describedby': o.hint || o.error ? hid : null, 'aria-invalid': o.error ? 'true' : null, disabled: o.disabled, spellcheck: o.mono ? 'false' : null, autocomplete: 'off' };
  const cls = cx('ui-input', o.mono && 'ui-input--mono', o.raised && 'ui-input--raised');
  let control: string;
  if (o.kind === 'textarea') control = '<textarea class="' + cls + '" data-ui="autosize" rows="2"' + attrs(common) + '>' + esc(o.value ?? '') + '</textarea>';
  else if (o.kind === 'select' || o.kind === 'model') {
    const list = o.options ?? [];
    control = selectHTML({ id, name: o.name, entries: o.kind === 'model' ? modelEntries(list.filter((x): x is string => typeof x === 'string')) : toEntries(list), value: o.value, placeholder: o.placeholder,
      labelId: o.label ? id + '-l' : null, label: o.label, describedby: o.hint || o.error ? hid : null, invalid: !!o.error, disabled: o.disabled, mono: o.mono, raised: o.raised });
  } else control = '<input type="' + (o.type ?? 'text') + '" class="' + cls + '"' + attrs({ ...common, value: o.value }) + '>';
  const picker = o.kind === 'select' || o.kind === 'model';   /* a button is named by aria-labelledby; a click on its label would open the list */
  return '<div class="ui-field">' + (o.label ? (picker ? '<span class="ui-field__label" id="' + id + '-l">' + esc(o.label) + '</span>' : '<label class="ui-field__label" for="' + id + '">' + esc(o.label) + '</label>') : '') + control +
    (o.error || o.hint ? '<p class="ui-field__hint" id="' + hid + '"' + (o.error ? ' data-tone="attention"' : '') + '>' + esc(o.error || o.hint) + '</p>' : '') + '</div>';
}
/** a settings row: its label, a hint under it (a command in backticks shows as code, as the host writes its sentences), its control */
const setRow = (o: { label: string; hint?: U<string | null>; for?: U<string | null>; /** the label's own id, for a control named by aria-labelledby (a select) */ labelId?: U<string>; control?: U<string> }): string =>
  '<div class="ui-set__row"><' + (o.for ? 'label for="' + esc(o.for) + '"' : 'span') + attrs({ id: o.labelId }) + ' class="ui-set__label"><span>' + esc(o.label) + '</span>' + (o.hint ? '<small>' + inline(o.hint) + '</small>' : '') + '</' + (o.for ? 'label' : 'span') + '>' + (o.control ?? '') + '</div>';
export interface BadgeOpts {
  label: string;
  /** the sentence behind the short words: its tooltip (and, with `describedBy`, its accessible description) */
  tip?: U<string>; tipPos?: U<string>;
  /** reachable by keyboard, so the tooltip shows on focus (outside a control; inside a row the row carries the sentence) */
  focusable?: U<boolean>; describedBy?: U<string>;
  class?: U<string>; attrs?: U<Attrs>;
}
export interface InputOpts {
  id?: U<string>; name?: U<string>; type?: U<string>; value?: U<string>; placeholder?: U<string>;
  /** the accessible name when no visible label is bound with `for` */
  label?: U<string>;
  mono?: U<boolean>; raised?: U<boolean>;
  /** a textarea of this many rows (a multi-line value: a theme's JSON) */
  rows?: U<number>;
  disabled?: U<boolean>; class?: U<string>; attrs?: U<Attrs>;
}
/** the bare text control (`.ui-input`, DESIGN-SYSTEM.md §14.25, R-field-1 to 4) for a place that has its own label: a settings row's
    control, a rename in a list. `field()` is the same control with its label, hint and error. */
function input(o: InputOpts): string {
  const a: Attrs = { id: o.id, name: o.name, placeholder: o.placeholder, 'aria-label': o.label, disabled: o.disabled, autocomplete: 'off', spellcheck: o.mono ? 'false' : null, ...o.attrs };
  const cls = cx('ui-input', o.mono && 'ui-input--mono', o.raised && 'ui-input--raised', o.class);
  return o.rows ? '<textarea class="' + cls + '"' + attrs({ rows: o.rows, ...a }) + '>' + esc(o.value ?? '') + '</textarea>'
    : '<input type="' + esc(o.type ?? 'text') + '" class="' + cls + '"' + attrs({ ...a, value: o.value }) + '>';
}
/** a quiet mark: a chip's capsule in mono 11, outlined, never filled and never red (a stamp is what the user owes). The "made outside
    boopis" mark (owner decision, 19 November 2026) is one. Pending rule: the design system describes this mark only for that place. */
const badge = (o: BadgeOpts): string => '<span class="' + cx('ui-badge', o.class) + '"' +
  attrs({ role: o.focusable ? 'note' : null, tabindex: o.focusable ? '0' : null, 'data-tip': o.tip, 'data-tip-pos': o.tipPos, 'aria-describedby': o.describedBy, ...o.attrs }) + '>' + esc(o.label) + '</span>';
/** a settings section's heading (12/500 quiet, 20 above: DESIGN-SYSTEM.md §14.21); the section is a `<section class="ui-set">` named by it */
/** a section's heading; `level` 2 where the page's own title is the h1 and no h2 sits between (first run), else 3 under the dialog's */
const setHead = (o: { label: string; id: string; level?: 2 | 3 }): string => { const h = 'h' + String(o.level ?? 3); return '<' + h + ' class="ui-set__head" id="' + esc(o.id) + '">' + esc(o.label) + '</' + h + '>'; };
/** a settings section: its heading, then its rows (`setRow`) */
const setSection = (o: { label: string; id: string; body?: U<string>; attrs?: U<Attrs> }): string =>
  '<section class="ui-set"' + attrs({ 'aria-labelledby': o.id, ...o.attrs }) + '>' + setHead(o) + (o.body ?? '') + '</section>';
const empty = (o: { title: string; text?: U<string>; mark?: U<boolean>; action?: U<string> }): string =>
  '<div class="ui-empty">' + (o.mark ? '<span class="ui-empty__mark">' + logoHTML({ mark: true, label: false }) + '</span>' : '') + '<h2 class="ui-empty__title">' + esc(o.title) + '</h2>' + (o.text ? '<p class="ui-empty__text">' + esc(o.text) + '</p>' : '') + (o.action ?? '') + '</div>';

/** the mod as a name: its glyph and its name, one unit (origin slots, tabs, band rows, toasts, placed rows) */
const mod = (name: string, o?: { class?: string }): string => '<span class="mv-by' + (o?.class ? ' ' + o.class : '') + '">' + icon('mod', { class: 'mv-by__g' }) + '<span class="mv-by__n">' + esc(name) + '</span></span>';

const toast = (text: string, action?: string): string => '<div class="ui-toast" role="status" data-static><span>' + esc(text) + '</span>' + (action ? button({ label: action, size: 's', variant: 'ghost', class: 'ui-corner' }) : '') + '</div>';
/** a tooltip's content: the label, an optional state, the keys (concentric with the tooltip, on its raised colour); tooltip.ts shows it */
export const tipBody = (label: string, k?: string | null, state?: { text: string; tone?: string | null } | null): string =>
  '<span>' + esc(label) + '</span>' + (state ? '<span class="ui-tip__state"' + attrs({ 'data-tone': state.tone }) + '>' + esc(state.text) + '</span>' : '') + (k ? keys(k, { fit: true, raised: true }) : '');
const tip = (label: string, k?: string, state?: { text: string; tone?: string }): string => '<div class="ui-tip" data-static>' + tipBody(label, k, state) + '</div>';


/** a task a session handed to another model (child.ts): mark and name, goal, what it does now, how it ended. The actions carry
    `data-action` `open` and `stop`; the session wires them. */
function child(o: ChildOpts): string {
  const word = STATUS_WORD[o.status];
  const live = o.status === 'running' || o.status === 'queued';
  const meta = [word, o.time, o.tools ? o.tools + (o.tools === 1 ? ' tool' : ' tools') : ''].filter(Boolean).map(esc).join(' \u00b7 ');
  return '<article class="ui-child"' + attrs({ 'data-status': o.status, 'data-child-id': o.id, 'aria-label': o.goal + ', ' + word }) + '>' +
    '<header class="ui-child__head"><span class="ui-child__who">' + modelHTML(o.model) + '</span><span class="ui-child__acts">' +
    (o.canOpen ? iconButton({ icon: 'session', label: 'Open this task\u2019s session', size: 's', action: 'open' }) : '') +
    (o.canStop && live ? iconButton({ icon: 'stop', label: 'Stop this task', size: 's', action: 'stop' }) : '') + '</span></header>' +
    '<p class="ui-child__goal">' + esc(o.goal) + '</p>' +
    '<p class="ui-child__state">' + dot(STATUS_DOT[o.status] || undefined, { size: 's' }) + '<span class="ui-child__meta">' + meta + '</span></p>' +
    (live && o.now ? '<p class="ui-child__now">' + esc(o.now) + '</p>' : '') +
    (!live && o.summary ? '<p class="ui-child__summary">' + esc(o.summary) + '</p>' : '') + '</article>';
}

export const html = {
  icon, keys, kbd, combo, comboKbds, code, inline, stamp, dot, capacity, button, iconButton, send, hold, switch: switchHtml, segmented, chip, chipGroup,
  orb: orbHtml, model: modelHTML, modelRoute: routeHTML, modelMark: markHTML, stateWord, row, leadFor, group, ladder, measure, legend, pages, request, entry, disclosure, steps, blank, section, menuItems, field, select: selectHTML, setRow, setHead, setSection, empty, toast, tip, mod,
  scroll, tabs, search, tipBody, badge, input, child, signinButton, stack
};
