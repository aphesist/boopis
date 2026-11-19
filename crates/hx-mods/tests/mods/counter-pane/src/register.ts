// A pane with a `$.state` counter, a button that increments it, and a `$.clock.every` tick.
// Both numbers are state atoms, so the pane redraws when either changes.
import type { Atom } from './types';
import { Counter } from './view';

interface Options {
  tickMs: number;
  title: string;
}

let count: Atom<number> | undefined;
let ticks: Atom<number> | undefined;

export function register(on: any, options: Options): void {
  on('session.start', async ($: any, e: unknown, next: (e: unknown) => Promise<unknown>) => {
    count = $.state.atom(0) as Atom<number>;
    ticks = $.state.atom(0) as Atom<number>;
    await $.ui.open({ id: 'counter', title: options.title });
    $.clock.every(options.tickMs, () => $.state.update(ticks, (n: number) => n + 1));
    return next(e);
  });

  on('ui.render', { component: 'Pane', id: 'counter' }, async ($: any) => {
    const n: number = $.state.read(count);
    const t: number = $.state.read(ticks);
    return Counter({ count: n, ticks: t, onIncrement: () => $.state.update(count, (c: number) => c + 1) });
  });
}
