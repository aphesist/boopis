/* What the lab must cover, for the coverage gate (coverage.test.ts). Every library component, card kind, form kind,
   surface and page has a story; every story has the minimum states. An exception is listed here with its reason;
   anything not listed fails the gate. docs/UI-LAB.md. */
import type { Tag } from './types';

/** the engines the kit draws with (named exports of `@boopis/ui` that draw something of their own: the v6 library went at step 2b),
    each covered as engine:<name> by a story */
export const ENGINES: readonly string[] = ['orb', 'stack', 'model-mark', 'markdown', 'card'];

/** surfaces: the app's places that are more than one component */
export const SURFACES: readonly string[] = [
  'dock', 'composer', 'sidebar', 'title-bar', 'palette', 'menus', 'popover', 'notices', 'details-panel', 'keys-sheet',
  'settings', 'settings-general', 'settings-models', 'settings-providers', 'settings-connectors', 'settings-appearance', 'settings-keys', 'first-run', 'startup-notice',
  'store', 'store-detail', 'store-review', 'store-installed', 'store-sources', 'store-dialog',
  'council', 'bots-roster', 'bots-rail', 'bots-room', 'bots-sheet', 'bots-new', 'bots-group', 'bots-kanban', 'bots-new-group'
];
/** where a mod draws (docs/MODS.md section 3) */
export const MOD_SURFACES: readonly string[] = ['band', 'status', 'pane', 'notice', 'theme-card', 'placed-row', 'log'];
/** whole-window layouts */
export const PAGES: readonly string[] = ['empty', 'conversation', 'live', 'bots', 'settings', 'first-run'];

/** the states every component and card story needs */
export const MIN_COMPONENT: readonly Tag[] = ['typical', 'long'];
/** components and cards where "empty" means something (nothing to show, no items, no value) */
export const EMPTY_APPLIES: readonly string[] = ['card:*', 'form:*'];
/** where "error" applies (a failure, an invalid value, an unknown model, a refused tree) */
export const ERROR_APPLIES: readonly string[] = ['engine:model-mark', 'card:approval', 'card:connector', 'form:*'];
/** surfaces need a typical state and at least this many states */
export const MIN_SURFACE_STATES = 3;

/** stories excused from a minimum, by story id and tag, with the reason */
export const STATE_EXCUSED: Readonly<Record<string, Readonly<Partial<Record<Tag, string>>>>> = {
  'cards/form-theme': { error: 'a theme card cannot be invalid: Keep or Reject' },
  'cards/form-permission': { error: 'a permission is the AskCard: it has no field to get wrong' },
  'cards/form-signin': { error: 'a sign-in has no field to get wrong; its failure is the host\'s' },
  'cards/form-connector': { error: 'an install has no field; its failure is the receipt' }
};
