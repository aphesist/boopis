/* Switching sessions never stops a running turn (docs/specs/session-launch.md 2.2, acceptance tests 1 and 3): selecting another
   session sends no stop; the stop key stops the session on screen only; running is each session's own. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import type { DataProvider } from '../../data';
import { VIEW, isRunning, selectSession } from './conversation';

let p: DataProvider;
beforeEach(() => {
  p = createMockProvider({ simulate: false });
  setProvider(p);
  VIEW.col = null; VIEW.composer = null;
});

describe('switching sessions', () => {
  it('sends no stop to the session it leaves, even while it runs', () => {
    const [a, b] = p.sessions.list.get();
    if (!a || !b) throw new Error('the mock has two sessions');
    const stop = vi.spyOn(p.sessions, 'stop');
    selectSession(a.id, { quiet: true });
    vi.spyOn(p.sessions, 'conversation').mockReturnValue({ snapshot: () => ({ turns: [{ id: 't', role: 'assistant', model: '', time: '', cost: '', stepCount: 0, steps: [], paragraphs: [], bullets: [], status: 'running' }] }), subscribe: () => () => undefined });
    expect(isRunning(a.id)).toBe(true);
    selectSession(b.id, { quiet: true });
    expect(stop).not.toHaveBeenCalled();
    expect(VIEW.current).toBe(b.id);
  });
  it('running is read from each session\'s own conversation', () => {
    const [a] = p.sessions.list.get();
    if (!a) throw new Error('the mock has a session');
    vi.spyOn(p.sessions, 'conversation').mockReturnValue({ snapshot: () => ({ turns: [{ id: 'u', role: 'user', at: '', text: 'x' }] }), subscribe: () => () => undefined });
    expect(isRunning(a.id)).toBe(false);
  });
});
