import { describe, expect, it } from 'vitest';
import { asksOf, askWords, fit, ordered, ownBots, rowWidth, shows } from './model';
import type { Wait } from '../../data';

const bot = (id: string, state = 'idle', attention: string | null = null) => ({ id, name: id, state, attention, paused: false });

describe('when the dock is drawn (21.4)', () => {
  it('only with a bot of your own, in the Sessions tab, with "Show the dock" on', () => {
    expect(shows({ ownBots: 1, tab: 'session', setting: true })).toBe(true);
    expect(shows({ ownBots: 0, tab: 'session', setting: true })).toBe(false);
    expect(shows({ ownBots: 3, tab: 'bots', setting: true })).toBe(false);
    expect(shows({ ownBots: 3, tab: 'session', setting: false })).toBe(false);
  });
  it('boopis alone does not count', () => {
    expect(ownBots([bot('boopis'), bot('default')])).toEqual([]);
    expect(ownBots([bot('boopis'), bot('nina')]).map((b) => b.id)).toEqual(['nina']);
  });
});

describe('the row\'s order', () => {
  it('needs you, then working, then the roster\'s order', () => {
    const list = [bot('a'), bot('b', 'working'), bot('c', 'idle', 'approval'), bot('d'), bot('e', 'thinking'), bot('f', 'working', 'approval')];
    expect(ordered(list).map((b) => b.id)).toEqual(['c', 'f', 'b', 'e', 'a', 'd']);
  });
});

describe('D01 B: the bots that matter now, then "N more"', () => {
  const R = { room: 640, pad: 30, orb: 40, gap: 14, grow: 24, end: 0, more: 70 };
  it('the row\'s width is its content plus twice the padding', () => {
    expect(rowWidth(3, false, R)).toBe(60 + 3 * 40 + 2 * 14);
    expect(rowWidth(2, true, { ...R, end: 120 })).toBe(60 + 80 + 70 + 120 + 3 * 14);
  });
  it('every bot while they fit, hover included', () => {
    expect(fit(10, R)).toEqual({ shown: 10, more: 0 });
    expect(rowWidth(10, false, R) + R.grow).toBeLessThanOrEqual(640);
  });
  it('as many as fit, then "N more", in 640', () => {
    const f = fit(120, R);
    expect(f.shown + f.more).toBe(120);
    expect(rowWidth(f.shown, true, R) + R.grow).toBeLessThanOrEqual(640);
    expect(rowWidth(f.shown + 1, true, R) + R.grow).toBeGreaterThan(640);
  });
  it('the ask pill takes its room from the orbs', () => {
    expect(fit(120, { ...R, end: 140 }).shown).toBeLessThan(fit(120, R).shown);
  });
  it('at least one bot shows, and none without bots', () => {
    expect(fit(5, { ...R, room: 100 }).shown).toBe(1);
    expect(fit(0, R)).toEqual({ shown: 0, more: 0 });
  });
});

describe('the asks', () => {
  const ap = (id: string, b: string): Wait => ({ id, kind: 'approval', bot: b, who: b, title: 'Deploy?', data: { title: 'Deploy?' } });
  const blank: Wait = { id: 'q', kind: 'blank', who: 'session', title: 'Which?', data: { question: 'Which?', short: 'which', options: ['a', 'b'] } };
  it('are your bots\' approvals (a session\'s blanks and forms are the session\'s)', () => {
    expect(asksOf([ap('1', 'nina'), ap('2', 'ghost'), blank], [{ id: 'nina' }]).map((w) => w.id)).toEqual(['1']);
  });
  it('the pill names the one bot, or counts them', () => {
    expect(askWords([ap('1', 'nina'), ap('2', 'nina')], (id) => id)).toBe('nina needs you');
    expect(askWords([ap('1', 'nina'), ap('2', 'kai')], (id) => id)).toBe('2 need you');
  });
});
