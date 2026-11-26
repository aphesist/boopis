/* Dictation: the microphone button of a composer, heard and written down by the host (ADR-0052). This file is the UI's whole
   side of it. The page never touches a microphone (no getUserMedia): on the person's press the composer starts the provider's
   `DictationSource` (data/provider.ts), which is this, and it asks the host with `dictation_start` and hands on what the host
   sends on a Channel. Audio stays in the host's process; nothing here ever holds a sample.

   The host's events become the provider's `DictationEvent`s as they are: `preparing` with the real bytes of the one-time
   speech model fetch, `listening`, `partial` (the stretch being spoken, so far), `final` (a finished stretch; more follow
   while the mic stays on). The host's error carries a code and a longer sentence; the composer shows `reason` as a Notice's
   title, so the code becomes one short sentence here (REASONS) and the host's own words go to the log. After an `error`
   nothing more is sent.

   The returned function cancels: the host closes the microphone at once and nothing more is handed on, as the provider's
   contract says (the composer drops what arrives once its mic is off). So that the words on screen are not left half
   written, the stretch being spoken is settled first: the last `partial` is handed on once more as a `final`, inside the
   cancel itself, while the composer still listens. What the host writes down after that (the same stretch with its last
   second of words, about a second later) is not shown: showing it needs a composer that takes one more `final` after its
   mic is off. */
import { Channel } from '@tauri-apps/api/core';
import { commands } from './bindings';
import type { DictationEvent as WireEvent } from './bindings';
import type { DictationEvent, DictationSource } from '../data/provider';
import { logger } from '../core/log';

const log = logger('dictation');

/** the host's reasons (`DictationEvent.reason` on the wire), each as the one plain sentence a person reads at the mic, and whether
    pressing the mic again can help */
export const REASONS = {
  'no-microphone': { says: 'No microphone found', retry: false },
  'permission-denied': { says: 'Microphone access is off for boopis', retry: false },
  'model-download-failed': { says: 'The speech model could not be downloaded', retry: true },
  'busy': { says: 'Something else is using dictation', retry: true },
  'too-long': { says: 'Dictation stopped at its time limit', retry: true },
  'failed': { says: 'Dictation failed', retry: true }
} as const;
export type DictationReason = keyof typeof REASONS;
const isReason = (r: string): r is DictationReason => Object.hasOwn(REASONS, r);

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

/** the host's error as the composer's: the reason's sentence (the cap's own, which names its minutes, is the host's first sentence),
    and `retry: false` where trying again cannot help. The host's longer words are kept in the log */
function errorFromWire(e: WireEvent): DictationEvent {
  const code: DictationReason = isReason(e.reason) ? e.reason : 'failed';
  log.info('dictation stopped: ' + code, e.message);
  const capped = code === 'too-long' ? /^[^.]+/.exec(e.message)?.[0] : undefined;   /* "Dictation stops after 5 minutes" */
  const retry = REASONS[code].retry && e.retry;
  return { kind: 'error', reason: capped ?? REASONS[code].says, ...(retry ? {} : { retry: false }) };
}

/** the host's event as the provider's, or null for the end mark */
function fromWire(e: WireEvent): DictationEvent | null {
  switch (e.kind) {
    case 'preparing': return { kind: 'preparing', done: e.done ?? 0, total: e.total ?? 0 };
    case 'listening': return { kind: 'listening' };
    case 'partial': return { kind: 'partial', text: e.text };
    case 'final': return { kind: 'final', text: e.text };
    case 'error': return errorFromWire(e);
    default: return null;
  }
}

/** what a cancel does with the stretch that was being spoken. `settle` (what the composer of today needs: it drops every event
    once its mic is off) hands the last partial on as a final inside the cancel, and nothing after. `follow` hands on nothing at
    the cancel and then the host's own last `final`, which has the last second of words the partial lacks: for a composer that
    takes one more `final` after its mic is off */
export type AfterCancel = 'settle' | 'follow';

/** the provider's dictation, over the host. The bridge is made on the first press, so nothing reaches for the host before one.
    `opts.botId` only tells the UI whose orbs listen: the host hears the same either way */
export function hostDictation(bridge: () => DictationBridge = tauriDictationBridge, afterCancel: AfterCancel = 'settle'): DictationSource {
  let made: DictationBridge | null = null;
  return {
    start(_opts, onEvent) {
      const host = (made ??= bridge());
      let id: number | null = null, cancelled = false, over = false, standing = '';
      const say = (e: DictationEvent): void => { try { onEvent(e); } catch (err) { log.error('a dictation event could not be handled', err); } };
      const askStop = (): void => { if (id !== null && !over) host.stop(id).catch((err: unknown) => { log.warn('the host did not take the stop', err); }); };
      const fail = (): void => { if (over) return; over = true; say({ kind: 'error', reason: REASONS.failed.says }); };
      const onWire = (wire: WireEvent): void => {
        if (over) return;
        const e = fromWire(wire);
        if (!e) { if (wire.kind === 'ended') over = true; return; }
        if (cancelled && e.kind !== 'final') return;   /* after a cancel only the last words may still come (`follow`) */
        if (e.kind === 'error') over = true;   /* after an error nothing more is sent */
        standing = e.kind === 'partial' ? e.text : e.kind === 'final' ? '' : standing;
        say(e);
      };
      /* with no host behind the page (a browser, a test) even making the Channel throws: that is a host that cannot be asked */
      let asked: Promise<number>;
      try { asked = host.start(onWire); } catch (err) { asked = Promise.reject(err instanceof Error ? err : new Error(String(err))); }
      asked.then((got) => {
        id = got;
        if (cancelled) host.stop(got).catch((err: unknown) => { log.warn('the host did not take the stop', err); });   /* the person let go before the host had answered */
      }, (err: unknown) => { log.warn('the host did not start a dictation', err); fail(); });
      return () => {
        if (cancelled) return;
        cancelled = true;
        askStop();
        if (over || afterCancel === 'follow') return;   /* following: the host's last final, then its end mark, close it */
        if (standing) say({ kind: 'final', text: standing });   /* the words on screen stay, as words that were said */
        over = true;
      };
    }
  };
}
