// @vitest-environment jsdom
/* The store view over the mock store, on the kit (board 15): the front page and its kinds, search, an item's page (licence, undeclared
   egress, the engine plugin's plain words), the review card with its hold, the install, Installed (switches, an update, a banner) and
   Sources (one off for unverified terms, adding one). The rendered text is checked for the engine's name outside an item's own text. */
import { beforeAll, describe, expect, it } from 'vitest';
import { engineWordsIn } from '../../core/engine-words';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { createMockStore } from '../../data/mock-store';
import { submitForm } from '../cards/form';
import { mountStore } from './view';
import { letters } from '../../core/letters';
import { itemTile } from '@boopis/ui';
import { markRef } from './model';
import { BOARD15_ITEMS, BOARD15_MODS } from '../../lab/board-fixtures';
import type { StoreView } from './view';

const tick = (ms = 0): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
beforeAll(() => { setProvider(createMockProvider()); });

function mount(o: Parameters<typeof createMockStore>[0] = {}, project: string | null = null): { root: HTMLElement; view: StoreView; store: ReturnType<typeof createMockStore> } {
  const root = document.createElement('div'); document.body.append(root);
  const store = createMockStore(o);
  const view = mountStore(root, { store, notify: () => undefined, project: () => project, settle: 0, enter: false });
  return { root, view, store };
}
const text = (root: HTMLElement): string => root.textContent ?? '';
const heads = (root: HTMLElement): string[] => [...root.querySelectorAll('.hx-store__group > .k7-shead .k7-shead__title, .hx-store__group > .k7-shead')].filter((h) => !h.querySelector('.k7-shead__title')).map((h) => (h.querySelector('.k7-shead__title') ?? h).textContent ?? '');
const search = (root: HTMLElement): HTMLInputElement => root.querySelector<HTMLInputElement>('#hx-store-q') as HTMLInputElement;
const type = async (root: HTMLElement, q: string): Promise<void> => { const i = search(root); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); await tick(250); };
const chip = (root: HTMLElement, kind: string): HTMLElement => root.querySelector<HTMLElement>('[data-kit~="Chip"][data-value="' + kind + '"]') as HTMLElement;
const review = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>('.hx-store__hero [data-store-review]');
const switchOf = (root: HTMLElement, sel: string): HTMLElement => root.querySelector<HTMLElement>(sel) as HTMLElement;

