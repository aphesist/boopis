/* Settings > Connectors with the "Connectors for" choice (the main profile or one bot): the main profile's list, one bot's own list,
   a bot with none, a bot's list that could not be read, and a bot's add flow. Then the redesign (23 November 2026): boopis's real
   collection (apps/shared/data/connectors.json, as the host's catalogue serves it), every state an installed connector can be in,
   the search narrowing both lists, nothing matching, a connector with several ways to run (its menu open), many installed. Each
   state mounts the view over a fake host in the lab's cell. */
import { mountConnectors } from '../../../host/connectors';
import type { ConnectorInfo, ConnectorsBridge } from '../../../host/connectors-bridge';
import type { StageCtx, State, Story } from '../../types';
import { collectionCatalog } from '../store/connector-items';
import { neutralText } from '../../neutral-store';
import type { ConnectorCatalogEntry } from '../../../host/connectors-bridge';

const MOCK = { url: '/__boards/screen.html?s=store', note: 'board 14 names the page and board 15 draws its rows: the installed connectors and the collection are the Store\'s item rows (step 7b)' };
const info = (o: Partial<ConnectorInfo>): ConnectorInfo => ({ name: 'fakemcp', transport: 'stdio', url: null, command: 'npx', args: ['-y', 'notes-mcp@1.2.3'], env: [], auth: null, oauth_tokens_present: null, enabled: true, plugin: null, status: 'connected', tools: 4, needs_auth: false, secrets: [], ...o });
const ok = { ok: true, tools: [{ name: 'search', description: '' }], error: null, prompts: 0, resources: 0, oauth_needed: false, signin_needed: false };
const bridge = (servers: ConnectorInfo[], fail = false, catalog: ConnectorCatalogEntry[] = []): ConnectorsBridge => ({
  catalog: () => Promise.resolve(catalog),
  inputs: () => Promise.resolve({ form_id: 'connector.command', kind: 'connector', title: 'Add a connector from a command', body: 'A local program that speaks MCP.', sensitive: false, origin: 'host', schema: { type: 'object', properties: { name: { type: 'string', title: 'Name' }, command: { type: 'string', title: 'Command' } }, required: ['name', 'command'] }, submit: { label: 'Review', hold: false }, cancel: { label: 'Not now' }, diff: [], contents: [], pinned: null, effect: null } as never),
  review: () => Promise.reject(new Error('not in the lab')),
  install: () => Promise.reject(new Error('not in the lab')),
  list: () => (fail ? Promise.reject(new Error('the bot\'s link is not up')) : Promise.resolve(servers)),
  test: () => Promise.resolve(ok as never),
  setEnabled: () => Promise.resolve(),
  remove: () => Promise.resolve({ name: 'x', deleted_credentials: [], kept_credentials: [], notes: [] } as never),
  signin: () => Promise.reject(new Error('not in the lab')),
  cancelSignin: () => Promise.resolve(),
  login: () => Promise.reject(new Error('not in the lab'))
});
const BOTS = [{ id: 'kai', name: 'Kai' }, { id: 'nina', name: 'Nina' }, { id: 'a-bot-with-a-very-long-name-that-keeps-going', name: 'A bot with a very long name that keeps going' }];
const MAIN = [info({ name: 'github', url: 'https://mcp.example.com/code/', command: null, args: [], tools: 12 }), info({ name: 'firecrawl', enabled: false })];

/* every state a connector the host lists can be in, with what each runs as the host reports it */
const EVERY = [
  info({ name: 'github', transport: 'stdio', command: 'docker', args: ['run', '-i', '--rm', '-e', 'CODE_HOST_TOKEN', 'registry.example.com/code-mcp-server@sha256:040c4e99810076035eb1d9beb4b4a96fcf589c43cefed6ff51a46a553eb4e174'], tools: 41, secrets: ['secret://connector.github/github_token'] }),
  info({ name: 'notion', transport: 'http', url: 'https://mcp.example.com/notes', command: null, args: [], auth: 'oauth', oauth_tokens_present: false, status: 'configured', tools: null }),
  info({ name: 'sentry', transport: 'http', url: 'https://mcp.example.com/errors', command: null, args: [], status: 'failed', tools: null }),
  info({ name: 'supabase', transport: 'http', url: 'https://mcp.example.com/database', command: null, args: [], status: 'connecting', tools: null }),
  info({ name: 'context7', command: 'npx', args: ['-y', '@example/docs-mcp@4.7.3'], status: 'lazy', tools: null }),
  info({ name: 'brave-search', command: 'npx', args: ['-y', '@example/search-mcp@2.2.0'], enabled: false, secrets: ['secret://connector.brave-search/brave_api_key'] }),
  info({ name: 'playwright', command: 'npx', args: ['-y', '@example/browser-mcp@0.0.86'], plugin: 'browser-tools' }),
  info({ name: 'notes', command: 'npx', args: ['-y', 'notes-mcp@1.2.3'], status: 'configured', tools: null })
];
const typeIn = (text: string) => async (root: HTMLElement): Promise<void> => {
  const i = root.querySelector<HTMLInputElement>('#hx-conn-q input, input#hx-conn-q'); if (!i) throw new Error('lab: no search field');
  i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => { setTimeout(r, 150); });
};
const view = (tags: State['tags'], per: Record<string, ConnectorsBridge>, pick: string | null, after?: (root: HTMLElement) => Promise<void>, main: ConnectorsBridge = bridge(MAIN)): State => ({
  tags, scope: '#lab-connectors', mock: MOCK,
  render: async (ctx: StageCtx) => {
    const host = document.createElement('div'); host.id = 'lab-connectors'; host.className = 'lab-fill k7-page__body';
    ctx.root.append(host);
    await mountConnectors(host, { bridge: main, bridgeFor: (b) => per[b] ?? bridge([]), bots: () => BOTS, toast: () => undefined, settle: 0 });
    if (pick) {
      const sel = host.querySelector('#hx-conn-for');
      sel?.dispatchEvent(new CustomEvent('ui:change', { detail: { value: pick }, bubbles: true }));
      await ctx.wait(200);
    }
    if (after) await after(host);
    await ctx.wait(100);
  }
});

