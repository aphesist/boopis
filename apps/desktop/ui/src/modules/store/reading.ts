/* Reading the sources (docs/STORE.md 5.3), without a DOM: which sources a read covers, and the state of the read in progress, so
   every row can say honestly where it stands. The store reads the sources that are due when it opens, and every source on "Read
   the sources again". It reads them one at a time through `StoreProvider.refresh(id)` (the host reads one source per call and
   keeps one read at a time), so a row says it is waiting, being read, or what came of it: so many items read just now, or the
   host's plain reason it could not. A source is never left saying "Not read yet" with no attempt. */
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
}
export interface Reader {
  state: Watch<Reading>;
  /** read the sources that are due (`all`: every source a read can reach); resolves when every one has answered */
  read(all: boolean): Promise<void>;
}

/** the two built-in places that hold nothing until the user adds one */
const PLACEHOLDERS = new Set(['marketplace-url', 'local']);
/** whether reading the sources again reads `s`: the host says so (`refreshable`); an older host's answer is derived the same way */
export const isRefreshable = (s: StoreSource): boolean =>
  s.refreshable ?? !(s.fetch === 'compiled-in' || s.fetch === 'github-api' || (!s.user_added && PLACEHOLDERS.has(s.id)));
/** whether `s` is due a read: the host says so (`stale`); without its word, a source that was never read or failed last time */
export const isStale = (s: StoreSource): boolean => s.stale ?? (isRefreshable(s) && (!s.refreshed_at || !!s.error));

/** the sources a read covers, in the order the store lists them: on, readable, and due unless `all` */
export function dueSources(list: readonly StoreSource[], all: boolean): StoreSource[] {
  return list.filter((s) => s.enabled !== false && isRefreshable(s) && (all || isStale(s)));
}

const IDLE: Reading = { states: new Map(), done: 0, total: 0, running: false, last: null };
const readers = new WeakMap<StoreProvider, Reader>();

/** the one reader of a provider: the store's view is mounted once, but a second caller must not start a second read */
export function readerFor(provider: StoreProvider): Reader {
  const have = readers.get(provider);
  if (have) return have;
  const state = store<Reading>(IDLE);
  let current: Promise<void> | null = null;
  const read = (all: boolean): Promise<void> => {
    if (current) return current;
    const list = dueSources(provider.sources.get(), all);
    if (!list.length) return Promise.resolve();
    current = (async () => {
      const states = new Map<string, ReadState>(list.map((s) => [s.id, 'waiting']));
      let done = 0;
      const publish = (running: boolean): void => { state.set({ states: new Map(states), done, total: list.length, running, last: running ? state.get().last : { total: list.length, failed: failedOf(list) } }); };
      publish(true);
      for (const s of list) {
        states.set(s.id, 'reading'); publish(true);
        /* a source that cannot be read says why in its own row (the host records the reason with the source); nothing to do here */
        try { await provider.refresh(s.id); } catch { /* its row says why */ }
        states.delete(s.id); done++; publish(true);
      }
      publish(false);
    })().finally(() => { current = null; });
    return current;
  };
  /** how many of the sources a read covered still say they could not be read */
  const failedOf = (list: readonly StoreSource[]): number => {
    const now = new Map(provider.sources.get().map((s) => [s.id, s]));
    return list.filter((s) => !!now.get(s.id)?.error).length;
  };
  const r: Reader = { state, read };
  readers.set(provider, r);
  return r;
}
