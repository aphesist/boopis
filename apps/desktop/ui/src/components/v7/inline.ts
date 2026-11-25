/* The v7 kit's inline and status pieces (DESIGN-SYSTEM.md v7 21.2, rows 30 to 35): InlineChip, Mark, StatusWord, Badge,
   StatusLine, Avatar. R-inline-1: a chip in running text is inline-level, sits on the line's baseline and never makes the
   line taller. */
import type { BotLike } from '../bot-state';
import { markHTML } from '../model-mark';
import type { ModelRef } from '../model-mark';
import { orbHtml } from '../orb';
import { stack } from '../stack';
import { botText } from './theme';
import { attrs, cls, esc, glyph, kitAttrs, partAttrs } from './util';
import type { Attrs, U } from './util';

/* ── Avatar (35): orb (16 to 64), brand tile (22, the model's mark), stack (overlap a third), logomark (S41 A) ── */
export const AVATAR_VARIANTS = ['orb', 'brand', 'stack', 'logomark'] as const;
export type AvatarVariant = typeof AVATAR_VARIANTS[number];
export const ORB_SIZES = [16, 20, 24, 28, 36, 40, 64, 96] as const;
export interface AvatarOpts {
  variant?: U<AvatarVariant>; bot?: U<BotLike>; size?: U<number>; state?: U<string>; still?: U<boolean>; live?: U<boolean>; flag?: U<boolean>;
  members?: U<readonly BotLike[]>; model?: U<ModelRef>; label?: U<string>;
  /** on a rest surface (the dock, the Bots sidebar, the rail): idle is the still rest pose (ORBS.md section 23) */ rest?: U<boolean>;
  /** the boopis bot: drawn in the theme's ink, its eyes the ground (section 10) */ ink?: U<boolean>; attrs?: U<Attrs>;
}
export function avatar(o: AvatarOpts): string {
  const v = o.variant ?? 'orb';
  const a = (extra: Attrs = {}): string => kitAttrs('Avatar', { 'data-variant': v, ...extra, ...(o.attrs ?? {}) });
  if (v === 'brand') return '<span class="k7-avatar k7-brand"' + a({ role: o.label ? 'img' : null, 'aria-label': o.label, 'aria-hidden': o.label ? null : 'true' }) + '>' + markHTML(o.model ?? null, { size: 14, label: false }) + '</span>';
  if (v === 'logomark') return '<span class="k7-avatar k7-logomark"' + a() + '><boopis-logo mark' + attrs({ label: o.label ?? 'boopis', state: o.state === 'sleeping' ? 'sleeping' : null }) + '></boopis-logo></span>';
  if (v === 'stack') return '<span class="k7-avatar"' + a() + '>' + stack({ members: o.members ?? [], size: o.size ?? 24, still: true, ...(o.label ? { label: o.label } : {}) }) + '</span>';
  const size = o.size ?? 36;
  const orb = orbHtml(o.bot ?? { id: 'boopis', name: 'boopis' }, { size, state: o.state, still: o.still, live: o.live, flag: o.flag, rest: o.rest });
  return '<span class="k7-avatar"' + a({ 'data-size': size }) + '>' + (o.ink ? inkOrb(orb) : orb) + '</span>';
}

/** a bot's colour as text in each theme (theme.ts botText), for the CSS to pick */
export const botColours = (hex: string): string => '--bot-dark:' + botText(hex, 'dark') + ';--bot-light:' + botText(hex, 'light');

/** the boopis bot (section 10): the squircle in --text-strong, light ink on dark, dark on light, light on the dock; its eyes the ground */
export const inkOrb = (orb: string): string => orb.replace(/ color="[^"]*"/, ' color="var(--text-strong)" data-ink').replace(/ shape="[^"]*"/, ' shape="squircle"');   /* its eyes stay cut to its surface, as every orb's (orb.ts `surface`) */

