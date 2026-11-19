/* The provider an app state boots on. The lab is test tooling, not a module, so it may build on the mock provider
   (src/data/README.md): the mock as it is, with fixtures, with the roster replaced (no bots, one, a hundred and more),
   with no sessions (the empty app), or the live provider over recorded gateway frames (real data). */
import type { DataProvider } from '../data/provider';
import { createMockProvider } from '../data/mock-provider';
import { store } from '../data/store';
import type { Bot, Wait } from '../data/types';
import type { ProviderSpec } from './types';
import { manyBots } from './fixtures';

export async function labProvider(spec: ProviderSpec = {}): Promise<DataProvider> {
  if (spec.replay) {
    const { connectReplay } = await import('../host/connect-replay');
    const p = await connectReplay(spec.replay);
    return spec.patch ? spec.patch(p) : p;
  }
  let p = createMockProvider({ fixtures: spec.fixtures ?? [], simulate: spec.simulate ?? false });
  if (spec.bots !== undefined) {
    const base = p.bots.snapshot();
    const roster: readonly Bot[] = spec.bots === 'none' ? [] : spec.bots === 'one' ? base.bots.slice(0, 1) : manyBots(spec.bots, base.bots);
    const ids = new Set(roster.map((b) => b.id));
    const threads = Object.fromEntries(Object.entries(base.threads).filter(([id]) => ids.has(id)));
    const waits = p.waits.snapshot().filter((w: Wait) => !w.bot || ids.has(w.bot));
    p = {
      ...p,
      bots: { ...p.bots, snapshot: () => ({ bots: roster, threads }) },
      waits: { ...p.waits, snapshot: () => waits },
      schedules: { ...p.schedules, list: store(p.schedules.list.get().filter((s) => ids.has(s.bot))) }
    };
  }
  if (spec.sessions !== undefined) {
    const all = p.sessions.list.get();
    const list = spec.sessions === 'none' ? [] : Array.from({ length: spec.sessions }, (_, i) => ({ ...(all[i % all.length] ?? all[0]!), id: i < all.length ? all[i]!.id : 'lab-s' + i, title: (all[i % all.length]?.title ?? 'session') + (i >= all.length ? ' ' + i : '') }));
    p = { ...p, sessions: { ...p.sessions, list: store(list) } };
  }
  return spec.patch ? spec.patch(p) : p;
}
