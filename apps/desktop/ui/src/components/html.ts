/* String templates: `html.<name>(opts)` for modules that build innerHTML (cards, dock). The element factories in
   index.ts wrap these and wire the behaviours, so there is one markup for every primitive. Class names and DOM output
   are the v6 library's, so components.css ports 1:1. No colour, family or size lives here. */
import { attrs, cx, esc, nid } from '../core/dom';
import type { Attrs } from '../core/dom';
import { ariaKeys } from '../core/keys';
import { combo, comboKbds, kbd, keys } from './kbd';
import { icon } from './icons';
import { logoHTML } from './logo';
import { signinButton } from './signin-button';
import { arrowHTML, isKnownModel, markHTML, modelHTML, routeHTML } from './model-mark';
import type { ModelRef } from './model-mark';
import { orbHtml } from './orb';
import { stack } from './stack';
import { scroll } from './scroll';

type U<T> = T | undefined;

const code = (text: string): string => '<code class="ui-code">' + esc(text) + '</code>';
/** inline `code` in a data string -> chips; everything else escaped */
const inline = (text: string): string => esc(text).replace(/`([^`]+)`/g, '<code class="ui-code">$1</code>');
const dot = (kind?: string, o: { size?: string; label?: string; show?: boolean } = {}): string =>
  '<span class="' + cx('ui-dot', kind && 'ui-dot--' + kind, o.size === 's' && 'ui-dot--s') + '"' + (o.label ? ' role="img" aria-label="' + esc(o.label) + '"' : ' aria-hidden="true"') + (o.show ? ' data-show' : '') + '></span>';

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
export interface MenuItem {
  label?: string; /** a model: a brand mark leads the label (a menu of models is the picker) */ model?: ModelRef; modelColor?: 'mono' | 'brand'; value?: string | number; desc?: string; icon?: string; keys?: string; checked?: boolean; mono?: boolean; disabled?: boolean; stamp?: string;
  role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox'; lead?: string; content?: boolean; title?: string; foot?: string;
}
export type MenuEntry = MenuItem | '-';
export const itemValue = (x: MenuItem): string => String(x.value != null ? x.value : x.label);
export interface BadgeOpts {
  label: string;
  /** the sentence behind the short words: its tooltip (and, with `describedBy`, its accessible description) */
  tip?: U<string>; tipPos?: U<string>;
  /** reachable by keyboard, so the tooltip shows on focus (outside a control; inside a row the row carries the sentence) */
  focusable?: U<boolean>; describedBy?: U<string>;
  class?: U<string>; attrs?: U<Attrs>;
}
const badge = (o: BadgeOpts): string => '<span class="' + cx('ui-badge', o.class) + '"' +
  attrs({ role: o.focusable ? 'note' : null, tabindex: o.focusable ? '0' : null, 'data-tip': o.tip, 'data-tip-pos': o.tipPos, 'aria-describedby': o.describedBy, ...o.attrs }) + '>' + esc(o.label) + '</span>';
const empty = (o: { title: string; text?: U<string>; mark?: U<boolean>; action?: U<string> }): string =>
  '<div class="ui-empty">' + (o.mark ? '<span class="ui-empty__mark">' + logoHTML({ mark: true, label: false }) + '</span>' : '') + '<h2 class="ui-empty__title">' + esc(o.title) + '</h2>' + (o.text ? '<p class="ui-empty__text">' + esc(o.text) + '</p>' : '') + (o.action ?? '') + '</div>';

/** the mod as a name: its glyph and its name, one unit (origin slots, tabs, band rows, notices, placed rows) */
const mod = (name: string, o?: { class?: string }): string => '<span class="mv-by' + (o?.class ? ' ' + o.class : '') + '">' + icon('mod', { class: 'mv-by__g' }) + '<span class="mv-by__n">' + esc(name) + '</span></span>';

/** a tooltip's content: the label, an optional state, the keys (concentric with the tooltip, on its raised colour); tooltip.ts shows it */
export const tipBody = (label: string, k?: string | null, state?: { text: string; tone?: string | null } | null): string =>
  '<span>' + esc(label) + '</span>' + (state ? '<span class="ui-tip__state"' + attrs({ 'data-tone': state.tone }) + '>' + esc(state.text) + '</span>' : '') + (k ? keys(k, { fit: true, raised: true }) : '');
const tip = (label: string, k?: string, state?: { text: string; tone?: string }): string => '<div class="ui-tip" data-static>' + tipBody(label, k, state) + '</div>';


export const html = {
  icon, keys, kbd, combo, comboKbds, code, inline, dot, button, iconButton, hold, orb: orbHtml, model: modelHTML, modelRoute: routeHTML, modelMark: markHTML, measure, legend, request, entry, disclosure, empty, tip, mod, scroll, tipBody, badge, signinButton, stack
};
