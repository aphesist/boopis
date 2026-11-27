// @vitest-environment jsdom
/* TimeSeparator: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './time-separator';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.timeSeparator>[0] = { text: 'Yesterday' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: TimeSeparator', () => {
  it('draws the component its contract names (data-kit="TimeSeparator")', () => {
    const el = put(kit.timeSeparator(EX));
    expect(el.matches('[data-kit~="TimeSeparator"]') || !!el.querySelector('[data-kit~="TimeSeparator"]')).toBe(true);
    expect(contract.name).toBe('TimeSeparator');
  });
  it('a separator named by its words; the unread start is marked', () => {
    const t = put(kit.timeSeparator({ text: 'Yesterday', unread: true }));
    expect([t.getAttribute('role'), t.getAttribute('aria-label'), t.hasAttribute('data-unread')]).toEqual(['separator', 'Yesterday', true]);
  });
});
