/* The pieces every card kind draws with: text helpers, the library's buttons, the head, the one-row mini and the origin
   slot (who is asking, FORMS.md section 4a). Pure string templates over the library; nothing here touches the DOM. */
import { esc } from '../../core/dom';
import { ui } from '../../components';
import { data } from '../../data';
import type { Origin } from '../../data';
import type { Ctx, Data } from './types';

const U = ui;
/** inline code in data strings: `money.ts` -> the library's code chip */
export const fmt = (s: string): string => U.html.inline(s);
export const code = (s: string): string => U.html.code(s);
export const mono = (s: string): string => '<span class="cd-mono">' + esc(s) + '</span>';
export const cap = (s: unknown): string => { const t = String(s == null ? '' : s); return t.charAt(0).toUpperCase() + t.slice(1); };
/** 'a · b · c' -> ['a', 'b', 'c']: the parts are set apart with space, never joined with dots */
export const parts = (s: unknown): string[] => (Array.isArray(s) ? s.map(String) : String(s == null ? '' : s).split(/\s+·\s+/)).map((x) => x.trim()).filter(Boolean);
const botList = () => data().bots.snapshot().bots;
export const bot = (id: string | undefined): ReturnType<typeof botList>[number] | undefined => (id ? botList().find((b) => b.id === id || b.name === id) : undefined);
export const check = (): string => U.icon('check', { class: 'cd-ico' });
/** a model wherever one appears: its provider's mark beside its name, mono, from the tokens */
export const model = (m: string, size = 14): string => U.html.model(m, { size, class: 'cd-mono', mono: false });
export const isRoute = (m: string): boolean => U.modelMark.parse(m).length > 1;

/* ───────── origin: who is asking, one slot for every card ─────────
   {kind: 'teammate', ids, via} | {kind: 'agent', model} | {kind: 'plugin' | 'hermes' | 'host'} | {kind: 'mcp', server, trust}.
   Older data ({from}, {bot}, {model}) is read as an origin. The slot draws: one teammate: its live orb, name and colour
   as the card's accent; several: stacked orbs (3, then +N) with every name on hover, focus and for screen readers; relayed:
   "nina, via atlas"; the agent: its model's provider mark and name; system sources: a quiet glyph and a label; an MCP
   server: its initial, name and trust. */
export type KnownOrigin =
  | { kind: 'teammate'; ids: readonly string[]; via: string | null }
  | { kind: 'agent'; model: string }
  | { kind: 'plugin' | 'hermes' | 'host' }
  | { kind: 'mcp'; server?: string | undefined; trust?: string | undefined };
const SYSTEM: Readonly<Record<string, readonly [icon: string, label: string]>> = { plugin: ['ladder', 'Governance'], hermes: ['spark', 'Hermes'], host: ['gear', 'hypotaxis'] };
const sys = (kind: string): readonly [string, string] => SYSTEM[kind] ?? ['', kind];

export function originOf(d: Data): KnownOrigin | null {
  const o = d.origin as Origin | undefined;
  if (o && o.kind) {
    if (o.kind === 'teammate') {
      const ids = (o.ids ?? (o.id ? [o.id] : [])).filter((x) => bot(x));
      return ids.length ? { kind: 'teammate', ids, via: o.via && bot(o.via) ? o.via : null } : null;
    }
    return o;
  }
  if (d.from && bot(d.from)) return { kind: 'teammate', ids: [d.from], via: d.via && bot(d.via) ? d.via : null };
  if (d.model) return { kind: 'agent', model: d.model };
  return null;
}
const nameOf = (id: string): string => bot(id)?.name ?? id;
export const namesText = (ids: readonly string[]): string => { const n = ids.map(nameOf); return n.length < 3 ? n.join(' and ') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };
const serverOf = (o: { server?: string | undefined }): string => o.server || 'An';
export function originText(o: KnownOrigin | null): string {
  if (!o) return '';
  if (o.kind === 'teammate') return namesText(o.ids) + (o.via ? ', via ' + nameOf(o.via) : '');
  if (o.kind === 'agent') return o.model;
  if (o.kind === 'mcp') return (o.server ? o.server + ' ' : '') + 'MCP server' + (o.trust ? ', ' + o.trust : '');
  return sys(o.kind)[1];
}
/** the visual alone: an orb, a stack, a glyph, a server's initial, or the agent's model mark (its provider's logo;
    a route draws its marks inline with the names instead) */
