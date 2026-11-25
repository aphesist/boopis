/* The dock's rules, pure (no DOM), so every case can be tested (DESIGN-SYSTEM.md v7 21.4).

   - It is the Sessions tab's: never drawn in the Bots tab, where the bots live in the sidebar and the rail.
   - It is hidden until you have a bot of your own: boopis alone does not count, and a session alone never draws it.
   - "Show the dock" (Settings > General) turns it off.
   - Its bots are ordered the way the others are: needs you, then working, then the roster's order (the app keeps no pin and no
     recency of its own yet: an owner question).
   - D01 B: the row shows the bots that matter now, as many as fit at most 640 wide, then "N more" (to the Bots tab). */
import type { Bot, Wait } from '../../data';
import { botState } from '@boopis/ui';

/** the boopis bot is the engine's own (the default profile): never one of yours, so it never counts toward showing the dock */
export const BOOPIS_ID = 'boopis';
export const ownBots = <B extends Pick<Bot, 'id'>>(bots: readonly B[]): B[] => bots.filter((b) => b.id !== BOOPIS_ID && b.id !== 'default');

export interface ShowInput { ownBots: number; tab: string; setting: boolean }
/** whether the dock is drawn: a bot of your own, the Sessions tab, and the setting on */
export const shows = (i: ShowInput): boolean => i.setting && i.ownBots > 0 && i.tab === 'session';

/** the rank a bot takes in the row: needs you (0), working (1), the rest (2); the roster's order within each */
export const rankOf = (b: Pick<Bot, 'state' | 'attention' | 'paused'>): number => { const s = botState(b); return s.attention ? 0 : s.busy ? 1 : 2; };
/** the bots in the row's order (a stable sort: the roster's order breaks ties) */
export function ordered<B extends Pick<Bot, 'id' | 'state' | 'attention' | 'paused'>>(bots: readonly B[]): B[] {
  return bots.map((b, i) => ({ b, i, r: rankOf(b) })).sort((x, y) => x.r - y.r || x.i - y.i).map((x) => x.b);
}

/** what the row has room for: `room` the dock's width at most (640, or less where the window is narrower), `pad` its side padding,
    `orb` and `gap` the row's (40, 14), `grow` the most a hover widens it (52 + 2 x 46 - 3 x 40 = 24, or 0 with "Grow bots on hover"
    off), `end` the end slot's width (the ask pill; 0 without one), `more` the "N more" chip's width */
export interface RowRoom { room: number; pad: number; orb: number; gap: number; grow: number; end: number; more: number }
/** the row's content width for `k` orbs, "N more" when `more` is set, and the end slot */
export function rowWidth(k: number, withMore: boolean, r: RowRoom): number {
  const items = [...Array<number>(k).fill(r.orb), ...(withMore ? [r.more] : []), ...(r.end ? [r.end] : [])];
  return 2 * r.pad + items.reduce((a, b) => a + b, 0) + Math.max(0, items.length - 1) * r.gap;
}
/** D01 B: how many of `n` bots the row shows, and how many are left to "N more". At least one shows */
export function fit(n: number, r: RowRoom): { shown: number; more: number } {
  if (n <= 0) return { shown: 0, more: 0 };
  if (rowWidth(n, false, r) + r.grow <= r.room) return { shown: n, more: 0 };
  let k = n - 1;
  while (k > 1 && rowWidth(k, true, r) + r.grow > r.room) k--;
  return { shown: Math.max(1, k), more: n - Math.max(1, k) };
}

/** the asks the dock carries: your bots' approvals (a session's blanks and forms are the session's, drawn there) */
export const asksOf = (waits: readonly Wait[], bots: readonly Pick<Bot, 'id'>[]): Wait[] =>
  waits.filter((w) => w.kind === 'approval' && bots.some((b) => b.id === w.bot));
/** the ask pill's words: "nina needs you", or "3 need you" */
export function askWords(asks: readonly Wait[], nameOf: (id: string) => string): string {
  const who = [...new Set(asks.map((w) => w.bot ?? ''))];
  return who.length === 1 ? nameOf(who[0] ?? '') + ' needs you' : who.length + ' need you';
}
