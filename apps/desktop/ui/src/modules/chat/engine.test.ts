// @vitest-environment jsdom
/* The line a thread ends with while boopis's engine is stopped (board S36; modules/chat/engine.ts): it is the kit's SystemLine in the
   error colour with the one way out, it stays the thread's last line whatever is drawn after it, its action asks the provider to start
   the engine again and is not drawn where the provider cannot, and it goes when the engine is back. */
import { beforeEach, describe, expect, it } from 'vitest';
import { setProvider } from '../../data';
import type { DataProvider, EngineState } from '../../data/provider';
import { createMockProvider } from '../../data/mock-provider';
import { store } from '../../data/store';
import { engineLine, followEngine } from './engine';

const tick = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
let col: HTMLElement, state: ReturnType<typeof store<EngineState>>, restarts: number, fail: Error | null;
function boot(o: { restart?: boolean; stopped?: boolean } = {}): void {
  const p = createMockProvider({ simulate: false });
  state = store<EngineState>({ stopped: o.stopped ?? true, restarting: false, why: 'boopis\'s engine is not answering.' });
  restarts = 0; fail = null;
  const provider: DataProvider = { ...p, engine: { state, ...(o.restart === false ? {} : { restart: () => { restarts++; return fail ? Promise.reject(fail) : Promise.resolve(); } }) } };
  setProvider(provider);
  document.body.innerHTML = '<div id="hx-notify"></div><div id="col"><p>a message</p></div>';
  col = document.getElementById('col') as HTMLElement;
}
const line = (): HTMLElement | null => col.querySelector<HTMLElement>(':scope > [data-engine]');
beforeEach(() => { boot(); });

describe('the engine stopped (board S36)', () => {
  it('is the kit\'s SystemLine in the error colour: the close glyph, "boopis\'s engine stopped", and "Start it again" as its one action', () => {
    const n = engineLine() as HTMLElement;
    expect(n.getAttribute('data-kit')).toBe('SystemLine');
    expect(n.dataset['variant']).toBe('error');
    expect(n.querySelector('.k7-sys__text')?.textContent).toBe('boopis\'s engine stopped');
    expect([...n.querySelectorAll('button')].map((b) => [b.textContent?.trim(), b.dataset['variant']])).toEqual([['Start it again', 'tint']]);
    expect(n.getAttribute('data-tip')).toBe('boopis\'s engine is not answering.');   /* why, as the host said it */
  });
  it('no line while the engine is reachable, and none where the provider has no engine of its own (the page build)', () => {
    boot({ stopped: false });
    expect(engineLine()).toBeNull();
    setProvider(createMockProvider({ simulate: false }));
    expect(engineLine()).toBeNull();
    expect(createMockProvider({ simulate: false }).engine).toBeUndefined();
  });
  it('where the host cannot start it again the line shows without its action', () => {
    boot({ restart: false });
    const n = engineLine() as HTMLElement;
    expect(n.querySelector('.k7-sys__text')?.textContent).toBe('boopis\'s engine stopped');
    expect(n.querySelector('button')).toBeNull();
  });
  it('stays the thread\'s last line whatever is drawn after it, and comes back when the thread is drawn again', async () => {
    followEngine(() => col);
    expect(col.lastElementChild).toBe(line());
    col.append(Object.assign(document.createElement('p'), { textContent: 'a later message' }));
    await tick();
    expect(col.lastElementChild).toBe(line());
    expect(col.querySelectorAll('[data-engine]').length).toBe(1);
    col.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'drawn again' }));
    await tick();
    expect(col.lastElementChild).toBe(line());
  });
  it('"Start it again" asks the provider once; while it is asked the action is inert; the line goes when the engine is back', async () => {
    followEngine(() => col);
    (line()?.querySelector('button') as HTMLElement).click();
    expect(restarts).toBe(1);
    state.set({ ...state.get(), restarting: true });
    const b = line()?.querySelector('button') as HTMLElement;
    expect(b.getAttribute('aria-disabled')).toBe('true');
    b.click();
    expect(restarts).toBe(1);
    state.set({ stopped: false, restarting: false, why: null });
    expect(line()).toBeNull();
    state.set({ stopped: true, restarting: false, why: null });   /* it stopped again */
    expect(line()).not.toBeNull();
  });
  it('a restart that could not be asked says why', async () => {
    followEngine(() => col);
    fail = new Error('boopis could not reach its host.');
    (line()?.querySelector('button') as HTMLElement).click();
    await tick();
    expect(document.body.textContent).toContain('boopis could not reach its host.');
    expect(line()).not.toBeNull();
  });
});