/* ── InlineChip (30): mention, you, reference, code, model, countdown ── */
export const INLINE_KINDS = ['mention', 'you', 'reference', 'code', 'model', 'countdown'] as const;
export type InlineKind = typeof INLINE_KINDS[number];
export interface InlineChipOpts { kind: InlineKind; text?: U<string>; bot?: U<BotLike & { color?: string }>; colour?: U<string>; model?: U<ModelRef>; attrs?: U<Attrs> }
export function inlineChip(o: InlineChipOpts): string {
  const a = (extra: Attrs = {}): string => kitAttrs('InlineChip', { 'data-kind': o.kind, ...extra, ...(o.attrs ?? {}) });
  switch (o.kind) {
    case 'mention': {
      /* a bot's name in the bot's colour (Grok 9.3: the room's named uses join the card ring); its colour is data (R-colour-8) */
      const name = o.bot?.name ?? o.text ?? '';
      return '<span class="k7-chip-in k7-mention"' + a({ 'data-bot-colour': o.colour ? '' : null, style: o.colour ? botColours(o.colour) : null }) + '>' +
        (o.bot ? orbHtml(o.bot, { size: 16, still: true }) : '') + '<span class="k7-mention__name">' + esc(name) + '</span></span>';
    }
    case 'you': return '<span class="k7-chip-in k7-cap k7-you"' + a() + '>' + glyph('user', 'k7-you__ic') + esc(o.text ?? 'you') + '</span>';
    case 'reference': return '<span class="k7-chip-in k7-cap k7-ref"' + a() + '>' + esc(o.text ?? '') + '</span>';
    case 'code': return '<code class="k7-chip-in k7-code"' + a() + '>' + esc(o.text ?? '') + '</code>';
    case 'model': return '<span class="k7-chip-in k7-model"' + a() + '>' + markHTML(o.model ?? null, { size: 14, label: false }) + esc(o.text ?? (typeof o.model === 'string' ? o.model : '')) + '</span>';
    case 'countdown': return '<span class="k7-chip-in k7-cap k7-count"' + partAttrs('Countdown', { 'data-kit': 'InlineChip', 'data-kind': 'countdown', role: 'timer', 'aria-live': 'off', ...(o.attrs ?? {}) }) + '>' + esc(o.text ?? '') + '</span>';
  }
}

/* ── Mark (31): feedforward, blank (opened, filled, waiting, lapsed), info label (17.1) ── */
export const MARK_STATES = ['shown', 'hover', 'open', 'chosen', 'waiting', 'guess'] as const;
export type MarkState = typeof MARK_STATES[number];
export const MARK_KINDS = ['feedforward', 'blank', 'info'] as const;
export type MarkKind = typeof MARK_KINDS[number];
export interface MarkOpts {
  text: string; kind?: U<MarkKind>; state?: U<MarkState>; isNew?: U<boolean>;
  /** a blank: waiting (the dashed gap of at least 7 characters with the countdown and "waiting for you"), filled (the person's words, solid
      accent), lapsed (the bot's guess with "(my guess)") */
  blank?: U<'waiting' | 'opened' | 'filled' | 'lapsed'>; countdown?: U<string>;
  /** an info label's explanation, opened in a popover */ explain?: U<string>; attrs?: U<Attrs>;
}
export function mark(o: MarkOpts): string {
  const kind = o.kind ?? 'feedforward';
  if (kind === 'info') {
    return '<button class="k7-reset k7-mark k7-info"' + kitAttrs('Mark', { type: 'button', 'data-mark-kind': 'info', 'data-mark': o.state, 'data-explain': o.explain, 'aria-haspopup': 'dialog', ...(o.attrs ?? {}) }) + '>' + esc(o.text) +
      '<span class="k7-mark__i" aria-hidden="true">' + glyph('info') + '</span></button>';
  }
  if (kind === 'blank') {
    const b = o.blank ?? 'waiting';
    if (b === 'filled') return '<span class="k7-mark"' + kitAttrs('Mark', { 'data-mark-kind': 'blank', 'data-mark': 'chosen', 'data-blank': b, ...(o.attrs ?? {}) }) + '>' + esc(o.text) + '</span>';
    if (b === 'lapsed') return '<span class="k7-blank"><span class="k7-mark k7-guess"' + kitAttrs('Mark', { 'data-mark-kind': 'blank', 'data-mark': 'guess', 'data-blank': b, ...(o.attrs ?? {}) }) + '>' + esc(o.text) + '</span> <span class="k7-blank__word">(my guess)</span></span>';
    const waiting = b === 'waiting';
    return '<span class="k7-blank"' + attrs({ 'data-blank': b }) + '><span class="k7-mark k7-gap" tabindex="0" role="textbox"' + kitAttrs('Mark', { 'data-mark-kind': 'blank', 'data-mark': waiting ? 'waiting' : 'open', 'aria-label': o.text, ...(o.attrs ?? {}) }) + '>' +
      '\u200b' + (waiting && o.countdown ? inlineChip({ kind: 'countdown', text: o.countdown }) : '') + '</span>' + (waiting ? '<span class="k7-blank__word" data-tone="owe">waiting for you</span>' : '') + '</span>';
  }
  return '<span class="k7-mark"' + kitAttrs('Mark', { 'data-mark-kind': 'feedforward', 'data-mark': o.state, 'data-mark-new': o.isNew ? '' : null, tabindex: '0', role: 'button', 'aria-haspopup': 'menu', ...(o.attrs ?? {}) }) + '>' + esc(o.text) + '</span>';
}

