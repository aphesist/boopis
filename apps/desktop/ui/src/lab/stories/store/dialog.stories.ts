/* The real store dialog in the whole window (ADR-0038): the app boots, the store opens as a person opens it (mod+shift+S), and the
   checks look at the dialog itself, at every width and preset. The other store stories draw the view in a lab cell, which has no
   dialog padding, no dialog edge and no window: a store cut off by its dialog passed there (the owner's screenshots of 22
   November 2026: the source switches, the search field, the source select and the Details buttons cut at the right edge).

   The data is the hard case, not the fixture's ten items: forty more items with long names and an unbroken identifier, every
   state a source row can be in (read just now, being read, waiting, could not be read with the host's long reasons, off, built
   in, GitHub without a sign-in, empty until one is added, one the person added with a long address), the line over Browse while
   a read runs and when it failed, an item's page and its review card. Opening the store reads the sources that are due, as the
   app does; a read that must stay in progress never answers (`ms: Infinity`), so every state is the same on every draw. */
import fixtureFile from '../../../../../../shared/data/store.fixtures.json';
import { createMockStore } from '../../../data/mock-store';
import type { MockStoreOptions } from '../../../data/mock-store';
import type { DataProvider } from '../../../data/provider';
import type { StoreItem, StoreKind } from '../../../data/types';
import type { AppCtx, State, Story } from '../../types';

const MOCK = { url: '/v6/__index.html', note: 'the owner has not drawn a store view: it is composed from the kit, for review' };
const FX = (fixtureFile as unknown as { items: StoreItem[] }).items;

/* the host's own sentences for a source that could not be read (store/reasons.rs) */
const HUB_DOWN = 'The engine is not running yet. This source is read through it: read the sources again once it has started.';
const REG_DOWN = 'Could not reach registry.modelcontextprotocol.io. Check the connection or proxy, then read the sources again.';
const PROXY_PAGE = 'github.com answered with something that is not its list (a proxy or a sign-in page can do that). Check the connection or proxy, then read it again.';
const NEVER = { ms: Number.POSITIVE_INFINITY };

const LONG = 'A connector with an extremely long name that goes on and on without a sensible place to stop, ending in a_very_long_unbroken_identifier_that_must_not_push_the_row_wider_than_the_dialog';
const NAMES = [
  'PostgreSQL schema explorer', 'Release notes from merged pull requests', 'Calendar and meeting notes', 'Spreadsheet formulas, explained',
  'Kubernetes cluster status', 'Accessibility audit for web pages', 'Invoice reader', 'Terraform plan review', 'Design tokens sync',
  'Customer support macros', 'Log search across services', 'SQL query review', 'Changelog writer', 'Incident timeline', 'Dependency upgrade helper',
  'Translation memory', 'Image alt-text writer', 'Test flake hunter', 'API contract checker', 'Meeting summariser'
];
const PUBLISHERS = ['Example Org', 'Northwind Labs', 'Acme Tools', 'example-org'];
const KINDS: readonly StoreKind[] = ['connector', 'skill', 'plugin', 'mod', 'engine-plugin'];
const SOURCE_OF: Readonly<Record<StoreKind, string>> = { connector: 'mcp-registry', skill: 'skills-hub', plugin: 'anthropic', mod: 'local', 'engine-plugin': 'engine-plugins' };

/** forty items over every kind and source, the odd ones with a long name or a long publisher; the first is the long detail item */
function manyItems(now: number): StoreItem[] {
  const base = FX.find((i) => i.id === 'mcp-registry:com.example/tickets') ?? FX[0]!;
  return Array.from({ length: 40 }, (_, n): StoreItem => {
    const kind = KINDS[n % KINDS.length]!;
    const source = SOURCE_OF[kind];
    const tmpl = FX.find((i) => i.kind === kind && i.pinned && !i.removed) ?? base;
    const item = structuredClone(tmpl);
    const title = n === 0 ? LONG : NAMES[n % NAMES.length]! + (n >= NAMES.length ? ' (second edition)' : '');
    return {
      ...item, id: `${source}:lab/item-${n}`, source, title, tier: kind === 'connector' || kind === 'mod' ? 'not-reviewed' : 'verified',
      publisher: n % 7 === 3 ? 'A publisher whose name is also far too long to fit on one line of the row at a narrow width' : PUBLISHERS[n % PUBLISHERS.length]!,
      hosts: item.hosts.basis === 'verified' ? { ...item.hosts, basis: 'declared' } : item.hosts, verified: null,
      summary: n % 5 === 1 ? 'A summary long enough to wrap over several lines of the row at every width, with a path like ~/projects/a-very-long-folder-name/and/deeper/still and no break in it.' : tmpl.summary,
      provenance: { ...item.provenance, source, last_updated: new Date(now - 3 * 3600_000).toISOString() }
    };
  });
}

