/* The store view (ADR-0038, docs/STORE.md): Browse (the front page, search, filters, offline, an error, long names), the detail
   sheet, the review card (a connector with a key, an engine plugin, a not-reviewed item, an update with its diff), Installed
   (switches, an update, a kill-list banner, the project's switch) and Sources (the defaults, one off for unverified terms, adding
   one). Each state mounts the view over the mock store (which serves the fixture items) in the lab's cell. */
import { mountStore } from '../../../modules/store/view';
import type { StoreScreen } from '../../../modules/store/view';
import { createMockStore } from '../../../data/mock-store';
import type { MockStoreOptions } from '../../../data/mock-store';
import type { StoreProvider } from '../../../data/provider';
import type { InstallReceipt, StoreBrowse, StoreItem } from '../../../data/types';
import type { StageCtx, State, Story } from '../../types';
import { recommendedItems } from './recommended-items';
import { connectorItems } from './connector-items';

const MOCK = { url: '/v6/__index.html', note: 'the owner has not drawn a store view: it is composed from the kit, for review' };
const NOW = Date.parse('2026-11-21T10:00:00Z');
type Drive = (c: { root: HTMLElement; wait(ms: number): Promise<void>; view: ReturnType<typeof mountStore>; store: StoreProvider }) => Promise<void> | void;

interface Opts { mock?: MockStoreOptions | (() => MockStoreOptions); patch?(s: StoreProvider): StoreProvider; project?: string | null; screen?: StoreScreen; item?: string }
const view = (tags: State['tags'], drive: Drive | null, o: Opts = {}): State => ({
  tags, scope: '.hx-store', mock: MOCK,
  render: async (ctx: StageCtx) => {
    const base = createMockStore(typeof o.mock === 'function' ? o.mock() : { ...(o.mock ?? {}) });
    const store = o.patch ? o.patch(base) : base;
    const project = o.project === undefined ? null : o.project;
    const host = document.createElement('div'); host.className = 'lab-fill'; ctx.root.append(host);
    const v = mountStore(host, { store, toast: () => undefined, project: () => project, settle: 0, now: () => NOW, enter: false });
    if (o.screen || o.item) v.show(o.screen ?? 'browse', o.item);
    await ctx.wait(120);
    if (drive) await drive({ root: ctx.root, wait: ctx.wait, view: v, store });
    await ctx.wait(120);
  }
});
const click = async (c: { root: HTMLElement; wait(ms: number): Promise<void> }, sel: string, ms = 120): Promise<void> => {
  const n = c.root.querySelector<HTMLElement>(sel);
  if (!n) throw new Error('lab: nothing matches ' + sel);
  n.click(); await c.wait(ms);
};
const type = async (c: { root: HTMLElement; wait(ms: number): Promise<void> }, text: string): Promise<void> => {
  const i = c.root.querySelector<HTMLInputElement>('#hx-store-q'); if (!i) throw new Error('lab: no search field');
  i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); await c.wait(450);
};

