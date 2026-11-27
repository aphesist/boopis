// @vitest-environment jsdom
/* Reading the sources: which sources a read covers, the read's progress row by row, how it ends (so many items read just now, or
   the host's plain reason), and the store's view while it runs: it reads the due sources when it opens, the rows and the line over
   Browse say where each one stands, and a source is never left at "Not read yet" with no attempt. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setProvider } from '../../data';
import type { StoreSource } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { createMockStore } from '../../data/mock-store';
import type { MockStoreOptions } from '../../data/mock-store';
import { freshness, listWords, outOfDate, readingWords, sourceState, upToDateWords } from './model';
import { dueSources, isRefreshable, isStale, keepFresh, readerFor, retryWait } from './reading';
import { mountStore } from './view';

const tick = (ms = 0): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
beforeAll(() => { setProvider(createMockProvider()); });

const NOW = Date.parse('2026-11-22T10:00:00Z');
const src = (o: Partial<StoreSource> & { id: string }): StoreSource => ({
  label: o.id, kinds: [], fetch: 'http-json', default_tier: 'not-reviewed', default_on: true, user_added: false, engine_origin: false, enabled: true, ...o
});
const READ = ['engine-plugins', 'skills-hub', 'anthropic', 'mcp-registry'];
const HUB_DOWN = 'The engine is not running yet. This source is read through it: read the sources again once it has started.';
const REG_DOWN = 'Could not reach registry.modelcontextprotocol.io. Check the connection or proxy, then read the sources again.';

describe('which sources a read covers', () => {
  it('reads the sources the host says are due, or every one a read reaches when asked to', () => {
    const list = [
      src({ id: 'boopis', fetch: 'compiled-in', refreshable: false, stale: false, refreshed_at: '2026-11-22T09:00:00Z' }),
      src({ id: 'engine-plugins', refreshable: true, stale: true }),
      src({ id: 'anthropic', refreshable: true, stale: false, refreshed_at: '2026-11-22T09:00:00Z' }),
      src({ id: 'mcp-registry', refreshable: true, stale: true, enabled: false }),
      src({ id: 'github', fetch: 'github-api', refreshable: false, stale: false })
    ];
    expect(dueSources(list, false).map((s) => s.id)).toEqual(['engine-plugins']);
    expect(dueSources(list, true).map((s) => s.id)).toEqual(['engine-plugins', 'anthropic']);
  });
  it('works out the same from an older host that does not say', () => {
    expect(isRefreshable(src({ id: 'boopis', fetch: 'compiled-in' }))).toBe(false);
    expect(isRefreshable(src({ id: 'github', fetch: 'github-api' }))).toBe(false);
    expect(isRefreshable(src({ id: 'local', fetch: 'local' }))).toBe(false);
    expect(isRefreshable(src({ id: 'local', fetch: 'local', user_added: true }))).toBe(true);
    expect(isStale(src({ id: 'mcp-registry', fetch: 'registry-api' }))).toBe(true);
    expect(isStale(src({ id: 'mcp-registry', fetch: 'registry-api', refreshed_at: '2026-11-22T09:00:00Z' }))).toBe(false);
    expect(isStale(src({ id: 'mcp-registry', fetch: 'registry-api', refreshed_at: '2026-11-22T09:00:00Z', error: REG_DOWN }))).toBe(true);
  });
});

describe('a source row and the line over Browse', () => {
  it('says the source is waiting or being read while a read runs, then what came of it', () => {
    const s = src({ id: 'mcp-registry', refreshable: true, items: 0, refreshed_at: null });
    expect(sourceState(s, NOW, 'waiting')).toEqual({ word: 'reading', text: 'Waiting for its turn to be read…' });
    expect(sourceState(s, NOW, 'reading')).toEqual({ word: 'reading', text: 'Reading it now…' });
    expect(sourceState(s, NOW).text).toBe('Not read yet: it is read when the store opens.');
    expect(sourceState({ ...s, items: 412, refreshed_at: '2026-11-22T09:59:50Z' }, NOW).text).toBe('412 items. Read just now.');
    expect(sourceState({ ...s, error: REG_DOWN }, NOW)).toEqual({ word: 'trouble', text: REG_DOWN });
    expect(sourceState({ ...s, enabled: false, error: REG_DOWN }, NOW).word).toBe('off');
  });
  it('says what a source a read does not reach is, never "Not read yet"', () => {
    expect(sourceState(src({ id: 'boopis', fetch: 'compiled-in', refreshable: false, items: 15 }), NOW).text).toBe('15 items. Built into this version of boopis.');
    expect(sourceState(src({ id: 'github', fetch: 'github-api', refreshable: false, items: 0 }), NOW).text).toMatch(/needs a GitHub sign-in.*Add a source/);
    expect(sourceState(src({ id: 'local', fetch: 'local', refreshable: false, items: 0 }), NOW).text).toBe('Empty until you add one under Add a source.');
  });
  it('says how far a read is and how it ended', () => {
    expect(readingWords({ running: true, done: 1, total: 4, last: null })).toBe('Reading the sources: 1 of 4 read…');
    expect(readingWords({ running: false, done: 0, total: 0, last: null })).toBe('');
    expect(readingWords({ running: false, done: 4, total: 4, last: { total: 4, failed: 0 } })).toBe('The 4 sources were read.');
    expect(readingWords({ running: false, done: 4, total: 4, last: { total: 4, failed: 1 } })).toBe('3 sources read; 1 could not be, and its row says why.');
    expect(readingWords({ running: false, done: 4, total: 4, last: { total: 4, failed: 4 } })).toBe('No source could be read. Each row says why.');
  });
  it('says why the list is out of date: the source that failed and its reason, the ones not read, else its age', () => {
    const b = { offline: false, stale: true, refreshed_at: '2026-11-21T10:00:00Z' };
    const reg = src({ id: 'mcp-registry', label: 'The MCP Registry', refreshable: true });
    const hub = src({ id: 'skills-hub', label: 'Skills from the engine\'s hub', refreshable: true });
    expect(freshness(b, NOW, [{ ...reg, error: REG_DOWN }, { ...hub, refreshed_at: b.refreshed_at }])).toBe(`This list is out of date: The MCP Registry could not be read. ${REG_DOWN}`);
    expect(freshness(b, NOW, [{ ...reg, error: REG_DOWN }, { ...hub, error: HUB_DOWN }])).toBe('This list is out of date: The MCP Registry and Skills from the engine\'s hub could not be read. Sources gives the reason for each.');
    expect(freshness(b, NOW, [reg, hub])).toBe('This list is out of date: The MCP Registry and Skills from the engine\'s hub have not been read yet.');
    expect(freshness(b, NOW, [{ ...reg, refreshed_at: b.refreshed_at, stale: true }])).toBe('This list is out of date: The MCP Registry was last read 24 hours ago.');
    expect(freshness(b, NOW, [{ ...reg, refreshed_at: b.refreshed_at, stale: true }, { ...hub, refreshed_at: '2026-11-19T10:00:00Z', stale: true }])).toBe('This list is out of date: The MCP Registry and Skills from the engine\'s hub are due a read; the oldest was read 3 days ago.');
    expect(freshness(b, NOW, [{ ...reg, refreshed_at: b.refreshed_at }])).toBe('This list is out of date: it was read 24 hours ago.');
    expect(freshness({ ...b, offline: true }, NOW, [])).toBe('You are offline. This is the last copy boopis saved, from 24 hours ago. Read the sources again when you are back online.');
    expect(freshness({ ...b, stale: false }, NOW, [{ ...reg, error: REG_DOWN }])).toBeNull();
  });
});

describe('the reader', () => {
  it('reads the due sources one at a time, says which is being read, and counts the ones that failed', async () => {
    const store = createMockStore({ start: 'unread', reads: { 'skills-hub': { ms: 10, error: HUB_DOWN }, anthropic: { ms: 10 } } });
    const reader = readerFor(store);
    expect(readerFor(store)).toBe(reader);
    const seen: string[] = [];
    reader.state.subscribe((r) => { seen.push([...r.states].map(([id, st]) => id + '=' + st).join(',') + (r.running ? '' : ' end')); });
    const first = reader.read(false);
    expect(reader.read(true)).toBe(first);
    await first;
    expect(seen[0]).toBe(READ.map((id) => id + '=waiting').join(','));
    expect(seen).toContain('skills-hub=reading,anthropic=waiting,mcp-registry=waiting');
    expect(seen.at(-1)).toBe(' end');
    expect(reader.state.get()).toMatchObject({ running: false, done: 4, total: 4, last: { total: 4, failed: 1 } });
    const after = new Map(store.sources.get().map((s) => [s.id, s]));
    expect(after.get('skills-hub')).toMatchObject({ error: HUB_DOWN, stale: true });
    for (const id of ['engine-plugins', 'anthropic', 'mcp-registry']) expect(after.get(id)).toMatchObject({ error: null, stale: false });
    expect(after.get('anthropic')?.refreshed_at).toBeTruthy();
    // read again when the store opens next: only the source that failed is due
    expect(dueSources(store.sources.get(), false).map((s) => s.id)).toEqual(['skills-hub']);
  });
  it('reads nothing when nothing is due', async () => {
    const store = createMockStore();
    const reader = readerFor(store);
    await reader.read(false);
    expect(reader.state.get()).toMatchObject({ running: false, total: 0, last: null });
  });
});

describe('the store view while the sources are read', () => {
  const mount = (o: MockStoreOptions): { root: HTMLElement; view: ReturnType<typeof mountStore>; store: ReturnType<typeof createMockStore>; notices: string[] } => {
    const root = document.createElement('div'); document.body.append(root);
    const store = createMockStore(o);
    const notices: string[] = [];
    const view = mountStore(root, { store, notify: (t) => { notices.push(t); }, project: () => null, settle: 0, enter: false, now: () => NOW });
    return { root, view, store, notices };
  };
  const text = (root: HTMLElement): string => root.textContent ?? '';

  it('Browse says the sources were not read, reads them when the store opens, and lists their items as each one is read', async () => {
    const { root, view } = mount({ start: 'unread', now: () => NOW, reads: { 'engine-plugins': { ms: 30 }, 'skills-hub': { ms: 30 }, anthropic: { ms: 30 }, 'mcp-registry': { ms: 30 } } });
    await tick(20);
    expect(root.querySelector('[data-store-fresh]')?.textContent).toContain('Some sources have not been read yet.');
    expect([...root.querySelectorAll('[data-store-fresh] button')].map((b) => b.textContent)).toEqual(['Read again']);
    const before = root.querySelectorAll('[data-store-open]').length;
    const reading = view.readDue();
    await vi.waitFor(() => { expect(root.querySelector('[data-store-read]')?.textContent).toMatch(/^Reading sources ?[0-3] of 4$/); }, { timeout: 2000, interval: 5 });
    await reading;
    await vi.waitFor(() => {
      expect(root.querySelector('[data-store-fresh]')).toBeNull();
      expect(root.querySelectorAll('[data-store-open]').length).toBeGreaterThan(before);
    }, { timeout: 2000 });
  });
  it('Sources shows each row waiting, being read, then its items or the plain reason, and says how the read ended', async () => {
    const { root, view, notices } = mount({ start: 'unread', now: () => NOW, reads: { 'engine-plugins': { ms: 30 }, 'skills-hub': { ms: 30, error: HUB_DOWN }, anthropic: { ms: 30 }, 'mcp-registry': { ms: 30, error: REG_DOWN } } });
    view.show('sources'); await tick(20);
    expect(text(root)).toContain('Not read yet: it is read when the store opens.');
    expect(text(root)).toContain('Built into this version of boopis.');
    const read = root.querySelector<HTMLButtonElement>('#hx-store-read');
    read?.focus(); read?.click();
    await vi.waitFor(() => { expect(text(root)).toContain('Reading it now…'); }, { timeout: 2000, interval: 2 });
    expect(text(root)).toContain('Waiting for its turn to be read…');
    expect(text(root)).toMatch(/Reading sources ?[0-3] of 4/);
    expect(document.activeElement?.id).toBe('hx-store-read');
    await vi.waitFor(() => { expect(notices.at(-1)).toBe('2 sources read; 2 could not be, and their rows say why.'); }, { timeout: 3000 });
    await vi.waitFor(() => { expect(text(root)).toContain(HUB_DOWN); }, { timeout: 3000 });
    expect(text(root)).toContain(REG_DOWN);
    expect(text(root)).toMatch(/\d+ items?\. Read just now\./);
    expect(text(root)).not.toContain('Not read yet');
    expect(document.activeElement?.id).toBe('hx-store-read');
  });
});

describe('the sources that fall due while the store stays open', () => {
  const HOUR = 3600_000;
  const aged = (start: number): { store: ReturnType<typeof createMockStore>; clock: { t: number } } => {
    const clock = { t: start };
    return { store: createMockStore({ now: () => clock.t, reads: {} }), clock };
  };
  it('the host\'s rule is followed: a copy ages out after its period, the registry\'s is an hour and the rest six', async () => {
    const { store, clock } = aged(NOW);
    expect(dueSources(store.sources.get(), false)).toEqual([]);
    clock.t = NOW + 2 * HOUR;
    await store.reloadSources?.();
    expect(dueSources(store.sources.get(), false).map((s) => s.id)).toEqual(['mcp-registry']);
    clock.t = NOW + 7 * HOUR;
    await store.reloadSources?.();
    expect(dueSources(store.sources.get(), false).map((s) => s.id)).toEqual(READ);
  });
  it('asks the host how old the sources are before it decides what is due, so a store opened hours later reads what aged', async () => {
    const { store, clock } = aged(NOW);
    const reader = readerFor(store);
    await reader.readDue();
    expect(reader.state.get().total).toBe(0);
    clock.t = NOW + 2 * HOUR;
    await reader.readDue();
    expect(reader.state.get()).toMatchObject({ total: 1, done: 1, order: ['mcp-registry'] });
    expect(store.sources.get().find((s) => s.id === 'mcp-registry')?.refreshed_at).toBe(new Date(NOW + 2 * HOUR).toISOString());
  });
  it('keeps looking while open: reads what falls due, nothing while closed, and not a source that failed until its wait is over', async () => {
    const clock = { t: NOW };
    const calls: string[] = [];
    const base = createMockStore({ now: () => clock.t, reads: { 'mcp-registry': { error: REG_DOWN } } });
    const store = { ...base, refresh: (id?: string) => { calls.push(String(id)); return base.refresh(id); } };
    let open = false;
    const stop = keepFresh(store, { open: () => open, every: 10, now: () => clock.t });
    clock.t = NOW + 2 * HOUR;
    await tick(40);
    expect(calls).toEqual([]);                           // closed: nothing is read, however old
    open = true;
    await vi.waitFor(() => { expect(calls).toEqual(['mcp-registry']); }, { timeout: 1000 });
    await tick(60);
    expect(calls).toEqual(['mcp-registry']);             // it failed: it waits, though it is still due
    expect(base.sources.get().find((s) => s.id === 'mcp-registry')).toMatchObject({ error: REG_DOWN, stale: true });
    clock.t += retryWait(1);
    await vi.waitFor(() => { expect(calls).toEqual(['mcp-registry', 'mcp-registry']); }, { timeout: 1000 });
    clock.t += retryWait(1);
    await tick(60);
    expect(calls).toHaveLength(2);                       // the second failure waits twice as long
    clock.t += retryWait(2) - retryWait(1);
    await vi.waitFor(() => { expect(calls).toHaveLength(3); }, { timeout: 1000 });
    stop();
    clock.t += 10 * HOUR; await tick(60);
    expect(calls).toHaveLength(3);                       // stopped
  });
  it('waits longer after each failure, at most an hour', () => {
    expect([1, 2, 3, 4, 5, 9].map(retryWait)).toEqual([5, 10, 20, 40, 60, 60].map((m) => m * 60_000));
  });
  it('the open store reads a source by itself when it falls due, and shows the read as it happens', async () => {
    const clock = { t: NOW };
    const root = document.createElement('div'); document.body.append(root);
    const store = createMockStore({ now: () => clock.t, reads: { 'mcp-registry': { ms: 40 } } });
    const view = mountStore(root, { store, notify: () => undefined, project: () => null, settle: 0, enter: false, now: () => clock.t, every: 15 });
    await tick(30);
    expect(root.querySelector('[data-store-read]')).toBeNull();
    clock.t = NOW + 2 * HOUR;
    await vi.waitFor(() => { expect(root.querySelector('[data-store-read]')?.textContent).toMatch(/^Reading sources ?0 of 1$/); }, { timeout: 2000, interval: 3 });
    await vi.waitFor(() => { expect(root.querySelector('[data-store-read]')?.textContent).toBe('Up to date'); }, { timeout: 2000 });
    expect(store.sources.get().find((s) => s.id === 'mcp-registry')?.stale).toBe(false);
    view.stop(); root.remove();
  });
  it('a store that is not in the document reads nothing', async () => {
    const clock = { t: NOW + 2 * HOUR };
    const root = document.createElement('div');             // never attached
    const store = createMockStore({ now: () => NOW, reads: {} });
    const seen: string[] = [];
    const wrapped = { ...store, refresh: (id?: string) => { seen.push(String(id)); return store.refresh(id); } };
    const view = mountStore(root, { store: wrapped, notify: () => undefined, project: () => null, settle: 0, enter: false, now: () => clock.t, every: 10 });
    await tick(60); view.stop();
    expect(seen).toEqual([]);
  });
});

describe('the read on Browse (board 15: one line, "Reading sources 0 of 1")', () => {
  const mount = (o: MockStoreOptions): { root: HTMLElement; view: ReturnType<typeof mountStore>; store: ReturnType<typeof createMockStore> } => {
    const root = document.createElement('div'); document.body.append(root);
    const store = createMockStore(o);
    const view = mountStore(root, { store, notify: () => undefined, project: () => null, settle: 0, enter: false, now: () => NOW });
    return { root, view, store };
  };
  const line = (root: HTMLElement): string => root.querySelector('[data-store-read]')?.textContent ?? '';

  it('says how far the read is in one line at the kinds\' end, and nothing once it ends on a list that was current', async () => {
    const { root, view } = mount({ start: 'unread', now: () => NOW, reads: { 'engine-plugins': { ms: 20 }, 'skills-hub': { ms: 20 }, anthropic: { ms: 120 }, 'mcp-registry': { ms: 20 } } });
    await tick(10);
    const run = view.readDue();
    await vi.waitFor(() => { expect(line(root)).toMatch(/^Reading sources ?\d of 4$/); }, { timeout: 2000, interval: 3 });
    expect(root.querySelector('[data-store-read]')?.getAttribute('role')).toBe('status');
    await run;
    await vi.waitFor(() => { expect(line(root)).toBe('Up to date'); }, { timeout: 2000 });
  });
  it('says why the list is still out of date after a read that could not reach a source, and offers the reasons and another try', async () => {
    const { root, view } = mount({ start: 'unread', now: () => NOW, reads: { 'skills-hub': { ms: 5, error: HUB_DOWN }, 'mcp-registry': { ms: 5, error: REG_DOWN } } });
    await tick(10);
    await view.readDue();
    await vi.waitFor(() => { expect(root.querySelector('[data-store-fresh]')?.textContent).toContain('2 sources could not be read.'); }, { timeout: 2000 });
    const buttons = [...root.querySelectorAll('[data-store-fresh] button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Read again', 'Show why']);
    [...root.querySelectorAll<HTMLElement>('[data-store-fresh] button')].find((b) => b.textContent === 'Show why')?.click();
    await vi.waitFor(() => { expect(root.textContent).toContain(HUB_DOWN); }, { timeout: 2000 });
    expect(root.textContent).toContain(REG_DOWN);
  });
  it('checks the fix: pressing Read again on an out-of-date list reads again, and the line then says the list is current', async () => {
    const reads: Record<string, { ms?: number; error?: string }> = { 'skills-hub': { ms: 5, error: HUB_DOWN } };
    const { root, view } = mount({ start: 'unread', now: () => NOW, reads });
    await tick(10);
    await view.readDue();
    await vi.waitFor(() => { expect(root.querySelector('[data-store-fresh]')?.textContent).toContain('A source could not be read.'); }, { timeout: 2000 });
    // the first press, with the engine still not running: the list is still out of date, and the Notice still says so
    const press = (): void => { [...root.querySelectorAll<HTMLElement>('[data-store-fresh] button')].find((b) => b.textContent === 'Read again')?.click(); };
    press();
    await vi.waitFor(() => { expect(line(root)).toMatch(/^Reading sources ?\d of 4$/); }, { timeout: 2000, interval: 3 });
    await vi.waitFor(() => { expect(root.querySelector('[data-store-fresh]')?.textContent).toContain('A source could not be read.'); expect(line(root)).not.toMatch(/Reading/); }, { timeout: 3000 });
    expect(line(root)).not.toBe('Up to date');
    // the engine has started: the same press now puts the list right, and the line says so
    delete reads['skills-hub'];
    (document.activeElement as HTMLElement | null)?.blur();
    press();
    await vi.waitFor(() => { expect(line(root)).toBe('Up to date'); }, { timeout: 3000 });
    expect(root.querySelector('[data-store-fresh]')).toBeNull();
  });
});

describe('the words of an out-of-date list and of the check after a read', () => {
  const reg = src({ id: 'mcp-registry', label: 'The MCP Registry', refreshable: true });
  it('names the cause: offline, failed, never read, or old', () => {
    const b = { offline: false, stale: true, refreshed_at: '2026-11-21T10:00:00Z' };
    expect(outOfDate({ ...b, offline: true }, NOW, [])).toMatchObject({ why: 'offline', failed: 0 });
    expect(outOfDate(b, NOW, [{ ...reg, error: REG_DOWN }])).toMatchObject({ why: 'failed', failed: 1 });
    expect(outOfDate(b, NOW, [reg])).toMatchObject({ why: 'unread', failed: 0 });
    expect(outOfDate(b, NOW, [{ ...reg, refreshed_at: b.refreshed_at, stale: true }])).toMatchObject({ why: 'old' });
    expect(outOfDate(b, NOW, [])).toMatchObject({ why: 'unknown' });
    expect(outOfDate({ ...b, stale: false }, NOW, [reg])).toBeNull();
  });
  it('lists names in words', () => {
    expect(listWords(['a'])).toBe('a');
    expect(listWords(['a', 'b'])).toBe('a and b');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
    expect(listWords(['a', 'b', 'c', 'd', 'e'])).toBe('a, b and 3 more');
  });
  it('says the list is current only when a read covered something', () => {
    expect(upToDateWords({ last: null })).toBe('');
    expect(upToDateWords({ last: { total: 1, failed: 0 } })).toBe('The list is up to date: the source was read just now.');
    expect(upToDateWords({ last: { total: 4, failed: 0 } })).toBe('The list is up to date: the 4 sources were read just now.');
  });
});
