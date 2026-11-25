// @vitest-environment jsdom
/* Settings > Connectors against a fake host: the list as Hermes reports it, switching, testing and removing, and the three forms of
   an install (inputs, review, sign-in) with what each sends. The fake records every call, so a test reads what reached the host. */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProvider } from '../data';
import { createMockProvider } from '../data/mock-provider';
import { formsHost } from '../modules/cards/forms-host';
import { useFormsHost } from '../modules/cards/forms-host';
import { kit } from '@boopis/ui';
import { describeConnector, installLines, mountConnectors, textValues } from './connectors';
import type { ConnectorInfo, ConnectorInstall, ConnectorRequest, ConnectorReview, ConnectorsBridge } from './connectors-bridge';

const info = (o: Partial<ConnectorInfo> = {}): ConnectorInfo => ({ name: 'fakemcp', transport: 'stdio', url: null, command: 'python3', args: ['server.py'], env: [], auth: null, oauth_tokens_present: null, enabled: true, plugin: null, status: 'connected', tools: 2, needs_auth: false, secrets: [], ...o });
const tick = (n = 3): Promise<void> => new Promise((r) => { let i = 0; const go = (): void => { if (++i >= n) r(); else setTimeout(go, 0); }; setTimeout(go, 0); });
const SECRET = 'fc-live-SECRET-0123456789';

const reviewFor = (name: string, secretField?: string): ConnectorReview => ({
  name, plan_hash: 'h-' + name,
  form: {
    form_id: 'connector.review', kind: 'connector', title: 'Install ' + name, body: 'You asked for it.', sensitive: !!secretField, origin: 'host',
    schema: { type: 'object', properties: secretField ? { [secretField]: { type: 'string', title: 'API key', 'x-secret': true, 'x-secret-ref': 'secret://connector.' + name + '/' + secretField } } : {}, required: secretField ? [secretField] : [] },
    submit: { label: 'Install', hold: true }, cancel: { label: 'Not now' },
    diff: [{ key: 'mcp_servers.' + name + '.command', from: null, to: 'npx' }], contents: [['Command', 'npx'], ['Reaches', 'api.example.com'], ['Version', 'Not pinned']], pinned: 'foo@1.2.3', effect: 'Adds it through Hermes.'
  }
} as unknown as ConnectorReview);

const installed = (o: Partial<ConnectorInstall> = {}): ConnectorInstall => ({ name: 'acme', steps: [{ id: 'add', title: 'Added', state: 'done', detail: 'as acme, with boopis\'s connectors', code: null }], test: { ok: true, tools: [{ name: 'echo', description: '' }], error: null, prompts: 0, resources: 0, oauth_needed: false, signin_needed: false }, signin_needed: false, restarted: false, notes: ['New sessions use it.'], ...o }) as unknown as ConnectorInstall;

