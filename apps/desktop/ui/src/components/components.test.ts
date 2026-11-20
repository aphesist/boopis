import { describe, expect, it } from 'vitest';
import { ui } from './index';
import { ariaKeys, keyLabel } from '../core/keys';
import { botState, botLabel } from './bot-state';
import { frag } from '../core/dom';

describe('the markup the CSS depends on', () => {
  it('a row puts a space between its title, subtitle and end, so assistive tech and axe read separate words', () => {
    const html = ui.html.row({ title: 'atlas', sub: 'reviewer', end: 'now' });
    expect(html).toContain('</span> <span class="ui-row__sub">');
    expect(html).toContain('</span> <span class="ui-row__end"');
  });
  it('escapes what it is given', () => {
    expect(ui.html.row({ title: '<b>x</b>' })).not.toContain('<b>x</b>');
    expect(ui.html.inline('`a<b>`')).toBe('<code class="ui-code">a&lt;b&gt;</code>');
  });
  it('a segmented control selects quietly, and moves with the arrow keys', () => {
    const seg = ui.segmented({ value: 'b', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] });
    document.body.append(seg);
    const changes: string[] = [];
    seg.addEventListener('ui:change', (e) => changes.push((e as CustomEvent<{ value: string }>).detail.value));
    seg.select('c');
    expect(changes).toEqual([]);
    expect(seg.querySelector('[aria-selected="true"]')?.getAttribute('data-value')).toBe('c');
    const first = seg.querySelector<HTMLElement>('[data-value="a"]')!;
    first.focus();
    seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(changes).toEqual(['b']);
    expect(seg.style.getPropertyValue('--i')).toBe('1');
    seg.remove();
  });
  it('a switch announces its value', () => {
    const sw = ui.switch({ id: 'x', checked: false, label: 'X' });
    const seen: boolean[] = [];
    sw.addEventListener('ui:change', (e) => seen.push((e as CustomEvent<{ value: boolean }>).detail.value));
    sw.checked = true; sw.dispatchEvent(new Event('change'));
    expect(seen).toEqual([true]);
  });
  it('a measure names its fill for assistive tech', () => {
    expect(ui.html.measure({ used: 76000, total: 200000 })).toContain('aria-label="Context 38% used"');
  });
  it('a ladder says which station it is on', () => {
    const l = frag(ui.html.ladder({ stations: [['a', 'first'], ['b', 'then']], current: 1 }));
    expect(l.getAttribute('aria-label')).toBe('Model ladder, station 2 of 2: B');
    expect([...l.querySelectorAll('i')].map((i) => i.getAttribute('data-s'))).toEqual(['past', 'now']);
  });
  it('a menu with a checked item is a radio menu, and gives each item its value', () => {
    const html = ui.html.menuItems([{ title: 'Model' }, { label: 'Smart', value: 's', checked: true }, { label: 'opus', checked: false }]);
    expect(html).toContain('role="menuitemradio"');
    expect(html).toContain('data-value="s"');
    expect(html).toContain('data-value="opus"');
  });
});

describe('the icon library', () => {
  it('has the dice, drawn on the 16 grid with its three pips filled', () => {
    expect(ui.icons).toContain('dice');
    const svg = frag(ui.icon('dice'));
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.querySelectorAll('rect')).toHaveLength(1);
    expect(svg.querySelectorAll('circle.is-fill')).toHaveLength(3);
  });
});

describe('bot states: one map for the app', () => {
  it('attention outranks work, and a pause outranks everything', () => {
    expect(botState({ state: 'working', attention: 'approval' }).key).toBe('needs');
    expect(botState({ state: 'working', attention: 'approval', paused: true }).key).toBe('paused');
    expect(botState('idle').word).toBe('idle');
    expect(botState({ state: 'nonsense' }).key).toBe('idle');
  });
  it('the label names the role and anything but idle', () => {
    expect(botLabel({ name: 'nina', role: 'deploys', state: 'needs' })).toBe('nina, deploys, needs you');
    expect(botLabel({ name: 'atlas', role: 'reviewer', state: 'idle' })).toBe('atlas, reviewer');
  });
});

describe('key labels', () => {
  it('chips and aria-keyshortcuts for a spec', () => {
    expect(ariaKeys('mod+shift+K')).toBe('Control+Shift+K');
    expect(ariaKeys('alt+V')).toBe('Alt+V');
    expect(keyLabel('mod')).toBe('ctrl');
    expect(keyLabel('period')).toBe('.');
    expect(keyLabel('k')).toBe('K');
  });
});
