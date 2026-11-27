// @vitest-environment jsdom
/* Notice: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kit } from '../index';
import { contract } from './notice';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.notice>[0] = { text: 'Saved' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Notice', () => {
  it('draws the component its contract names (data-kit="Notice")', () => {
    const el = put(kit.notice(EX));
    expect(el.matches('[data-kit~="Notice"]') || !!el.querySelector('[data-kit~="Notice"]')).toBe(true);
    expect(contract.name).toBe('Notice');
  });
  it('a polite status, an alert in red; at most two actions and a Dismiss', () => {
    const n = put(kit.notice({ text: 'Saved', actions: [{ label: 'Undo' }, { label: 'Open' }, { label: 'More' }], dismiss: true }));
    expect([n.getAttribute('role'), n.dataset['place'], n.dataset['tone']]).toEqual(['status', 'page', 'neutral']);
    expect(n.querySelectorAll('[data-kit~="Button"]').length).toBe(2);
    expect(n.querySelector('[aria-label="Dismiss"]')).not.toBeNull();
    expect(put(kit.notice({ text: 'Failed', tone: 'red' })).getAttribute('role')).toBe('alert');
  });
});

describe('scene: Notice', () => {
  it('notify shows one floating Notice at a time, the newest in place of the last', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0));
    kit.notify('Copied');
    kit.notify('Saved');
    expect(kit.notifyText()).toBe('Saved');
    expect(document.querySelectorAll('[data-kit~="Notice"]').length).toBe(1);
    vi.useRealTimers(); vi.unstubAllGlobals();
  });
});