interface Fake extends ConnectorsBridge { calls: string[]; servers: ConnectorInfo[]; installs: { request: ConnectorRequest; hash: string; secrets: Record<string, string>; restart: string | undefined }[]; reviews: ConnectorRequest[]; failReview: string | null; failInstall: string | null; report: ConnectorInstall }
function fake(servers: ConnectorInfo[] = []): Fake {
  const f: Fake = {
    calls: [], servers, installs: [], reviews: [], failReview: null, failInstall: null, report: installed(),
    catalog: () => Promise.resolve([{ id: 'firecrawl', name: 'Firecrawl', publisher: 'Firecrawl', description: 'Scrape the web.', license: 'MIT', verified: '2026-11-19', variants: [
      { id: 'local', label: 'Local', summary: 'Runs on your machine.', reaches: 'Only this computer (127.0.0.1)', pinned: 'firecrawl-mcp@3.40.0', default: true },
      { id: 'hosted', label: 'Hosted', summary: 'Firecrawl runs it.', reaches: 'mcp.firecrawl.dev', pinned: null, default: false }] }]),
    inputs: (source, connector, variant) => { f.calls.push(`inputs:${source}:${connector ?? ''}:${variant ?? ''}`); return Promise.resolve({ form_id: 'connector.' + source, kind: 'connector', title: 'Add a connector by ' + source, body: 'Inputs.', sensitive: false, origin: 'host', schema: { type: 'object', properties: { name: { type: 'string', title: 'Name' }, url: { type: 'string', title: 'URL' } }, required: ['name'] }, submit: { label: 'Review', hold: false }, cancel: { label: 'Not now' }, diff: [], contents: [], pinned: null, effect: null } as never); },
    review: (request) => { f.reviews.push(request); return f.failReview ? Promise.reject(new Error(f.failReview)) : Promise.resolve(reviewFor(request.values['name'] ?? 'x', request.values['name'] === 'keyed' ? 'key' : undefined)); },
    install: (request, hash, secrets, restart) => { f.installs.push({ request, hash, secrets: { ...secrets }, restart }); return f.failInstall ? Promise.reject(new Error(f.failInstall)) : Promise.resolve(f.report); },
    list: () => { f.calls.push('list'); return Promise.resolve(f.servers); },
    test: (name) => { f.calls.push('test:' + name); return Promise.resolve({ ok: true, tools: [{ name: 'echo', description: '' }, { name: 'ping', description: '' }], error: null, prompts: 0, resources: 0, oauth_needed: false, signin_needed: false } as never); },
    setEnabled: (name, on) => { f.calls.push(`enable:${name}:${String(on)}`); return Promise.resolve(); },
    remove: (name, del) => { f.calls.push(`remove:${name}:${String(del)}`); return Promise.resolve({ name, deleted_credentials: [], kept_credentials: [], notes: ['Open sessions keep their tools.'] } as never); },
    signin: (name) => { f.calls.push('signin:' + name); return Promise.resolve({ name, stored: "Hermes's own token store", tools: [], test: null } as never); },
    cancelSignin: (name) => { f.calls.push('cancel:' + name); return Promise.resolve(); },
    login: () => Promise.reject(new Error('not used'))
  };
  return f;
}
async function mount(f: Fake): Promise<{ panel: HTMLElement; toasts: string[] }> {
  const panel = document.createElement('div');
  document.body.append(panel);
  const toasts: string[] = [];
  await mountConnectors(panel, { bridge: f, notify: (t) => { toasts.push(t); }, settle: 0 });
  return { panel, toasts };
}
const click = (root: Element, sel: string): void => { const b = root.querySelector<HTMLElement>(sel); if (!b) throw new Error('no ' + sel); b.click(); };
/** a connector's overflow Menu, and one of its rows (Test, Remove) */
const pick = (root: Element, name: string, value: 'test' | 'remove'): void => {
  click(root, `[data-conn-more="${name}"]`);
  const row = document.querySelector<HTMLElement>(`[data-kit~="Menu"][data-floating] [data-value="${value}"]`);
  if (!row) throw new Error('no ' + value + ' in the menu of ' + name);
  row.click();
};
/** what a person can read: the text, and the explanations behind the rows' info labels */
const read = (root: Element | null | undefined): string => root ? (root.textContent ?? '') + ' ' + [...root.querySelectorAll('[data-explain]')].map((n) => n.getAttribute('data-explain')).join(' ') : '';
const sw = (root: Element, name?: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(name ? `[data-conn-switch="${name}"]` : '[data-conn-switch]') as HTMLButtonElement;
function fill(root: Element, name: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(`[data-name="${name}"]`);
  if (!input) throw new Error('no field ' + name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeAll(() => { setProvider(createMockProvider({ simulate: false })); });
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); document.body.replaceChildren(); useFormsHost(null); });

