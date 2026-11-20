/* Attaching, from the page's side: the system's file and folder dialog, and files dropped on the window. The host owns
   both (`window.rs`); a path never comes from the page's own input. */
import { commands, events } from './bindings';
import type { Attachment, FileDragEvent } from './bindings';
import { asHostError } from './bridge';
import type { Attached } from '../data/types';
import type { FileDrag } from '../data/provider';

export const toAttached = (a: Attachment): Attached => ({ name: a.name, kind: a.kind, path: a.path, ...(a.bytes != null ? { bytes: a.bytes } : {}) });

/** ask for files or a folder; empty when the person cancels */
export async function pickAttachments(kind: 'file' | 'folder', pick: (k: string) => Promise<Attachment[]> = (k) => commands.pickAttachments(k)): Promise<Attached[]> {
  try { return (await pick(kind)).map(toAttached); } catch (e) { throw asHostError(e); }
}

export const toDrag = (e: FileDragEvent): FileDrag => ({ phase: e.phase === 'drop' || e.phase === 'enter' || e.phase === 'over' ? e.phase : 'leave', x: e.x ?? 0, y: e.y ?? 0, attachments: e.attachments.map(toAttached) });

/** the drops the host reports; the listening starts with the first subscriber and ends with the last */
export function dropsFromHost(listen: (cb: (e: FileDragEvent) => void) => Promise<() => void> = (cb) => events.fileDragEvent.listen((ev) => { cb(ev.payload); })): NonNullable<import('../data/provider').FilesSource['drops']> {
  const subs = new Set<(e: FileDrag) => void>();
  let stop: Promise<() => void> | null = null;
  return {
    subscribe(fn) {
      subs.add(fn);
      stop ??= listen((e) => { const d = toDrag(e); for (const s of subs) s(d); });
      stop.catch(() => { stop = null; });
      return () => {
        subs.delete(fn);
        if (!subs.size && stop) { const p = stop; stop = null; void p.then((off) => { off(); }, () => undefined); }
      };
    }
  };
}
