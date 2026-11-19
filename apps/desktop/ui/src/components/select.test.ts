/* The themed select and its listbox: ARIA, keyboard, typeahead, selection, disabled options, groups, long lists. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from './index';
import type { SelectElement } from './index';

const key = (target: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};
const list = (): HTMLElement | null => document.querySelector<HTMLElement>('.ui-listbox');
const box = (): HTMLElement => document.querySelector<HTMLElement>('.ui-listbox [role="listbox"]')!;
const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.ui-listbox .ui-option')];
const focused = (): string => (document.activeElement as HTMLElement | null)?.dataset['value'] ?? '';
const FRUIT = ['apple', 'apricot', 'banana', 'blueberry', 'cherry'];
const make = (o: Partial<Parameters<typeof ui.select>[0]> = {}): SelectElement => {
  const s = ui.select({ id: 's1', entries: FRUIT.map((value) => ({ value })), value: 'banana', label: 'Fruit', ...o });
  document.body.append(s);
  return s;
};
afterEach(() => { ui.layer.close(false); document.body.innerHTML = ''; vi.useRealTimers(); });

describe('the select: markup and ARIA', () => {
  it('is a select-only combobox that names itself by its label and its value, and has no native select', () => {
    const lbl = document.createElement('span'); lbl.id = 'fl'; lbl.textContent = 'Fruit'; document.body.append(lbl);
    const s = make({ labelId: 'fl', label: undefined });
    expect(s.tagName).toBe('BUTTON');
    expect(s.getAttribute('role')).toBe('combobox');
    expect(s.getAttribute('aria-haspopup')).toBe('listbox');
    expect(s.getAttribute('aria-expanded')).toBe('false');
    expect(s.getAttribute('aria-labelledby')).toBe('fl s1-v');
    expect(s.querySelector('.ui-select__v')?.textContent).toBe('banana');
    expect(document.querySelector('select')).toBeNull();
  });
  it('says so, quietly, when nothing is chosen', () => {
    const s = make({ value: '', placeholder: 'Pick a fruit' });
    expect(s.querySelector('.ui-select__ph')?.textContent).toBe('Pick a fruit');
    expect(s.value).toBe('');
  });
  it('opens a listbox of options with the chosen one selected, links it with aria-controls and closes back to the trigger', () => {
    const s = make(); s.click();
    const lb = box();
    expect(lb.getAttribute('role')).toBe('listbox');
    expect(lb.getAttribute('aria-label')).toBe('Fruit');
    expect(s.getAttribute('aria-expanded')).toBe('true');
    expect(s.getAttribute('aria-controls')).toBe(lb.id);
    expect(options().map((o) => o.getAttribute('role'))).toEqual(Array(5).fill('option'));
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false', 'false']);
    expect(focused()).toBe('banana');   /* focus starts on the chosen option */
    key(document.activeElement!, 'Escape');
    expect(s.getAttribute('aria-expanded')).toBe('false');
    expect(s.hasAttribute('aria-controls')).toBe(false);
    expect(document.activeElement).toBe(s);
  });
  it('escapes what it shows', () => {
    const s = make({ entries: [{ value: 'x', label: '<b>bold</b>', desc: '<i>d</i>' }], value: 'x' });
    s.click();
    expect(list()!.querySelector('b, i')).toBeNull();
    expect(s.querySelector('b')).toBeNull();
  });
});