describe('how a connector reads in the list', () => {
  it('says on, off, needs sign-in, failed, or from a plugin, from what Hermes reported', () => {
    expect(describeConnector(info())).toMatchObject({ state: 'on', word: 'connected, 2 tools', canSignIn: false });
    expect(describeConnector(info({ tools: 1 })).word).toBe('connected, 1 tool');
    expect(describeConnector(info({ enabled: false }))).toMatchObject({ state: 'off', word: 'off' });
    expect(describeConnector(info({ url: 'https://mcp.x.dev/mcp', command: null, args: [], auth: 'oauth', oauth_tokens_present: false, status: 'configured' }))).toMatchObject({ state: 'sign in', word: 'needs sign-in', canSignIn: true });
    expect(describeConnector(info({ auth: 'oauth', needs_auth: true }))).toMatchObject({ state: 'sign in', canSignIn: true });
    expect(describeConnector(info({ auth: 'oauth', oauth_tokens_present: true })).canSignIn).toBe(false);
    expect(describeConnector(info({ status: 'failed' }))).toMatchObject({ word: 'failed to connect', tone: 'attention' });
    expect(describeConnector(info({ status: 'connecting' }))).toMatchObject({ word: 'connecting', tone: 'busy' });
    expect(describeConnector(info({ auth: 'oauth', needs_auth: true })).tone).toBe('attention');
    expect(describeConnector(info({ enabled: false, status: 'failed' })).tone).toBeNull();
    expect(describeConnector(info()).where).toBe('python3 server.py');
    expect(describeConnector(info({ status: 'lazy', tools: null })).word).toBe('connects when used');
    expect(describeConnector(info({ plugin: 'acme' }))).toMatchObject({ state: 'plugin', canSignIn: false });
    expect(describeConnector(info({ secrets: ['secret://connector.fakemcp/key'] })).hint).toContain('1 key in your keychain');
    expect(describeConnector(info({ command: 'x'.repeat(200), args: [] })).hint.length).toBeLessThan(160);
  });
  it('sends every form value as text, lists joined by lines', () => {
    expect(textValues({ a: 'x', n: 3, b: true, l: ['p', 'q'], u: undefined, z: null })).toEqual({ a: 'x', n: '3', b: 'true', l: 'p\nq' });
  });
  it('turns an install into lines a person reads, with the server\'s reason when it did not connect and never the engine\'s words', () => {
    expect(installLines(installed())).toEqual(['Added: as acme, with boopis\'s connectors', 'Connected and found 1 tool: echo.', 'New sessions use it.']);
    const bad = installed({ test: { ok: false, tools: [], error: 'FAKE_API_KEY is not set', prompts: null, resources: null, oauth_needed: false, signin_needed: false } as never });
    expect(installLines(bad)).toContain('It did not connect: FAKE_API_KEY is not set');
    const engine = installed({ test: { ok: false, tools: [], error: 'hermes mcp: OSError', prompts: null, resources: null, oauth_needed: false, signin_needed: false } as never });
    expect(installLines(engine).join(' ')).not.toMatch(/hermes|OSError/i);
  });
});

