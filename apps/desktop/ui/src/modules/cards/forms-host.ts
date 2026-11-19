/* Where a form card sends its answer. Normally the app's data provider (`data().forms`); a screen that runs before a provider
   exists (first-run setup, answered through the host's `setup_advance`) installs its own for as long as it is on screen. */
import { data } from '../../data';
import type { FormsSource } from '../../data';

let override: FormsSource | null = null;
export const formsHost = (): FormsSource => override ?? data().forms;
/** use `src` for every form card until it is called again with null; returns what to restore */
export function useFormsHost(src: FormsSource | null): FormsSource | null { const prev = override; override = src; return prev; }
