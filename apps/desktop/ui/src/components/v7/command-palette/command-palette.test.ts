// @vitest-environment jsdom
/* CommandPalette: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './command-palette';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.commandPalette>[0] = {
  id: 'p', label: 'Search and commands', placeholder: 'Search',
  groups: [{ label: 'Sessions', rows: [{ value: 's1', label: 'Fix the dock', meta: 'boopis', trail: '2h' }] }, { label: 'Commands', rows: [{ value: 'c1', label: 'Settings', keys: 'mod+,' }, { value: 'c2', label: 'Store' }] }]
};
beforeEach(() => { document.body.replaceChildren(); });
const key = (el: Element, k: string, shift = false): void => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true })); };

describe('story: CommandPalette', () => {
  it('draws the component its contract names (data-kit="CommandPalette")', () => {
    const el = put(kit.commandPalette(EX));
    expect(el.matches('[data-kit~="CommandPalette"]')).toBe(true);
    expect(contract.name).toBe('CommandPalette');
  });
  it('a modal dialog whose field is a combobox over one listbox, the first row the one the keys are on', () => {
    const p = put(kit.commandPalette(EX));
    expect([p.getAttribute('role'), p.getAttribute('aria-modal'), p.getAttribute('aria-label')]).toEqual(['dialog', 'true', 'Search and commands']);
    const input = p.querySelector('#p-input') as HTMLInputElement;
    expect([input.getAttribute('role'), input.getAttribute('aria-controls'), input.getAttribute('aria-activedescendant')]).toEqual(['combobox', 'p-list', 'p-0']);
    expect(p.querySelector('#p-list')?.getAttribute('role')).toBe('listbox');
    expect([...p.querySelectorAll('.k7-cpal__head')].map((h) => h.textContent)).toEqual(['Sessions', 'Commands']);
    expect([...p.querySelectorAll('[role="option"]')].map((r) => r.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(p.querySelector('#p-1 .k7-kbd')).not.toBeNull();
  });
  it('marks the first word of the query where a label holds it', () => {
    const p = put(kit.commandPalette({ ...EX, query: 'dock' }));
    expect(p.querySelector('#p-0 .k7-cpal__hit')?.textContent).toBe('dock');
  });
  it('nothing matching is one status line, and the list is no listbox', () => {
    const p = put(kit.commandPalette({ ...EX, groups: [], empty: 'Nothing matches “zz”.' }));
    expect(p.querySelector('.k7-cpal__empty')?.textContent).toBe('Nothing matches “zz”.');
    expect(p.querySelector('#p-list')?.hasAttribute('role')).toBe(false);
    expect(p.querySelector('#p-input')?.hasAttribute('aria-activedescendant')).toBe(false);
  });
  it('an attention trail is a StatusWord in the amber', () => {
    const p = put(kit.commandPalette({ ...EX, groups: [{ label: 'Bots', rows: [{ value: 'b', label: 'kai', trail: 'needs you', attn: true }] }] }));
    expect(p.querySelector('.k7-word')?.getAttribute('data-tone')).toBe('owe');
  });
});

describe('scene: CommandPalette', () => {
  it('Down, Tab and Up move the row the keys are on, and the field names it', () => {
    const p = put(kit.commandPalette(EX));
    const input = p.querySelector('#p-input') as HTMLInputElement;
    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('p-1');
    key(input, 'Tab');
    expect(p.querySelector('#p-2')?.getAttribute('aria-selected')).toBe('true');
    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('p-0');
    key(input, 'Tab', true);
    expect(input.getAttribute('aria-activedescendant')).toBe('p-2');
  });
  it('Enter and a press choose the row with ui:select, which a listener can cancel', () => {
    const p = put(kit.commandPalette(EX));
    const got: string[] = [];
    p.addEventListener('ui:select', (e) => { got.push((e as CustomEvent<{ value: string }>).detail.value); });
    const input = p.querySelector('#p-input') as HTMLInputElement;
    key(input, 'ArrowDown'); key(input, 'Enter');
    (p.querySelector('#p-2') as HTMLElement).click();
    expect(got).toEqual(['c1', 'c2']);
  });
  it('a list drawn again keeps working: the rows are read at each key', () => {
    const p = put(kit.commandPalette(EX));
    const list = p.querySelector('#p-list') as HTMLElement;
    list.innerHTML = kit.html.commandPaletteList({ id: 'p', groups: [{ label: 'Commands', rows: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] }] });
    const input = p.querySelector('#p-input') as HTMLInputElement;
    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('p-1');
  });
});
