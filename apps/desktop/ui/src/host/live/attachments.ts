/* What a message carries besides its words: files, pictures and folders the person attached. The engine takes them
   before `prompt.submit` (tui_gateway/methods_prompt.py):
   - a picture is queued on the session with `image.attach {session_id, path}`; `prompt.submit` then sends it with the text;
   - any other file goes through `file.attach {session_id, path}`, which stages it where the agent can read it and answers
     with the `@file:` reference to put in the message (`ref_text`);
   - a folder is a context reference the engine expands itself: `@folder:<path>`, quoted the way the engine quotes (a value
     with spaces or brackets is wrapped in backticks, quotes or apostrophes).
   Nothing is attached silently: when the engine refuses one, the send stops and says which (the pictures already queued are
   taken back, so they do not ride on the next message). */
import type { Attached } from '../../data/types';

type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** the engine's own rule for a reference value (`_format_ref_value`): quote it when it holds whitespace, brackets or quotes */
export function refValue(value: string): string {
  if (!value || !/[\s()[\]{}<>"'`]/.test(value)) return value;
  for (const q of ['`', '"', "'"]) if (!value.includes(q)) return q + value + q;
  return value;
}

export class AttachError extends Error {
  readonly name_: string;
  constructor(name: string, reason: string) {
    super(`${name} was not attached: ${reason}`);
    this.name = 'AttachError';
    this.name_ = name;
  }
}

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** attach everything with the engine; resolves to the references to add after the message's text */
export async function stageAttachments(request: Request, session: string, items: readonly Attached[]): Promise<string[]> {
  const refs: string[] = [];
  const queued: string[] = [];
  try {
    for (const a of items) {
      if (!a.path) throw new AttachError(a.name, 'it has no path on this machine');
      if (a.kind === 'folder') { refs.push('@folder:' + refValue(a.path)); continue; }
      if (a.kind === 'image') {
        try { await request('image.attach', { session_id: session, path: a.path }); } catch (e) { throw new AttachError(a.name, reasonOf(e)); }
        queued.push(a.path);
        continue;
      }
      let res: unknown;
      try { res = await request('file.attach', { session_id: session, path: a.path }); } catch (e) { throw new AttachError(a.name, reasonOf(e)); }
      const ref = (res as { ref_text?: unknown } | null)?.ref_text;
      if (typeof ref !== 'string' || !ref) throw new AttachError(a.name, 'the engine did not say where it put it');
      refs.push(ref);
    }
  } catch (e) {
    for (const path of queued) await request('image.detach', { session_id: session, path }).catch(() => undefined);
    throw e;
  }
  return refs;
}

/** the message the engine receives: the person's words, then one reference per file and folder */
export function withRefs(text: string, refs: readonly string[]): string {
  return refs.length ? `${text}\n\n${refs.join(' ')}` : text;
}