describe('the select: choosing', () => {
  it('a click chooses, tells ui:change once, shows the choice and returns focus', () => {
    const s = make(); const seen: Array<{ value: string }> = [];
    s.addEventListener('ui:change', (e) => seen.push((e as CustomEvent<{ value: string }>).detail));
    s.click(); options()[4]!.click();
    expect(seen).toEqual([{ value: 'cherry', option: { value: 'cherry' } }]);
    expect(s.value).toBe('cherry');
    expect(s.querySelector('.ui-select__v')?.textContent).toBe('cherry');
    expect(document.activeElement).toBe(s);
  });
  it('choosing what is already chosen changes nothing', () => {
    const s = make(); const fn = vi.fn(); s.addEventListener('ui:change', fn);
    s.click(); options()[2]!.click();
    expect(fn).not.toHaveBeenCalled();
  });
  it('a listener can refuse the change', () => {
    const s = make(); s.addEventListener('ui:change', (e) => e.preventDefault());
    s.click(); options()[0]!.click();
    expect(s.value).toBe('banana');
  });
  it('setting value or options from code is quiet', () => {
    const s = make(); const fn = vi.fn(); s.addEventListener('ui:change', fn);
    s.value = 'apple';
    expect(s.querySelector('.ui-select__v')?.textContent).toBe('apple');
    s.setOptions(['kiwi', 'apple']);
    expect(s.value).toBe('apple');
    s.setOptions(['kiwi']);
    expect(s.value).toBe('');
    expect(fn).not.toHaveBeenCalled();
  });
  it('a disabled select does not open', () => {
    const s = make({ disabled: true }); s.click();
    expect(list()).toBeNull();
  });
  it('a second click on the trigger closes it', () => {
    const s = make(); s.click(); s.click();
    expect(s.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the select: keyboard', () => {
  it('Down, Up, Home and End open the closed select; a letter opens it on that letter', () => {
    for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      const s = make(); const e = key(s, k);
      expect(e.defaultPrevented).toBe(true);
      expect(list()).not.toBeNull();
      ui.layer.close(false); document.body.innerHTML = '';
    }
    const s = make(); key(s, 'c');
    expect(focused()).toBe('cherry');
  });
  it('Up and Down move over the options and stop at the ends; Home and End jump', () => {
    make().click();
    key(document.activeElement!, 'ArrowDown'); expect(focused()).toBe('blueberry');
    key(document.activeElement!, 'ArrowDown'); key(document.activeElement!, 'ArrowDown'); expect(focused()).toBe('cherry');
    key(document.activeElement!, 'ArrowUp'); expect(focused()).toBe('blueberry');
    key(document.activeElement!, 'Home'); expect(focused()).toBe('apple');
    key(document.activeElement!, 'ArrowUp'); expect(focused()).toBe('apple');
    key(document.activeElement!, 'End'); expect(focused()).toBe('cherry');
  });
  it('Enter and Space choose the focused option', () => {
    const s = make(); s.click(); key(document.activeElement!, 'ArrowUp'); key(document.activeElement!, 'Enter');
    expect(s.value).toBe('apricot');
    s.click(); key(document.activeElement!, 'End'); key(document.activeElement!, ' ');
    expect(s.value).toBe('cherry');
  });
  it('Esc closes without changing; Tab closes and leaves focus on the trigger', () => {
    const s = make(); s.click(); key(document.activeElement!, 'Home'); key(document.activeElement!, 'Escape');
    expect(s.value).toBe('banana'); expect(list() === null || !list()!.classList.contains('is-in')).toBe(true);
    s.click(); key(document.activeElement!, 'Tab');
    expect(s.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(s);
  });
  it('the keys of an open list do not reach the page', () => {
    make().click();
    const e = key(document.activeElement!, 'ArrowDown');
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('the select: typeahead', () => {
  it('a letter jumps to the next option that starts with it, again cycles', () => {
    make({ value: 'apple' }).click();
    key(document.activeElement!, 'b'); expect(focused()).toBe('banana');
    key(document.activeElement!, 'b'); expect(focused()).toBe('blueberry');   /* the same letter again moves to the next one */
    key(document.activeElement!, 'b'); expect(focused()).toBe('banana');
  });
  it('typing a word narrows: "ap" then "r" lands on apricot, not apple', () => {
    make({ value: 'cherry' }).click();
    key(document.activeElement!, 'a'); expect(focused()).toBe('apple');
    key(document.activeElement!, 'p'); expect(focused()).toBe('apple');
    key(document.activeElement!, 'r'); expect(focused()).toBe('apricot');
  });
  it('is case-insensitive, matches the label and not the value, and never lands on a disabled option', () => {
    make({ value: 'x', entries: [{ value: 'x', label: 'Xenon' }, { value: 'y', label: 'Beta' }, { value: 'z', label: 'Bravo', disabled: true }, { value: 'w', label: 'Bone' }] }).click();
    key(document.activeElement!, 'B'); expect(focused()).toBe('y');
    vi.useFakeTimers(); vi.advanceTimersByTime(800);
    key(document.activeElement!, 'b'); expect(focused()).toBe('w');
  });
  it('Space is part of a word being typed and chooses only when none is', () => {
    const s = make({ value: 'a', entries: [{ value: 'a', label: 'a' }, { value: 'n', label: 'new york' }, { value: 'x', label: 'newark' }] });
    s.click();
    key(document.activeElement!, 'n'); key(document.activeElement!, 'e'); key(document.activeElement!, 'w'); key(document.activeElement!, ' ');
    expect(list()).not.toBeNull();   /* still open: it was a letter */
    key(document.activeElement!, 'y');
    expect(focused()).toBe('n');
  });
});

describe('the select: disabled options', () => {
  const entries = [{ value: 'a' }, { value: 'b', disabled: true, desc: 'Needs a key' }, { value: 'c' }];
  it('are marked, skipped by the arrows and refuse a click', () => {
    const s = make({ entries, value: 'a' }); s.click();
    expect(options()[1]!.getAttribute('aria-disabled')).toBe('true');
    key(document.activeElement!, 'ArrowDown'); expect(focused()).toBe('c');
    options()[1]!.click();
    expect(s.value).toBe('a');
    expect(list()).not.toBeNull();   /* a refused click leaves it open */
  });
  it('a selected value that is disabled does not take focus', () => {
    make({ entries: [{ value: 'a' }, { value: 'b', disabled: true }], value: 'b' }).click();
    expect(focused()).toBe('a');
  });
});

describe('the select: groups and models', () => {
  it('groups are labelled groups whose header is not an option', () => {
    make({ entries: [{ label: 'Fruit', options: [{ value: 'a' }, { value: 'b' }] }, { label: 'Veg', options: [{ value: 'c' }] }], value: 'c' }).click();
    const groups = [...document.querySelectorAll<HTMLElement>('.ui-listbox [role="group"]')];
    expect(groups).toHaveLength(2);
    const head = document.getElementById(groups[0]!.getAttribute('aria-labelledby')!)!;
    expect(head.textContent).toBe('Fruit');
    expect(head.getAttribute('role')).toBe('presentation');
    expect(options()).toHaveLength(3);
    key(document.activeElement!, 'Home'); key(document.activeElement!, 'End'); expect(focused()).toBe('c');   /* keys run across groups */
  });
  it('model entries group by provider family with the family\'s mark in the header, and a single family needs no header', () => {
    const e = ui.modelEntries(['sonnet 5.5', 'haiku 4.5', 'gpt-5', 'qwen3-coder', 'opus 4.1']);
    expect(e.map((x) => ('options' in x ? x.label + ':' + x.options.map((o) => o.value).join('|') : x.value))).toEqual(['Claude:sonnet 5.5|haiku 4.5|opus 4.1', 'OpenAI:gpt-5', 'Qwen:qwen3-coder']);
    expect(ui.modelEntries(['sonnet 5.5', 'opus 4.1']).every((x) => !('options' in x))).toBe(true);
    make({ entries: e, value: 'gpt-5' }).click();
    const heads = [...document.querySelectorAll('.ui-listbox__head')];
    expect(heads.map((h) => h.textContent)).toEqual(['Claude', 'OpenAI', 'Qwen']);
    expect(heads.every((h) => h.querySelector('svg.ui-mm[data-color="mono"]'))).toBe(true);
    expect(options().every((o) => o.querySelector('svg.ui-mm[data-color="brand"]'))).toBe(true);   /* brand colour is the picker's */
  });
  it('a model field is the model picker: the chosen model leads with its mark', () => {
    const f = ui.field({ kind: 'model', label: 'Model', options: ['sonnet 5.5', 'gpt-5'], value: 'gpt-5' });
    document.body.append(f);
    const trigger = f.querySelector<SelectElement>('.ui-select')!;
    expect(trigger.querySelector('svg.ui-mm')?.getAttribute('data-family')).toBe('openai');
    expect(f.querySelector('label')).toBeNull();   /* a label for a button would open the list on a click on its text */
    expect(trigger.getAttribute('aria-labelledby')).toBe(f.querySelector('.ui-field__label')!.id + ' ' + trigger.id + '-v');
  });
});

describe('the select: long lists', () => {
  const MANY = Array.from({ length: 1200 }, (_, i) => 'model-' + String(i).padStart(4, '0'));
  it('draws every option and scrolls instead of growing past the window', () => {
    make({ entries: MANY.map((value) => ({ value })), value: 'model-0600' }).click();
    expect(options()).toHaveLength(1200);
    expect(list()!.style.maxHeight).toMatch(/^\d+px$/);
    expect(parseInt(list()!.style.maxHeight, 10)).toBeLessThanOrEqual(360);
    expect(focused()).toBe('model-0600');
  });
  it('End, Home and PageDown reach the far ends, and typing a number finds a model', () => {
    make({ entries: MANY.map((value) => ({ value })), value: 'model-0000' }).click();
    key(document.activeElement!, 'End'); expect(focused()).toBe('model-1199');
    key(document.activeElement!, 'Home'); expect(focused()).toBe('model-0000');
    key(document.activeElement!, 'PageDown'); expect(focused()).not.toBe('model-0000');
    for (const c of 'model-09') key(document.activeElement!, c);
    expect(focused()).toBe('model-0900');
  });
});

describe('the listbox: for a chip that owns its state', () => {
  it('opens against any button, marks the value, reports the choice and closes', () => {
    const chip = document.createElement('button'); document.body.append(chip);
    const onSelect = vi.fn();
    ui.listbox.open(chip, [{ value: '__smart', label: 'Smart', desc: 'Picks the model for each message' }, ...ui.modelEntries(['sonnet', 'haiku'])], { value: '__smart', label: 'Model', onSelect });
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    options()[2]!.click();
    expect(onSelect).toHaveBeenCalledWith('haiku', expect.objectContaining({ value: 'haiku' }));
    expect(chip.getAttribute('aria-expanded')).toBe('false');
  });
  it('opens inside the dialog that holds its trigger, so a modal dialog does not hide it', () => {
    const d = document.createElement('dialog'); d.setAttribute('open', ''); document.body.append(d);
    const s = ui.select({ entries: [{ value: 'a' }], value: 'a', label: 'X' }); d.append(s);
    s.click();
    expect(list()!.parentElement).toBe(d);
  });
});
