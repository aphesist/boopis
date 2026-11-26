/* What waits on you, said by the Sessions / Bots switch: the open sidebar's and the collapsed rail's upright one say the same, also
   after the rail is drawn again (the lab's second render differed: a rail drawn after the last change of attention kept the bare name
   until the next one). */
import { beforeEach, describe, expect, it } from 'vitest';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { setState } from '../../core/state';
import { sh } from './ctx';
import { reportAttention, seedAttention } from './attention';

const seg = (): string => '<div role="tablist"><button role="tab" data-value="session">Sessions</button><button role="tab" data-value="bots">Bots</button></div>';
const names = (root: Element): (string | null)[] => [...root.querySelectorAll('[role="tab"]')].map((b) => b.getAttribute('aria-label'));
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  setProvider(createMockProvider({ simulate: false }));
  document.body.innerHTML = '<div id="side">' + seg() + '</div><div id="hx-rail"><div data-rail-tabs>' + seg() + '</div></div>';
  sh.seg.tabs = document.querySelector<HTMLElement>('#side [role="tablist"]');
  setState({ tab: 'bots' });
});

describe('the tab switch says what waits on the other side', () => {
  it('both switches name it, and a rail drawn again says it at once', async () => {
    seedAttention();
    reportAttention('session', 1, 'session', undefined);
    const rail = document.getElementById('hx-rail') as HTMLElement;
    expect(names(document.getElementById('side') as HTMLElement)).toEqual(['Sessions, needs you', 'Bots']);
    expect(names(rail)).toEqual(['Sessions, needs you', 'Bots']);
    /* the bots module draws the rail again: a new switch, with nothing said yet */
    rail.innerHTML = '<div data-rail-tabs>' + seg() + '</div>';
    expect(names(rail)).toEqual([null, null]);
    await tick();
    expect(names(rail)).toEqual(['Sessions, needs you', 'Bots']);
    reportAttention('session', 0, 'session', undefined);
    expect(names(rail)).toEqual(['Sessions', 'Bots']);
  });
});