/** the provider with its browse and search answering with these items */
const withItems = (map: (i: StoreItem) => StoreItem) => (s: StoreProvider): StoreProvider => {
  const fix = (b: StoreBrowse): StoreBrowse => ({ ...b, items: b.items.map(map), ...(b.recommended ? { recommended: b.recommended.map(map) } : {}) });
  return { ...s, browse: async (f, c) => fix(await s.browse(f, c)), search: async (q, f, c) => fix(await s.search(q, f, c)) };
};
const failing = (s: StoreProvider): StoreProvider => ({ ...s, browse: () => Promise.reject({ code: 'hx.store.source_unreachable', message: 'boopis could not reach that source. What you see is the last copy it saved.' }) });
const killListed = (s: StoreProvider): StoreProvider => {
  const w = s.installed as unknown as { update(fn: (l: readonly InstallReceipt[]) => readonly InstallReceipt[]): void; get(): readonly InstallReceipt[] };
  const have = w.get().find((r) => r.item_id === 'anthropic:example-lint-kit');
  if (have) w.update((l) => l.map((r) => (r.item_id === have.item_id ? { ...r, kill_listed: { reason: 'Its source took it down after a report', by: 'source' as const } } : r)));
  return s;
};
const hosted = (s: StoreProvider): StoreProvider => withItems((i) => (i.id === 'mcp-registry:com.example/tickets' && i.pinned ? { ...i, pinned: { ...i.pinned, repo: 'remote:https://mcp.example.com/' } } : i))({
  ...s,
  detail: async (id) => { const d = await s.detail(id); return d.item.pinned ? { ...d, item: { ...d.item, pinned: { ...d.item.pinned, repo: 'remote:https://mcp.example.com/' } } } : d; },
  review: async (id, sc) => { const r = await s.review(id, sc); return { ...r, plan: { ...r.plan, pinned: { ...r.plan.pinned, repo: 'remote:https://mcp.example.com/' } } }; }
});
/* the host's own sentences for a source that could not be read (store/reasons.rs) */
const HUB_DOWN = 'The engine is not running yet. This source is read through it: read the sources again once it has started.';
const REG_DOWN = 'Could not reach registry.modelcontextprotocol.io. Check the connection or proxy, then read the sources again.';
const PROXY_PAGE = 'github.com answered with something that is not its list (a proxy or a sign-in page can do that). Check the connection or proxy, then read it again.';
const NEVER = { ms: Number.POSITIVE_INFINITY };
/* the clock of the store that ages: it starts eight hours before `NOW`, where its sources were read, and the state moves it to `NOW` */
const clock = { t: NOW - 8 * 3600_000 };
const LONG = 'A connector with an extremely long name that goes on and on without any sensible place to stop, ending in a_very_long_unbroken_identifier_that_must_not_push_the_row_wider_than_the_window';

