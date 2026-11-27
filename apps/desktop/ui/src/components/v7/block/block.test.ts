// @vitest-environment jsdom
/* Block: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './block';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.block>[0] = { body: '<p>Inside</p>' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Block', () => {
  it('draws the component its contract names (data-kit="Block")', () => {
    const el = put(kit.block(EX));
    expect(el.matches('[data-kit~="Block"]') || !!el.querySelector('[data-kit~="Block"]')).toBe(true);
    expect(contract.name).toBe('Block');
  });
  it('holds what it is given in a drawn frame; an offer says what is missing over its ways', () => {
    const b = put(kit.block(EX));
    expect(b.dataset['sq']).toBe('');
    expect(b.textContent).toBe('Inside');
    const o = put(kit.block({ body: '', variant: 'offer', text: 'No model yet.', actions: kit.html.button({ label: 'Choose a model' }) }));
    expect(o.querySelector('.k7-block__say')?.textContent).toBe('No model yet.');
    expect(o.querySelector('.k7-block__ways [data-kit~="Button"]')).not.toBeNull();
  });
});