export function originVisual(o: KnownOrigin | null, size: number, max?: number): string {
  if (!o) return '';
  if (o.kind === 'teammate') {
    const one = bot(o.ids[0]);
    if (o.ids.length === 1 && one) return U.html.orb(one, { size });
    const lim = max || 3;
    const shown = o.ids.slice(0, Math.max(1, Math.min(lim, o.ids.length > lim ? lim - 1 : o.ids.length))), more = o.ids.length - shown.length;
    return '<span class="cd-stack" style="--s:' + size + 'px"' + (more ? ' tabindex="0"' : '') + ' data-tip="' + esc(namesText(o.ids)) + '" role="img" aria-label="' + esc(namesText(o.ids)) + '">' +
      shown.map((id) => { const b = bot(id); return '<span class="cd-stack__one">' + (b ? U.html.orb(b, { size }) : '') + '</span>'; }).join('') +
      (more ? '<span class="cd-stack__more" aria-hidden="true">+' + more + '</span>' : '') + '</span>';
  }
  if (o.kind === 'agent') return U.html.modelMark(U.modelMark.last(o.model), { size: 16, class: 'cd-glyph' });
  if (o.kind === 'mcp') return '<span class="cd-tile" style="--cd-orb:' + size + 'px" aria-hidden="true">' + esc(String(o.server || '?').slice(0, 1).toUpperCase()) + '</span>';
  const g = sys(o.kind)[0];
  return g ? U.icon(g, { class: 'cd-glyph' }) : '';
}
function originLabel(o: KnownOrigin): string {
  if (o.kind === 'teammate') {
    const names = o.ids.length > 3 ? o.ids.slice(0, 2).map((x) => esc(nameOf(x))).join(', ') + ' and ' + (o.ids.length - 2) + ' more' : esc(namesText(o.ids));
    return '<span class="cd-by__name">' + names + '</span>' + (o.via ? '<span class="cd-by__via">via ' + esc(nameOf(o.via)) + '</span>' : '');
  }
  if (o.kind === 'agent') return '<span class="cd-by__name cd-mono">' + (isRoute(o.model) ? U.html.modelRoute(o.model, { size: 14, mono: false }) : esc(o.model)) + '</span>';
  if (o.kind === 'mcp') return '<span class="cd-by__name">' + esc(o.server || 'MCP server') + '</span><span class="cd-by__via">' + (o.server ? 'MCP server' : '') + (o.trust ? (o.server ? ', ' : '') + esc(o.trust) : '') + '</span>';
  return '<span class="cd-by__name">' + esc(sys(o.kind)[1]) + '</span>';
}
const shape = (o: KnownOrigin): string => (o.kind === 'teammate' ? (o.ids.length > 1 ? 'joint' : o.via ? 'relay' : 'teammate') : o.kind);
/** the byline above a card's title; hidden names (+N) are read out with the label */
export const byline = (c: Pick<Ctx, 'origin' | 'size'>): string => {
  const o = c.origin;
  if (!o) return '';
  return '<div class="cd-by" data-origin="' + shape(o) + '">' +
    (o.kind === 'agent' && isRoute(o.model) ? '' : originVisual(o, c.size === 'compact' || c.size === 'popover' ? 18 : 20)) + '<span class="cd-by__label">' + originLabel(o) + '</span>' +
    (o.kind === 'teammate' && o.ids.length > 3 ? '<span class="ui-sr">: ' + esc(namesText(o.ids)) + '</span>' : '') + '</div>';
};
/** one teammate lends its colour to the card as a restrained accent (a ring and a 5% tint); a nearly black orb is mixed
    toward the ink so the ring still shows on dark grounds */
export function accentOf(o: KnownOrigin | null): string {
  if (!o || o.kind !== 'teammate' || o.ids.length !== 1) return '';
  const col = String(bot(o.ids[0])?.color ?? '');
  const m = /^#?([0-9a-f]{6})$/i.exec(col);
  if (!m) return col;
  const n = parseInt(m[1] ?? '0', 16), lin = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L < 0.06 ? 'color-mix(in srgb, ' + col + ' 45%, var(--text))' : col;
}

