/* The UI's side of dictation against a fake host: the provider's events as the composer gets them, cancel in every order, the
   host's reasons as sentences, and the host that cannot be asked. The real bridge is checked over a fake Channel and `invoke`. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  Channel: class { onmessage: ((m: unknown) => void) | null = null; }
}));

import { hostDictation, REASONS, tauriDictationBridge } from './dictation';
import type { DictationBridge } from './dictation';
import type { DictationEvent as WireEvent, DictationKind } from './bindings';
import type { DictationEvent } from '../data/provider';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const wire = (kind: DictationKind, over: Partial<WireEvent> = {}): WireEvent => ({ kind, done: 0, total: 0, text: '', reason: '', message: '', retry: false, ...over });
const BOT = { botId: 'nina' };

/** a host that starts when the test says, and remembers what it was asked */
function fakeHost(): { bridge: () => DictationBridge; calls: string[]; send: (e: WireEvent) => void; answer: (id: number) => void; refuse: (why: string) => void; made: () => number } {
  const calls: string[] = [];
  let to: ((e: WireEvent) => void) | null = null;
  let settle: { resolve: (id: number) => void; reject: (e: Error) => void } | null = null;
  let made = 0;
  return {
    calls,
    made: () => made,
    send: (e) => { to?.(e); },
    answer: (id) => { settle?.resolve(id); },
    refuse: (why) => { settle?.reject(new Error(why)); },
    bridge: () => {
      made++;
      return {
        start: (onEvent) => { calls.push('start'); to = onEvent; return new Promise<number>((resolve, reject) => { settle = { resolve, reject }; }); },
        stop: (id) => { calls.push('stop:' + String(id)); return Promise.resolve(); }
      };
    }
  };
}

beforeEach(() => { invoke.mockReset(); });

