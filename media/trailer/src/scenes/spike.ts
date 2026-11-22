import { ui } from '@boopis/ui';
import type { SceneDef } from '../engine/stage';
import { el, line, kinetic, put } from '../engine/stage';
import { SPRING, step } from '../engine/motion';

export const spike: SceneDef = {
  id: 'spike', start: 0, end: 6,
  setup(root, ctx) {
    const logo = el('boopis-logo' as 'div', 'abs', root); logo.setAttribute('letters', 'play'); logo.style.fontSize = '160px'; logo.style.color = 'var(--text-strong)';
    const orbWrap = el('div', 'abs', root);
    orbWrap.innerHTML = '<orb-avatar size="300" shape="triangle" color="#f23b5a" reaction="idle" idle-motion="calm" mode="drift"></orb-avatar>';
    const orb = orbWrap.firstElementChild as HTMLElement & { react(s: string): void };
    const plate = el('div', 'plate', root); plate.style.width = '720px'; plate.style.padding = '24px'; plate.style.left = '0'; plate.style.top = '0';
    const comp = ui.composer({ placeholder: 'Describe the change', spend: { spent: '$0.00', cap: '$0.60' }, chips: [{ label: 'Governed', pressed: true }, { label: 'Smart', pressed: true }],
      feedforward: (t) => ['refactor', 'src/billing', 'run the tests'].filter((w) => t.includes(w)).map((w) => ({ text: w, kind: 'verb' })),
      hint: (t) => (t ? [{ label: '>refactor' }, { label: '>src/billing' }] : '') as never });
    plate.append(comp);
    const card = ui.card('approval', { from: 'nina', title: 'deploy to staging', quote: 'billing/cents → staging, dry run first', item: ['staging, invoices-api', 'read-only on invoices, 1 migration'], meta: 'expires in 9 min' }, { size: 'inline', enter: false });
    const cardPlate = el('div', 'plate', root); cardPlate.style.padding = '24px'; cardPlate.style.width = '660px'; cardPlate.append(card);
    const h = line('meet your team.', 'h2', root);
    const text = 'refactor the proration helpers in src/billing, run the tests, then open a PR.';
    ctx.at(1.0, () => orb.react('thinking'));
    ctx.at(2.0, () => { (logo as unknown as { play(s: unknown): void }).play([{ state: 'listening', hold: 0.8 }, { state: 'happy', hold: 1.0 }]); });
    ctx.at(3.0, () => { const b = card.querySelector('.ui-hold') as HTMLElement; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true, button: 0 })); });
    return (t) => {
      put(logo, 960, 160, 1, step(t, 0, 0.6));
      put(orbWrap, 300, 600, 0.6 + 0.4 * step(t, 0.2, 0.8, SPRING), 1);
      put(plate, 1250, 420, 1.4, 1);
      put(cardPlate, 1250, 820, 1.2, 1);
      const n = Math.floor(Math.max(0, t - 0.5) * 30);
      (comp as unknown as { setValue(s: string): void }).setValue(text.slice(0, n));
      kinetic(h, t, 0.3, 5.5); h.style.left = '80px'; h.style.top = '900px';
    };
  }
};
