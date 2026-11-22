// @vitest-environment jsdom
/* Reading the sources: which sources a read covers, the read's progress row by row, how it ends (so many items read just now, or
   the host's plain reason), and the store's view while it runs: it reads the due sources when it opens, the rows and the line over
   Browse say where each one stands, and a source is never left at "Not read yet" with no attempt. */
import { beforeAll, describe, expect, it } from 'vitest';
import { setProvider } from '../../data';
import type { StoreSource } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { createMockStore } from '../../data/mock-store';
import type { MockStoreOptions } from '../../data/mock-store';
import { freshness, readingWords, sourceState } from './model';
import { dueSources, isRefreshable, isStale, readerFor } from './reading';
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
    expect(freshness(b, NOW, [{ ...reg, error: REG_DOWN }, { ...hub, error: HUB_DOWN }])).toBe('This list is out of date: 2 sources could not be read. Sources says why for each.');
    expect(freshness(b, NOW, [reg, hub])).toBe('This list is out of date: 2 sources have not been read yet.');
    expect(freshness(b, NOW, [{ ...reg, refreshed_at: b.refreshed_at }])).toBe('This list is out of date: it was read 24 hours ago.');
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
  const mount = (o: MockStoreOptions): { root: HTMLElement; view: ReturnType<typeof mountStore>; store: ReturnType<typeof createMockStore>; toasts: string[] } => {
    const root = document.createElement('div'); document.body.append(root);
    const store = createMockStore(o);
    const toasts: string[] = [];
    const view = mountStore(root, { store, toast: (t) => { toasts.push(t); }, project: () => null, settle: 0, enter: false, now: () => NOW });
    return { root, view, store, toasts };
  };
  const text = (root: HTMLElement): string => root.textContent ?? '';

  it('Browse says the sources were not read, reads them when the store opens, and lists their items as each one is read', async () => {
    const { root, view } = mount({ start: 'unread', now: () => NOW, reads: { 'engine-plugins': { ms: 30 }, 'skills-hub': { ms: 30 }, anthropic: { ms: 30 }, 'mcp-registry': { ms: 30 } } });
    await tick(20);
    expect(text(root)).toContain('This list is out of date: 4 sources have not been read yet.');
    expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Read the sources again')).toBe(true);
    const before = root.querySelectorAll('[data-store-open]').length;
    const reading = view.readDue();
    await tick(45);
    expect(text(root)).toMatch(/Reading the sources: 1 of 4 read…/);
    await reading; await tick(20);
    expect(text(root)).not.toContain('out of date');
    expect(root.querySelectorAll('[data-store-open]').length).toBeGreaterThan(before);
  });
  it('Sources shows each row waiting, being read, then its items or the plain reason, and says how the read ended', async () => {
    const { root, view, toasts } = mount({ start: 'unread', now: () => NOW, reads: { 'engine-plugins': { ms: 30 }, 'skills-hub': { ms: 30, error: HUB_DOWN }, anthropic: { ms: 30 }, 'mcp-registry': { ms: 30, error: REG_DOWN } } });
    view.show('sources'); await tick(20);
    expect(text(root)).toContain('Not read yet: it is read when the store opens.');
    expect(text(root)).toContain('Built into this version of boopis.');
    const read = root.querySelector<HTMLButtonElement>('#hx-store-read');
    read?.focus(); read?.click(); await tick(10);
    expect(text(root)).toContain('Reading it now…');
    expect(text(root)).toContain('Waiting for its turn to be read…');
    expect(text(root)).toContain('Reading the sources: 0 of 4 read…');
    expect(document.activeElement?.id).toBe('hx-store-read');
    await tick(200);
    expect(text(root)).toContain(HUB_DOWN);
    expect(text(root)).toContain(REG_DOWN);
    expect(text(root)).toMatch(/\d+ items?\. Read just now\./);
    expect(text(root)).not.toContain('Not read yet');
    expect(text(root)).toContain('2 sources read; 2 could not be, and their rows say why.');
    expect(toasts.at(-1)).toBe('2 sources read; 2 could not be, and their rows say why.');
    expect(document.activeElement?.id).toBe('hx-store-read');
  });
});
