// @vitest-environment jsdom
/* Bubble: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './bubble';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.bubble>[0] = { text: 'Hello' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Bubble', () => {
  it('draws the component its contract names (data-kit="Bubble")', () => {
    const el = put(kit.bubble(EX));
    expect(el.matches('[data-kit~="Bubble"]') || !!el.querySelector('[data-kit~="Bubble"]')).toBe(true);
    expect(contract.name).toBe('Bubble');
  });
  it('says whose it is as data; a bot\'s chat fills your bubble with the bot\'s colour', () => {
    expect(put(kit.bubble({ kind: 'user', text: 'Hi' })).dataset['kind']).toBe('user');
    expect(put(kit.bubble({ kind: 'bot', text: 'Hi' })).dataset['kind']).toBe('agent');
    const f = put(kit.bubble({ kind: 'user', text: 'Hi', fill: { fill: '#335', text: '#fff' } }));
    expect(f.hasAttribute('data-bot-colour')).toBe(true);
    expect(f.style.getPropertyValue('--bubble-user')).toBe('#335');
  });
});
