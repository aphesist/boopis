/* Disclosure: its behaviour, moved as it was from wire.ts; wire.ts wires it on every Disclosure once (docs/kit/RULES.md). State lives in ARIA and data attributes. */
import { emit } from '../events';

/** Disclosure and every collapsed summary (Card's danger zone, FilesCard, ToolRow): the summary opens its body */
export function wireDisclosure(d: HTMLElement): void {
  const btn = d.querySelector<HTMLButtonElement>(':scope > [aria-expanded], :scope > * > [aria-expanded]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    if (!emit(d, 'ui:toggle', { open }, true)) return;
    btn.setAttribute('aria-expanded', String(open));
    d.toggleAttribute('data-open', open);
  });
}
