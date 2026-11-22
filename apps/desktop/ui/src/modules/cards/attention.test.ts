// @vitest-environment jsdom
/* A card counts once for the user's attention: the dock draws an ask a second time in a session (a mirror), and that is not another ask. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { on } from '../../core/bus';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { createCard } from './index';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const approval = { id: 'approve-deploy', title: 'Deploy to staging', bot: 'nina' };
const counts: number[] = [];
beforeAll(() => { setProvider(createMockProvider()); });
const off = on('hx:attention', (d) => { if (d.source === 'cards') counts.push(d.count); });
afterEach(async () => { document.body.replaceChildren(); await tick(); counts.length = 0; });

afterAll(() => off());

describe('cards waiting on the user', () => {
  it('a mirror of an ask does not count again', async () => {
    const a = createCard('approval', approval as never, { size: 'compact' });
    document.body.append(a);
    await tick();
    const one = counts.at(-1);
    expect(one).toBeGreaterThan(0);
    const m = createCard('approval', approval as never, { size: 'compact' });
    m.setAttribute('data-mirror', '');
    document.body.append(m);
    await tick();
    expect(counts.at(-1)).toBe(one);
    expect(m.attn()).toBe(false);
    expect(a.attn()).toBe(true);
  });

  it('a card that is not a mirror counts', async () => {
    const a = createCard('approval', approval as never, { size: 'compact' });
    document.body.append(a);
    await tick();
    const one = counts.at(-1) ?? 0;
    const b = createCard('approval', { ...approval, id: 'other' } as never, { size: 'compact' });
    document.body.append(b);
    await tick();
    expect(counts.at(-1)).toBe(one + 1);
  });
});