const browse: Story = {
  id: 'store/browse', title: 'Store: browse', area: 'store', kind: 'surface', covers: ['surface:store'], scope: '.hx-store', mock: MOCK,
  states: {
    'front page (Recommended)': view(['typical'], null),
    'search results': view(['variant'], (c) => type(c, 'firecrawl')),
    'nothing matches': view(['empty'], (c) => type(c, 'zzzzqq')),
    'engine plugins only': view(['variant'], (c) => click(c, '[role=radio][data-value="engine-plugin"]')),
    'offline, with the saved copy': view(['loading'], null, { mock: { offline: true } }),
    'the store did not load': view(['error'], null, { patch: failing }),
    'long names': view(['long'], null, { patch: withItems((i) => ({ ...i, title: LONG, publisher: 'A publisher whose name is also far too long to fit on one line of the row at a narrow width' })) }),
    'details focus': { ...view(['focus'], null), force: [{ sel: '[data-store-open]', state: 'focus' as const }] },
    'details hover': { ...view(['hover'], null), force: [{ sel: '[data-store-open]', state: 'hover' as const }] },
    'the front page with boopis\'s skills and plugins, most used first': view(['many'], null, { mock: { extraItems: recommendedItems() } }),
    'skills only, most used first': view(['variant'], (c) => click(c, '[role=radio][data-value="skill"]'), { mock: { extraItems: recommendedItems() } }),
    'the sources being read, source by source': view(['loading'], (c) => { void c.view.readDue(); return c.wait(250); }, { mock: { start: 'unread', now: () => NOW, reads: { 'engine-plugins': { ms: 20 }, 'skills-hub': NEVER } } }),
    'out of date: a source could not be read': view(['error'], (c) => c.view.readDue(), { mock: { start: 'unread', now: () => NOW, reads: { 'engine-plugins': { ms: 5 }, 'skills-hub': { ms: 5, error: HUB_DOWN }, anthropic: { ms: 5 }, 'mcp-registry': { ms: 5 } } } }),
    'out of date: several could not be read (with the reasons one tap away)': view(['error', 'variant'], (c) => c.view.readDue(), { mock: { start: 'unread', now: () => NOW, reads: { 'skills-hub': { ms: 5, error: HUB_DOWN }, anthropic: { ms: 5, error: PROXY_PAGE }, 'mcp-registry': { ms: 5, error: REG_DOWN } } } }),
    'out of date: due a read again': view(['variant'], async (c) => { clock.t = NOW; await c.store.reloadSources?.(); c.view.show('browse'); await c.wait(150); }, { mock: () => { clock.t = NOW - 8 * 3600_000; return { now: () => clock.t }; } }),
    'up to date after a read': view(['typical'], (c) => c.view.readDue(), { mock: { start: 'unread', now: () => NOW, reads: { 'engine-plugins': { ms: 5 }, 'skills-hub': { ms: 5 }, anthropic: { ms: 5 }, 'mcp-registry': { ms: 5 } } } }),
    'boopis\'s whole collection, by kind, with each connector\'s mark': view(['many', 'variant'], null, { mock: { extraItems: [...connectorItems(), ...recommendedItems()] } }),
    'connectors only, with their marks': view(['variant'], (c) => click(c, '[role=radio][data-value="connector"]'), { mock: { extraItems: connectorItems() } }),
    'search with results across kinds': view(['variant'], (c) => type(c, 'design'), { mock: { extraItems: [...connectorItems(), ...recommendedItems()] } }),
    'nothing matches in one kind (show everything)': view(['empty', 'variant'], async (c) => { await click(c, '[role=radio][data-value="mod"]'); await type(c, 'postgres'); }, { mock: { extraItems: connectorItems() } }),
    'a row focused from the search (down arrow)': view(['focus'], async (c) => {
      const i = c.root.querySelector<HTMLInputElement>('#hx-store-q'); i?.focus(); i?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); await c.wait(60);
    }),
    'row hover': { ...view(['hover'], null), force: [{ sel: '.ui-row--item', state: 'hover' as const }] },
    'no sources on': view(['empty'], async (c) => { for (const s of c.store.sources.get()) await c.store.setSourceEnabled(s.id, false); await click(c, '[role=radio][data-value="skill"]'); })
  }
};
const detail: Story = {
  id: 'store/detail', title: 'Store: detail', area: 'store', kind: 'surface', covers: ['surface:store-detail'], scope: '.hx-store', mock: MOCK,
  states: {
    'a recommended connector': view(['typical'], null, { item: 'boopis:firecrawl' }),
    'a connector with its service\'s mark and a key': view(['variant'], null, { item: 'boopis:github', mock: { extraItems: connectorItems() } }),
    'a hosted connector from the collection (sign in)': view(['variant'], null, { item: 'boopis:notion', mock: { extraItems: connectorItems() } }),
    'a skill with its publisher\'s mark': view(['variant'], null, { item: 'boopis:skills/pdf', mock: { extraItems: recommendedItems() } }),
    'not reviewed, with undeclared egress': view(['variant'], null, { item: 'mcp-registry:com.example/tickets' }),
    'an engine plugin (runs inside the engine)': view(['variant'], null, { item: 'engine-plugins:example-metrics' }),
    'a hosted connector': view(['variant'], null, { item: 'mcp-registry:com.example/tickets', patch: hosted }),
    'taken down by its source': view(['error'], null, { item: 'engine-plugins:example-old-sync' }),
    'not pinned (cannot be installed)': view(['disabled'], null, { item: 'github:example-org/loose-skill' }),
    'installed, with an update': view(['variant'], async (c) => { await c.store.checkUpdates(); c.view.show('browse', 'anthropic:example-lint-kit'); await c.wait(150); }),
    'an item that is not there': view(['error'], null, { item: 'boopis:nothing-here' }),
    'long name': view(['long'], null, { item: 'boopis:firecrawl', patch: (s) => ({ ...s, detail: async (id) => { const d = await s.detail(id); return { ...d, item: { ...d.item, title: LONG } }; } }) })
  }
};
const review: Story = {
  id: 'store/review', title: 'Store: review card', area: 'store', kind: 'surface', covers: ['surface:store-review'], scope: '.hx-store', mock: MOCK,
  states: {
    'a connector with a key': view(['typical'], (c) => click(c, '.hx-store__sheet .ui-btn--primary, .hx-store__sheet button[class*="primary"]', 250), { item: 'boopis:firecrawl', mock: { empty: true } }),
    'an engine plugin (strong warning)': view(['variant'], (c) => click(c, '.hx-store__sheet button[class*="primary"]', 250), { item: 'engine-plugins:example-metrics', mock: { empty: true } }),
    'not reviewed (strong warning)': view(['variant'], (c) => click(c, '.hx-store__sheet button[class*="primary"]', 250), { item: 'github:example-org/changelog-skills' }),
    'a hosted connector (standing caution)': view(['variant'], (c) => click(c, '.hx-store__sheet button[class*="primary"]', 250), { item: 'mcp-registry:com.example/tickets', patch: hosted }),
    'in a project (scope choice)': view(['variant'], (c) => click(c, '.hx-store__sheet button[class*="primary"]', 250), { item: 'boopis:release-notes', project: '~/work/api' }),
    'an update with its diff': view(['variant'], async (c) => { await c.store.checkUpdates(); c.view.show('browse', 'anthropic:example-lint-kit'); await c.wait(150); await click(c, '.hx-store__sheet button[class*="primary"]', 250); }),
    'could not be checked': view(['error'], (c) => click(c, '.hx-store__sheet button[class*="primary"]', 250), { item: 'boopis:release-notes', patch: (s) => ({ ...s, review: () => Promise.reject({ code: 'hx.store.digest_mismatch', message: 'What was downloaded is not what the catalogue promised, so it was thrown away and nothing was installed.' }) }) }),
    'long name': view(['long'], (c) => click(c, '.hx-store__sheet button[class*="primary"]', 250), { item: 'boopis:release-notes', patch: (s) => ({ ...s, review: async (id, scope) => { const r = await s.review(id, scope); return { ...r, plan: { ...r.plan, title: LONG } }; } }) })
  }
};
const installed: Story = {
  id: 'store/installed', title: 'Store: installed', area: 'store', kind: 'surface', covers: ['surface:store-installed'], scope: '.hx-store', mock: MOCK,
  states: {
    installed: view(['typical'], null, { screen: 'installed' }),
    'nothing installed': view(['empty'], null, { screen: 'installed', mock: { empty: true } }),
    'an update is available': view(['variant'], (c) => c.store.checkUpdates().then(() => c.view.show('installed')), { screen: 'installed' }),
    'taken down by its source (banner)': view(['error'], null, { screen: 'installed', patch: killListed }),
    'in a governed project (the switch is on)': view(['variant'], null, { screen: 'installed', project: '~/work/api' }),
    'in an ordinary project (the switch is off)': view(['variant'], null, { screen: 'installed', project: '~/work/site' }),
    'remove: its keys': view(['variant'], (c) => click(c, '[data-store-remove="boopis:firecrawl"]', 250), { screen: 'installed' }),
    'long name': view(['long'], null, { screen: 'installed', patch: (s) => { const w = s.installed as unknown as { update(fn: (l: readonly InstallReceipt[]) => readonly InstallReceipt[]): void }; w.update((l) => l.map((r) => ({ ...r, title: LONG }))); return s; } }),
    'switch focus': { ...view(['focus'], null, { screen: 'installed' }), force: [{ sel: '.ui-switch', state: 'focus' as const }] },
    'button pressed': { ...view(['active'], null, { screen: 'installed' }), force: [{ sel: '.ui-btn', state: 'active' as const }] }
  }
};
const sources: Story = {
  id: 'store/sources', title: 'Store: sources', area: 'store', kind: 'surface', covers: ['surface:store-sources'], scope: '.hx-store', mock: MOCK,
  states: {
    sources: view(['typical'], null, { screen: 'sources' }),
    'a source added by you': view(['variant'], async (c) => { await c.store.addSource({ url: 'https://github.com/example-org/skills' }); c.view.show('sources'); }, { screen: 'sources' }),
    'a source that is off, with the reason': view(['disabled'], (c) => { const w = c.store.sources as unknown as { update(fn: (l: readonly import('../../../data/types').StoreSource[]) => readonly import('../../../data/types').StoreSource[]): void }; w.update((l) => l.map((s, i) => (i === 1 ? { ...s, enabled: false, terms: 'unverified' as const, note: 'Its terms have not been read yet.' } : s))); c.view.show('sources'); }, { screen: 'sources' }),
    'add a source': view(['open'], (c) => click(c, '[data-store-src-add]', 250), { screen: 'sources' }),
    'offline': view(['loading'], null, { screen: 'sources', mock: { offline: true } }),
    'a source that could not be read': view(['error'], (c) => { const w = c.store.sources as unknown as { update(fn: (l: readonly import('../../../data/types').StoreSource[]) => readonly import('../../../data/types').StoreSource[]): void }; w.update((l) => l.map((s, i) => (i === 1 ? { ...s, error: 'boopis could not reach that source. What you see is the last copy it saved.' } : s))); c.view.show('sources'); }, { screen: 'sources' })
  }
};
export default [browse, detail, review, installed, sources];
