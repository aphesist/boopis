/* Settings > Connectors with the "Connectors for" choice (the main profile or one bot): the main profile's list, one bot's own list,
   a bot with none, a bot's list that could not be read, and a bot's add flow. Each state mounts the view over a fake host in the lab's cell. */
import { mountConnectors } from '../../../host/connectors';
import type { ConnectorInfo, ConnectorsBridge } from '../../../host/connectors-bridge';
import type { StageCtx, State, Story } from '../../types';

const MOCK = { url: '/v6/__index.html', note: 'the owner has not drawn a connectors view: it is composed from the settings rows and the form cards, for review' };
const info = (o: Partial<ConnectorInfo>): ConnectorInfo => ({ name: 'fakemcp', transport: 'stdio', url: null, command: 'npx', args: ['-y', 'notes-mcp@1.2.3'], env: [], auth: null, oauth_tokens_present: null, enabled: true, plugin: null, status: 'connected', tools: 4, needs_auth: false, secrets: [], ...o });
const ok = { ok: true, tools: [{ name: 'search', description: '' }], error: null, prompts: 0, resources: 0, oauth_needed: false, signin_needed: false };
const bridge = (servers: ConnectorInfo[], fail = false): ConnectorsBridge => ({
  catalog: () => Promise.resolve([]),
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
const MAIN = [info({ name: 'github', url: 'https://api.githubcopilot.com/mcp/', command: null, args: [], tools: 12 }), info({ name: 'firecrawl', enabled: false })];

const view = (tags: State['tags'], per: Record<string, ConnectorsBridge>, pick: string | null, after?: (root: HTMLElement) => Promise<void>): State => ({
  tags, scope: '#lab-connectors', mock: MOCK,
  render: async (ctx: StageCtx) => {
    const host = document.createElement('div'); host.id = 'lab-connectors'; host.className = 'lab-fill ui-set-host';
    ctx.root.append(host);
    await mountConnectors(host, { bridge: bridge(MAIN), bridgeFor: (b) => per[b] ?? bridge([]), bots: () => BOTS, toast: () => undefined, settle: 0 });
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
  id: 'settings/connectors-for', title: 'Connectors for a bot', area: 'settings', kind: 'surface', covers: ['surface:settings-connectors'], scope: '#lab-connectors', mock: MOCK,
  states: {
    'main profile': view(['typical'], {}, null),
    'one bot, its own list': view(['variant'], { kai: bridge([info({ name: 'notes' }), info({ name: 'paper-search', url: 'https://mcp.example.com/mcp', command: null, args: [], status: 'failed', tools: null })]) }, 'kai'),
    'one bot, none yet': view(['empty'], { nina: bridge([]) }, 'nina'),
    'a bot with a long name': view(['long'], { 'a-bot-with-a-very-long-name-that-keeps-going': bridge([info({ name: 'notes' })]) }, 'a-bot-with-a-very-long-name-that-keeps-going'),
    'one bot, the list could not be read': view(['error'], { kai: bridge([], true) }, 'kai'),
    'one bot, adding from a command': view(['variant'], { kai: bridge([]) }, 'kai', async (root) => { root.querySelector<HTMLElement>('[data-add-command]')?.click(); await new Promise((r) => { setTimeout(r, 200); }); })
  }
};

export default story;
