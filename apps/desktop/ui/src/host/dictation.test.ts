/* The UI's side of dictation against a fake host: the events as the composer gets them, stop in every order, the end, and
   the host that cannot be asked. The real bridge is checked over a fake Channel and `invoke`. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  Channel: class { onmessage: ((m: unknown) => void) | null = null; }
}));

import { asDictationSource, COULD_NOT_START, createDictation, DICTATION_REASONS, tauriDictationBridge } from './dictation';
import type { DictationBridge, DictationEvent } from './dictation';
import type { DictationEvent as WireEvent, DictationKind } from './bindings';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const wire = (kind: DictationKind, over: Partial<WireEvent> = {}): WireEvent => ({ kind, done: 0, total: 0, text: '', reason: '', message: '', retry: false, ...over });

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

describe('dictation over the host', () => {
  it('asks nothing of the host until the first press', () => {
    const host = fakeHost();
    createDictation(host.bridge);
    expect(host.made()).toBe(0);
    expect(host.calls).toEqual([]);
  });

  it('hands on preparing, listening, partial and final words in order, and ends after the stop\'s last words', async () => {
    const host = fakeHost();
    const got: DictationEvent[] = [];
    let ended = 0;
    const stop = createDictation(host.bridge).start((e) => got.push(e), () => { ended++; });
    host.answer(4);
    await tick();
    host.send(wire('preparing', { done: 1024, total: 59707625 }));
    host.send(wire('preparing', { done: 59707625, total: 59707625 }));
    host.send(wire('listening'));
    host.send(wire('partial', { text: 'and so' }));
    host.send(wire('partial', { text: 'and so my fellow' }));
    host.send(wire('final', { text: 'And so, my fellow Americans,' }));
    host.send(wire('partial', { text: 'ask not' }));
    stop();
    expect(host.calls).toEqual(['start', 'stop:4']);
    /* the microphone is closed; what was still being said arrives as one more final, then the end */
    host.send(wire('final', { text: 'ask not what your country can do for you.' }));
    expect(ended).toBe(0);
    host.send(wire('ended'));
    expect(ended).toBe(1);
    host.send(wire('partial', { text: 'a stray event after the end' }));
    expect(got).toEqual([
      { kind: 'preparing', done: 1024, total: 59707625 },
      { kind: 'preparing', done: 59707625, total: 59707625 },
      { kind: 'listening' },
      { kind: 'partial', text: 'and so' },
      { kind: 'partial', text: 'and so my fellow' },
      { kind: 'final', text: 'And so, my fellow Americans,' },
      { kind: 'partial', text: 'ask not' },
      { kind: 'final', text: 'ask not what your country can do for you.' }
    ]);
    stop();   /* a second stop, and one after the end, ask nothing */
    expect(host.calls).toEqual(['start', 'stop:4']);
    expect(ended).toBe(1);
  });

  it('stops a dictation the person let go of before the host had answered', async () => {
    const host = fakeHost();
    const stop = createDictation(host.bridge).start(() => undefined);
    stop();
    expect(host.calls).toEqual(['start']);   /* no id yet: nothing to stop with */
    host.answer(9);
    await tick();
    expect(host.calls).toEqual(['start', 'stop:9']);
  });

  it('does not ask the host to stop what already ended by itself', async () => {
    const host = fakeHost();
    const got: DictationEvent[] = [];
    let ended = 0;
    const stop = createDictation(host.bridge).start((e) => got.push(e), () => { ended++; });
    host.answer(2);
    await tick();
    host.send(wire('error', { reason: 'no-microphone', message: 'boopis found no microphone. Plug one in, or choose an input in your system\'s sound settings, then press the mic again.', retry: true }));
    host.send(wire('ended'));
    stop();
    expect(host.calls).toEqual(['start']);
    expect(ended).toBe(1);
    expect(got).toEqual([{ kind: 'error', reason: 'no-microphone', message: 'boopis found no microphone. Plug one in, or choose an input in your system\'s sound settings, then press the mic again.', retry: true }]);
  });

  it('carries each of the host\'s reasons, and reads one it does not know as failed', async () => {
    const host = fakeHost();
    const got: DictationEvent[] = [];
    createDictation(host.bridge).start((e) => got.push(e));
    host.answer(1);
    await tick();
    for (const reason of DICTATION_REASONS) host.send(wire('error', { reason, message: 'A sentence.', retry: reason !== 'failed' }));
    host.send(wire('error', { reason: 'something-newer', message: '', retry: false }));
    expect(got.map((e) => (e.kind === 'error' ? e.reason : e.kind))).toEqual(['no-microphone', 'permission-denied', 'model-download-failed', 'busy', 'too-long', 'failed', 'failed']);
    expect(got[6]).toEqual({ kind: 'error', reason: 'failed', message: COULD_NOT_START, retry: false });   /* never an empty sentence */
  });

  it('reads byte counts the host could not give as zero', async () => {
    const host = fakeHost();
    const got: DictationEvent[] = [];
    createDictation(host.bridge).start((e) => got.push(e));
    host.send(wire('preparing', { done: null, total: null }));   /* events may come before the id does */
    expect(got).toEqual([{ kind: 'preparing', done: 0, total: 0 }]);
  });

  it('says one plain error and ends when the host cannot be asked', async () => {
    const host = fakeHost();
    const got: DictationEvent[] = [];
    let ended = 0;
    const stop = createDictation(host.bridge).start((e) => got.push(e), () => { ended++; });
    host.refuse('dictation_start is not allowed');
    await tick();
    expect(got).toEqual([{ kind: 'error', reason: 'failed', message: COULD_NOT_START, retry: true }]);
    expect(ended).toBe(1);
    stop();
    expect(host.calls).toEqual(['start']);
  });

  it('keeps going when the composer\'s handler throws', async () => {
    const host = fakeHost();
    let n = 0;
    createDictation(host.bridge).start(() => { n++; throw new Error('the composer is gone'); });
    host.answer(1);
    await tick();
    host.send(wire('listening'));
    host.send(wire('final', { text: 'still delivered' }));
    expect(n).toBe(2);
  });

  it('runs one dictation after another over the same bridge', async () => {
    const host = fakeHost();
    const source = createDictation(host.bridge);
    const first: DictationEvent[] = [], second: DictationEvent[] = [];
    source.start((e) => first.push(e));
    host.answer(1);
    await tick();
    host.send(wire('final', { text: 'one' }));
    host.send(wire('ended'));
    source.start((e) => second.push(e));
    host.send(wire('final', { text: 'two' }));
    expect(host.made()).toBe(1);
    expect(first).toEqual([{ kind: 'final', text: 'one' }]);
    expect(second).toEqual([{ kind: 'final', text: 'two' }]);
  });
});

describe('the provider\'s text-only dictation', () => {
  it('hands on each finished stretch, spaced, and no partial words', async () => {
    const host = fakeHost();
    const heard: string[] = [];
    const stop = asDictationSource(createDictation(host.bridge)).start({ botId: null }, (t) => heard.push(t));
    host.answer(3);
    await tick();
    host.send(wire('listening'));
    host.send(wire('partial', { text: 'and' }));
    host.send(wire('final', { text: 'And so, my fellow Americans,' }));
    stop();
    host.send(wire('final', { text: 'ask not.' }));   /* the words of the stop still arrive */
    host.send(wire('error', { reason: 'too-long', message: 'Dictation stops after 5 minutes. Press the mic to go on.', retry: true }));
    host.send(wire('ended'));
    expect(heard).toEqual(['And so, my fellow Americans,', ' ask not.']);
    expect(host.calls).toEqual(['start', 'stop:3']);
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
