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
  /** a stack: the token of the surface it sits on (the orbs' eyes are cut to it), how many places it has ("+N" the last), and members it cannot draw */ surface?: U<string>; max?: U<number>; extra?: U<number>;
}
export function avatar(o: AvatarOpts): string {
  const v = o.variant ?? 'orb';
  const a = (extra: Attrs = {}): string => kitAttrs('Avatar', { 'data-variant': v, ...extra, ...(o.attrs ?? {}) });
  if (v === 'brand') return '<span class="k7-avatar k7-brand"' + a({ role: o.label ? 'img' : null, 'aria-label': o.label, 'aria-hidden': o.label ? null : 'true' }) + '>' + markHTML(o.model ?? null, { size: 14, label: false }) + '</span>';
  if (v === 'logomark') return '<span class="k7-avatar k7-logomark"' + a() + '><boopis-logo mark' + attrs({ label: o.label ?? 'boopis', state: o.state === 'sleeping' ? 'sleeping' : null }) + '></boopis-logo></span>';
  if (v === 'stack') return '<span class="k7-avatar"' + a() + '>' + kitStack(o.members ?? [], o.size ?? 24, { ...(o.label ? { label: o.label } : {}), ...(o.rest ? { rest: true } : {}), ...(o.surface ? { surface: o.surface } : {}), max: o.max ?? 4, ...(o.extra ? { extra: o.extra } : {}) }) + '</span>';
  const size = o.size ?? 36;
  const orb = orbHtml(o.bot ?? { id: 'boopis', name: 'boopis' }, { size, state: o.state, still: o.still, live: o.live, flag: o.flag, rest: o.rest });
  return '<span class="k7-avatar"' + a({ 'data-size': size }) + '>' + (o.ink ? inkOrb(orb) : orb) + '</span>';
}

/** members as the boards stack them (kit.js `stack`): each at rest, two thirds of an orb apart in whole pixels, the first underneath;
    `surface` is the token of what they sit on (their eyes are cut to it), `rest` the rest pose of a rest surface (the sidebar's rows) */
export function kitStack(members: readonly BotLike[], size: number, o: { surface?: string; rest?: boolean; label?: string; max?: number; extra?: number } = {}): string {
  return stack({ members: members.map((m) => ({ ...m, state: 'idle', attention: null })), size, still: !o.rest, tip: false, step: Math.round((size * 2) / 3), orb: { mode: 'fixed', ...(o.rest ? { rest: true } : {}), ...(o.surface ? { surface: o.surface } : {}) }, ...(o.label ? { label: o.label } : {}), ...(o.max ? { max: o.max } : {}), ...(o.extra ? { extra: o.extra } : {}) });
}
/** a bot's colour as text in each theme (theme.ts botText), for the CSS to pick */
export const botColours = (hex: string): string => '--bot-dark:' + botText(hex, 'dark') + ';--bot-light:' + botText(hex, 'light');

/** the boopis bot (section 10): the squircle in --text-strong, light ink on dark, dark on light, light on the dock; its eyes the ground */
export const inkOrb = (orb: string): string => orb.replace(/ color="[^"]*"/, ' color="var(--text-strong)" data-ink').replace(/ shape="[^"]*"/, ' shape="squircle"');   /* its eyes stay cut to its surface, as every orb's (orb.ts `surface`) */

