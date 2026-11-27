// @vitest-environment jsdom
/* Card: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './card';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.card>[0] = { rows: [{ label: 'Theme', value: 'Dark' }] };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Card', () => {
  it('draws the component its contract names (data-kit="Card")', () => {
    const el = put(kit.card(EX));
    expect(el.matches('[data-kit~="Card"]') || !!el.querySelector('[data-kit~="Card"]')).toBe(true);
    expect(contract.name).toBe('Card');
  });
  it('a settings card of Rows; a danger zone is folded under its head', () => {
    const c = put(kit.card({ rows: [{ label: 'Theme', value: 'Dark' }, { label: 'Sounds', control: kit.html.switch({ label: 'Sounds' }) }] }));
    expect(c.querySelectorAll('[data-kit-part~="Row"]').length).toBe(2);
    const d = put(kit.card({ variant: 'danger', rows: [{ label: 'Delete bot' }] }));
    expect(d.querySelector('.k7-card__head')?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('scene: Card', () => {
  it('a check Row toggles and says so; a Row that acts is pressed with Enter', () => {
    const c = put(kit.card({ rows: [{ label: 'Under the composer', check: false }, { label: 'Model', value: 'Opus', action: 'opens the model menu' }] }));
    const [check, act] = [...c.querySelectorAll<HTMLElement>('[data-kit-part~="Row"]')];
    const seen: unknown[] = []; c.addEventListener('ui:change', (e) => { seen.push((e as CustomEvent<{ value: boolean }>).detail.value); });
    check?.click();
    expect([seen, check?.getAttribute('aria-checked')]).toEqual([[true], 'true']);
    let pressed = 0; act?.addEventListener('click', () => { pressed++; });
    act?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(pressed).toBe(1);
  });
  it('the danger head opens the zone and says so', () => {
    const d = put(kit.card({ variant: 'danger', rows: [{ label: 'Delete bot' }] }));
    let open: boolean | null = null; d.addEventListener('ui:toggle', (e) => { open = (e as CustomEvent<{ open: boolean }>).detail.open; });
    (d.querySelector('.k7-card__head') as HTMLElement).click();
    expect([open, d.hasAttribute('data-open')]).toEqual([true, true]);
  });
});
