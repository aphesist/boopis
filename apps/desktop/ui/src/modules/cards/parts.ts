/* What the form card and its neighbours read from a card's data: text helpers, the asker (its origin), the countdown, and the
   config diff a bot's settings show. Pure functions over the data; nothing here draws a card (the kit's AskCard does, form.ts). */
import { esc } from '../../core/dom';
import { modelMark } from '@boopis/ui';
import { data } from '../../data';
import type { Origin } from '../../data';
import type { Data } from './types';

/* the brand stays lowercase at the start of a sentence too (design system section 2) */
export const cap = (s: unknown): string => { const t = String(s == null ? '' : s); return /^boopis\b/.test(t) ? t : t.charAt(0).toUpperCase() + t.slice(1); };
/** 'a · b · c' -> ['a', 'b', 'c']: the parts are set apart with space, never joined with dots */
export const parts = (s: unknown): string[] => (Array.isArray(s) ? s.map(String) : String(s == null ? '' : s).split(/\s+·\s+/)).map((x) => x.trim()).filter(Boolean);
const botList = () => data().bots.snapshot().bots;
export const bot = (id: string | undefined): ReturnType<typeof botList>[number] | undefined => (id ? botList().find((b) => b.id === id || b.name === id) : undefined);
/** a route ('qwen3-coder → sonnet 5.5') asks as the model it ended on: one mark, one name (the route itself is the session's call number) */
const asker = (m: string | undefined): string => modelMark.last(m) || String(m || '');

/* ───────── origin: who is asking ─────────
   {kind: 'teammate', ids, via} | {kind: 'agent', model} | {kind: 'plugin' | 'hermes' | 'host'} | {kind: 'mcp', server, trust} | {kind: 'mod', plugin}.
   Older data ({from}, {bot}, {model}) is read as an origin. The form's AskCard draws it (form.ts `askerLead`, `askerWords`). */
export type KnownOrigin =
  | { kind: 'teammate'; ids: readonly string[]; via: string | null }
  | { kind: 'agent'; model: string; route?: string | undefined }
  | { kind: 'plugin' | 'hermes' | 'host' }
  | { kind: 'mcp'; server?: string | undefined; trust?: string | undefined }
  /** a Claude Code mod: its puzzle glyph and "name mod" (DESIGN-SYSTEM.md 14.29) */
  | { kind: 'mod'; plugin: string };

export function originOf(d: Data): KnownOrigin | null {
  const o = d.origin as Origin | undefined;
  if (o && o.kind) {
    if (o.kind === 'teammate') {
      const ids = (o.ids ?? (o.id ? [o.id] : [])).filter((x) => bot(x));
      return ids.length ? { kind: 'teammate', ids, via: o.via && bot(o.via) ? o.via : null } : null;
    }
    return o.kind === 'agent' ? { ...o, model: asker(o.model), route: o.model } : o;
  }
  if (d.from && bot(d.from)) return { kind: 'teammate', ids: [d.from], via: d.via && bot(d.via) ? d.via : null };
  if (d.model) return { kind: 'agent', model: asker(d.model), route: d.model };
  return null;
}
const nameOf = (id: string): string => bot(id)?.name ?? id;
export const namesText = (ids: readonly string[]): string => { const n = ids.map(nameOf); return n.length < 3 ? n.join(' and ') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };
/** a change as lines ('+ added', '- removed', '  kept') in the config diff's well: each line says added or removed to a screen reader */
export function diffWell(diff: string, file?: string): string {
  return '<div class="cd-well cd-diff" role="group" aria-label="' + esc('Changes to ' + (file || 'the config')) + '">' + (file ? '<div class="cd-diff__file">' + esc(file) + '</div>' : '') +
    diff.split('\n').map((l) => '<div class="cd-diff__l"' + (/^\+/.test(l) ? ' data-d="add"' : /^-/.test(l) ? ' data-d="del"' : '') + '><span aria-hidden="true">' + esc(l.charAt(0) === '+' || l.charAt(0) === '-' ? l.charAt(0) : ' ') + '</span>' +
      '<span class="ui-sr">' + (/^\+/.test(l) ? 'added: ' : /^-/.test(l) ? 'removed: ' : '') + '</span>' + esc(l.replace(/^[+\- ]/, '')) + '</div>').join('') + '</div>';
}
/** 'expires in 9 min' stays live */
export function expiryText(left: number, short: boolean): string {
  if (left <= 0) return short ? 'now' : 'Expires now';
  const s = Math.ceil(left / 1000);
  const v = s >= 90 ? Math.ceil(s / 60) + ' min' : s + ' s';
  return short ? v : 'Expires in ' + v;
}
