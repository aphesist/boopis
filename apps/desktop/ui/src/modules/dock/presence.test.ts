// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createMockProvider } from '../../data/mock-provider';
import { changeOf, hasPage, pageOf, pagesFor, partOf, presenceOf, sessionStarted } from './presence';
import type { Presence } from './presence';

/* Owner, 19 November 2026: the dock only really appears once a bot exists or a session has started. */
const P = (bots: number, session: boolean, setting = true): Presence => presenceOf({ bots, session, setting });
const ARRANGED = [{ id: 'bots', on: true }, { id: 'run', on: true }, { id: 'wait', on: true }, { id: 'sched', on: true }, { id: 'ctx', on: false }];

describe('which parts exist, and whether the dock shows', () => {
  it.each([
    // bots, session, setting, then the bots part, the session part, visible
    [0, false, true, false, false, false],   // a first install: no dock
    [1, false, true, true, false, true],     // the first bot: the dock, with its roster
    [3, false, true, true, false, true],
    [0, true, true, false, true, true],      // a session and no bots: the session part alone
    [2, true, true, true, true, true],       // both
    [0, false, false, false, false, false],
    [2, false, false, true, false, false],   // the setting off hides whatever exists
    [0, true, false, false, true, false],
    [2, true, false, true, true, false]
  ])('%i bots, session %s, setting %s -> bots part %s, session part %s, visible %s', (bots, session, setting, b, s, v) => {
    expect(presenceOf({ bots, session, setting })).toEqual({ bots: b, session: s, visible: v });
  });

  it('a session is started when the run has a title: a blank new session, and no run at all, are not', () => {
    expect(sessionStarted({ title: 'proration drift in src/billing' })).toBe(true);
    expect(sessionStarted({ title: '' })).toBe(false);
    expect(sessionStarted({ title: '   ' })).toBe(false);
    expect(sessionStarted(null)).toBe(false);
    expect(sessionStarted(undefined)).toBe(false);
  });
});

describe('what a change of presence does', () => {
  it('rises when the first bot is made, or the first session starts', () => {
    expect(changeOf(P(0, false), P(1, false))).toBe('appear');
    expect(changeOf(P(0, false), P(0, true))).toBe('appear');
  });
  it('rises when the setting turns the dock on while a part exists, and leaves when it turns it off', () => {
    expect(changeOf(P(2, true, false), P(2, true, true))).toBe('appear');
    expect(changeOf(P(2, true, true), P(2, true, false))).toBe('leave');
  });
  it('a setting turned on with nothing in the dock changes nothing', () => {
    expect(changeOf(P(0, false, false), P(0, false, true))).toBe('none');
  });
  it('leaves when the last bot goes and no session part is left', () => {
    expect(changeOf(P(1, false), P(0, false))).toBe('leave');
  });
  it('grows to take a part in, and shrinks when one goes, without leaving', () => {
    expect(changeOf(P(0, true), P(1, true))).toBe('parts');      // bots after a session
    expect(changeOf(P(1, false), P(1, true))).toBe('parts');     // a session after bots
    expect(changeOf(P(1, true), P(0, true))).toBe('parts');      // the last bot goes, the session part stays
  });
  it('a bot more or fewer, with a part still there, changes nothing at this level', () => {
    expect(changeOf(P(1, false), P(2, false))).toBe('none');
    expect(changeOf(P(2, false), P(1, false))).toBe('none');
    expect(changeOf(P(2, true), P(3, true))).toBe('none');
  });
  it('nothing happens while the dock is off', () => {
    expect(changeOf(P(0, false, false), P(1, false, false))).toBe('none');
    expect(changeOf(P(1, false, false), P(0, false, false))).toBe('none');
  });
});

describe('the pages of each part', () => {
  it('the bots part owns Bots and Scheduled, the session part Run and Context, Needs you is the dock\'s', () => {
    expect(['bots', 'sched', 'run', 'ctx', 'wait'].map(partOf)).toEqual(['bots', 'bots', 'session', 'session', 'any']);
  });
  it('a page exists when its part does', () => {
    expect(hasPage('bots', { bots: true, session: false })).toBe(true);
    expect(hasPage('run', { bots: true, session: false })).toBe(false);
    expect(hasPage('run', { bots: false, session: true })).toBe(true);
    expect(hasPage('wait', { bots: false, session: true })).toBe(true);
    expect(hasPage('wait', { bots: false, session: false })).toBe(false);
  });
  it('with both parts, the arranged pages are all shown', () => {
    expect(pagesFor(ARRANGED, { bots: true, session: true })).toEqual(['bots', 'run', 'wait', 'sched']);
  });
  it('with bots only, the roster is there and Run is not', () => {
    expect(pagesFor(ARRANGED, { bots: true, session: false })).toEqual(['bots', 'wait', 'sched']);
  });
  it('with a session only, no roster: Run (and Needs you), never Bots or Scheduled', () => {
    expect(pagesFor(ARRANGED, { bots: false, session: true })).toEqual(['run', 'wait']);
  });
  it('the user\'s order is kept', () => {
    const swapped = [{ id: 'run', on: true }, { id: 'bots', on: true }, { id: 'wait', on: false }, { id: 'sched', on: false }, { id: 'ctx', on: true }];
    expect(pagesFor(swapped, { bots: true, session: true })).toEqual(['run', 'bots', 'ctx']);
  });
  it('a part with none of its pages switched on still has its own page', () => {
    const onlyBots = [{ id: 'bots', on: true }, { id: 'run', on: false }, { id: 'wait', on: false }, { id: 'sched', on: false }, { id: 'ctx', on: false }];
    expect(pagesFor(onlyBots, { bots: false, session: true })).toEqual(['run']);
    const onlyRun = [{ id: 'bots', on: false }, { id: 'run', on: true }, { id: 'wait', on: false }, { id: 'sched', on: false }, { id: 'ctx', on: false }];
    expect(pagesFor(onlyRun, { bots: true, session: false })).toEqual(['bots']);
  });
  it('no part, no page', () => {
    expect(pagesFor(ARRANGED, { bots: false, session: false })).toEqual([]);
  });
  it('the page to be on: the current one while it is shown, else the first', () => {
    expect(pageOf('run', ['run', 'wait'])).toBe('run');
    expect(pageOf('bots', ['run', 'wait'])).toBe('run');
    expect(pageOf('bots', [])).toBe('bots');
  });
});

describe('the mock\'s first install', () => {
  it('the default mock has bots and a started session', () => {
    const d = createMockProvider({ simulate: false });
    expect(d.bots.snapshot().bots.length).toBeGreaterThan(0);
    expect(sessionStarted(d.run.current.get())).toBe(true);
  });
  it('`none` is no bots with the session still there', () => {
    const d = createMockProvider({ simulate: false, fixtures: ['none'] });
    expect(d.bots.snapshot().bots.length).toBe(0);
    expect(sessionStarted(d.run.current.get())).toBe(true);
  });
  it('`fresh` is no bots and no session, and the first message starts one', () => {
    const d = createMockProvider({ simulate: false, fixtures: ['fresh'] });
    expect(d.bots.snapshot().bots.length).toBe(0);
    expect(sessionStarted(d.run.current.get())).toBe(false);
    const s = d.sessions.create(null);
    expect(sessionStarted(d.run.current.get())).toBe(false);   // a blank session is not a started one
    d.sessions.send(s.id, 'fix the proration drift\nand the rounding', { governed: true, smart: true, model: 'sonnet 5.5', assume: [] });
    expect(d.run.current.get().title).toBe('fix the proration drift');
    expect(sessionStarted(d.run.current.get())).toBe(true);
  });
});
