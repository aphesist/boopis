/* The UI lab's story format (docs/UI-LAB.md). A story is data: an id, the area that owns it, what it covers (library
   components by their public name, card kinds, surfaces, pages) and its named states. A state either renders on the
   lab's stage (components and cards: `render`) or boots the whole app on a provider and drives it (`app`: surfaces
   and pages). Nothing here imports the app: stories reach it through `kit.ts` and the contexts below. */
import type { Ui } from '@boopis/ui';
import type { DataProvider } from '../data/provider';
import type { DockApi } from '../core/registry';

/** the fix agents' areas; `pnpm lab:check --area <id>` runs one */
export type Area = 'components' | 'composer' | 'shell' | 'settings' | 'bots' | 'cards' | 'dock' | 'store';
export const AREAS: Readonly<Record<Area, string>> = {
  components: 'Components (the HX.ui primitives)',
  composer: 'Conversation and composer',
  shell: 'Shell (sidebar, palette, menus, toasts)',
  settings: 'Settings and first run',
  bots: 'Bots',
  cards: 'Cards, forms and mods',
  dock: 'Dock',
  store: 'Store'
};
export type StoryKind = 'component' | 'card' | 'surface' | 'page';

/** what a state shows; the coverage gate counts them (`coverage.ts`) */
export type Tag =
  | 'empty' | 'typical' | 'long' | 'many' | 'single'
  | 'loading' | 'error' | 'disabled' | 'expired' | 'success'
  | 'variant' | 'size' | 'rtl' | 'owner' | 'scroll'
  | 'hover' | 'focus' | 'active' | 'tooltip' | 'open';

export type Forced = 'hover' | 'focus' | 'active';
/** a pseudo-state forced on the elements a selector matches (the lab rewrites :hover, :focus-visible, :active into attributes) */
export interface Force { sel: string; state: Forced }

/** the v6 mock's counterpart: a page under design/v6, optionally an element to crop to */
export interface MockRef { url: string; crop?: string; note?: string }

/** an interaction the stability check samples frame by frame: nothing may be replaced, flicker or jump */
export interface Interaction {
  name: string;
  steps: ReadonlyArray<{ do: 'hover' | 'click' | 'dblclick' | 'focus' | 'press' | 'move-away' | 'wait' | 'call'; sel?: string; key?: string; ms?: number; /** for `call`: an expression run in the frame (`__lab.hx` is the app) */ js?: string }>;
  /** how long to sample after the last step (ms) */
  sample?: number;
  /** what to watch (defaults to the story's scope) */
  watch?: string;
}

export type Render = (ctx: StageCtx) => void | Promise<void>;
export interface StageCtx {
  /** the cell the state draws into */
  root: HTMLElement;
  ui: Ui;
  wait(ms: number): Promise<void>;
}
export interface LabHx {
  state: Record<string, unknown>;
  setState(patch: Record<string, unknown>): void;
  emit(type: string, detail?: unknown): void;
  ui: Ui;
  theme: { preset(id: string): void };
  data(): DataProvider;
  dock(): DockApi | null;
}
export interface AppCtx {
  hx: LabHx;
  app: HTMLElement;
  wait(ms: number): Promise<void>;
  /** clicks the first element a selector matches (throws when there is none, so a broken story is loud) */
  click(sel: string): Promise<void>;
  /** a key on the focused element, as a user would press it */
  key(key: string, init?: KeyboardEventInit): Promise<void>;
  $(sel: string): HTMLElement;
}

/** which provider an app state boots on (`provider.ts`) */
export interface ProviderSpec {
  /** the mock, with `BOT_FIXTURES` names added (long, outside) */
  fixtures?: readonly string[];
  /** replace the roster: 0 (no bots), 1, or many (generated, `many` bots) */
  bots?: 'none' | 'one' | number;
  /** no sessions: the empty app */
  sessions?: 'none' | number;
  /** the live provider over recorded gateway frames (tests/fixtures/frames/<name>.frames.json): real data */
  replay?: string;
  simulate?: boolean;
  /** a last change to the provider */
  patch?(p: DataProvider): DataProvider;
}

export interface State {
  tags: readonly Tag[];
  note?: string;
  /** draws on the stage (components, cards) */
  render?(ctx: StageCtx): void | Promise<void>;
  /** boots the app (surfaces, pages) */
  app?: { provider?: ProviderSpec; setup?(ctx: AppCtx): void | Promise<void> };
  /** the stage cell's width in px (else the window less the stage padding) */
  width?: number;
  /** the stage's ground: the conversation's (default), the frame's, or the dock's black */
  ground?: 'ground' | 'frame' | 'dock' | 'raised';
  /** pseudo-states forced on part of the state */
  force?: readonly Force[];
  /** interactions the stability check samples */
  interact?: readonly Interaction[];
  /** an overlay that should be open: the overlay check reads it */
  overlay?: { anchor: string; layer: string };
  /** checks this state is excused from, each with the reason (shown in the report): a string excuses the whole check, an
      `Allowance` with `el` only the findings whose element description contains that text (one element, not the state) */
  allow?: Readonly<Partial<Record<CheckId, Allowance>>>;
  /** the element the checks look at, overriding the story's */
  scope?: string;
  mock?: MockRef;
  /** right to left */
  dir?: 'rtl';
}

export interface Story {
  id: string;
  title: string;
  area: Area;
  kind: StoryKind;
  /** what this story covers: `ui.<name>` library components, `card:<kind>`, `form:<kind>`, `surface:<id>`, `page:<id>`, `mod:<surface>` */
  covers: readonly string[];
  /** what the checks look at in an app state (a stage state is checked as its cell) */
  scope?: string;
  mock?: MockRef;
  states: Readonly<Record<string, State>>;
}

export type CheckId =
  | 'geometry.contain' | 'geometry.center' | 'geometry.clip' | 'geometry.hscroll' | 'geometry.target'
  | 'concentric' | 'overlay' | 'tokens.computed' | 'native' | 'scrollbar' | 'axe'
  | 'tokens.spacing' | 'roles' | 'copy' | 'brand'
  | 'stability.render' | 'stability.interact' | 'visual' | 'errors';

/** an excuse for one check: the reason alone (the whole check, for the whole state), or the reason and the text the
    finding's element description must contain (`el`, matched against the report's selector, e.g. `ui-pages__dot`; for axe,
    the target and the rule's id, e.g. `label-content-name-mismatch`) */
export type Allowance = string | { readonly reason: string; readonly el: string };
