/* Switch: its view (typed props to markup) and its contract. Its look is switch.css, its stories and tests stand beside it, its behaviour is behaviour.ts
   (docs/kit/RULES.md). */
import { attrs, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Switch (25): on (accent), off, focus, disabled ── */
export interface SwitchOpts { checked?: U<boolean>; disabled?: U<boolean>; label?: U<string>; labelledby?: U<string>; id?: U<string>; attrs?: U<Attrs> }
export function switchHTML(o: SwitchOpts): string {
  return '<button class="k7-reset k7-switch"' + kitAttrs('Switch') + attrs({ type: 'button', role: 'switch', 'aria-checked': String(!!o.checked), disabled: !!o.disabled, 'aria-label': o.labelledby ? null : o.label, 'aria-labelledby': o.labelledby, id: o.id, ...(o.attrs ?? {}) }) + '><span class="k7-switch__knob" aria-hidden="true"></span></button>';
}

/** what Switch promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<SwitchOpts>({
  name: 'Switch',
  folder: 'switch',
  layer: 'control',
  summary: 'On or off, applied at once: the accent with a white knob when on.',
  exports: ['switch'],
  props: {
    checked: 'it is on',
    disabled: 'it cannot be changed now',
    label: 'its accessible name, where no visible label names it',
    labelledby: 'the id of the visible words that name it',
    id: 'its id',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: ['ui:change'],
  states: ['aria-checked', 'disabled'],
  parts: ['k7-switch__knob'],
  tokens: [
    '--accent', '--dur-1', '--dur-slide', '--ease-out', '--fill-4', '--gap-hair', '--hl', '--icon-off', '--knob', '--knob-d',
    '--knob-sh', '--line-strong', '--on-accent', '--r-pill', '--selected-off', '--spring', '--switch-h', '--switch-w',
    '--track-off'
  ],
  a11y: 'role="switch" on a native <button>; Space and Enter toggle it, and it says on or off.',
  boards: []
});
