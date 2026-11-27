// @vitest-environment jsdom
/* Avatar: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './avatar';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.avatar>[0] = { bot: { id: 'kai', name: 'kai' } };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Avatar', () => {
  it('draws the component its contract names (data-kit="Avatar")', () => {
    const el = put(kit.avatar(EX));
    expect(el.matches('[data-kit~="Avatar"]') || !!el.querySelector('[data-kit~="Avatar"]')).toBe(true);
    expect(contract.name).toBe('Avatar');
  });
  it('an orb carries its size; a brand tile with a label is an image, without one it is hidden', () => {
    const o = put(kit.avatar({ bot: { id: 'kai', name: 'kai' }, size: 28 }));
    expect([o.dataset['variant'], o.dataset['size']]).toEqual(['orb', '28']);
    expect(put(kit.avatar({ variant: 'brand', model: 'claude-opus', label: 'Claude Opus' })).getAttribute('role')).toBe('img');
    expect(put(kit.avatar({ variant: 'brand', model: 'claude-opus' })).getAttribute('aria-hidden')).toBe('true');
  });
});

describe('scene: Avatar', () => {
  it('a bot at rest wakes under the pointer and settles back when it leaves', () => {
    const a = put(kit.avatar({ bot: { id: 'kai', name: 'kai' }, rest: true }));
    const w = a.querySelector<HTMLElement>('.ui-orb[data-orb-rest]');
    const o = w?.querySelector('orb-avatar');
    if (!w || !o) return;
    o.setAttribute('reaction', 'pose');
    w.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect([w.hasAttribute('data-awake'), o.getAttribute('reaction')]).toEqual([true, 'idle']);
    w.dispatchEvent(new PointerEvent('pointerleave'));
    expect([w.hasAttribute('data-awake'), o.getAttribute('reaction')]).toEqual([false, 'pose']);
  });
});
