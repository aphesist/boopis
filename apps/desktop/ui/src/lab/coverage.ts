/* What the lab must cover, for the coverage gate (coverage.test.ts). Every library component, card kind, form kind,
   surface and page has a story; every story has the minimum states. An exception is listed here with its reason;
   anything not listed fails the gate. docs/UI-LAB.md. */
import type { Tag } from './types';

/** `ui` members that are not components: helpers, data, behaviours with nothing of their own to draw */
export const NOT_COMPONENTS: Readonly<Record<string, string>> = {
  version: 'a string', html: 'the string templates: each is covered through its factory or as html.<name>', esc: 'escaping', icons: 'the icon names (drawn by the icon button story, "every icon")',
  announce: 'a live-region message, nothing visible', botState: 'a bot\'s state word as data', botLabel: 'an accessible name as data', states: 'the state table (drawn by the orb story, "states")',
  hydrate: 'wires markup that the stories already draw', liven: 'an orb\'s motion policy (orbs are drawn still in the lab)', glance: 'eye steps under reduced motion (behaviour)',
  shape: 'a cached token reader', scrollClass: 'the scroll area\'s class, drawn by components/scroll', listbox: 'drawn by components/listbox',
  squircle: 'the corner engine every story runs through (the concentric check reads its paths)'
};
/** html templates that are only strings (no factory), and why some need no story of their own */
export const HTML_ONLY_EXCUSED: Readonly<Record<string, string>> = {
  kbd: 'an alias of keys', switch: 'the switch factory covers it', orb: 'the orb factory covers it', model: 'the model factory covers it', modelRoute: 'the modelRoute factory covers it', modelMark: 'the modelMark factory covers it',
  menuItems: 'covered by the menu story (covers html.menuItems)', leadFor: 'covered by the row story', stateWord: 'covered by the row story', icon: 'covered by the icon button story'
};

/** surfaces: the app's places that are more than one component */
export const SURFACES: readonly string[] = [
  'dock', 'composer', 'sidebar', 'title-bar', 'palette', 'menus', 'popover', 'toasts', 'details-panel', 'keys-sheet',
  'settings', 'settings-general', 'settings-models', 'settings-providers', 'settings-connectors', 'settings-appearance', 'settings-keys', 'first-run',
  'council', 'bots-roster', 'bots-room', 'bots-sheet', 'bots-new', 'bots-group', 'bots-new-group'
];
/** where a mod draws (docs/MODS.md section 3) */
export const MOD_SURFACES: readonly string[] = ['band', 'status', 'pane', 'toast', 'theme-card', 'placed-row', 'log'];
/** whole-window layouts */
export const PAGES: readonly string[] = ['empty', 'conversation', 'live', 'bots', 'settings', 'first-run'];

/** the states every component and card story needs */
export const MIN_COMPONENT: readonly Tag[] = ['typical', 'long'];
/** components and cards where "empty" means something (nothing to show, no items, no value) */
export const EMPTY_APPLIES: readonly string[] = ['ui.composer', 'ui.row', 'ui.group', 'ui.chipGroup', 'ui.field', 'ui.menu', 'ui.ladder', 'ui.measure', 'ui.steps', 'ui.entry', 'ui.section', 'ui.blank', 'ui.code', 'ui.modView', 'ui.request', 'card:*', 'form:*'];
/** where "error" applies (a failure, an invalid value, an unknown model, a refused tree) */
export const ERROR_APPLIES: readonly string[] = ['ui.field', 'ui.chip', 'ui.capacity', 'ui.measure', 'ui.steps', 'ui.modelMark', 'ui.modView', 'card:approval', 'card:ship', 'card:escalation', 'card:error', 'card:connector', 'card:teammate', 'form:*'];
/** surfaces need a typical state and at least this many states */
export const MIN_SURFACE_STATES = 3;

/** stories excused from a minimum, by story id and tag, with the reason */
export const STATE_EXCUSED: Readonly<Record<string, Readonly<Partial<Record<Tag, string>>>>> = {
  'components/keys': { empty: 'a key needs a key' },
  'cards/form-theme': { error: 'a theme card cannot be invalid: Keep or Reject' },
  'cards/form-signin': { error: 'a sign-in has no field to get wrong; its failure is the host\'s' },
  'cards/form-connector': { error: 'an install has no field; its failure is the receipt' }
};
