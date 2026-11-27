// @vitest-environment jsdom
/* SetupPage: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. It has no
   behaviour of its own (its buttons are the kit's Buttons; the screen listens for their presses). */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './setup-page';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: SetupPage', () => {
  it('draws the component its contract names (data-kit="SetupPage")', () => {
    const el = put(kit.setupPage({ title: 'Hi, I’m boopis' }));
    expect(el.matches('[data-kit~="SetupPage"]')).toBe(true);
    expect(contract.name).toBe('SetupPage');
  });
  it('names its region by its heading and draws the mark where it is asked', () => {
    const el = put(kit.setupPage({ title: 'Hi, I’m boopis', lede: 'A minute of setup.', mark: 'hero' }));
    expect(el.getAttribute('aria-labelledby')).toBe('k7-setup-title');
    expect(el.querySelector('#k7-setup-title')?.textContent).toBe('Hi, I’m boopis');
    expect(el.querySelector('.k7-setup__hero boopis-logo')).toBeTruthy();
    expect(el.querySelector('.k7-setup__mark')).toBeNull();
    expect(put(kit.setupPage({ title: 'x', mark: 'none' })).querySelector('boopis-logo')).toBeNull();
  });
  it('stacks its actions in order, the primary first, each with its value; busy is disabled and says so', () => {
    const el = put(kit.setupPage({ title: 'x', actions: [{ label: 'Use Claude', primary: true, value: 'use', busy: true }, { label: 'Add another', value: 'more' }] }));
    const b = [...el.querySelectorAll<HTMLButtonElement>('.k7-setup__acts [data-kit~="Button"]')];
    expect(b.map((x) => x.dataset['setup'])).toEqual(['use', 'more']);
    expect(b[0]?.getAttribute('aria-busy')).toBe('true');
    expect(b[0]?.disabled).toBe(true);
  });
  it('a status takes the actions\' place as a live region', () => {
    const el = put(kit.setupPage({ title: 'x', actions: [{ label: 'Go', value: 'go' }], status: { text: 'Getting boopis ready', figure: '62%' } }));
    expect(el.querySelector('[role="status"]')?.textContent).toBe('Getting boopis ready62%');
    expect(el.querySelector('[data-setup="go"]')).toBeNull();
  });
  it('the way out and the window glyphs, with the app\'s handles; none on a tiling desktop', () => {
    const el = put(kit.setupPage({ title: 'x', skip: { label: 'Skip setup', value: 'skip' }, windowParts: { close: { 'data-win': 'close' } } }));
    expect(el.querySelector('.k7-setup__skip [data-setup="skip"]')?.textContent).toContain('Skip setup');
    expect(el.querySelector('.k7-setup__wc [data-win="close"]')).toBeTruthy();
    expect(put(kit.setupPage({ title: 'x', windowControls: false })).querySelector('.k7-setup__wc')).toBeNull();
  });
});
