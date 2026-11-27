// @vitest-environment jsdom
/* Field: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './field';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.field>[0] = { id: 'f-name', label: 'Name' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Field', () => {
  it('draws the component its contract names (data-kit="Field")', () => {
    const el = put(kit.field(EX));
    expect(el.matches('[data-kit~="Field"]') || !!el.querySelector('[data-kit~="Field"]')).toBe(true);
    expect(contract.name).toBe('Field');
  });
  it('a label for its control; the hint and the error describe it, and the error marks it invalid', () => {
    const f = put(kit.field({ id: 'f-key', label: 'Key', hint: 'From your account', error: 'Too short' }));
    const input = f.querySelector('input') as HTMLInputElement;
    expect(f.querySelector('label')?.getAttribute('for')).toBe('f-key');
    expect(input.getAttribute('aria-describedby')).toBe('f-key-hint f-key-err');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(f.hasAttribute('data-error')).toBe(true);
  });
  it('a secret is typed unseen and carries its Show; a multiline field is a textarea', () => {
    const s = put(kit.field({ id: 'f-tok', label: 'Token', secret: true }));
    expect((s.querySelector('input') as HTMLInputElement).type).toBe('password');
    expect(s.querySelector('[data-reveal]')?.getAttribute('aria-pressed')).toBe('false');
    expect(put(kit.field({ id: 'f-m', label: 'Notes', kind: 'multiline' })).querySelector('textarea')).not.toBeNull();
  });
});
