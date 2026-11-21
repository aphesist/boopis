/* boopis shared component library (v6 `HX.ui`), one module per primitive:
     html            string templates for modules that build innerHTML
     the factories   button, iconButton, segmented, chip, row, group, ... -> an element, already wired
     hydrate(root)   wires every [data-ui] element under root once
     select (the themed select), listbox (its list: a chip's picker), modelEntries, menu, popover, layer, tooltip, toast, hold, composer, orb, liven, glance, announce, shape, squircle, modelMark, icon, botState
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
import type { ChildOpts } from './child';
import { composer } from './composer';
import { holdElement, wireHold } from './hold';
import { html } from './html';
import type { ButtonOpts, ChipOpts, EntryOpts, FieldOpts, IconButtonOpts, LadderOpts, MeasureOpts, MeasurePart, RowOpts, SegmentedOpts, StepItem } from './html';
import { icon, iconNames } from './icons';
import { layer, menu, popover } from './layer';
import { isRoute, lastModel, modelFamily, modelHTML, modelMark as modelMarkEl, parseRoute, routeHTML, swapMark, families as modelFamilies } from './model-mark';
import type { ModelOpts, ModelRef } from './model-mark';
import { modView, modViewUpdate, h as modH, sanitizeSvg, validateTree, LIMITS as MOD_LIMITS, modColors } from './mod-view';
import { glance, liven, orb } from './orb';
import { listbox, wireSelect } from './select';
import type { SelectElement } from './select';
import { modelEntries } from './select-html';
import { aliasOf, canon, modelName, providerName, sameModel, splitRef } from './model-name';
import type { SelectEntry, SelectGroup, SelectOpts, SelectOption } from './select-html';
import { shape } from './shape';
import { squircle } from './squircle';
import { toast } from './toast';
import type { SigninButtonOpts } from './signin-button';
import { tooltip } from './tooltip';
import { hydrate, hydrateOne } from './wire';
import { scrollClass } from './scroll';
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
  scroll: make<Parameters<typeof html.scroll>[0]>(html.scroll),
  tabs: make<Parameters<typeof html.tabs>[0], SegElement>(html.tabs),
  search: make<Parameters<typeof html.search>[0]>(html.search),
  field: make<FieldOpts>(html.field),
  select: make<SelectOpts, SelectElement>(html.select),
  empty: make<Parameters<typeof html.empty>[0]>(html.empty),
  row: make<RowOpts, HTMLLIElement>(html.row),
  group: make<Parameters<typeof html.group>[0]>(html.group),
  child: make<ChildOpts, HTMLElement>(html.child),
  signinButton: make<SigninButtonOpts, HTMLButtonElement>(html.signinButton)
};
const legend = (parts: readonly MeasurePart[], fmt?: (n: number) => string): HTMLElement => frag(html.legend(parts, fmt));
const keys = (k: string): HTMLElement => frag(html.keys(k));
const inline = (text: string): HTMLSpanElement => { const s = document.createElement('span'); s.innerHTML = html.inline(text); return s; };

/** `ui.modelMark(ref, opts)` draws a provider mark; its properties read the family from a model id */
const modelMark = Object.assign(modelMarkEl, { called: modelName, provider: providerName, same: sameModel, split: splitRef, canon, aliasOf, family: modelFamily, parse: parseRoute, last: lastModel, isRoute, swap: swapMark, families: modelFamilies });
const model = (ref: ModelRef, o?: ModelOpts): HTMLElement => frag(modelHTML(ref, o));
const modelRoute = (text: string, o?: ModelOpts): HTMLElement => frag(routeHTML(text, o));

export const ui = {
  version, html, esc, icon, icons: iconNames, announce, botState, botLabel, states: STATES,
  ...factories, legend, keys, inline, scrollClass,
  hydrate, orb, liven, glance, shape, squircle, modelMark, model, modelRoute, menu, popover, layer, listbox, modelEntries, wireSelect, tooltip, toast, composer, card,
  hold: Object.assign(holdElement, { wire: wireHold }),
  /** a Claude Code mod's element tree, drawn with the library (MODS.md section 2) */
  modView: Object.assign(modView, { update: modViewUpdate, validate: validateTree, limits: MOD_LIMITS, sanitizeSvg, h: modH, colors: modColors })
};
export type Ui = typeof ui;
export { html, icon, hydrate, hydrateOne, wireSelect, announce, botState, botLabel, orb, liven, glance, shape, squircle, modelMark, menu, popover, layer, listbox, modelEntries, tooltip, toast, composer, card, wireHold, holdElement };
export type { SegElement } from './wire';
export { fileChip } from './composer';
export type { FileChipOpts } from './composer';
/* runtime pieces the app's modules and host wire (the orbs' engine, the card layer's factory, the first run's moments) */
export { oc, startGlance } from './orb';
export type { OrbOpts } from './orb';
export { holdOutsideDock, releaseOutsideDock } from './orb-runtime';
export { orbState, setupOrbs } from './orb-worker/host';
export { setCardFactory } from './card-registry';
export type { CardFactory, CardSize } from './card-registry';
export { holdOf } from './hold';
export { isKnownModel } from './model-mark';
export { modViewUpdate } from './mod-view';
export type { ModEvent, ModRoot } from './mod-view';
export { MARK, parseLiteral, setTokenReader } from './mod-colors';
export { welcomeLogo } from './logo';
export { BRANDS as SIGNIN_BRANDS_DEF, SIGNIN_BRANDS, signinLabel } from './signin-button';
export type { SigninBrand, SigninButtonOpts } from './signin-button';
export { progressDots, setProgress } from './progress';
export { kbd, keys as keyChips, combo, comboKbds, keysVariants } from './kbd';
export type { KeysOpts } from './kbd';
/* every component's variants, for the UI lab's stories (variants.ts) */
export { variants } from './variants';
export type { ComponentName } from './variants';
export type { InputOpts, BadgeOpts } from './html';
export type { SelectElement, ListboxOpts } from './select';
export type { SelectEntry, SelectGroup, SelectOpts, SelectOption };
export { scroll, scrollClass, scrollVariants, SCROLL_AXES } from './scroll';
export { tabs, tabsVariants, fitTabs } from './tabs';
export { search, searchVariants, SEARCH_SIZES } from './search';
export type { SearchOpts, SearchSize } from './search';
export type { TabDef, TabsOpts } from './tabs';
export { CHILD_STATUSES, STATUS_WORD as CHILD_STATUS_WORDS } from './child';
export type { ChildOpts, ChildStatus } from './child';
export type { ScrollAxis, ScrollOpts, ScrollHtmlOpts } from './scroll';
export type { ComposerEl, ComposerOpts, DecisionDetail, AssumptionDetail, DictateDetail, SendDetail } from './composer';
export type { PageDef, MenuEntry, MenuItem, StepItem, LadderOpts, MeasurePart, Station, CallLine } from './html';
export type { ModelRef, ModelOpts, MarkOpts, ModelFamily } from './model-mark';
export type { BotLike } from './bot-state';
export type { CardKind, CardOpts, CardLike, CardData } from './card-registry';
