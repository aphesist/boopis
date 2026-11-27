// @vitest-environment jsdom
/* Disclosure: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from thread.test.ts keep their words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './disclosure';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.disclosure>[0] = { summary: 'Read 2 files', steps: [{ text: 'a.ts' }, { text: 'b.ts' }] };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Disclosure', () => {
  it('draws the component its contract names (data-kit="Disclosure")', () => {
    const el = put(kit.disclosure(EX));
    expect(el.matches('[data-kit~="Disclosure"]') || !!el.querySelector('[data-kit~="Disclosure"]')).toBe(true);
    expect(contract.name).toBe('Disclosure');
  });
  it('its summary controls its body and says whether it is open; its steps are an ordered list', () => {
    const d = put(kit.disclosure(EX));
    const sum = d.querySelector('button') as HTMLElement;
    expect(sum.getAttribute('aria-expanded')).toBe('false');
    expect(d.querySelector('#' + sum.getAttribute('aria-controls'))?.querySelectorAll('li').length).toBe(2);
  });
});

describe('scene: Disclosure', () => {
  it('Disclosure: the chevron leads the summary, and the summary opens the steps', () => {
    const d = put(kit.disclosure({ variant: 'worklog', summary: 'Read 6 files', steps: [{ text: 'read_file' }] }));
    const sum = d.querySelector('.k7-disc__sum') as HTMLButtonElement;
    expect(sum.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    sum.click();
    expect(d.hasAttribute('data-open')).toBe(true);
    expect(sum.getAttribute('aria-expanded')).toBe('true');
  });
});
