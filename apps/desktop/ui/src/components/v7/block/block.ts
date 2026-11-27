/* Block: its view (typed props to markup) and its contract. Its look is block.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { esc, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Block (7): every inline surface that holds controls: radius 22, padding 8, 28 px controls on the 8 inset, text 4 more ── */
export interface BlockOpts {
  body: string; attrs?: U<Attrs>;
  /** `offer` (board S37's `.ns-hello`): what is missing, said kindly in one centred sentence, over the row of ways to get it (`actions`,
      kit Buttons as markup) */ variant?: U<'offer'>; text?: U<string>; actions?: U<string>;
}
export function block(o: BlockOpts): string {
  const body = o.variant === 'offer' ? '<p class="k7-type-s k7-block__say">' + esc(o.text ?? '') + '</p><div class="k7-block__ways">' + (o.actions ?? '') + '</div>' + o.body : o.body;
  return '<div class="k7-block"' + kitAttrs('Block', { 'data-sq': '', 'data-sq-mode': 'frame', 'data-variant': o.variant ?? null, ...(o.attrs ?? {}) }) + '>' + body + '</div>';
}

/** what Block promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<BlockOpts>({
  name: 'Block',
  folder: 'block',
  layer: 'block',
  summary: 'Every inline surface that holds controls: radius 22, padding 8, 28 px controls on the 8 inset, text 4 more. `offer` says what is missing in one sentence over the ways to get it.',
  exports: ['block'],
  props: {
    body: 'what it holds, as kit markup',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    variant: 'offer: a centred sentence over a row of Buttons',
    text: 'offer: the sentence',
    actions: 'offer: the Buttons, as markup'
  },
  events: [],
  states: ['data-variant'],
  parts: ['k7-block__say', 'k7-block__ways'],
  tokens: [
    '--bg-3', '--gap-row', '--gap-s', '--hl', '--line', '--offer-w', '--pad-block', '--pad-chip', '--pad-text', '--r-block',
    '--sp-4', '--text-dim'
  ],
  a11y: 'A plain container; what it holds names itself.',
  boards: []
});
