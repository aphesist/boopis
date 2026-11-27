/* HoverBar: its view (typed props to markup) and its contract. Its look is hover-bar.css, its stories and tests stand beside it, its behaviour is behaviour.ts
   (docs/kit/RULES.md). */
import { iconButton } from '../icon-button/icon-button';
import { kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── HoverBar: what a turn offers while the pointer or the focus is on it (board 11's `.hoverbar`: copy, more), beside its last bubble
   on that bubble's middle. One part for every thread: a bot's message, a room's member, a session's answer. Each action is a ghost
   IconButton carrying `data-act`; a press fires `ui:act` {value, el} on the bar (wire.ts) ── */
export interface HoverAction { value: string; icon: string; /** its accessible name ("Copy kai's message") */ label: string; /** the tip, when shorter than the name ("Copy") */ tip?: U<string>; keys?: U<string>; /** it opens a menu */ menu?: U<boolean> }
export interface HoverBarOpts { /** the group's name ("Actions on kai's message") */ label: string; actions: readonly HoverAction[]; attrs?: U<Attrs> }
export function hoverBar(o: HoverBarOpts): string {
  return '<div class="k7-hoverbar"' + kitAttrs('HoverBar', { role: 'group', 'aria-label': o.label, ...(o.attrs ?? {}) }) + '>' +
    o.actions.map((a) => iconButton({ icon: a.icon, label: a.label, tip: a.tip ?? a.label, variant: 'ghost', keys: a.keys, haspopup: a.menu ? 'menu' : undefined, attrs: { 'data-act': a.value } })).join('') + '</div>';
}

/** what HoverBar promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<HoverBarOpts>({
  name: 'HoverBar',
  folder: 'hover-bar',
  layer: 'thread',
  summary: 'What a turn offers while the pointer or the focus is on it: ghost IconButtons beside its last bubble, on that bubble\'s middle.',
  exports: ['hoverBar'],
  props: {
    label: 'the group\'s accessible name ("Actions on kai\'s message")',
    actions: 'its actions: a value, a glyph, a name, a tip, keys, whether it opens a menu',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: ['ui:act'],
  states: [],
  parts: ['k7-hoverrow'],
  tokens: ['--bubble-max', '--dur-1', '--ease-out', '--focus-w', '--gap-hair', '--gap-s', '--icon-quiet', '--sp-2'],
  a11y: 'role="group" named for the message; each action is a named IconButton, and it shows on focus as well as hover.',
  boards: []
});
