/* Button: its behaviour, moved as it was from wire.ts; wire.ts wires it on every Button once (docs/kit/RULES.md). State lives in ARIA and data attributes. */
import { tokenMs } from '../../../core/dom';
import { emit } from '../events';

/** hold to confirm (owner decision: 1 s, --dur-hold, everywhere): press and hold, or hold Space; released early it drains. From the
    keyboard Enter twice confirms too (KEYMAP section 6, as the v6 hold: the first press arms it and says so, for 4 s) */
export function wireHold(b: HTMLElement): void {
  let timer = 0, held = false, armed = 0;
  const label = b.querySelector<HTMLElement>('.k7-chip__label, .k7-btn__label'), words = label?.textContent ?? '';
  const disarm = (): void => { clearTimeout(armed); armed = 0; b.removeAttribute('data-armed'); if (label && !held) label.textContent = words; };
  const commit = (): void => { if (!emit(b, 'ui:commit', undefined, true)) return; held = true; b.setAttribute('data-held', ''); };
  const ms = (): number => tokenMs('--dur-hold', 1000);
  const start = (): void => {
    if (held || (b as HTMLButtonElement).disabled) return;
    b.setAttribute('data-holding', '');
    clearTimeout(timer);
    timer = window.setTimeout(() => { b.removeAttribute('data-holding'); commit(); }, ms());
  };
  const stop = (): void => { clearTimeout(timer); b.removeAttribute('data-holding'); };
  b.addEventListener('pointerdown', (e) => { if (e.button === 0) start(); });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) b.addEventListener(t, stop);
  b.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !e.repeat) { e.preventDefault(); start(); return; }
    if (e.key !== 'Enter' || e.repeat || held || (b as HTMLButtonElement).disabled) return;
    e.preventDefault();
    if (armed) { disarm(); commit(); return; }
    b.setAttribute('data-armed', '');
    if (label) label.textContent = 'Press again to confirm';
    armed = window.setTimeout(disarm, 4000);
  });
  b.addEventListener('blur', () => { if (armed) disarm(); });
  b.addEventListener('keyup', (e) => { if (e.key === ' ') stop(); });
}
