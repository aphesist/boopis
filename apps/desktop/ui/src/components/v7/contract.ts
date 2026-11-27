/* A component's contract (docs/kit/RULES.md): what the component promises, written once beside its view as a typed const, so the docs
   and the tests read the same thing. Every folder of the kit exports one:

     export const contract = defineContract<ButtonOpts>({ name: 'Button', ... });

   `props` must describe every prop of the component's options type (the compiler says which one is missing), `events` may only name
   events of the kit's event map (events.ts), and the contract test (contract.test.ts) checks the rest against the code: every token is
   one the v7 token sheet declares, every board one the lab compares (tests/lab/boards.json), every part drawn, and every function of
   `kit.html` owned by exactly one contract. */
import type { UiEventName } from './events';

/** where a component stands in the kit's order, which is the order the docs teach it in (each layer builds on the ones before) */
export const LAYERS = ['control', 'inline', 'row', 'block', 'surface', 'thread', 'compose', 'dock', 'notify'] as const;
export type Layer = typeof LAYERS[number];

export interface Contract<P = Record<string, unknown>> {
  /** the public name: the component's `data-kit` and its heading in the docs */
  name: string;
  /** its folder under components/v7/, kebab-case */
  folder: string;
  /** one or two plain sentences: what it is for */
  summary: string;
  layer: Layer;
  /** the functions of `kit.html` this folder owns: the component and the parts the app may draw on their own */
  exports: readonly string[];
  /** every prop, with what it does */
  props: { readonly [K in keyof P]-?: string };
  /** the events it dispatches on its root (events.ts) */
  events: readonly UiEventName[];
  /** where its state lives on the element: the ARIA and data attributes that say it (R-state-2) */
  states: readonly string[];
  /** its named parts (`data-kit-part`) and other pieces with a name of their own */
  parts: readonly string[];
  /** the v7 tokens its CSS reads (tokens.v7.css) */
  tokens: readonly `--${string}`[];
  /** how a person using a keyboard or a screen reader meets it */
  a11y: string;
  /** the approved boards the lab compares it on (tests/lab/boards.json ids, or their number: "14" for "14-settings") */
  boards: readonly string[];
}

/** a contract, checked against the component's options type `P`: `defineContract<ButtonOpts>({ … })` */
export function defineContract<P>(c: Contract<P>): Contract<P> { return c; }
