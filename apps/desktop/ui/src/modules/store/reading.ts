/* Reading the sources (docs/STORE.md 5.3), without a DOM: which sources a read covers, and the state of the read in progress, so
   every row can say honestly where it stands. The store reads the sources that are due when it opens, and every source on "Read
   the sources again". It reads them one at a time through `StoreProvider.refresh(id)` (the host reads one source per call and
   keeps one read at a time), so a row says it is waiting, being read, or what came of it: so many items read just now, or the
   host's plain reason it could not. A source is never left saying "Not read yet" with no attempt.

   While the store stays open it also reads the sources again when they fall due (`keepFresh`): a source's age moves on while
   nobody presses anything, and the host only says a source is due when it is asked, so the view asks (`reloadSources`) before
   it decides what is due. A source that failed is not tried again at once: it waits longer after each failure, so a service
   that is down or limiting requests is not hammered, and a person who opens the store later still gets a try straight away. */
import { store } from '../../data/store';
import type { Watch } from '../../data/provider';
import type { StoreProvider } from '../../data/provider';
import type { StoreSource } from '../../data';

export type ReadState = 'waiting' | 'reading';
export interface Reading {
  /** the sources this read covers that are not finished yet */
  states: ReadonlyMap<string, ReadState>;
  /** how many of `total` are finished */
  done: number;
  total: number;
  running: boolean;
  /** the last read that finished: how many it covered and how many of those could not be read */
  last: { total: number; failed: number } | null;
  /** the sources this read covers, in the order they are read, and the ones of them already finished (each row of the progress
      is one of these: waiting, being read, or done) */
  order: readonly string[];
  finished: ReadonlySet<string>;
}
export interface Reader {
  state: Watch<Reading>;
  /** read the sources that are due (`all`: every source a read can reach), except those `hold` keeps back; resolves when every one has answered */
  read(all: boolean, hold?: (s: StoreSource) => boolean): Promise<void>;
  /** ask the host how old each source is now (the answer moves on with time), then read the ones that are due */
  readDue(hold?: (s: StoreSource) => boolean): Promise<void>;
}

/** the two built-in places that hold nothing until the user adds one */
const PLACEHOLDERS = new Set(['marketplace-url', 'local']);
/** whether reading the sources again reads `s`: the host says so (`refreshable`); an older host's answer is derived the same way */
export const isRefreshable = (s: StoreSource): boolean =>
  s.refreshable ?? !(s.fetch === 'compiled-in' || s.fetch === 'github-api' || (!s.user_added && PLACEHOLDERS.has(s.id)));
/** whether `s` is due a read: the host says so (`stale`); without its word, a source that was never read or failed last time */
export const isStale = (s: StoreSource): boolean => s.stale ?? (isRefreshable(s) && (!s.refreshed_at || !!s.error));

/** the sources a read covers, in the order the store lists them: on, readable, and due unless `all` */
export function dueSources(list: readonly StoreSource[], all: boolean, hold?: (s: StoreSource) => boolean): StoreSource[] {
  return list.filter((s) => s.enabled !== false && isRefreshable(s) && (all || isStale(s)) && !hold?.(s));
}

const IDLE: Reading = { states: new Map(), done: 0, total: 0, running: false, last: null, order: [], finished: new Set() };
const readers = new WeakMap<StoreProvider, Reader>();

/** the one reader of a provider: the store's view is mounted once, but a second caller must not start a second read */
export function readerFor(provider: StoreProvider): Reader {
  const have = readers.get(provider);
  if (have) return have;
  const state = store<Reading>(IDLE);
  let current: Promise<void> | null = null;
  const read = (all: boolean, hold?: (s: StoreSource) => boolean): Promise<void> => {
    if (current) return current;
    const list = dueSources(provider.sources.get(), all, hold);
    if (!list.length) return Promise.resolve();
    current = (async () => {
      const states = new Map<string, ReadState>(list.map((s) => [s.id, 'waiting']));
      const order = list.map((s) => s.id);
      const finished = new Set<string>();
      let done = 0;
      const publish = (running: boolean): void => { state.set({ states: new Map(states), done, total: list.length, running, order, finished: new Set(finished), last: running ? state.get().last : { total: list.length, failed: failedOf(list) } }); };
      publish(true);
      for (const s of list) {
        states.set(s.id, 'reading'); publish(true);
        /* a source that cannot be read says why in its own row (the host records the reason with the source); nothing to do here */
        try { await provider.refresh(s.id); } catch { /* its row says why */ }
        states.delete(s.id); finished.add(s.id); done++; publish(true);
      }
      publish(false);
    })().finally(() => { current = null; });
    return current;
  };
  const readDue = async (hold?: (s: StoreSource) => boolean): Promise<void> => {
    if (!current) { try { await provider.reloadSources?.(); } catch { /* the state it already has stands */ } }
    return read(false, hold);
  };
  /** how many of the sources a read covered still say they could not be read */
  const failedOf = (list: readonly StoreSource[]): number => {
    const now = new Map(provider.sources.get().map((s) => [s.id, s]));
    return list.filter((s) => !!now.get(s.id)?.error).length;
  };
  const r: Reader = { state, read, readDue };
  readers.set(provider, r);
  return r;
}

/* ───────── reading again while the store stays open ───────── */
export interface KeepFresh {
  /** whether the store is open (a closed store reads nothing) */
  open: () => boolean;
  /** how often to look at what is due; default a minute */
  every?: number;
  now?: () => number;
  /** the wait before a source that failed `failures` times in a row is tried again, in ms (default 5 minutes, doubling, at most an hour) */
  wait?: (failures: number) => number;
}
export const retryWait = (failures: number): number => Math.min(5 * 60_000 * 2 ** Math.max(0, failures - 1), 60 * 60_000);

/** Looks, every `every` ms while `open()`, at what the host says is due and reads it. Returns what stops it. */
export function keepFresh(provider: StoreProvider, o: KeepFresh): () => void {
  const reader = readerFor(provider);
  const now = o.now ?? Date.now;
  const wait = o.wait ?? retryWait;
  const tried = new Map<string, { failures: number; at: number }>();
  const hold = (s: StoreSource): boolean => { const b = tried.get(s.id); return !!b && now() - b.at < wait(b.failures); };
  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy || !o.open() || reader.state.get().running) return;
    busy = true;
    try {
      const before = reader.state.get();
      await reader.readDue(hold);
      const after = new Map(provider.sources.get().map((s) => [s.id, s]));
      /* only a read this look made counts: when nothing was due, the state is the last read's, and its failures were counted */
      for (const id of reader.state.get() === before ? [] : reader.state.get().order) {
        const s = after.get(id);
        if (s?.error) tried.set(id, { failures: (tried.get(id)?.failures ?? 0) + 1, at: now() });
        else tried.delete(id);
      }
      /* a source that is fine now (a person read it, or it was switched off) is not held */
      for (const id of [...tried.keys()]) if (!after.get(id)?.error) tried.delete(id);
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, o.every ?? 60_000);
  return () => { clearInterval(timer); };
}