/* ── StatusWord (32): neutral, amber (needs you), red (failed), ok; with a dot, with a pulse ── */
export const STATUS_TONES = ['neutral', 'owe', 'red', 'ok'] as const;
export type StatusTone = typeof STATUS_TONES[number];
export interface StatusWordOpts { text: string; tone?: U<StatusTone>; dot?: U<boolean>; pulse?: U<boolean>; attrs?: U<Attrs> }
export function statusWord(o: StatusWordOpts): string {
  return '<span class="k7-word"' + kitAttrs('StatusWord', { 'data-tone': o.tone ?? 'neutral', ...(o.attrs ?? {}) }) + '>' +
    (o.dot || o.pulse ? '<span class="k7-dot"' + attrs({ 'data-pulse': o.pulse ? '' : null, 'data-live': o.pulse ? '' : null, 'aria-hidden': 'true' }) + '></span>' : '') + esc(o.text) + '</span>';
}

/* ── Badge (33): a count or a short status at the end of a row; neutral, amber ── */
export interface BadgeOpts { text: string; tone?: U<'neutral' | 'owe'>; label?: U<string>; attrs?: U<Attrs> }
export function badge(o: BadgeOpts): string {
  return '<span class="k7-cap k7-badge"' + kitAttrs('Badge', { 'data-tone': o.tone ?? 'neutral', 'aria-label': o.label, ...(o.attrs ?? {}) }) + '>' + esc(o.text) + '</span>';
}

/* ── StatusLine (34): bot (its live 16 px orb), session (the answering model's mark, breathing), system (the phrase alone) ── */
export const STATUS_LINE_KINDS = ['bot', 'session', 'system'] as const;
export type StatusLineKind = typeof STATUS_LINE_KINDS[number];
export interface StatusLineOpts {
  kind?: U<StatusLineKind>; phrase: string; working?: U<boolean>; bot?: U<BotLike>; members?: U<readonly BotLike[]>; model?: U<ModelRef>; count?: U<string>;
  /** inside the title pill: no live region of its own (the pill names it) */ inPill?: U<boolean>; attrs?: U<Attrs>;
}
export function statusLine(o: StatusLineOpts): string {
  const kind = o.kind ?? 'bot', working = o.working !== false;
  const lead = kind === 'bot'
    ? (o.members && o.members.length > 1 ? stack({ members: o.members, size: 16, still: true, tip: false }) : o.bot ? orbHtml(o.bot, { size: 16, live: working, mode: 'fixed', ...(working ? { state: 'working' } : {}) })   /* at rest it keeps the bot's own face (board 11: "Waiting for you" with the needs-you face) */ : '')
    : kind === 'session' ? '<span class="k7-status__mark"' + attrs({ 'data-pulse': working ? '' : null, 'data-live': working ? '' : null }) + '>' + markHTML(o.model ?? null, { size: 16, label: false }) + '</span>' : '';
  return '<div class="k7-status"' + kitAttrs('StatusLine', { 'data-kind': kind, 'data-working': working ? '' : null, role: o.inPill ? null : 'status', 'aria-live': o.inPill ? null : 'polite', ...(o.attrs ?? {}) }) + '>' + lead +
    '<span class="' + cls('k7-status__phrase', working && 'k7-shimmer') + '"' + attrs({ 'data-live': working ? '' : null }) + '>' + esc(o.phrase) + '</span>' +
    (o.count ? '<span class="k7-status__count k7-mono">' + esc(o.count) + '</span>' : '') + '</div>';
}
