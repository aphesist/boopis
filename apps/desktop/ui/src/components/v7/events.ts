/* The v7 kit's events: props go down, events come up (docs/kit/RULES.md). A component is drawn from its props; what a person does to
   it comes back as one of these events, dispatched on the component's root. Every event bubbles, so a screen listens once on a
   container (`on(root, 'ui:change', …)`); the ones an action follows are cancelable, and a listener that calls preventDefault() keeps
   the component as it was (a Switch stays off, a Segmented keeps its item, the composer keeps its text).

   This map is the one list of what the kit dispatches. A component's contract names the events it fires (contract.ts), and the
   contract test checks that each one is here. */
import { fire } from '../../core/dom';

/** event name → its detail. `undefined` is an event that says only that it happened */
export interface UiEvents {
  /** a choice changed: a Segmented's item (its value), a Switch, a filter Chip or a check Row (on or off). Cancelable */
  'ui:change': { value: string | boolean };
  /** a hold finished: the press was held for --dur-hold (1 s), or Enter was pressed twice. Cancelable */
  'ui:commit': undefined;
  /** a Disclosure, a danger Card, a FilesCard or a folding DiffView opened or closed. Cancelable */
  'ui:toggle': { open: boolean };
  /** a row of a floating Menu was chosen (`kit.openMenu`). Cancelable */
  'ui:select': { value: string };
  /** an action of a HoverBar was pressed; `el` is its button, what a menu opens against */
  'ui:act': { value: string; el: HTMLElement };
  /** the composer sends its text; `queue` while a turn runs. Cancelable: cancelled, the text stays */
  'ui:send': { text: string; queue: boolean };
  /** ctrl Enter: the text steers the running turn. Cancelable */
  'ui:steer': { text: string; queue: boolean };
  /** the composer's Stop was pressed while a turn runs */
  'ui:stop': Record<string, never>;
  /** the voice circle was pressed with no text; `setup`: no voice model is set up yet */
  'ui:voice': { setup: boolean };
  /** the composer's "+" was pressed (the app picks what to add) */
  'ui:add': Record<string, never>;
  /** the mic was switched on or off: `toggle` by a press or alt+V, `hold` while held (null when it goes off). Cancelable */
  'ui:dictate': { on: boolean; mode: 'toggle' | 'hold' | null };
  /** the mic was pressed in a build with no dictation: nothing started */
  'ui:dictate-unavailable': Record<string, never>;
  /** files were dropped on the composer or pasted into it */
  'ui:files': { files: File[]; via: 'drop' | 'paste' };
  /** Enter while a turn runs where nothing queues: the text stays */
  'ui:refused': Record<string, never>;
  /** a word the composer's text is read by was pressed (or alt ArrowDown in it): what is it read as? */
  'ui:mark': { text: string; kind: string; el: HTMLElement };
  /** a mod's element was used (ModView): a Button pressed, a Field changed or submitted, a choice made; `id` is the mod's handler */
  'ui:mod': { type: 'ui.press' | 'ui.input' | 'ui.select' | 'ui.submit'; id: string; value?: string };
  /** the band's fold over the composer was pressed (Queue, mod): the row opens or closes. Cancelable */
  'ui:fold': { open: boolean; row: string };
}
export type UiEventName = keyof UiEvents;
/* one entry per event of the map: the compiler fails here when an event is added to the map and not listed */
const LISTED: { readonly [K in UiEventName]: true } = {
  'ui:change': true, 'ui:commit': true, 'ui:toggle': true, 'ui:select': true, 'ui:act': true, 'ui:send': true, 'ui:steer': true, 'ui:stop': true,
  'ui:voice': true, 'ui:add': true, 'ui:dictate': true, 'ui:dictate-unavailable': true, 'ui:files': true, 'ui:refused': true, 'ui:mark': true,
  'ui:mod': true, 'ui:fold': true
};
/** every event the kit dispatches, for tests and docs */
export const UI_EVENTS = Object.keys(LISTED) as UiEventName[];

/** dispatch `name` on `el`: a bubbling CustomEvent carrying `detail`, cancelable where an action follows. Returns false when a
    listener cancelled it (the component then leaves its state as it was) */
export function emit<K extends UiEventName>(el: EventTarget, name: K, detail: UiEvents[K], cancelable = false): boolean {
  return fire(el, name, detail, cancelable);
}

/** listen for `name` on `root` and everything under it; returns the function that stops listening */
export function on<K extends UiEventName>(root: EventTarget, name: K, handler: (e: CustomEvent<UiEvents[K]>) => void): () => void {
  const fn = (e: Event): void => { handler(e as CustomEvent<UiEvents[K]>); };
  root.addEventListener(name, fn);
  return () => { root.removeEventListener(name, fn); };
}
