import { describe, expect, it } from 'vitest';
import { icon, iconNames, inlineCodeHTML, kit } from './index';
import { ariaKeys, keyLabel } from '../core/keys';
import { botState, botLabel } from './bot-state';
import { frag } from '../core/dom';

describe('the markup the CSS depends on', () => {
  it('escapes what it is given', () => {
    expect(kit.html.badge({ text: '<b>x</b>' })).not.toContain('<b>x</b>');
    expect(inlineCodeHTML('`a<b>`')).toBe('<code class="k7-chip-in k7-code">a&lt;b&gt;</code>');
  });
});

describe('the icon library', () => {
  it('has the dice, drawn on the 16 grid with its three pips filled', () => {
    expect(iconNames).toContain('dice');
    const svg = frag(icon('dice'));
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
