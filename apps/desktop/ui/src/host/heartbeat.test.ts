import { describe, expect, it, vi } from 'vitest';

vi.mock('./bindings', () => ({ commands: {} }));

import { BEAT_EVERY, TICK_MS, heartbeat, stallOf } from './heartbeat';

describe('the heartbeat', () => {
  it('counts lateness only while the page was visible', () => {
    expect(stallOf(2000, 2100, true)).toBe(100);
    expect(stallOf(2000, 1990, true)).toBe(0);
    expect(stallOf(2000, 60000, false)).toBe(0);
  });

  it('beats at once and then every few ticks with the worst stall since, and shows a notice once', async () => {
    let t = 0, visible = true;
    const beats: [boolean, number][] = [];
    const notices: string[] = [];
    let owed: string | null = 'The window stopped responding, so boopis reloaded it. Your sessions are as they were.';
    const hb = heartbeat({
      now: () => t, visible: () => visible,
      beat: (v, s) => { beats.push([v, s]); const n = owed; owed = null; return Promise.resolve({ notice: n }); },
      notice: (x) => notices.push(x)
    });
    t += TICK_MS; await hb.tick();
    expect(beats).toEqual([[true, 0]]);
    expect(notices).toHaveLength(1);
    t += TICK_MS + 3000; await hb.tick();            /* a 3 s stall */
    for (let i = 2; i < BEAT_EVERY; i++) { t += TICK_MS; await hb.tick(); }
    t += TICK_MS; await hb.tick();
    expect(beats[1]).toEqual([true, 3000]);
    expect(notices).toHaveLength(1);
  });

  it('does not count time spent hidden as a stall', async () => {
    let t = 0, visible = true;
    const beats: number[] = [];
    const hb = heartbeat({ now: () => t, visible: () => visible, beat: (_v, s) => { beats.push(s); return Promise.resolve({ notice: null }); }, notice: () => undefined });
    await hb.tick();
    visible = false; hb.flip();
    t += 120000; await hb.tick();                     /* throttled while hidden */
    visible = true; hb.flip();
    for (let i = 2; i <= BEAT_EVERY; i++) { t += TICK_MS; await hb.tick(); }
    expect(beats).toEqual([0, 0]);
  });
});