describe('the Connectors tab', () => {
  it('lists what Hermes has, with a switch, Test and Remove for its own and no control for a plugin\'s, and Sign in where one is owed', async () => {
    const f = fake([info(), info({ name: 'linear', url: 'https://mcp.linear.example/mcp', command: null, args: [], auth: 'oauth', oauth_tokens_present: false, status: 'configured', tools: null }), info({ name: 'fromplugin', plugin: 'acme' })]);
    const { panel } = await mount(f);
    const rows = [...panel.querySelectorAll('#hx-conn-have [data-kit-part~="Row"]')].map((r) => r.querySelector('.k7-row__label')?.textContent);
    expect(rows).toEqual(['fakemcp', 'linear', 'fromplugin']);
    expect(panel.querySelectorAll('[role=switch][data-conn-switch]')).toHaveLength(2);
    expect(panel.querySelector('[data-conn-signin="linear"]')).toBeTruthy();
    expect(panel.querySelector('[data-conn-signin="fakemcp"]')).toBeNull();
    expect(panel.querySelector('[data-conn-more="fromplugin"]')).toBeNull();
    expect(read(panel)).toContain('Provided by the plugin acme');
    pick(panel, 'fakemcp', 'remove');
    expect(panel.querySelector('hx-card')).toBeTruthy();
  });

  it('lists the collection one row per connector, and offers each way with where it reaches and its pin, then a URL and a command', async () => {
    const { panel } = await mount(fake());
    expect(panel.textContent).toContain('No connectors yet');
    const coll = panel.querySelector('#hx-conn-coll') as HTMLElement;
    expect(coll.querySelectorAll('[data-kit~="ListRow"]')).toHaveLength(1);
    expect(coll.textContent).toContain('Firecrawl');
    expect(coll.textContent).toContain('Scrape the web.');
    expect(coll.textContent).toContain('local · hosted');
    expect(coll.querySelector('[data-add-entry="firecrawl"]')?.getAttribute('data-ways')).toBe('2');
    click(coll, '[data-add-entry="firecrawl"]');
    const menu = document.querySelector('[data-kit~="Menu"][data-floating]') as HTMLElement;
    expect(menu.getAttribute('aria-label')).toBe('Ways to add Firecrawl');
    expect(menu.textContent).toContain('Reaches: Only this computer (127.0.0.1). Pinned to firecrawl-mcp@3.40.0.');
    expect(menu.textContent).toContain('Reaches: mcp.firecrawl.dev.');
    kit.closeMenu();
    const add = panel.querySelector('#hx-conn-add')?.textContent ?? '';
    expect(add).toContain('Other ways to add');
    expect(add).toContain('From a URL');
    expect(add).toContain('From a command');
  });

  it('adds a connector with one way at once, and marks one already added', async () => {
    const f = fake([info({ name: 'firecrawl' })]);
    f.catalog = () => Promise.resolve([{ id: 'exa', name: 'Exa', publisher: 'Exa', description: 'Web search.', license: 'MIT', verified: '2026-11-19', variants: [{ id: 'hosted', label: 'Hosted', summary: 'Exa runs it.', reaches: 'mcp.exa.ai', pinned: null, default: true }] },
      { id: 'firecrawl', name: 'Firecrawl', publisher: 'Firecrawl', description: 'Scrape.', license: 'MIT', verified: '2026-11-19', variants: [{ id: 'local', label: 'Local', summary: 'Here.', reaches: 'x', pinned: null, default: true }] }]);
    const { panel } = await mount(f);
    expect(panel.querySelector('[data-add-entry="firecrawl"]')?.textContent).toContain('added');
    expect(panel.querySelector('[data-add-entry="exa"]')?.textContent).not.toContain('Exa ·');   /* the publisher is the name: said once */
    click(panel, '[data-add-entry="exa"]');
    await tick();
    expect(f.calls).toContain('inputs:catalog:exa:hosted');
    expect(document.querySelector('[data-kit~="Menu"][data-floating]')).toBeNull();
  });

  it('narrows the installed list and the collection as you type, and says when nothing matches', async () => {
    const f = fake([info({ name: 'github', url: 'https://api.githubcopilot.com/mcp/', command: null, args: [] }), info({ name: 'notes' })]);
    const { panel } = await mount(f);
    const q = panel.querySelector<HTMLInputElement>('input#hx-conn-q') as HTMLInputElement;
    q.value = 'scrape'; q.dispatchEvent(new Event('input', { bubbles: true }));
    expect(panel.querySelector('[data-add-entry="firecrawl"]')).toBeTruthy();
    expect(panel.querySelector('#hx-conn-installed')?.textContent).toContain('No installed connector matches');
    q.value = 'github'; q.dispatchEvent(new Event('input', { bubbles: true }));
    expect(panel.querySelector('[data-conn-more="github"]')).toBeTruthy();
    expect(panel.querySelector('[data-conn-more="notes"]')).toBeNull();
    expect(panel.querySelector('#hx-conn-coll')?.textContent).toContain('Nothing in boopis\'s collection matches “github”');
  });

  it('says the list could not be read, and draws no list, when the host cannot read it', async () => {
    const f = fake();
    f.list = () => Promise.reject(new Error('hermes is not installed'));
    const { panel } = await mount(f);
    expect(panel.textContent).toContain('boopis could not read the list, so it is not shown: ');
  });

  it('switches a server through the host, and puts the switch back when the host refuses', async () => {
    const f = fake([info()]);
    const { panel, toasts } = await mount(f);
    sw(panel).click();
    await tick();
    expect(f.calls).toContain('enable:fakemcp:false');
    expect(toasts.at(-1)).toContain('fakemcp is off');
    f.setEnabled = () => Promise.reject(new Error('Hermes refused it'));
    sw(panel).click();
    await tick();
    expect(toasts.at(-1)).toBe('Hermes refused it');
  });

  it('tests a server and writes Hermes\'s answer where it can be read', async () => {
    const f = fake([info()]);
    const { panel } = await mount(f);
    pick(panel, 'fakemcp', 'test');
    await tick();
    expect(panel.querySelector('[data-conn-status]')?.textContent).toBe('fakemcp: connected, 2 tools: echo, ping.');
  });
});

