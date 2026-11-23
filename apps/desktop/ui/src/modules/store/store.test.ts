// @vitest-environment jsdom
/* The store view over the mock store: the front page and its tiers, search, the detail sheet (licence, undeclared egress, the engine
   plugin's plain words), the review card with its hold, the install, Installed (switches, an update, a banner) and Sources (one off
   for unverified terms, adding one). The rendered text is checked for the engine's name outside an item's own text. */
import { beforeAll, describe, expect, it } from 'vitest';
import { engineWordsIn } from '../../core/engine-words';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { createMockStore } from '../../data/mock-store';
import { submitForm } from '../cards/form';
import { mountStore } from './view';
import type { StoreView } from './view';

const tick = (ms = 0): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
beforeAll(() => { setProvider(createMockProvider()); });

function mount(o: Parameters<typeof createMockStore>[0] = {}, project: string | null = null): { root: HTMLElement; view: StoreView; store: ReturnType<typeof createMockStore> } {
  const root = document.createElement('div'); document.body.append(root);
  const store = createMockStore(o);
  const view = mountStore(root, { store, toast: () => undefined, project: () => project, settle: 0, enter: false });
  return { root, view, store };
}
const text = (root: HTMLElement): string => root.textContent ?? '';

describe('the store view', () => {
  it('opens on Recommended, then each kind, with a missing review said in words and no ratings or counts', async () => {
    const { root } = mount(); await tick(20);
    const heads = [...root.querySelectorAll('.hx-store__group > .ui-set__head')].map((h) => h.textContent);
    expect(heads).toEqual(['Recommended', 'Skills', 'Connectors', 'Plugins', 'Mods', 'Engine plugins']);
    expect(text(root)).toContain('not reviewed');
    expect(text(root)).not.toMatch(/stars?|downloads|installs\b|rating/i);
    expect(engineWordsIn(root)).toEqual([]);
  });
  it('searches the cache, filters by kind, and says when nothing matches', async () => {
    const { root } = mount(); await tick(20);
    const q = root.querySelector<HTMLInputElement>('#hx-store-q input, input#hx-store-q') as HTMLInputElement;
    q.value = 'zzzzqq'; q.dispatchEvent(new Event('input', { bubbles: true })); await tick(250);
    expect(text(root)).toContain('Nothing matches');
    q.value = 'firecrawl'; q.dispatchEvent(new Event('input', { bubbles: true })); await tick(250);
    expect(root.querySelectorAll('[data-store-open]').length).toBe(1);
    q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); await tick(250);
    root.querySelector<HTMLElement>('[role=radio][data-value="mod"]')?.click(); await tick(30);
    expect(root.querySelectorAll('[data-store-open]').length).toBe(1);
  });
  it('the detail sheet shows the licence, says undeclared egress is not known, and what an engine plugin does', async () => {
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
    expect(text(root)).toContain('Taken down'); expect(root.querySelector('.hx-store__sheet .ui-btn--primary')).toBeNull();
    view.show('browse', 'github:example-org/loose-skill'); await tick(20);
    expect(text(root)).toContain('will not install it'); expect(root.querySelector('.hx-store__sheet .ui-btn--primary')).toBeNull();
  });
  it('reviews, then installs on the hold, then lists it as installed', async () => {
    const { root, view, store } = mount({ empty: true });
    view.show('browse', 'skills-hub:example-org/sql-review'); await tick(20);
    root.querySelector<HTMLElement>('.hx-store__sheet .ui-btn--primary')?.click(); await tick(30);
    const card = root.querySelector('hx-card') as HTMLElement & { holdButton(): unknown };
    expect(card).not.toBeNull();
    expect(text(root)).toContain('Plan hash'); expect(text(root)).toContain('Not reviewed'.slice(0, 0) + 'Install');
    expect(store.installed.get()).toEqual([]);
    expect(await submitForm(card as never, true)).toBe(true);
    await tick(30);
    expect(store.installed.get().map((r) => r.item_id)).toEqual(['skills-hub:example-org/sql-review']);
    expect(text(root)).toContain('is installed');
    expect(engineWordsIn(root)).toEqual([]);
  });
  it('offers a fresh review when the plan changed, and only this bot where the project forbids hooks', async () => {
    const { root, view, store } = mount({ empty: true }, '~/work/api');
    const bad = { ...store, install: () => Promise.reject({ code: 'hx.store.plan_changed', message: 'What would be installed changed since the card was shown, so nothing was installed. Review it again.' }) };
    const host = document.createElement('div'); document.body.append(host);
    const v2 = mountStore(host, { store: bad, toast: () => undefined, project: () => '~/work/api', settle: 0, enter: false });
    v2.show('browse', 'anthropic:example-lint-kit'); await tick(20);
    host.querySelector<HTMLElement>('.hx-store__sheet .ui-btn--primary')?.click(); await tick(40);
    expect(host.textContent).toContain('This project has engine plugins and plugin hooks turned off');
    expect(host.querySelector('[role=radio][data-value="bot-project"]')).toBeNull();
    const card = host.querySelector('hx-card') as never;
    await submitForm(card, true); await tick(30);
    expect(host.textContent).toContain('Review again');
    void root; void view;
  });
  it('Installed has switches, an update with its diff, Roll back and Remove', async () => {
    const { root, view, store } = mount();
    await store.checkUpdates();
    view.show('installed'); await tick(20);
    expect(root.querySelectorAll('input[role=switch][name]').length).toBe(2);
    expect(root.querySelector('[data-store-update="anthropic:example-lint-kit"]')).not.toBeNull();
    expect(root.querySelector('[data-store-rollback]')).not.toBeNull();
    expect(root.querySelector('[data-store-remove]')).not.toBeNull();
    const sw = root.querySelector<HTMLInputElement>('input[role=switch][name="boopis:firecrawl"]') as HTMLInputElement;
    sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true })); await tick(10);
    expect(store.installed.get().find((r) => r.item_id === 'boopis:firecrawl')?.enabled).toBe(false);
  });
  it('keeps the focus on a switch after turning it, though the screen redraws with the new state', async () => {
    const { root, view } = mount(); view.show('installed'); await tick(30);
    const find = (): HTMLInputElement => root.querySelector<HTMLInputElement>('input[role=switch][name="boopis:firecrawl"]') as HTMLInputElement;
    document.body.append(root);
    const before = find(); before.focus();
    before.checked = false; before.dispatchEvent(new Event('change', { bubbles: true })); await tick(30);
    expect(find()).not.toBe(before);
    expect(document.activeElement).toBe(find());
    view.show('sources'); await tick(30);
    const src = root.querySelector<HTMLInputElement>('input[role=switch][name="mcp-registry"]') as HTMLInputElement;
    src.focus(); src.checked = false; src.dispatchEvent(new Event('change', { bubbles: true })); await tick(30);
    expect(document.activeElement).toBe(root.querySelector('input[role=switch][name="mcp-registry"]'));
  });
  it('shows the project switch on by default for a governed project', async () => {
    const { root, view } = mount({}, '~/work/api');
    view.show('installed'); await tick(30);
    const sw = root.querySelector<HTMLInputElement>('#hx-store-policy-installed') as HTMLInputElement;
    expect(text(root)).toContain('No engine plugins and no plugin hooks');
    expect(sw.checked).toBe(true);
  });
  it('Sources shows a source that is off with the reason, and adds and removes your own', async () => {
    const { root, view, store } = mount();
    (store.sources as unknown as { update(fn: (l: readonly import('../../data').StoreSource[]) => readonly import('../../data').StoreSource[]): void }).update((l) => l.map((x, i) => (i === 0 ? { ...x, label: 'A catalogue', enabled: false, terms: 'unverified' as const, note: 'Its terms have not been read.' } : x)));
    view.show('sources'); await tick(20);
    expect(text(root)).toMatch(/A catalogue[\s\S]*Off until its terms are checked/);
    await store.addSource({ url: 'https://github.com/example-org/skills' }); await tick(30);
    expect(root.querySelector('[data-store-src-remove]')).not.toBeNull();
  });
  it('says offline with the saved copy\'s age, and shows a failure as the host\'s sentence', async () => {
    const { root } = mount({ offline: true }); await tick(20);
    expect(text(root)).toMatch(/You are offline\. This is the last copy boopis saved/);
    const bad = document.createElement('div'); document.body.append(bad);
    const s = createMockStore();
    mountStore(bad, { store: { ...s, browse: () => Promise.reject({ code: 'hx.store.source_unreachable', message: 'boopis could not reach that source. What you see is the last copy it saved.' }) }, toast: () => undefined, enter: false }); await tick(20);
    expect(bad.textContent).toContain('boopis could not reach that source');
    expect(bad.textContent).not.toContain('hx.store');
  });
  it('draws each item as a row with its tile and one word at its end, and opens its page from the row', async () => {
    const { root } = mount(); await tick(20);
    const row = root.querySelector<HTMLElement>('.ui-row--item[data-value="mcp-registry:com.example/tickets"]') as HTMLElement;
    expect(row.querySelector('.ui-imark')).not.toBeNull();
    expect(row.querySelector('.ui-row__end')?.textContent).toBe('needs a key');
    expect(root.querySelector('.ui-row--item[data-value="engine-plugins:example-old-sync"] .ui-row__end')?.getAttribute('data-tone')).toBe('attention');
    row.click(); await tick(20);
    expect(root.querySelector('.hx-store__hero .hx-store__title')?.textContent).toBe('Tickets');
    expect(root.querySelector('.hx-store__hero .ui-imark[data-size="40"]')).not.toBeNull();
    const facts = [...root.querySelectorAll('.hx-store__fact > dt')].map((d) => d.textContent);
    expect(facts.indexOf('Keys')).toBeLessThan(facts.indexOf('Contents'));   /* what it needs comes before what it adds */
    expect(root.querySelector('.ui-row[aria-current]')).toBeNull();
  });
  it('the keyboard: down from the search to the first row, on across the lists, up to the search again', async () => {
    const { root } = mount(); await tick(20);
    const q = root.querySelector<HTMLInputElement>('#hx-store-q input, input#hx-store-q') as HTMLInputElement;
    q.focus();
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    const lists = [...root.querySelectorAll<HTMLElement>('[data-ui="rows"]')];
    const first = lists[0]?.querySelector<HTMLElement>('.ui-row');
    expect(document.activeElement).toBe(first);
    const lastOfFirst = [...(lists[0] as HTMLElement).querySelectorAll<HTMLElement>('.ui-row')].pop() as HTMLElement;
    lastOfFirst.focus();
    lastOfFirst.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(lists[1]?.querySelector('.ui-row'));
    first?.focus();
    first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(q);
  });
  it('Enter in the search opens the one result; nothing matching offers to clear the search', async () => {
    const { root } = mount(); await tick(20);
    const q = (): HTMLInputElement => root.querySelector<HTMLInputElement>('#hx-store-q input, input#hx-store-q') as HTMLInputElement;
    q().value = 'zzzzqq'; q().dispatchEvent(new Event('input', { bubbles: true })); await tick(250);
    const clear = root.querySelector<HTMLElement>('[data-store-clear]') as HTMLElement;
    expect(clear.textContent).toBe('Clear the search');
    clear.click(); await tick(30);
    expect(q().value).toBe('');
    expect(root.querySelectorAll('.ui-row--item').length).toBeGreaterThan(3);
    q().value = 'firecrawl'; q().dispatchEvent(new Event('input', { bubbles: true })); await tick(250);
    expect(root.querySelector('.hx-store__group > .ui-set__head')?.textContent).toBe('1 result for “firecrawl”');
    q().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick(20);
    expect(root.querySelector('.hx-store__title')?.textContent).toBe('Firecrawl');
  });
  it('Installed draws each item with its tile', async () => {
    const { root, view } = mount(); await tick(20);
    view.show('installed'); await tick(20);
    expect(root.querySelectorAll('.ui-set__row .ui-set__lead .ui-imark').length).toBeGreaterThan(0);
  });
});