/* ── InlineChip (30): mention, you, reference, code, cite, model, countdown ── */
export const INLINE_KINDS = ['mention', 'you', 'reference', 'code', 'cite', 'model', 'countdown'] as const;
export type InlineKind = typeof INLINE_KINDS[number];
export interface InlineChipOpts {
  kind: InlineKind; text?: U<string>; bot?: U<BotLike>; colour?: U<string>; model?: U<ModelRef>; attrs?: U<Attrs>;
  /** a mention of the whole room (`@all`): its members' orbs lead, stacked */ members?: U<readonly BotLike[]>;
  /** a mention of a bot that is not here: muted, and it opens nothing */ out?: U<boolean>;
  /** the chip is a control (a message's mention opens the bot; a reference its file): a button, named by `label` */ action?: U<boolean>; label?: U<string>;
  /** a chip set into a composer's text: one unit (not editable inside), its text exactly `words` (what is sent), its name drawn */ words?: U<string>;
  /** a source: where its words lead */ href?: U<string>;
}
/** a bot as a still mark shows it: its look, at rest whatever it is doing (the boards' small orbs keep the plain face) */
const atRest = <T extends BotLike>(b: T): T => ({ ...b, state: 'idle', attention: null });
export function inlineChip(o: InlineChipOpts): string {
  const a = (extra: Attrs = {}): string => kitAttrs('InlineChip', { 'data-kind': o.kind, ...(o.words != null ? { contenteditable: 'false', 'data-words': o.words } : {}), ...extra, ...(o.attrs ?? {}) });
  /* in a composer the chip's own text is the words as typed (read out, selected and sent); what shows is drawn from data-name */
  const said = (shown: string): string => (o.words != null ? '<span class="k7-sr">' + esc(o.words) + '</span><span aria-hidden="true"' + attrs({ 'data-name': shown }) + '></span>' : esc(shown));
  switch (o.kind) {
    case 'mention': {
      /* a bot's name in the bot's colour (Grok 9.3: the room's named uses join the card ring); its colour is data (R-colour-8) */
      const name = o.bot?.name ?? o.text ?? '', tag = o.action && o.words == null ? 'button' : 'span';
      const lead = o.members?.length ? kitStack(o.members, 16, { surface: '--bg-3' }) : o.bot ? orbHtml(atRest(o.bot), { size: 16, still: true, mode: 'fixed', surface: '--bg-3' }) : '';
      const shown = o.words != null ? '<span class="k7-sr">' + esc(o.words) + '</span><span class="k7-mention__name" aria-hidden="true"' + attrs({ 'data-name': o.members?.length ? (o.text ?? name) : name }) + '></span>' : '<span class="k7-mention__name">' + esc(o.members?.length ? (o.text ?? name) : name) + '</span>';
      return '<' + tag + ' class="' + cls(tag === 'button' && 'k7-reset', 'k7-chip-in k7-mention') + '"' + a({ type: tag === 'button' ? 'button' : null, 'aria-label': o.label, 'data-out': o.out ? '' : null, 'data-all': o.members?.length ? '' : null, 'data-bot-colour': o.colour && !o.out ? '' : null, style: o.colour && !o.out ? botColours(o.colour) : null }) + '>' + lead + shown + '</' + tag + '>';
    }
    case 'you': return '<span class="k7-chip-in k7-cap k7-you"' + a() + '>' + glyph('user', 'k7-you__ic') + said(o.text ?? 'you') + '</span>';
    case 'reference': {
      const tag = o.action && o.words == null ? 'button' : 'span';
      return '<' + tag + ' class="' + cls(tag === 'button' && 'k7-reset', 'k7-chip-in k7-cap k7-ref') + '"' + a({ type: tag === 'button' ? 'button' : null, 'aria-label': o.label }) + '>' + said(o.text ?? '') + '</' + tag + '>';
    }
    case 'cite': return '<a class="k7-chip-in k7-cite"' + a({ href: o.href, target: o.href ? '_blank' : null, rel: o.href ? 'noopener noreferrer' : null }) + '><i class="k7-cite__ic" aria-hidden="true"></i>' + esc(o.text ?? '') + '</a>';
    case 'code': return '<code class="k7-chip-in k7-code"' + a() + '>' + esc(o.text ?? '') + '</code>';
    case 'model': return '<span class="k7-chip-in k7-model"' + a() + '>' + markHTML(o.model ?? null, { size: 14, label: false }) + said(o.text ?? (typeof o.model === 'string' ? o.model : '')) + '</span>';   /* in a composer its own text is the words typed ("@Claude Sonnet"), as every chip's */
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

/* ── MarkStack (6e, derived from 6d's askers): several models as their marks overlapped a third, at most three, then the rail's "+N"
   chip clear of them (owner, 25 November); its name says them all ── */
export function markStack(models: readonly ModelRef[], size = 12, label?: string): string {
  const shown = models.slice(0, 3), more = models.length - shown.length;
  return '<span class="k7-marks"' + kitAttrs('MarkStack', { role: 'img', 'aria-label': label ?? null, style: '--s:' + size + 'px' }) + '>' + shown.map((m) => '<span class="k7-marks__one">' + markHTML(m, { size, label: false }) + '</span>').join('') +
    (more ? '<span class="k7-ask__more" aria-hidden="true" data-more="+' + more + '"></span>' : '') + '</span>';
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
    ? (o.members && o.members.length > 1 ? kitStack(o.members, 16) : o.bot ? orbHtml(o.bot, { size: 16, live: working, mode: 'fixed', ...(working ? { state: 'working' } : {}) })   /* at rest it keeps the bot's own face (board 11: "Waiting for you" with the needs-you face) */ : '')
    : kind === 'session' ? '<span class="k7-status__mark"' + attrs({ 'data-pulse': working ? '' : null, 'data-live': working ? '' : null }) + '>' + markHTML(o.model ?? null, { size: 16, label: false }) + '</span>' : '';
  return '<div class="k7-status"' + kitAttrs('StatusLine', { 'data-kind': kind, 'data-working': working ? '' : null, role: o.inPill ? null : 'status', 'aria-live': o.inPill ? null : 'polite', ...(o.attrs ?? {}) }) + '>' + lead +
    '<span class="' + cls('k7-status__phrase', working && 'k7-shimmer') + '"' + attrs({ 'data-live': working ? '' : null }) + '>' + esc(o.phrase) + '</span>' +
    (o.count ? '<span class="k7-status__count k7-mono">' + esc(o.count) + '</span>' : '') + '</div>';
}
