/* Small reactive containers the providers build their streams from. */
import type { Feed, Unsubscribe, Watch } from './provider';

export interface Store<T> extends Watch<T> { set(value: T): void; update(fn: (current: T) => T): void }
/** a Watch you can write: subscribers are called with every new value, in subscription order */
export function store<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  return {
    get: () => value,
    set(v) { value = v; for (const f of [...subs]) f(v); },
    update(fn) { this.set(fn(value)); },
    subscribe(fn): Unsubscribe { subs.add(fn); return () => { subs.delete(fn); }; }
  };
}

export interface Emitter<E> { emit(e: E): void; subscribe(fn: (e: E) => void): Unsubscribe }
export function emitter<E>(): Emitter<E> {
  const subs = new Set<(e: E) => void>();
  return { emit(e) { for (const f of [...subs]) f(e); }, subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; } };
}

/** a Feed from a snapshot function and an emitter */
export function feed<S, E>(snapshot: () => S, source: Pick<Emitter<E>, 'subscribe'>): Feed<S, E> {
  return { snapshot, subscribe: (fn) => source.subscribe(fn) };
}
