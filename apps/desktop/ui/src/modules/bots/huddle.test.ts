// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { GroupMessage, GroupText } from '../../data';
import type { GroupMember } from '../../data';
import { foldHuddles, huddleEntry, huddleMessage, huddleRuns, isBetween, liveAt } from './huddle';
import type { HuddleDeps } from './huddle';

const t = (id: string, who: string, round?: number): GroupText => ({ kind: 'text', id, who, t: '09:0' + id.length, text: 'hello', ...(round === undefined ? {} : { round }) });
const thread: GroupMessage[] = [t('a', 'you'), t('b', 'kai', 0), t('cc', 'nina', 1), t('ddd', 'kai', 2), t('eeee', 'moss', 3), t('f', 'you'), t('gg', 'kai', 0)];

describe('the huddle', () => {
  it('folds only what the members say among themselves, two or more in a row', () => {
    expect(thread.filter((m) => isBetween(m)).map((m) => m.id)).toEqual(['cc', 'ddd', 'eeee']);
    expect(huddleRuns(thread)).toEqual([[2, 5]]);
    expect(huddleRuns([t('a', 'you'), t('cc', 'nina', 1), t('b', 'kai', 0)])).toEqual([]);
  });
  it('keeps a member’s message that addresses the person (@user) out of the fold: a reply to the person stays a full entry', () => {
    const toYou = (m: GroupMessage): boolean => m.id === 'ddd';
    expect(thread.filter((m) => isBetween(m, toYou)).map((m) => m.id)).toEqual(['cc', 'eeee']);
    expect(huddleRuns(thread, toYou)).toEqual([]);
  });
  it('is live until the user writes again', () => {
    expect(liveAt(thread, 5)).toBe(false);
    expect(liveAt(thread.slice(0, 5), 5)).toBe(true);
  });
  it('folds when the user writes, unless they opened it themselves', () => {
    document.body.innerHTML = '<div><div class="bt-huddle-entry"><button class="ui-disclosure" aria-expanded="true"></button><div class="bt-huddle__body"></div></div><div class="bt-huddle-entry" data-user="1"><button class="ui-disclosure" aria-expanded="true"></button><div class="bt-huddle__body"></div></div></div>';
    foldHuddles(document.body);
    const [a, b] = [...document.querySelectorAll<HTMLElement>('.bt-huddle-entry')];
    expect(a!.querySelector('.ui-disclosure')!.getAttribute('aria-expanded')).toBe('false');
    expect((a!.querySelector('.bt-huddle__body') as HTMLElement).hidden).toBe(true);
    expect(b!.querySelector('.ui-disclosure')!.getAttribute('aria-expanded')).toBe('true');
  });
  it('folds a run into one entry that says who and how many, and keeps every message', () => {
    const mem = (id: string): GroupMember => ({ id, profile: id, handle: id, name: id });
    const members = [mem('kai'), mem('nina')];
    const drawn: string[] = [];
    const deps: HuddleDeps = {
      member: (id) => members.find((m) => m.id === id),
      orb: (m) => '<span class="orb">' + m.id + '</span>',
      to: (m) => (m.who === 'kai' ? ['nina'] : []),
      ctx: { members } as unknown as HuddleDeps['ctx'],
      drawn: (m) => { drawn.push(m.id); }
    };
    const run = [t('cc', 'nina', 1), t('ddd', 'kai', 2), t('eeee', 'nina', 3)];
    const e = huddleEntry(run, deps, { open: false, unreadBefore: 'ddd' });
    expect(e.dataset['huddle']).toBe('3');
    expect(e.textContent).toContain('nina and kai worked it out, 3 messages');
    const head = e.querySelector('.ui-disclosure')!, body = e.querySelector<HTMLElement>('.bt-huddle__body')!;
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    expect(head.getAttribute('aria-controls')).toBe(body.id);
    expect([...body.children].map((c) => c.className.split(' ')[0])).toEqual(['bt-hmsg', 'bt-unread', 'bt-hmsg', 'bt-hmsg']);
    expect(drawn).toEqual(['cc', 'ddd', 'eeee']);
    const one = huddleMessage(run[1] as GroupText, deps);
    expect(one.getAttribute('aria-label')).toBe('kai, to nina, ' + (run[1] as GroupText).t);
    expect(one.querySelector('.bt-hmsg__to')?.textContent).toBe('to nina');
  });
});