describe('removing', () => {
  it('asks what to do with its keys when it has some, and sends the answer', async () => {
    const f = fake([info({ name: 'keyed', secrets: ['secret://connector.keyed/key'] })]);
    const { panel, toasts } = await mount(f);
    pick(panel, 'keyed', 'remove');
    const options = [...panel.querySelectorAll('.cd-opt')].map((o) => o.textContent);
    expect(options.join('|')).toContain('Keep them in my keychain');
    expect(options.join('|')).toContain('Delete them too');
    await formsHost().submit('connector.remove.keyed', { values: { keys: 'delete' }, secrets: {} });
    await tick();
    expect(f.calls).toContain('remove:keyed:true');
    expect(toasts.at(-1)).toContain('Removed keyed.');
  });

  it('asks nothing about keys when it has none, and keeps them when the answer is not delete', async () => {
    const f = fake([info()]);
    const { panel } = await mount(f);
    pick(panel, 'fakemcp', 'remove');
    expect(panel.querySelectorAll('.cd-opt')).toHaveLength(0);
    await formsHost().submit('connector.remove.fakemcp', { values: {}, secrets: {} });
    await tick();
    expect(f.calls).toContain('remove:fakemcp:false');
  });

  it('shows the host\'s refusal on the card and stays open', async () => {
    const f = fake([info()]);
    f.remove = () => Promise.reject(new Error('fakemcp comes from the plugin p'));
    const { panel } = await mount(f);
    pick(panel, 'fakemcp', 'remove');
    await expect(formsHost().submit('connector.remove.fakemcp', { values: {}, secrets: {} })).rejects.toThrow('comes from the plugin p');
  });
});

