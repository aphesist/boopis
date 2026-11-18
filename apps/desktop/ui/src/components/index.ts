/* hypotaxis shared component library (v6 `HX.ui`), one module per primitive:
     html            string templates for modules that build innerHTML
     the factories   button, iconButton, segmented, chip, row, group, ... -> an element, already wired
     hydrate(root)   wires every [data-ui] element under root once
     menu, popover, layer, tooltip, toast, hold, composer, orb, liven, glance, announce, shape, icon, botState
   Events bubble from the element and are cancelable where an action follows:
     'ui:change' {value}  segmented, switch, chip, option group
     'ui:commit'          hold to approve finished
     'ui:select' {value, item}  menu item, row
     'ui:send' {text}     composer;  'ui:stop' composer while running;  'ui:decision' {kind, text, el} feedforward mark
   No colour, family or size lives here: everything visual is in components.css. */
import { esc, frag } from '../core/dom';
import { announce } from './announce';
import { botLabel, botState, STATES } from './bot-state';
import { card } from './card-registry';
import { composer } from './composer';
import { holdElement, wireHold } from './hold';
import { html } from './html';
import type { ButtonOpts, ChipOpts, EntryOpts, FieldOpts, IconButtonOpts, LadderOpts, MeasureOpts, MeasurePart, RowOpts, SegmentedOpts, StepItem } from './html';
import { icon, iconNames } from './icons';
import { layer, menu, popover } from './layer';
import { glance, liven, orb } from './orb';
import { shape } from './shape';
import { toast } from './toast';
import { tooltip } from './tooltip';
import { hydrate, hydrateOne } from './wire';
import type { SegElement } from './wire';

export const version = '1.0.0';

/** build an element from a template and wire it */
function make<O, E extends HTMLElement = HTMLElement>(fn: (o: O) => string): (o: O) => E {
  return (o: O): E => { const el = frag<E>(fn(o)); hydrateOne(el); return el; };
}

const factories = {
  button: make<ButtonOpts, HTMLButtonElement>(html.button),
  iconButton: make<IconButtonOpts, HTMLButtonElement>(html.iconButton),
  send: make<{ running?: boolean; disabled?: boolean } | undefined, HTMLButtonElement>((o) => html.send(o ?? {})),
  switch: make<Parameters<typeof html.switch>[0], HTMLInputElement>(html.switch),
  segmented: make<SegmentedOpts, SegElement>(html.segmented),
  chip: make<ChipOpts, HTMLButtonElement>(html.chip),
  chipGroup: make<Parameters<typeof html.chipGroup>[0]>(html.chipGroup),
  stamp: make<string>((t) => html.stamp(t)),
  dot: make<{ kind?: string }>((o) => html.dot(o.kind)),
  code: make<string>(html.code),
  capacity: make<{ spent: string; cap: string }>((o) => html.capacity(o.spent, o.cap)),
  ladder: make<LadderOpts>(html.ladder),
  measure: make<MeasureOpts>(html.measure),
  pages: make<Parameters<typeof html.pages>[0]>(html.pages),
  request: make<string>(html.request),
  entry: make<EntryOpts, HTMLElement>(html.entry),
  disclosure: make<Parameters<typeof html.disclosure>[0], HTMLButtonElement>(html.disclosure),
  steps: make<{ items: readonly StepItem[]; id?: string; hidden?: boolean }, HTMLOListElement>((o) => html.steps(o.items, o)),
  blank: make<{ answer?: string } | undefined, HTMLButtonElement>((o) => html.blank(o ?? {})),
  section: make<Parameters<typeof html.section>[0]>(html.section),
  field: make<FieldOpts>(html.field),
  empty: make<Parameters<typeof html.empty>[0]>(html.empty),
  row: make<RowOpts, HTMLLIElement>(html.row),
  group: make<Parameters<typeof html.group>[0]>(html.group)
};
const legend = (parts: readonly MeasurePart[], fmt?: (n: number) => string): HTMLElement => frag(html.legend(parts, fmt));
const keys = (k: string): HTMLElement => frag(html.keys(k));
const inline = (text: string): HTMLSpanElement => { const s = document.createElement('span'); s.innerHTML = html.inline(text); return s; };

export const ui = {
  version, html, esc, icon, icons: iconNames, announce, botState, botLabel, states: STATES,
  ...factories, legend, keys, inline,
  hydrate, orb, liven, glance, shape, menu, popover, layer, tooltip, toast, composer, card,
  hold: Object.assign(holdElement, { wire: wireHold })
};
export type Ui = typeof ui;
export { html, icon, hydrate, hydrateOne, announce, botState, botLabel, orb, liven, glance, shape, menu, popover, layer, tooltip, toast, composer, card, wireHold, holdElement };
export type { SegElement } from './wire';
export type { ComposerEl, ComposerOpts, DecisionDetail, AssumptionDetail, DictateDetail, SendDetail } from './composer';
export type { PageDef, MenuEntry, MenuItem, StepItem, LadderOpts, MeasurePart, Station } from './html';
export type { BotLike } from './bot-state';
export type { CardKind, CardOpts, CardLike, CardData } from './card-registry';