/* ───────── text and structure ───────── */
/** titles are the request itself; who asks is the byline (screen readers hear both: "nina: Deploy to staging") */
export const sentenceHTML = (d: Data): string => fmt(cap(d.title));
export const sentenceText = (d: Data): string => { const w = originText(originOf(d)); return (w ? w + ': ' : '') + cap(d.title); };
/** the head: the byline, the title, and in its corner the stamp of what you owe (filled in by applyState) */
export const headrow = (c: Ctx, html: string): string => '<div class="cd-headrow"><div class="cd-headmain">' + byline(c) + '<p class="cd-lead" id="' + c.id + '-t">' + html + '</p></div><span class="ui-stamp" data-stamp></span></div>';
export const quote = (q?: string): string => (q ? '<p class="cd-quote">“' + fmt(q) + '”</p>' : '');
export const breath = (): string => U.html.dot('run');
export function well(lines?: readonly string[]): string {
  const ls = (lines ?? []).filter(Boolean);
  if (!ls.length) return '';
  return '<div class="cd-well">' + ls.map((l, i) => {
    const p = parts(l);
    return '<div class="cd-well__line' + (i === 0 ? ' cd-well__line--first' : '') + '">' + p.map((x, j) => '<span' + (i === 0 && j === 0 ? ' class="cd-well__strong"' : '') + '>' + fmt(x) + '</span>').join('') + '</div>';
  }).join('') + '</div>';
}
/** the library's buttons: variant 'primary' | 'ghost' | (secondary), o: {size: 's', disabled, keys, attrs} */
export const btn = (action: string, label: string, variant?: 'primary' | 'ghost' | null, o?: { size?: 's'; disabled?: boolean; keys?: string; attrs?: Record<string, string> }): string =>
  U.html.button({ label, action, ...(variant ? { variant } : {}), ...(o ?? {}) });
export const actions = (html: string): string => '<div class="cd-actions">' + html + '</div>';
export const at = (word: string, c: Ctx): string => esc(word) + ' at ' + mono(c.at);
export const receipt = (html: string, icon?: boolean): string => '<p class="cd-receipt">' + (icon ? check() : '') + '<span>' + html + '</span></p>';
export const foot = (left?: string, right?: string): string => '<div class="cd-foot">' + (left ?? '') + (right ?? '') + '</div>';
export const meta = (items: Array<string | false | undefined>): string => { const it = items.filter(Boolean); return it.length ? '<div class="cd-meta">' + it.join('') + '</div>' : ''; };
/** a queue's position: the library's still page dots */
export function qdots(q: Ctx['q']): string {
  if (!q || q.total < 2) return '';
  const pages = [];
  for (let i = 0; i < q.total; i++) pages.push({ id: String(i) });
  return U.html.pages({ pages, current: String(q.index), label: 'Request ' + (q.index + 1) + ' of ' + q.total });
}
const shortWho = (x: KnownOrigin): string => (x.kind === 'teammate' ? (x.ids.length > 2 ? nameOf(x.ids[0] ?? '') + ' +' + (x.ids.length - 1) : namesText(x.ids)) : x.kind === 'mcp' ? (x.server || 'MCP server') : originText(x));
/** one row, in aligned columns: a fixed lead mark (who: the origin's visual), the text (who, then what), a fixed status
    column (the attention dot when it owes something, then a short meta) */
export function mini(ctx: Ctx, o: { lead?: string; who?: boolean; text: string; meta?: string }): string {
  const owe = ctx.owe, or = ctx.origin;
  const lead = o.lead != null ? o.lead : originVisual(or, 16, 2);
  const who = or && o.who !== false ? '<span class="cd-mini__who">' + (or.kind === 'agent' ? mono(or.model) : esc(shortWho(or))) + '</span> ' : '';
  return '<button type="button" class="cd-mini" data-action="open" aria-labelledby="' + ctx.id + '-t' + (owe ? ' ' + ctx.id + '-o' : '') + (o.meta ? ' ' + ctx.id + '-m' : '') + '">' +
    '<span class="cd-mini__lead" aria-hidden="true">' + lead + '</span>' +
    '<span class="cd-mini__text" id="' + ctx.id + '-t">' + who + o.text + '</span>' +
    '<span class="cd-mini__status"><span class="cd-mini__dot">' + (owe ? U.html.dot('attention') : '') + '</span>' +
    (owe ? '<span class="ui-sr" id="' + ctx.id + '-o">, ' + esc(owe) + '</span>' : '') +
    '<span class="cd-mini__meta"' + (o.meta ? ' id="' + ctx.id + '-m"' : '') + '>' + (o.meta ?? '') + '</span></span></button>';
}
export const tones = (m: Record<string, string>) => (c: { s: string }): string | undefined => m[c.s];
export { serverOf };

/** 'expires in 9 min' stays live */
export function expiryText(left: number, short: boolean): string {
  if (left <= 0) return short ? 'now' : 'Expires now';
  const s = Math.ceil(left / 1000);
  const v = s >= 90 ? Math.ceil(s / 60) + ' min' : s + ' s';
  return short ? v : 'Expires in ' + v;
}