describe('adding', () => {
  it('asks the host for the inputs of a URL, reviews what was typed, and shows the review as the connector card', async () => {
    const f = fake();
    const { panel } = await mount(f);
    click(panel, '[data-add-url]');
    await tick();
    expect(f.calls).toContain('inputs:url::');
    expect(panel.querySelector('[data-hold]'), 'the questions before the review are not a hold').toBeNull();
    fill(panel, 'name', 'acme');
    fill(panel, 'url', 'https://mcp.acme.dev/mcp');
    click(panel, '[data-action="submit"]');
    await tick(5);
    expect(f.reviews).toEqual([{ source: 'url', values: { name: 'acme', url: 'https://mcp.acme.dev/mcp' } }]);
    const text = panel.textContent ?? '';
    expect(text).toContain('Install acme');
    expect(text).toContain('Reaches');
    expect(text).toContain('api.example.com');
    expect(text).toContain('foo@1.2.3');
    expect(text).toContain('mcp_servers.acme.command');
    expect(panel.querySelector('[data-hold]'), 'the install is a hold, like every approval').toBeTruthy();
  });

  it('names the collection entry and variant in the request, whatever the form holds', async () => {
    const f = fake();
    const { panel } = await mount(f);
    click(panel, '[data-add-entry="firecrawl"]');
    (document.querySelector('[data-kit~="Menu"][data-floating] [data-value="hosted"]') as HTMLElement).click();
    await tick();
    expect(f.calls).toContain('inputs:catalog:firecrawl:hosted');
    fill(panel, 'name', 'fc');
    click(panel, '[data-action="submit"]');
    await tick(5);
    expect(f.reviews[0]).toEqual({ source: 'catalog', values: { name: 'fc', connector: 'firecrawl', variant: 'hosted' } });
  });

  it('shows the host\'s refusal in the card, in words, and sends nothing to Hermes', async () => {
    const f = fake();
    f.failReview = 'only https links are accepted (plain http only for this computer, 127.0.0.1 or localhost)';
    const { panel } = await mount(f);
    click(panel, '[data-add-url]');
    await tick();
    fill(panel, 'name', 'acme');
    fill(panel, 'url', 'http://evil.example/mcp');
    click(panel, '[data-action="submit"]');
    await tick(5);
    expect(panel.textContent).toContain('only https links are accepted');
    expect(f.installs).toHaveLength(0);
    expect(panel.textContent).not.toContain('Install acme');
  });

  async function toReview(f: Fake, name: string): Promise<HTMLElement> {
    const { panel } = await mount(f);
    click(panel, '[data-add-command]');
    await tick();
    fill(panel, 'name', name);
    click(panel, '[data-action="submit"]');
    await tick(5);
    return panel;
  }

  it('installs with the hash the review named and the key to the host alone, then shows what Hermes found', async () => {
    const f = fake();
    f.report = installed({ name: 'keyed', restarted: true });
    const panel = await toReview(f, 'keyed');
    expect(panel.querySelector('[data-secret="key"]'), 'the key is a secret field of the review').toBeTruthy();
    await formsHost().submit('connector.review', { values: {}, secrets: { key: SECRET } });
    await tick(5);
    expect(f.installs).toEqual([{ request: { source: 'command', values: { name: 'keyed' } }, hash: 'h-keyed', secrets: { key: SECRET }, restart: undefined }]);
    expect(panel.textContent).toContain('keyed is ready');
    expect(panel.textContent).toContain('Connected and found 1 tool: echo.');
    expect(panel.textContent).not.toContain(SECRET);
    expect(panel.querySelector('[aria-live=polite]')?.textContent).not.toContain(SECRET);
  });

  it('sends the user\'s choice of when to restart Hermes with the install, and says plainly when it waits for idle sessions', async () => {
    const f = fake();
    f.report = installed({ name: 'keyed', restart_pending: true, test: null, steps: [{ id: 'restart', title: 'Hermes restart', state: 'pending', detail: 'waits until no session has a turn running; boopis restarts it then and tells you', code: null }] as never } as never);
    const panel = await toReview(f, 'keyed');
    await formsHost().submit('connector.review', { values: { restart: 'when_idle' }, secrets: { key: SECRET } });
    await tick(5);
    expect(f.installs[0]?.restart).toBe('when_idle');
    expect(panel.textContent).toContain('waits until no session has a turn running');
    await formsHost().submit('connector.review', { values: { restart: 'now' }, secrets: { key: SECRET } }).catch(() => undefined);
    expect(f.installs[1]?.restart).toBe('now');
    await formsHost().submit('connector.review', { values: { restart: 'nonsense' }, secrets: { key: SECRET } }).catch(() => undefined);
    expect(f.installs[2]?.restart, 'only the two choices the host knows are sent').toBeUndefined();
  });

  it('shows the host\'s "choose when" refusal on the card and sends nothing more', async () => {
    const f = fake();
    f.failInstall = '2 sessions have a turn running. Installing the key restarts Hermes, which would end it: choose to restart now, or when no turn is running.';
    await toReview(f, 'keyed');
    await expect(formsHost().submit('connector.review', { values: {}, secrets: { key: SECRET } })).rejects.toThrow('choose to restart now, or when no turn is running');
  });

  it('shows an install that Hermes refused on the card, and a name that is taken, without the key', async () => {
    const f = fake();
    f.failInstall = 'keyed is already a connector. Remove it first, or pick another name';
    await toReview(f, 'keyed');
    await expect(formsHost().submit('connector.review', { values: {}, secrets: { key: SECRET } })).rejects.toThrow('already a connector');
  });

  it('follows an OAuth install with the sign-in card, runs Hermes\'s flow from its button, and goes back to the list', async () => {
    const f = fake();
    f.report = installed({ name: 'linear', signin_needed: true, test: { ok: false, tools: [], error: 'OAuth authentication required', prompts: null, resources: null, oauth_needed: true, signin_needed: true } as never });
    const panel = await toReview(f, 'linear');
    await formsHost().submit('connector.review', { values: {}, secrets: {} });
    await tick(5);
    expect(panel.textContent).toContain('linear is added');
    expect(panel.textContent).toContain('It did not connect: OAuth authentication required');
    const button = panel.querySelector<HTMLButtonElement>('[data-action="signin"]');
    expect(button?.disabled, 'the sign-in control is enabled now').toBe(false);
    expect(panel.textContent).toContain('Opens linear in your browser');
    button?.click();
    await tick(8);
    expect(f.calls).toContain('signin:linear');
    expect(panel.querySelector<HTMLElement>('#hx-conn-installed')?.hidden, 'back to the list after the sign-in').toBe(false);
  });

  it('cancels a running sign-in through the host when the card is cancelled', async () => {
    const f = fake([info({ name: 'linear', url: 'https://mcp.linear.example/mcp', command: null, args: [], auth: 'oauth', oauth_tokens_present: false, status: 'configured' })]);
    let release: () => void = () => undefined;
    f.signin = () => new Promise((r) => { release = () => { r({} as never); }; });
    const { panel } = await mount(f);
    click(panel, '[data-conn-signin="linear"]');
    await tick();
    click(panel, '[data-action="signin"]');
    await tick();
    await formsHost().cancelSignin?.('connector.signin.linear', 'signin');
    expect(f.calls).toContain('cancel:linear');
    release();
  });

  it('goes back to the list from "Back to connectors" and when a form is declined', async () => {
    const f = fake();
    const { panel } = await mount(f);
    click(panel, '[data-add-command]');
    await tick();
    expect(panel.querySelector<HTMLElement>('#hx-conn-installed')?.hidden).toBe(true);
    const back = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Back to connectors');
    back?.click();
    await tick();
    expect(panel.querySelector<HTMLElement>('#hx-conn-installed')?.hidden).toBe(false);
  });
});

