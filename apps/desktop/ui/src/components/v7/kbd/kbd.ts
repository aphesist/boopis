/* Kbd: its view (typed props to markup) and its contract. Its look is kbd.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { isMac } from '../../../core/dom';
import { attrs, esc, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Kbd (27): in text (radius 4), in a pill (a pill) ── */
export interface KbdOpts { keys: string; inPill?: U<boolean>; attrs?: U<Attrs> }
/** the key names as a person reads them: ctrl K, and ⌘K on macOS */
export function keyNames(k: string): string[] {
  return k.split(/\s*\+\s*|\s+/).filter(Boolean).map((p) => {
    const l = p.toLowerCase();
    if (l === 'mod') return isMac ? '⌘' : 'ctrl';
    if (l === 'ctrl') return 'ctrl';
    if (l === 'shift') return isMac ? '⇧' : 'shift';
    if (l === 'alt') return isMac ? '⌥' : 'alt';
    if (l === 'enter') return 'Enter';
    if (l === 'esc' || l === 'escape') return 'esc';
    return p.length === 1 ? p.toUpperCase() : p;
  });
}
/** a binding as the keymap writes it ("mod+G L | g", "hold:space"): each alternative's chips, a sequence's steps with a quiet "then",
    a hold with "hold", the alternatives with "or" (Settings › Keyboard, 7a: read only) */
export function kbdSpec(spec: string): string {
  const word = (w: string): string => '<span class="k7-keyspec__word">' + w + '</span>';
  /* the chips are each a Kbd (one line each); the binding as a whole wraps between them in a narrow row */
  return '<span class="k7-keyspec"' + partAttrs('KbdSpec', {}) + '>' + spec.split(' | ').map((alt) => alt.split(' ').map((step) =>
    step.startsWith('hold:') ? word('hold') + kbd({ keys: step.slice(5) }) : kbd({ keys: step })).join(word('then'))).join(word('or')) + '</span>';
}
export function kbd(o: KbdOpts): string {
  return '<span class="k7-keys"' + attrs(o.attrs ?? {}) + '>' + keyNames(o.keys).map((n) => '<kbd class="k7-kbd"' + kitAttrs('Kbd', { 'data-in': o.inPill ? 'pill' : null }) + '>' + esc(n) + '</kbd>').join(' ') + '</span>';
}

/** what Kbd promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<KbdOpts>({
  name: 'Kbd',
  folder: 'kbd',
  layer: 'control',
  summary: 'Keys as chips: in text (radius 4) or in a pill. `kbdSpec` draws a whole binding as the keymap writes it: alternatives, sequences and holds.',
  exports: ['kbd', 'kbdSpec'],
  props: {
    keys: 'the keys, as the keymap writes them ("mod+K"); mod is ⌘ on macOS and ctrl elsewhere',
    inPill: 'inside a pill (a search field): the chip is a pill too',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-in'],
  parts: ['KbdSpec', 'k7-keys'],
  tokens: [
    '--fs-xs', '--gap-xs', '--hair', '--hl', '--hover', '--kbd-h', '--lh-xs', '--pad-kbd', '--r-pill', '--r-xs', '--sans',
    '--sp-2', '--sp-3', '--text-dim'
  ],
  a11y: 'Each key is a <kbd>; the chips are separated by spaces in the markup, so a reader says them as words.',
  boards: []
});
