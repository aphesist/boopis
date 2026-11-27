// @vitest-environment jsdom
/* ListRow: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './list-row';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.listRow>[0] = { title: 'Fix the flaky test' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: ListRow', () => {
  it('draws the component its contract names (data-kit="ListRow")', () => {
    const el = put(kit.listRow(EX));
    expect(el.matches('[data-kit~="ListRow"]') || !!el.querySelector('[data-kit~="ListRow"]')).toBe(true);
    expect(contract.name).toBe('ListRow');
  });
  it('an option that says whether it is the current one; an item row is a list item with its action', () => {
    const r = put(kit.listRow({ title: 'Fix the flaky test', current: true }));
    expect([r.getAttribute('role'), r.getAttribute('aria-selected'), r.tabIndex]).toEqual(['option', 'true', 0]);
    const i = put(kit.listRow({ variant: 'item', title: 'GitHub', action: 'Connect' }));
    expect(i.getAttribute('role')).toBe('listitem');
    expect(i.querySelector('[data-kit~="Button"]')?.textContent).toBe('Connect');
  });
  it('a list of rows is a listbox, or a list when every row is an item', () => {
    const el = document.createElement('div');
    el.innerHTML = kit.html.list({ label: 'Sessions', rows: [{ title: 'a' }, { title: 'b' }] });
    expect(put(el).firstElementChild?.getAttribute('role')).toBe('listbox');
    el.innerHTML = kit.html.list({ label: 'Connectors', rows: [{ variant: 'item', title: 'a' }] });
    expect(el.firstElementChild?.getAttribute('role')).toBe('list');
  });
});
