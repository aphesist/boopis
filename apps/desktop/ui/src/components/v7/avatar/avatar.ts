/* Avatar: its view (typed props to markup) and its contract. Its look is avatar.css, its stories and tests stand beside it, its behaviour is behaviour.ts
   (docs/kit/RULES.md). */
import type { BotLike } from '../../bot-state';
import { markHTML } from '../../model-mark';
import type { ModelRef } from '../../model-mark';
import { orbHtml } from '../../orb';
import { stack } from '../../stack';
import { botText } from '../theme/theme';
import { attrs, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

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

/** what Avatar promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<AvatarOpts>({
  name: 'Avatar',
  folder: 'avatar',
  layer: 'inline',
  summary: 'Who is there: a bot\'s orb (16 to 96), a model\'s brand tile, a stack of members, or the boopis logomark.',
  exports: ['avatar'],
  props: {
    variant: 'orb (the default), brand, stack or logomark',
    bot: 'the bot an orb draws',
    size: 'its size in px (an orb: one of the kit\'s sizes)',
    state: 'the orb\'s state (working, needs, sleeping)',
    still: 'drawn still (a mark in text)',
    live: 'its idle motion runs',
    flag: 'the needs-you flag on the orb',
    members: 'a stack: the members, the first underneath',
    model: 'brand: the model whose mark it shows',
    label: 'its accessible name (a brand tile or a stack)',
    rest: 'on a rest surface: idle is the still rest pose, and it wakes under the pointer',
    ink: 'the boopis bot: drawn in the theme\'s ink',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    surface: 'a stack: the token of the surface it sits on (the eyes are cut to it)',
    max: 'a stack: how many places it has ("+N" the last)',
    extra: 'a stack: members it cannot draw, counted in "+N"'
  },
  events: [],
  states: ['data-variant', 'data-size', 'data-awake (a rest orb under the pointer)'],
  parts: ['orb-avatar', 'k7-brand', 'k7-logomark'],
  tokens: ['--fill-2', '--gm', '--ns-logo', '--ns-mark', '--r-pill', '--text-dim', '--text-strong'],
  a11y: 'An orb is decoration beside the name it stands for; a brand tile or a stack with a label is role="img", else hidden from readers.',
  boards: [
    '11-botchat', '12-room', 'K02-12-sidebar', '17-working', 'S17-newsession', 'S20-running', 'S23-finished', 'S37-nomodel',
    'S41-noproject', '14-settings'
  ]
});
