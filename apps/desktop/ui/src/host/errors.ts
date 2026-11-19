/* What the UI shows for an error (ADR-0031: boopis is the product, its engine is invisible). The host's one mapper
   (`src-tauri/src/error.rs`, `user_message`) already turns its own errors into the catalog's sentences. The engine's JSON-RPC
   answers reach the UI byte for byte (the proxy never alters a frame), so an answer that carries no `hx.*` code of ours is the
   engine speaking: the UI shows the same catalog's sentence for `hx.engine.refused`, and keeps the engine's words for
   Settings, General, Diagnostics and the log. The sentences are one file shared with the host and the plugin
   (`crates/hx-proto/errors.json`). */
import catalog from '../../../../../crates/hx-proto/errors.json';
import { logger } from '../core/log';

const log = logger('errors');

interface Entry { code: string; user?: string }
const SENTENCES: ReadonlyMap<string, string> = new Map((catalog.errors as Entry[]).filter((e) => e.user).map((e) => [e.code, e.user as string]));

/** the code the UI shows for the engine's own refusals */
export const ENGINE_REFUSED = 'hx.engine.refused';

/** the catalog's sentence for `code`, else the engine fallback's */
export function sentenceFor(code: string): string {
  return SENTENCES.get(code) ?? SENTENCES.get(ENGINE_REFUSED) ?? 'boopis could not do that. Try again.';
}

/** whether `text` names the engine, which the UI never shows */
export function namesEngine(text: string): boolean {
  return /hermes/i.test(text);
}

export interface EngineDetail { code: string; detail: string; at: number }
const CAP = 32;
const recent: EngineDetail[] = [];

/** keep the engine's raw words for Diagnostics (bounded) and the log; never shown elsewhere */
export function keepDetail(code: string, detail: string): void {
  log.info('the engine said (shown as its catalog sentence)', code);
  recent.push({ code, detail, at: Date.now() });
  if (recent.length > CAP) recent.shift();
}

/** the raw words behind the sentences the UI showed this session, oldest first (Settings, General, Diagnostics) */
export function engineDetails(): readonly EngineDetail[] {
  return recent;
}

/** what to show for a text that may quote the engine: as it is, unless it names it */
export function unlessEngine(code: string, text: string): string {
  if (!namesEngine(text)) return text;
  keepDetail(code, text);
  return sentenceFor(code);
}
