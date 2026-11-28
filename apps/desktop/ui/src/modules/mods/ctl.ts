/* The mods module's shared state: which session it draws for, what that session's mods say now, and which of the tools' tabs is in
   front. Everything the surfaces read lives here, so each surface file is a pure function of it plus the DOM it owns. */
import { data } from '../../data';
import type { ModSession } from '../../data';
import { NO_MODS } from '../../data/mods-model';

/** what the person did to a mod's drawing (the kit's `ui:mod`), by the handler id of the element used */
export interface ModEvent { type: 'ui.press' | 'ui.input' | 'ui.select' | 'ui.submit'; id: string; value?: string | undefined }

export const ctl = {
  /** the session the surfaces draw for (the UI's id); null before the first conversation is drawn */
  id: null as string | null,
  /** that session's mods, as of the last change */
  s: NO_MODS as ModSession,
  /** the tools' tab in front: a pane's id, or 'diff' */
  active: 'diff',
  /** the band's row is open (not collapsed) */
  bandOpen: false,
  /** the drawn ModView of each pane, by its id, so a redraw updates it in place and keeps focus */
  roots: new Map<string, HTMLElement>(),
  bandRoot: null as HTMLElement | null
};

/** what the person does to an element goes back to the mod by its handler id; the session is the one the tree was drawn for */
export function dispatcher(sessionId: string): (ev: ModEvent) => void {
  return (ev) => {
    const m = data().mods;
    if (ev.type === 'ui.press') m.press(sessionId, ev.id);
    else if (ev.type === 'ui.select') m.select(sessionId, ev.id, ev.value ?? '');
    else m.input(sessionId, ev.id, ev.value ?? '');   /* ui.input and ui.submit: the plugin's `mod.input` */
  };
}
export const sessionOf = (): string => ctl.id ?? '';
