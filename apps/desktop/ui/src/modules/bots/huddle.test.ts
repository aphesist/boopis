// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { GroupMessage, GroupText } from '../../data';
import { foldHuddles, huddleOn, huddleRuns, isBetween, liveAt, setHuddle } from './huddle';

const t = (id: string, who: string, round?: number): GroupText => ({ kind: 'text', id, who, t: '09:0' + id.length, text: 'hello', ...(round === undefined ? {} : { round }) });
const thread: GroupMessage[] = [t('a', 'you'), t('b', 'kai', 0), t('cc', 'nina', 1), t('ddd', 'kai', 2), t('eeee', 'moss', 3), t('f', 'you'), t('gg', 'kai', 0)];

describe('the huddle', () => {
  it('draws nothing until it is switched on (held back for 0.1.9)', () => {
    expect(huddleOn()).toBe(false);
    expect(huddleRuns(thread)).toEqual([]);
    setHuddle(true);
  });
  it('folds only what the members say among themselves, two or more in a row', () => {
    expect(thread.filter(isBetween).map((m) => m.id)).toEqual(['cc', 'ddd', 'eeee']);
    expect(huddleRuns(thread)).toEqual([[2, 5]]);
    expect(huddleRuns([t('a', 'you'), t('cc', 'nina', 1), t('b', 'kai', 0)])).toEqual([]);
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
});
