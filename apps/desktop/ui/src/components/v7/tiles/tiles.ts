/* Tiles: its view (typed props to markup) and its contract. Its look is tiles.css, its behaviour behaviour.ts, its stories and tests stand
   beside it (docs/kit/RULES.md). */
import { chip } from '../chip/chip';
import { attrs, esc, glyph, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Tiles (the boopis bot's first-run cards, boards O-B02 and O-B03; ob3-screens.js teamCard, goalCard, ob2-screens.js tile): a Block of
   three columns. `goals`: tiles to pick, up to `max` (a glyph in a 28 circle, or once chosen the bot it gets; its name at the foot; chosen:
   the bot's colour as its line and a tenth of its ground), a head line with what is still free at its end, the foot's action and "n of 3".
   `bots`: each a bot over a chip of its job, the foot's action and a quiet line ── */
export interface Tile { label: string; value: string; /** a glyph of the kit's set in the tile's circle */ icon?: U<string>; /** what leads it in place of the glyph (an orb), trusted kit markup */ leadHTML?: U<string>; chosen?: U<boolean>; /** the colour a chosen tile takes (its bot's) */ colour?: U<string> }
export interface TilesOpts {
  variant?: U<'goals' | 'bots'>; tiles: readonly Tile[]; label: string;
  /** goals: the head line, and what stands at its end (the bots still free), trusted kit markup */ head?: U<string>; headEndHTML?: U<string>;
  /** goals: how many may be chosen */ max?: U<number>;
  /** the foot's action (a chip: on once it can be pressed) and the quiet words at the foot's end */ action: { label: string; on?: U<boolean>; value?: U<string> }; note?: U<string>;
  attrs?: U<Attrs>;
}
export function tiles(o: TilesOpts): string {
  const v = o.variant ?? 'goals';
  const cells = o.tiles.map((t) => v === 'bots'
    ? '<div class="k7-tiles__bot"' + partAttrs('TileBot', { 'data-value': t.value }) + '>' + (t.leadHTML ?? '') + chip({ label: t.label, attrs: { tabindex: '-1', 'aria-disabled': 'true', 'data-static': '' } }) + '</div>'
    : '<button class="k7-reset k7-tiles__tile"' + partAttrs('Tile', { type: 'button', 'aria-pressed': String(!!t.chosen), 'data-value': t.value, style: t.colour ? '--tile-bot:' + t.colour : null }) + '>' +
      '<span class="k7-tiles__lead" aria-hidden="true">' + (t.chosen && t.leadHTML ? t.leadHTML : '<span class="k7-tiles__ic">' + glyph(t.icon ?? 'dot') + '</span>') + '</span><span class="k7-tiles__name">' + esc(t.label) + '</span></button>').join('');
  const n = o.tiles.filter((t) => t.chosen).length;
  return '<div class="k7-tiles k7-block"' + kitAttrs('Tiles', { role: 'group', 'aria-label': o.label, 'data-variant': v, 'data-max': v === 'goals' ? String(o.max ?? 3) : null, 'data-sq': '', 'data-sq-mode': 'frame', ...(o.attrs ?? {}) }) + '>' +
    (v === 'goals' && o.head ? '<div class="k7-tiles__head"><span class="k7-ell">' + esc(o.head) + '</span>' + (o.headEndHTML ? '<span class="k7-tiles__free">' + o.headEndHTML + '</span>' : '') + '</div>' : '') +
    '<div class="k7-tiles__grid">' + cells + '</div>' +
    '<div class="k7-tiles__foot">' + chip({ label: o.action.label, variant: 'answer', chosen: o.action.on !== false, attrs: { 'data-tiles-act': o.action.value ?? 'next', ...(o.action.on === false ? { 'aria-disabled': 'true' } : {}) } }) +
    '<span class="k7-tiles__note"' + attrs({ 'aria-live': v === 'goals' ? 'polite' : null }) + '>' + esc(o.note ?? (v === 'goals' ? String(n) + ' of ' + String(o.max ?? 3) : '')) + '</span></div></div>';
}

/** what Tiles promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<TilesOpts>({
  name: 'Tiles',
  folder: 'tiles',
  layer: 'block',
  summary: 'A Block of three columns: goals to pick, up to three, each becoming its bot once chosen; or bots, each over a chip of its job. A foot with one action.',
  exports: ['tiles'],
  props: {
    variant: 'goals (the default: tiles to pick) or bots (a bot over its job)',
    tiles: 'each tile: its words, its value, its glyph or lead, chosen, the colour it takes once chosen',
    label: 'the group\'s accessible name',
    head: 'goals: the head line',
    headEndHTML: 'goals: what stands at the head\'s end (the bots still free)',
    max: 'goals: how many may be chosen (3)',
    action: 'the foot\'s chip: its words, on once it can be pressed, its value',
    note: 'the quiet words at the foot\'s end ("2 of 3" unless said)',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: ['ui:change'],
  states: ['aria-pressed', 'data-variant', 'data-max', 'aria-disabled'],
  parts: ['Tile', 'TileBot', 'k7-tiles__head', 'k7-tiles__foot'],
  tokens: [
    '--accent', '--bg-3', '--ctl-s', '--dur-1', '--dur-out', '--ease-out', '--fill-2', '--focus-w', '--fs-l', '--fs-s', '--fs-xs', '--gap-row',
    '--gap-s', '--hl', '--hover-ctl', '--icon', '--icon-s', '--lh-l', '--lh-xs', '--line', '--pad-block', '--pad-chip', '--r-bubble', '--r-pill',
    '--sp-2', '--sp-3', '--sp-4', '--text', '--text-dim', '--text-strong', '--tile-h'
  ],
  a11y: 'A group named by its label; a goal is a toggle button (aria-pressed), and a goal past the most that may be chosen is refused; the count is a polite live region.',
  boards: ['O-B02', 'O-B03', 'O-B03b']
});
