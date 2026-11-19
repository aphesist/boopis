/* Bringing an archived bot back: the one place the Bots tab's "Restore" and the palette's "Restore bot…" ask the provider and
   say what happened, so both give the same answer, the refusal included (a name that is in use again is refused, and the
   archived bot stays where it is). */
import type { BotsSource } from './provider';

export type Restored = { ok: true; name: string } | { ok: false; name: string; message: string };

export async function restoreBot(source: BotsSource, id: string): Promise<Restored> {
  const name = source.archived.get().find((a) => a.id === id)?.was ?? id;
  try {
    await source.restore(id);
    return { ok: true, name };
  } catch (e) {
    return { ok: false, name, message: e instanceof Error ? e.message : String(e) };
  }
}
/** the words for a toast */
export const restoredWords = (r: Restored): string => (r.ok ? 'Restored ' + r.name : 'Could not restore ' + r.name + ': ' + r.message);

/** "5m ago", "yesterday", "mon", "12/11": how the lists say when, said as a sentence */
export const archivedWhen = (when: string): string => (!when ? 'Archived' : when === 'now' ? 'Archived just now' : /^\d+[mh]$/.test(when) ? 'Archived ' + when + ' ago' : 'Archived ' + when);