/** the app on a store with these options: the clock is the real one (so "read just now" stays true), and forty more items */
const withStore = (o: MockStoreOptions = {}) => (p: DataProvider): DataProvider => ({ ...p, store: createMockStore({ now: () => Date.now(), extraItems: manyItems(Date.now()), ...o }) });

/** waits until `ok` holds (the store's view is imported the first time it opens, so a fixed wait races it on a busy machine) */
const until = async (c: AppCtx, ok: () => boolean, ms = 5000): Promise<void> => { for (let t = 0; t < ms && !ok(); t += 50) await c.wait(50); };
const open = async (c: AppCtx): Promise<void> => {
  document.body.focus(); await c.key('S', { ctrlKey: true, shiftKey: true });
  await until(c, () => !!document.querySelector('#hx-store [data-store-status]') && !!document.querySelector('#hx-store [data-store-open], #hx-store .ui-empty'));
  await c.wait(400);
};
const tab = async (c: AppCtx, value: 'browse' | 'installed' | 'sources'): Promise<void> => {
  await c.click(`#hx-store [role=tab][data-value="${value}"], #hx-store .ui-seg__opt[data-value="${value}"]`); await c.wait(400);
};
const st = (tags: State['tags'], o: MockStoreOptions | null, setup: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State =>
  ({ tags, app: { provider: { patch: withStore(o ?? {}) }, setup }, ...extra });

/* every state a source row has after a read, at once: read just now, two that could not be read, one off, built in, GitHub, the
   placeholder, and one the person added (being read and waiting are 'sources, being read') */
const everySource: MockStoreOptions = { start: 'unread', reads: { 'skills-hub': { error: HUB_DOWN }, anthropic: { error: PROXY_PAGE } } };
const addLong = async (c: AppCtx): Promise<void> => {
  const s = c.hx.data().store;
  await s.addSource({ url: 'https://github.com/an-organisation-with-a-long-name/a-marketplace-repository-with-an-even-longer-name-and-no-spaces' });
  await s.setSourceEnabled('engine-plugins', false);
};

const dialog: Story = {
  id: 'store/dialog', title: 'Store: the dialog', area: 'store', kind: 'surface', covers: ['surface:store-dialog'], scope: '#hx-store', mock: MOCK,
  states: {
    'browse (the front page)': st(['typical'], null, open),
    'browse, many items': st(['many', 'scroll'], null, async (c) => {
      await open(c);
      await until(c, () => [...document.querySelectorAll('#hx-store .hx-store__list button')].some((b) => b.textContent === 'Show more'));
      const body = c.$('#hx-store-body'); body.scrollTop = body.scrollHeight; await c.wait(300);
    }),
    'browse, connectors': st(['variant'], null, async (c) => { await open(c); await c.click('#hx-store [role=radio][data-value="connector"]'); await c.wait(400); }),
    'browse, long names': st(['long'], null, async (c) => {
      await open(c);
      const q = c.$('#hx-store-q input, input#hx-store-q') as HTMLInputElement;
      q.value = 'long name'; q.dispatchEvent(new Event('input', { bubbles: true })); await c.wait(500);
    }),
    'browse, the sources being read': st(['loading'], { start: 'unread', reads: { 'engine-plugins': NEVER } }, open),
    'browse, sources that could not be read': st(['error'], { start: 'unread', reads: { 'skills-hub': { error: HUB_DOWN }, 'mcp-registry': { error: REG_DOWN } } }, open),
    sources: st(['variant'], null, async (c) => { await open(c); await tab(c, 'sources'); }),
    'sources, being read': st(['loading'], { start: 'unread', reads: { 'engine-plugins': NEVER } }, async (c) => { await open(c); await tab(c, 'sources'); }),
    'sources, every state': st(['error', 'long'], everySource, async (c) => { await addLong(c); await open(c); await tab(c, 'sources'); }),
    'an item\'s page': st(['variant'], null, async (c) => { await open(c); await c.click('#hx-store [data-store-open="mcp-registry:lab/item-0"]'); await c.wait(400); }),
    'the review card': st(['open'], null, async (c) => {
      await open(c); await c.click('#hx-store [data-store-open="mcp-registry:lab/item-0"]'); await c.wait(400);
      await c.click('#hx-store .hx-store__sheet .ui-btn--primary'); await c.wait(600);
    })
  }
};

export default dialog;