const story: Story = {
  id: 'v7/settings-connectors-for', title: 'Connectors for a bot (7b, the full page)', area: 'settings', kind: 'surface', covers: ['surface:settings-connectors'], scope: '#lab-connectors', mock: MOCK,
  states: {
    'main profile': view(['typical'], {}, null),
    'one bot, its own list': view(['variant'], { kai: bridge([info({ name: 'notes' }), info({ name: 'paper-search', url: 'https://mcp.example.com/mcp', command: null, args: [], status: 'failed', tools: null })]) }, 'kai'),
    'one bot, none yet': view(['empty'], { nina: bridge([]) }, 'nina'),
    'a bot with a long name': view(['long'], { 'a-bot-with-a-very-long-name-that-keeps-going': bridge([info({ name: 'notes' })]) }, 'a-bot-with-a-very-long-name-that-keeps-going'),
    'one bot, the list could not be read': view(['error'], { kai: bridge([], true) }, 'kai'),
    'one bot, adding from a command': view(['variant'], { kai: bridge([]) }, 'kai', async (root) => { root.querySelector<HTMLElement>('[data-add-command]')?.click(); await new Promise((r) => { setTimeout(r, 200); }); })
  }
};

const LONG = 'a-connector-with-an-extremely-long-name-that-goes-on-and-on_without_any_sensible_place_to_stop';
/* boopis's real collection on neutral words: no story shows a code host's address (neutral-store.ts) */
const COLL = collectionCatalog().map((c) => ({ ...c, description: neutralText(c.description), variants: c.variants.map((v) => ({ ...v, summary: neutralText(v.summary), reaches: neutralText(v.reaches) })) }));
const collection: Story = {
  id: 'v7/settings-connectors', title: 'Settings: Connectors (7b, the full page)', area: 'settings', kind: 'surface', covers: ['surface:settings-connectors'], scope: '#lab-connectors', mock: MOCK,
  states: {
    'with boopis\'s collection': view(['typical'], {}, null, undefined, bridge(MAIN, false, COLL)),
    'every state of an installed connector': view(['variant', 'many'], {}, null, undefined, bridge(EVERY, false, COLL)),
    'nothing installed yet': view(['empty'], {}, null, undefined, bridge([], false, COLL)),
    'the search narrows both lists': view(['variant'], {}, null, typeIn('base'), bridge(EVERY, false, COLL)),
    'nothing matches the search': view(['empty', 'variant'], {}, null, typeIn('zzzzqq'), bridge(EVERY, false, COLL)),
    'a connector with several ways (its menu)': { ...view(['open'], {}, null, async (root) => { root.querySelector<HTMLElement>('[data-add-entry="context7"]')?.click(); await new Promise((r) => { setTimeout(r, 250); }); }, bridge(MAIN, false, COLL)), overlay: { anchor: '[data-add-entry="context7"]', layer: '[data-kit~="Menu"]' } },
    'long names': view(['long'], {}, null, undefined, bridge([info({ name: LONG, url: 'https://mcp.example.com/' + 'a-very-long-path/'.repeat(6), command: null, args: [] }), ...EVERY.slice(0, 2)], false, COLL.map((c, i) => (i === 0 ? { ...c, name: 'A connector with an extremely long name that goes on and on without a sensible place to stop', publisher: 'A publisher whose name is also far too long to fit on one line' } : c)))),
    'the list could not be read': view(['error'], {}, null, undefined, bridge([], true, COLL)),
    'row focus': { ...view(['focus'], {}, null, undefined, bridge(MAIN, false, COLL)), force: [{ sel: '[data-add-entry]', state: 'focus' as const }] },
    'row hover': { ...view(['hover'], {}, null, undefined, bridge(MAIN, false, COLL)), force: [{ sel: '#lab-connectors [data-kit~="ListRow"]', state: 'hover' as const }] }
  }
};

export default [story, collection];