describe('the store view', () => {
  it('opens on Recommended, then each kind, with a missing review said in words and no ratings or counts', async () => {
    const { root } = mount(); await tick(20);
    expect(heads(root)).toEqual(['Recommended', 'Skills', 'Connectors', 'Plugins', 'Mods', 'Engine plugins']);
    expect(text(root)).toContain('Not reviewed');
    expect(text(root)).not.toMatch(/stars?|downloads|installs\b|rating/i);
    expect(engineWordsIn(root)).toEqual([]);
  });
  it('board 15: the kinds as filter chips, and the head\'s end says how many are installed', async () => {
    const { root } = mount(); await tick(20);
    expect([...root.querySelectorAll('.hx-store__chips [data-kit~="Chip"]')].map((c) => c.textContent)).toEqual(['All', 'Skills', 'Connectors', 'Plugins', 'Mods', 'Engine plugins']);
    expect(chip(root, 'all').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[data-store-go="installed"]')?.textContent).toBe('2 installed');
    expect(root.querySelector('.hx-store__grid > [data-kit~="ListRow"][data-variant="item"] .k7-lrow__mark')).not.toBeNull();
  });
  it('searches the cache, filters by kind, and says when nothing matches', async () => {
    const { root } = mount(); await tick(20);
    await type(root, 'zzzzqq');
    expect(text(root)).toContain('Nothing matches');
    await type(root, 'firecrawl');
    expect(root.querySelectorAll('[data-store-open]').length).toBe(1);
    await type(root, '');
    chip(root, 'mod').click(); await tick(30);
    expect(root.querySelectorAll('[data-store-open]').length).toBe(1);
    expect(chip(root, 'mod').getAttribute('aria-pressed')).toBe('true');
    expect(chip(root, 'all').getAttribute('aria-pressed')).toBe('false');
  });
  it('an item\'s page shows the licence, says undeclared egress is not known, and what an engine plugin does', async () => {
    const { root, view } = mount();
    view.show('browse', 'mcp-registry:com.example/tickets'); await tick(20);
    expect(text(root)).toMatch(/Licence/); expect(text(root)).toMatch(/Hosts.*Not known/s); expect(text(root)).toMatch(/Not reviewed/);
    view.show('browse', 'engine-plugins:example-metrics'); await tick(20);
    expect(text(root)).toContain('runs inside the engine, in every session, governed ones included');
    expect(text(root)).toContain('outside the sandbox');
  });
  it('a removed item and an unpinned one cannot be installed', async () => {
    const { root, view } = mount();
    view.show('browse', 'engine-plugins:example-old-sync'); await tick(20);
    expect(text(root)).toContain('Taken down'); expect(review(root)).toBeNull();
    view.show('browse', 'github:example-org/loose-skill'); await tick(20);
    expect(text(root)).toContain('will not install it'); expect(review(root)).toBeNull();
  });
  it('reviews, then installs on the hold, then lists it as installed', async () => {
    const { root, view, store } = mount({ empty: true });
    view.show('browse', 'skills-hub:example-org/sql-review'); await tick(20);
    review(root)?.click(); await tick(30);
    const card = root.querySelector('hx-card') as HTMLElement & { holdButton(): unknown };
    expect(card).not.toBeNull();
    expect(text(root)).toContain('Plan hash'); expect(text(root)).toContain('Install');
    expect(store.installed.get()).toEqual([]);
    expect(await submitForm(card as never, true)).toBe(true);
    await tick(30);
    expect(store.installed.get().map((r) => r.item_id)).toEqual(['skills-hub:example-org/sql-review']);
    expect(text(root)).toContain('is installed');
    expect(engineWordsIn(root)).toEqual([]);
  });
  it('offers a fresh review when the plan changed, and only this bot where the project forbids hooks', async () => {
    const store = createMockStore({ empty: true });
    const bad = { ...store, install: () => Promise.reject({ code: 'hx.store.plan_changed', message: 'What would be installed changed since the card was shown, so nothing was installed. Review it again.' }) };
    const host = document.createElement('div'); document.body.append(host);
    const v2 = mountStore(host, { store: bad, notify: () => undefined, project: () => '~/work/api', settle: 0, enter: false });
    v2.show('browse', 'anthropic:example-lint-kit'); await tick(20);
    review(host)?.click(); await tick(40);
    expect(host.textContent).toContain('Plugin hooks are off in this project');
    expect(host.querySelector('[data-kit~="Segmented"] [data-value="bot-project"]')).toBeNull();
    const card = host.querySelector('hx-card') as never;
    await submitForm(card, true); await tick(30);
    expect(host.textContent).toContain('Review again');
  });
  it('Installed has switches and an update; its page has Review the update, Roll back and Remove', async () => {
    const { root, view, store } = mount();
    await store.checkUpdates();
    view.show('installed'); await tick(20);
    expect(root.querySelectorAll('[data-store-switch]').length).toBe(2);
    expect(text(root)).toContain('update');
    const sw = switchOf(root, '[data-store-switch="boopis:firecrawl"]');
    sw.click(); await tick(10);
    expect(store.installed.get().find((r) => r.item_id === 'boopis:firecrawl')?.enabled).toBe(false);
    (root.querySelector('[data-store-open="anthropic:example-lint-kit"]') as HTMLElement).click(); await tick(20);
    expect(review(root)?.textContent).toBe('Review the update');
    expect(root.querySelector('[data-store-rollback]')).not.toBeNull();
    expect(root.querySelector('[data-store-remove]')).not.toBeNull();
  });
  it('keeps the focus on a switch after turning it, though the screen redraws with the new state', async () => {
    const { root, view } = mount(); view.show('installed'); await tick(30);
    const find = (): HTMLElement => switchOf(root, '[data-store-switch="boopis:firecrawl"]');
    const before = find(); before.focus();
    before.click(); await tick(30);
    expect(find()).not.toBe(before);
    expect(document.activeElement).toBe(find());
    view.show('sources'); await tick(30);
    const src = switchOf(root, '[data-store-src="mcp-registry"]');
    src.focus(); src.click(); await tick(30);
    expect(document.activeElement).toBe(root.querySelector('[data-store-src="mcp-registry"]'));
  });
  it('shows the project switch on by default for a governed project', async () => {
    const { root, view } = mount({}, '~/work/api');
    view.show('installed'); await tick(30);
    expect(text(root)).toContain('No engine plugins and no plugin hooks');
    expect(root.querySelector('[data-store-policy-switch]')?.getAttribute('aria-checked')).toBe('true');
  });
  it('Sources shows a source that is off with the reason, and adds and removes your own', async () => {
    const { root, view, store } = mount();
    (store.sources as unknown as { update(fn: (l: readonly import('../../data').StoreSource[]) => readonly import('../../data').StoreSource[]): void }).update((l) => l.map((x, i) => (i === 0 ? { ...x, label: 'A catalogue', enabled: false, terms: 'unverified' as const, note: 'Its terms have not been read.' } : x)));
    view.show('sources'); await tick(20);
    expect(text(root)).toMatch(/A catalogue[\s\S]*Off until its terms are checked/);
    await store.addSource({ url: 'https://example.com/plugins' }); await tick(30);
    expect(root.querySelector('[data-store-src-remove]')).not.toBeNull();
  });
  it('says offline with the saved copy\'s age, and shows a failure as the host\'s sentence', async () => {
    const { root } = mount({ offline: true }); await tick(20);
    expect(root.querySelector('[data-store-fresh]')?.textContent).toMatch(/^You are offline: this copy is from /);
    const bad = document.createElement('div'); document.body.append(bad);
    const s = createMockStore();
    mountStore(bad, { store: { ...s, browse: () => Promise.reject({ code: 'hx.store.source_unreachable', message: 'boopis could not reach that source. What you see is the last copy it saved.' }) }, notify: () => undefined, enter: false }); await tick(20);
    expect(bad.textContent).toContain('boopis could not reach that source');
    expect(bad.textContent).not.toContain('hx.store');
  });
  it('draws each item as board 15\'s row: its tile, Get or Open, a word only where one is needed; the row opens its page', async () => {
    const { root } = mount(); await tick(20);
    const row = root.querySelector<HTMLElement>('[data-store-item-row="mcp-registry:com.example/tickets"]') as HTMLElement;
    expect(row.querySelector('.k7-lrow__mark')?.textContent).toBe('TC');
    expect(row.querySelector('[data-store-open]')?.textContent).toBe('Get');
    expect(row.querySelector('[data-kit~="StatusWord"]')?.textContent).toBe('needs a key');
    expect(root.querySelector('[data-store-item-row="engine-plugins:example-old-sync"] [data-kit~="StatusWord"]')?.getAttribute('data-tone')).toBe('owe');
    expect(root.querySelector('[data-store-item-row="boopis:firecrawl"] [data-store-open]')?.textContent).toBe('Open');
    row.click(); await tick(20);
    expect(root.querySelector('.hx-store__hero .k7-lrow__title')?.textContent).toBe('Tickets');
    const facts = [...root.querySelectorAll('.hx-store__sheet .k7-row__label')].map((d) => d.childNodes[0]?.textContent);
    expect(facts.indexOf('Keys')).toBeLessThan(facts.indexOf('Contents'));   /* what it needs comes before what it adds */
    (root.querySelector('[data-store-back]') as HTMLElement).click(); await tick(20);
    expect(search(root)).not.toBeNull();
  });
  it('the keyboard: down from the search to the first row\'s button, on through the rows, up to the search again', async () => {
    const { root } = mount(); await tick(20);
    const q = search(root);
    q.focus();
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    const all = [...root.querySelectorAll<HTMLElement>('.hx-store__list [data-store-open]')];
    expect(document.activeElement).toBe(all[0]);
    all[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(all[1]);
    all[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    all[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(q);
  });
  it('Enter in the search opens the one result; nothing matching offers to clear the search', async () => {
    const { root } = mount(); await tick(20);
    await type(root, 'zzzzqq');
    const clear = root.querySelector<HTMLElement>('[data-store-clear]') as HTMLElement;
    expect(clear.textContent).toBe('Clear the search');
    clear.click(); await tick(30);
    expect(search(root).value).toBe('');
    expect(root.querySelectorAll('[data-store-item-row]').length).toBeGreaterThan(3);
    await type(root, 'firecrawl');
    expect(heads(root)[0]).toBe('1 result for “firecrawl”');
    search(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick(20);
    expect(root.querySelector('.hx-store__hero .k7-lrow__title')?.textContent).toBe('Firecrawl');
  });
  it('a search narrowed to a kind that finds nothing offers the host\'s count in every kind instead', async () => {
    const { root } = mount(); await tick(20);
    chip(root, 'mod').click(); await tick(30);
    await type(root, 'firecrawl');
    expect(text(root)).toContain('Nothing matches “firecrawl”');
    const widen = root.querySelector<HTMLElement>('[data-store-widen]') as HTMLElement;
    expect(widen.textContent).toBe('Show 1 result in every kind');
    expect(root.querySelector('[data-store-clear]')).toBeNull();
    widen.click(); await tick(30);
    expect(root.querySelectorAll('[data-store-item-row]')).toHaveLength(1);
  });
  it('the head\'s end goes to Installed, then to Sources, and back the way it came', async () => {
    const { root } = mount(); await tick(20);
    (root.querySelector('[data-store-go="installed"]') as HTMLElement).click(); await tick(20);
    expect(root.querySelectorAll('[data-store-item-row] .k7-lrow__mark').length).toBeGreaterThan(0);
    (root.querySelector('[data-store-go="sources"]') as HTMLElement).click(); await tick(20);
    expect(root.querySelector('[data-store-back]')?.textContent).toBe('Installed');
    (root.querySelector('[data-store-back]') as HTMLElement).click(); await tick(20);
    expect(root.querySelector('[data-store-go="sources"]')).not.toBeNull();
  });
  it('board 15\'s items take the kit\'s one tile rule: brand marks in colour, a proven publisher\'s mark, a mod\'s glyph, letters where none is known', () => {
    const t = [...BOARD15_ITEMS, ...BOARD15_MODS].map((i) => { const x = itemTile(markRef(i), i.title); return 'markText' in x ? x.markText : /data-mark="([^"]+)"/.exec(x.markHTML)?.[1] ?? 'glyph'; });
    expect(t).toEqual(['context7', 'anthropic', 'github', 'playwright', 'linear', 'supabase', 'glyph', 'glyph']);   /* Context7 and Playwright from the brands' own files (2a) */
  });
  it('board 15\'s tile letters: two from the name', () => {
    expect([letters('Context7'), letters('GitHub'), letters('Linear'), letters('Frontend design'), letters('Pomodoro band')]).toEqual(['C7', 'GH', 'LN', 'FD', 'PB']);
  });
});
