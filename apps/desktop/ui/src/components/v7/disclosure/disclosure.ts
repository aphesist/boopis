/* Disclosure: its view (typed props to markup) and its contract. Its look is disclosure.css, its stories and tests stand beside it, its behaviour is behaviour.ts
   (docs/kit/RULES.md). */
import { statusWord } from '../status-word/status-word';
import { attrs, esc, glyph, idFrom, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Disclosure (36): steps ("Read 6 files"), work log ("Worked for 59s: ..."): the boards' `.worklog` (kit.css): a chevron that turns down
   when it opens, then the summary ── */
export interface StepOpts {
  text: string; /** `log`: a line of a work log (board S10), led by its kind's glyph (`icon`) in the words' own colour */ state?: U<'done' | 'now' | 'todo' | 'failed' | 'log'>; icon?: U<string>; time?: U<string>;
  /** what became of it, after its words (the kit's StatusWord, red): "failed" */ word?: U<string>;
}
export function steps(items: readonly StepOpts[], id?: string): string {
  return '<ol class="k7-steps"' + partAttrs('Steps', { id }) + '>' + items.map((s) => '<li class="k7-step" data-state="' + (s.state ?? 'done') + '">' +
    '<span class="k7-step__ic" aria-hidden="true">' + (s.icon ? glyph(s.icon) : s.state === 'done' || !s.state ? glyph('check') : s.state === 'failed' ? glyph('close') : '<span class="k7-step__dot"' + (s.state === 'now' ? ' data-live' : '') + '></span>') + '</span>' +
    '<span class="k7-step__text">' + esc(s.text) + '</span>' + (s.word ? statusWord({ text: s.word, tone: 'red' }) : '') + (s.time ? '<span class="k7-step__time k7-mono">' + esc(s.time) + '</span>' : '') + '</li>').join('') + '</ol>';
}
export interface DisclosureOpts {
  summary: string; variant?: U<'steps' | 'worklog'>; open?: U<boolean>; steps?: U<readonly StepOpts[]>; attrs?: U<Attrs>;
  /** what follows its steps when it is open, as markup: a work log's output (a Well), what a list of parts can do (a Button) */ after?: U<string>;
}
export function disclosure(o: DisclosureOpts): string {
  const id = idFrom('k7-dc', o.summary);
  return '<div class="k7-disc"' + kitAttrs('Disclosure', { 'data-variant': o.variant ?? 'steps', 'data-disclose': '', 'data-open': o.open ? '' : null, ...(o.attrs ?? {}) }) + '>' +
    '<button class="k7-reset k7-disc__sum" type="button"' + attrs({ 'aria-expanded': String(!!o.open), 'aria-controls': id }) + '>' + glyph('chevron', 'k7-disc__chev') + '<span class="k7-ell">' + esc(o.summary) + '</span></button>' +
    '<div class="k7-disc__body" id="' + id + '">' + (o.steps?.length || !o.after ? steps(o.steps ?? []) : '') + (o.after ? '<div class="k7-disc__after">' + o.after + '</div>' : '') + '</div></div>';
}

/** what Disclosure promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<DisclosureOpts>({
  name: 'Disclosure',
  folder: 'disclosure',
  layer: 'block',
  summary: 'A summary that opens its steps: "Read 6 files", or a work log ("Worked for 59s"). The chevron leads and turns down when it opens.',
  exports: ['disclosure', 'steps'],
  props: {
    summary: 'the words of its summary',
    variant: 'steps (the default) or worklog',
    open: 'open',
    steps: 'its steps: words, a state (done, now, todo, failed, log), a glyph, a time, a word',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    after: 'what follows the steps when it is open, as markup'
  },
  events: ['ui:toggle'],
  states: ['aria-expanded', 'data-open', 'data-variant'],
  parts: ['Steps', 'k7-disc__sum', 'k7-disc__body'],
  tokens: [
    '--ctl-s', '--dur-1', '--dur-breathe', '--ease-io', '--ease-sharp', '--focus-w', '--fs-2xs', '--fs-s', '--gap-hair', '--gap-s',
    '--icon-s', '--lh-m', '--mark-off', '--ok-text', '--r-pill', '--r-xs', '--red-text', '--sp-2', '--step-dot', '--text',
    '--text-dim', '--text-quiet', '--track-s'
  ],
  a11y: 'The summary is a <button> with aria-expanded and aria-controls; the steps are an ordered list.',
  boards: []
});
