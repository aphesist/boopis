/* Dictation: the microphone button of a composer, heard and written down by the host (ADR-0052). This file is the UI's whole
   side of it: the page never touches a microphone (no getUserMedia), it asks the host with `dictation_start` and reads the
   events the host sends on a Channel. Audio stays in the host's process; nothing here ever holds a sample.

   What the kit side calls is `dictation.start(onEvent, onEnd?)` (a `HostDictation`):

     const stop = dictation.start((e) => { ... });   // on the person's press of the mic, and only then
     stop();                                         // on release, on a second press, on Esc, when the composer goes away

   Events, in order:
     { kind: 'preparing', done, total }   the speech model is being fetched, once (bytes); the microphone is still closed
     { kind: 'listening' }                the microphone is open
     { kind: 'partial', text }            the stretch being spoken, so far; each partial replaces the last one
     { kind: 'final', text }              a finished stretch (a pause ended it, or the stop did): it stays, and the next
                                          partial starts a new stretch. A long dictation gives several
     { kind: 'error', reason, message, retry }   it could not start, or stopped by itself. `reason` is one of
                                          DICTATION_REASONS, `message` a plain sentence the host wrote for the person,
                                          `retry` whether pressing the mic again can help
   After `stop()` the microphone is closed at once, and the words of what was still being said arrive as one last `final`
   (about a second later); then `onEnd` is called and nothing more comes. An `error` is also followed by `onEnd`.

   `asDictationSource` fits the same thing to the provider's present `DictationSource` (text only), which cannot carry the
   events: it hands on each `final` and logs an error. */
import { Channel } from '@tauri-apps/api/core';
import { commands } from './bindings';
import type { DictationEvent as WireEvent } from './bindings';
import type { DictationSource } from '../data/provider';
import { logger } from '../core/log';

const log = logger('dictation');

/** why a dictation could not start or stopped by itself */
export const DICTATION_REASONS = ['no-microphone', 'permission-denied', 'model-download-failed', 'busy', 'too-long', 'failed'] as const;
export type DictationReason = typeof DICTATION_REASONS[number];

export type DictationEvent =
  | { kind: 'preparing'; done: number; total: number }
  | { kind: 'listening' }
  | { kind: 'partial'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'error'; reason: DictationReason; message: string; retry: boolean };

/** the dictation source the composer's mic drives */
export interface HostDictation {
  /** start listening (the person pressed the mic); the returned function stops it. `onEnd` is told when nothing more will
      come: after the last `final` that follows a stop, or after an `error` */
  start(onEvent: (e: DictationEvent) => void, onEnd?: () => void): () => void;
}

/** the host's two commands */
export interface DictationBridge {
  /** start a dictation whose events go to `onEvent`; resolves to its id */
  start(onEvent: (e: WireEvent) => void): Promise<number>;
  stop(id: number): Promise<void>;
}

export function tauriDictationBridge(): DictationBridge {
  return {
    start(onEvent) {
      const events = new Channel<WireEvent>();
      events.onmessage = (e) => { onEvent(e); };
      return commands.dictationStart(events);
    },
    stop: (id) => commands.dictationStop(id)
  };
}

/** what to say when the host could not even be asked (it answers every other failure itself, in its own words) */
export const COULD_NOT_START = 'Dictation could not start. Press the mic to try again.';

const isReason = (r: string): r is DictationReason => (DICTATION_REASONS as readonly string[]).includes(r);

/** the host's event as the UI's, or null for the end mark */
function fromWire(e: WireEvent): DictationEvent | null {
  switch (e.kind) {
    case 'preparing': return { kind: 'preparing', done: e.done ?? 0, total: e.total ?? 0 };
    case 'listening': return { kind: 'listening' };
    case 'partial': return { kind: 'partial', text: e.text };
    case 'final': return { kind: 'final', text: e.text };
    case 'error': return { kind: 'error', reason: isReason(e.reason) ? e.reason : 'failed', message: e.message || COULD_NOT_START, retry: e.retry };
    default: return null;
  }
}

/** a dictation source over the host. The bridge is made on the first press, so nothing reaches for the host before one */
export function createDictation(bridge: () => DictationBridge = tauriDictationBridge): HostDictation {
  let made: DictationBridge | null = null;
  return {
    start(onEvent, onEnd) {
      const host = (made ??= bridge());
      let id: number | null = null, stopped = false, over = false;
      const end = (): void => { if (over) return; over = true; onEnd?.(); };
      const say = (e: DictationEvent): void => { try { onEvent(e); } catch (err) { log.error('a dictation event could not be handled', err); } };
      const askStop = (): void => { if (id !== null && !over) host.stop(id).catch((err: unknown) => { log.warn('the host did not take the stop', err); }); };
      const onWire = (wire: WireEvent): void => {
        if (over) return;
        const e = fromWire(wire);
        if (e) say(e); else if (wire.kind === 'ended') end();
      };
      /* with no host behind the page (a browser, a test) even making the Channel throws: that is a host that cannot be asked */
      let asked: Promise<number>;
      try { asked = host.start(onWire); } catch (err) { asked = Promise.reject(err instanceof Error ? err : new Error(String(err))); }
      asked.then((got) => {
        id = got;
        if (stopped) askStop();   /* the person let go before the host had answered */
      }, (err: unknown) => {
        log.warn('the host did not start a dictation', err);
        if (over) return;
        say({ kind: 'error', reason: 'failed', message: COULD_NOT_START, retry: true });
        end();
      });
      return () => { if (stopped) return; stopped = true; askStop(); };
    }
  };
}

/** the app's dictation, over the host */
export const dictation: HostDictation = createDictation();

/** the same source as the provider's `DictationSource`, which carries only text: each finished stretch is handed on (the second
    and later ones after a space), partial words are not, and an error is logged. Stopping still lets the last words arrive. */
export function asDictationSource(source: HostDictation = dictation): DictationSource {
  return {
    start(_opts, onTranscript) {
      let said = 0;
      return source.start((e) => {
        if (e.kind === 'final') onTranscript((said++ ? ' ' : '') + e.text);
        else if (e.kind === 'error') log.warn('dictation stopped: ' + e.reason);
      });
    }
  };
}