describe('the provider\'s dictation over the host', () => {
  it('asks nothing of the host until the first press', () => {
    const host = fakeHost();
    hostDictation(host.bridge);
    expect(host.made()).toBe(0);
    expect(host.calls).toEqual([]);
  });

  it('hands on the model\'s bytes, listening, and partial and final words in order; cancel closes the microphone', async () => {
    const host = fakeHost();
    const got: DictationEvent[] = [];
    const cancel = hostDictation(host.bridge).start(BOT, (e) => got.push(e));
    host.answer(4);
    await tick();
    host.send(wire('preparing', { done: 12582912, total: 59707625 }));
    host.send(wire('preparing', { done: 59707625, total: 59707625 }));
    host.send(wire('listening'));
    host.send(wire('partial', { text: 'and so' }));
    host.send(wire('partial', { text: 'and so my fellow' }));
    host.send(wire('final', { text: 'And so, my fellow Americans,' }));
    host.send(wire('partial', { text: 'ask not' }));
    cancel();
    expect(host.calls).toEqual(['start', 'stop:4']);
    /* cancelled: what the host still sends (the same stretch, written down after the stop) is not handed on */
    host.send(wire('final', { text: 'ask not what your country can do for you.' }));
    host.send(wire('ended'));
    host.send(wire('partial', { text: 'a stray event after the end' }));
    expect(got).toEqual([
      { kind: 'preparing', done: 12582912, total: 59707625 },
      { kind: 'preparing', done: 59707625, total: 59707625 },
      { kind: 'listening' },
      { kind: 'partial', text: 'and so' },
      { kind: 'partial', text: 'and so my fellow' },
      { kind: 'final', text: 'And so, my fellow Americans,' },
      { kind: 'partial', text: 'ask not' },
      { kind: 'final', text: 'ask not' }   /* the words on screen are settled inside the cancel itself, while the composer still listens */
    ]);
    cancel();   /* a second cancel asks nothing and says nothing */
    expect(host.calls).toEqual(['start', 'stop:4']);
    expect(got).toHaveLength(8);
  });

  it('settles nothing at a cancel when no words stand: after a final, or before any', async () => {
    const host = fakeHost();
    const got: DictationEvent[] = [];
    const cancel = hostDictation(host.bridge).start(BOT, (e) => got.push(e));
    host.answer(2);
    await tick();
    host.send(wire('listening'));
    host.send(wire('partial', { text: 'one' }));
    host.send(wire('final', { text: 'One.' }));
    cancel();
    expect(got).toEqual([{ kind: 'listening' }, { kind: 'partial', text: 'one' }, { kind: 'final', text: 'One.' }]);
  });

  it('can follow the host\'s last words after a cancel instead, for a composer that takes them', async () => {
    const host = fakeHost();
    const got: DictationEvent[] = [];
    const cancel = hostDictation(host.bridge, 'follow').start(BOT, (e) => got.push(e));
    host.answer(5);
    await tick();
    host.send(wire('listening'));
    host.send(wire('partial', { text: 'ask not' }));
    cancel();
    expect(got).toHaveLength(2);   /* nothing is settled at the cancel */
    host.send(wire('partial', { text: 'a partial that was already on its way' }));
    host.send(wire('final', { text: 'Ask not what your country can do for you.' }));
    host.send(wire('ended'));
    host.send(wire('final', { text: 'after the end' }));
    expect(got.slice(2)).toEqual([{ kind: 'final', text: 'Ask not what your country can do for you.' }]);
    expect(host.calls).toEqual(['start', 'stop:5']);
  });

  it('cancels a dictation the person let go of before the host had answered', async () => {
    const host = fakeHost();
    const cancel = hostDictation(host.bridge).start(BOT, () => undefined);
    cancel();
    expect(host.calls).toEqual(['start']);   /* no id yet: nothing to stop with */
    host.answer(9);
    await tick();
    expect(host.calls).toEqual(['start', 'stop:9']);
  });

  it('says each of the host\'s reasons as one plain sentence, and sends nothing after an error', async () => {
    const said: Record<string, DictationEvent[]> = {};
    for (const reason of Object.keys(REASONS)) {
      const host = fakeHost();
      const got: DictationEvent[] = [];
      const cancel = hostDictation(host.bridge).start({ botId: null }, (e) => got.push(e));
      host.answer(1);
      await tick();
      host.send(wire('error', { reason, message: reason === 'too-long' ? 'Dictation stops after 5 minutes. Press the mic to go on.' : 'boopis found no microphone. Plug one in, then press the mic again.', retry: true }));
      host.send(wire('final', { text: 'never shown' }));
      host.send(wire('ended'));
      cancel();
      expect(host.calls).toEqual(['start']);   /* it ended by itself: there is nothing to stop */
      said[reason] = got;
    }
    expect(said).toEqual({
      'no-microphone': [{ kind: 'error', reason: 'No microphone found', retry: false }],
      'permission-denied': [{ kind: 'error', reason: 'Microphone access is off for boopis', retry: false }],
      'model-download-failed': [{ kind: 'error', reason: 'The speech model could not be downloaded' }],
      'busy': [{ kind: 'error', reason: 'Something else is using dictation' }],
      'too-long': [{ kind: 'error', reason: 'Dictation stops after 5 minutes' }],   /* the cap's minutes are the host's */
      'failed': [{ kind: 'error', reason: 'Dictation failed' }]
    });
  });

  it('reads a reason it does not know as a failure, and the host\'s "cannot help" as retry: false', async () => {
    const host = fakeHost();
    const got: DictationEvent[] = [];
    hostDictation(host.bridge).start(BOT, (e) => got.push(e));
    host.send(wire('error', { reason: 'something-newer', message: 'Dictation needs a processor with AVX2, which this computer does not have.', retry: false }));
    expect(got).toEqual([{ kind: 'error', reason: 'Dictation failed', retry: false }]);
  });

  it('reads byte counts the host could not give as zero', () => {
    const host = fakeHost();
    const got: DictationEvent[] = [];
    hostDictation(host.bridge).start(BOT, (e) => got.push(e));
    host.send(wire('preparing', { done: null, total: null }));   /* events may come before the id does */
    expect(got).toEqual([{ kind: 'preparing', done: 0, total: 0 }]);
  });

  it('says one plain error when the host cannot be asked, or is not there at all, and never throws at the composer', async () => {
    const host = fakeHost();
    const got: DictationEvent[] = [];
    const cancel = hostDictation(host.bridge).start(BOT, (e) => got.push(e));
    host.refuse('dictation_start is not allowed');
    await tick();
    expect(got).toEqual([{ kind: 'error', reason: 'Dictation failed' }]);
    cancel();
    expect(host.calls).toEqual(['start']);

    const none: DictationEvent[] = [];
    const noHost = (): DictationBridge => ({ start: () => { throw new TypeError('window.__TAURI_INTERNALS__ is undefined'); }, stop: () => Promise.resolve() });
    hostDictation(noHost).start(BOT, (e) => none.push(e));
    expect(none).toEqual([]);   /* the press itself returns; the error comes as an event */
    await tick();
    expect(none).toEqual([{ kind: 'error', reason: 'Dictation failed' }]);
  });

  it('keeps going when the composer\'s handler throws, and runs one dictation after another over the same bridge', async () => {
    const host = fakeHost();
    const source = hostDictation(host.bridge);
    let n = 0;
    source.start(BOT, () => { n++; throw new Error('the composer is gone'); });
    host.answer(1);
    await tick();
    host.send(wire('listening'));
    host.send(wire('final', { text: 'still delivered' }));
    host.send(wire('ended'));
    expect(n).toBe(2);
    const second: DictationEvent[] = [];
    source.start(BOT, (e) => second.push(e));
    host.send(wire('final', { text: 'two' }));
    expect(host.made()).toBe(1);
    expect(second).toEqual([{ kind: 'final', text: 'two' }]);
  });
});

describe('the real bridge', () => {
  it('starts through the generated command with a Channel, and stops by id', async () => {
    invoke.mockResolvedValueOnce(12).mockResolvedValueOnce(undefined);
    const bridge = tauriDictationBridge();
    const got: WireEvent[] = [];
    const id = await bridge.start((e) => got.push(e));
    expect(id).toBe(12);
    const [cmd, args] = invoke.mock.calls[0] as [string, { events: { onmessage: (m: unknown) => void } }];
    expect(cmd).toBe('dictation_start');
    expect(Object.keys(args)).toEqual(['events']);   /* the page sends nothing but where to answer: no audio, no device, no text */
    args.events.onmessage(wire('listening'));
    expect(got).toEqual([wire('listening')]);
    await bridge.stop(12);
    expect(invoke.mock.calls[1]).toEqual(['dictation_stop', { id: 12 }, undefined]);
  });
});
