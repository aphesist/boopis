/* The mods module's shared state: which session it draws for, what that session's mods say now, and where a pane goes.
   Everything the surfaces read lives here, so each surface file is a pure function of it plus the DOM it owns. */
import { data } from '../../data';
import type { ModSession } from '../../data';
import { NO_MODS } from '../../data/mods-model';
import type { ModEvent, ModRoot } from '../../components/mod-view';

export const ctl = {
  /** the session the surfaces draw for (the UI's id); null before the first conversation is drawn */
  id: null as string | null,
  /** that session's mods, as of the last change */
  s: NO_MODS as ModSession,
  /** the pane the details panel shows: a pane's id, or 'details' */
  active: 'details',
  /** an inline pane is folded to its head */
  folded: new Map<string, boolean>(),
  /** the band's row is open (not collapsed) */
  bandOpen: false,
  /** scroll of the details panel per tab */
  scroll: {} as Record<string, number>,
  /** the drawn roots of each pane, by `id:dock` and `id:inline`, so a redraw updates them in place and keeps focus */
  roots: new Map<string, ModRoot>(),
  bandRoot: null as ModRoot | null
};

/** From 1200px wide a pane is a tab of the details panel (the layout's own breakpoint for a pushed right panel); below it the pane is inline above the composer (owner decision, 19 November 2026) */
export const DOCK_MIN = 1200;
export const docked = (): boolean => window.innerWidth >= DOCK_MIN;

/** what the user does to an element goes back to the mod by its handler id; the session is the one the tree was drawn for */
export function dispatcher(sessionId: string): (ev: ModEvent) => void {
  return (ev) => {
    const m = data().mods;
    if (ev.type === 'ui.press') m.press(sessionId, ev.id);
    else if (ev.type === 'ui.select') m.select(sessionId, ev.id, ev.value ?? '');
    else m.input(sessionId, ev.id, ev.value ?? '');   /* ui.input and ui.submit: the plugin's `mod.input` */
  };
}
export const sessionOf = (): string => ctl.id ?? '';