describe('connectors for one bot', () => {
  async function mountFor(main: Fake, bots: Record<string, Fake>): Promise<{ panel: HTMLElement; asked: string[] }> {
    const panel = document.createElement('div');
    document.body.append(panel);
    const asked: string[] = [];
    await mountConnectors(panel, {
      bridge: main, notify: () => { /* not read here */ }, settle: 0,
      bots: () => Object.keys(bots).map((id) => ({ id, name: id[0]?.toUpperCase() + id.slice(1) })),
      bridgeFor: (bot) => { asked.push(bot); return bots[bot] as Fake; }
    });
    return { panel, asked };
  }
  const choose = async (panel: HTMLElement, value: string): Promise<void> => {
    click(panel, '#hx-conn-for');
    (document.querySelector(`[data-kit~="Menu"][data-floating] [data-value="${value}"]`) as HTMLElement).click();
    await tick(4);
  };

  it('draws no choice when there is no bot to choose', async () => {
    const { panel } = await mount(fake());
    expect(panel.querySelector('#hx-conn-for')).toBeNull();
  });

  it('lists, tests, switches and removes the chosen bot\'s own connectors and leaves the main profile\'s alone', async () => {
    const main = fake([info({ name: 'mainmcp' })]);
    const kai = fake([info({ name: 'kaimcp' })]);
    const { panel, asked } = await mountFor(main, { kai });
    expect(panel.textContent).toContain('mainmcp');
    await choose(panel, 'kai');
    expect(asked).toContain('kai');
    expect(panel.textContent).toContain('kaimcp');
    expect(panel.textContent).not.toContain('mainmcp');
    expect(read(panel)).toContain('Only Kai has these');
    pick(panel, 'kaimcp', 'test');
    await tick();
    sw(panel, 'kaimcp').click();
    await tick();
    expect(kai.calls).toEqual(expect.arrayContaining(['test:kaimcp', 'enable:kaimcp:false']));
    expect(main.calls.filter((c) => c.startsWith('test:') || c.startsWith('enable:'))).toEqual([]);
    await choose(panel, '');
    expect(panel.textContent).toContain('mainmcp');
  });

  it('sends an add to the chosen bot and to no one else', async () => {
    const main = fake();
    const kai = fake();
    const { panel } = await mountFor(main, { kai });
    await choose(panel, 'kai');
    click(panel, '[data-add-command]');
    await tick();
    fill(panel, 'name', 'notes');
    click(panel, '[data-action="submit"]');
    await tick(6);
    expect(kai.reviews.map((r) => r.values['name'])).toEqual(['notes']);
    expect(main.reviews).toEqual([]);
  });

  it('falls back to the main profile when the chosen bot is no longer there', async () => {
    const main = fake([info({ name: 'mainmcp' })]);
    const kai = fake([info({ name: 'kaimcp' })]);
    const bots: Record<string, Fake> = { kai };
    const panel = document.createElement('div');
    document.body.append(panel);
    const m = await mountConnectors(panel, { bridge: main, notify: () => { /* unused */ }, settle: 0, bots: () => Object.keys(bots).map((id) => ({ id, name: id })), bridgeFor: (b) => bots[b] as Fake });
    await choose(panel, 'kai');
    expect(panel.textContent).toContain('kaimcp');
    delete bots['kai'];
    await m.refresh();
    expect(panel.textContent).toContain('mainmcp');
  });
});
