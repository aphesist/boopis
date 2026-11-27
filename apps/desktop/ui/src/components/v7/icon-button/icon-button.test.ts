// @vitest-environment jsdom
/* IconButton: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './icon-button';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.iconButton>[0] = { icon: 'copy', label: 'Copy' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: IconButton', () => {
  it('draws the component its contract names (data-kit="IconButton")', () => {
    const el = put(kit.iconButton(EX));
    expect(el.matches('[data-kit~="IconButton"]') || !!el.querySelector('[data-kit~="IconButton"]')).toBe(true);
    expect(contract.name).toBe('IconButton');
  });
  it('is named by its label, its tip says the same, and its keys are said', () => {
    const b = put(kit.iconButton({ icon: 'copy', label: 'Copy', keys: 'mod+C' }));
    expect(b.getAttribute('aria-label')).toBe('Copy');
    expect(b.dataset['tip']).toBe('Copy');
    expect(b.getAttribute('aria-keyshortcuts')).toBe('mod+C');
    expect(b.dataset['variant']).toBe('floating');
  });
  it('a toggle says whether it is pressed; tip false draws no tooltip', () => {
    const b = put(kit.iconButton({ icon: 'mic', label: 'Dictate', pressed: false, tip: false, variant: 'tinted' }));
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.hasAttribute('data-tip')).toBe(false);
  });
});
