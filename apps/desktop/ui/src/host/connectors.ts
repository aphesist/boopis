/* Settings > Connectors: the MCP servers Hermes has (docs/CONNECTORS.md), and how to add one. Adding is three forms in the
   card family (docs/FORMS.md): the inputs (a collection entry's setup values, a URL, or a command), the review (the `connector`
   card: exactly what will be added, the command and its arguments, the hosts it reaches, the pinned version, the config diff,
   the keys it needs as secret fields), and, when the server signs in with OAuth, a `signin` card. Every change goes through the
   host, which validates it again and drives Hermes's own mechanisms; this view knows no Hermes file and holds no key (a key
   goes from its field to the host's keychain and no further). It draws the design system's settings rows and cards; the owner
   has not drawn a connectors view, so it is composed from those patterns, for review (DESIGN-SYSTEM.md 14.21). */
import { storeItem } from '../core/engine-words';
import { unlessEngine } from './errors';
import { ui } from '@boopis/ui';
import { reduced } from '../core/dom';
import { logger } from '../core/log';
import '../modules/cards';
import { useFormsHost } from '../modules/cards/forms-host';
import type { FormOutcome, FormSpec, FormsSource } from '../data';
import { connectorSigninForm, fromConnectorForm } from './forms';
import type { ConnectorFormIn } from './forms';
import type { ConnectorCatalogEntry, ConnectorInfo, ConnectorInstall, ConnectorRequest, ConnectorSource, ConnectorsBridge } from './connectors-bridge';

const log = logger('connectors');

export interface ConnectorsDeps {
  bridge: ConnectorsBridge;
  toast: (text: string) => void;
  /** the delay before the next card replaces one that just answered, so its receipt shows (0 in tests) */
  settle?: number;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || 'That did not work';

/** how a connector reads in the list: the word the design system's state vocabulary lets a row say, and its second line */
export interface ConnectorView { name: string; state: 'on' | 'off' | 'sign in' | 'plugin'; word: string; hint: string; canSignIn: boolean }
export function describeConnector(c: ConnectorInfo): ConnectorView {
  const where = c.url ?? [c.command, ...c.args].filter(Boolean).join(' ');
  const shown = where.length > 90 ? where.slice(0, 89) + '…' : where;
  if (c.plugin) return { name: c.name, state: 'plugin', word: 'from a plugin', hint: `Provided by the plugin ${c.plugin}; change the plugin to change it. ${shown}`.trim(), canSignIn: false };
  const needsSignIn = c.auth === 'oauth' && (c.needs_auth || c.oauth_tokens_present === false);
  const tools = c.tools === null || c.tools === undefined ? '' : `, ${String(c.tools)} tool${c.tools === 1 ? '' : 's'}`;
  let word: string;
  if (!c.enabled) word = 'off';
  else if (needsSignIn) word = 'needs sign-in';
  else if (c.status === 'connected') word = 'connected' + tools;
  else if (c.status === 'failed') word = 'failed to connect';
  else if (c.status === 'connecting') word = 'connecting';
  else if (c.status === 'lazy') word = 'connects when used';
  else word = 'not connected yet';
  const keys = c.secrets.length ? ` · ${String(c.secrets.length)} key${c.secrets.length === 1 ? '' : 's'} in your keychain` : '';
  return { name: c.name, state: !c.enabled ? 'off' : needsSignIn ? 'sign in' : 'on', word, hint: `${word} · ${shown}${keys}`, canSignIn: c.enabled && needsSignIn };
}

/** the host reads every value as text: a form's values, whatever the field's type */
export function textValues(values: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== null) out[k] = Array.isArray(v) ? v.map(String).join('\n') : String(v);
  return out;
}

/** what an install did, in lines a person reads */
export function installLines(r: ConnectorInstall): string[] {
  const lines = r.steps.map((s) => `${s.title}: ${s.detail || s.state}`);
  const t = r.test;
  if (t) {
    if (t.ok) lines.push(`Connected and found ${String(t.tools.length)} tool${t.tools.length === 1 ? '' : 's'}${t.tools.length ? ': ' + t.tools.slice(0, 8).map((x) => x.name).join(', ') + (t.tools.length > 8 ? ', …' : '') : ''}.`);
    else lines.push(`It did not connect: ${unlessEngine('hx.connectors.failed', t.error ?? 'no reason given')}`);
  }
  return [...lines, ...r.notes];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

interface Handlers {
  submit(formId: string, outcome: FormOutcome): Promise<void>;
  cancel(formId: string): Promise<void>;
  signin?: (formId: string, field: string) => Promise<void>;
  cancelSignin?: (formId: string, field: string) => Promise<void>;
}
const sink = (h: Handlers): FormsSource => ({
  submit: h.submit, cancel: h.cancel,
  signin: h.signin ?? (() => Promise.reject(new Error('There is nothing to sign in to here.'))),
  ...(h.cancelSignin ? { cancelSignin: h.cancelSignin } : {}),
  can: { signin: !!h.signin, upload: false, folder: false }, pickerItems: () => [], pickFolder: () => Promise.resolve(null)
});

/** Put the tab into `panel`. `refresh` asks the host again and drops any form that was open; call it each time the tab shows. */
export async function mountConnectors(panel: HTMLElement, deps: ConnectorsDeps): Promise<{ refresh: () => Promise<void> }> {
  const { bridge } = deps;
  const settle = deps.settle ?? (reduced() ? 200 : 700);
  const installed = el('section', { class: 'ui-set', 'aria-labelledby': 'hx-conn-installed-h' });
  const add = el('section', { class: 'ui-set', 'aria-labelledby': 'hx-conn-add-h' });
  const flow = el('section', { class: 'ui-set', 'aria-label': 'Add a connector', hidden: '' });
  panel.append(installed, add, flow);
  let catalog: ConnectorCatalogEntry[] = [];
  let busy = false;

  const say = (text: string): void => {
    const s = installed.querySelector('[data-conn-status]');
    if (s) s.textContent = text;
  };
  const release = (): void => { useFormsHost(null); };
  const showList = async (): Promise<void> => {
    release();
    flow.hidden = true;
    flow.replaceChildren();
    installed.hidden = false;
    add.hidden = false;
    await drawInstalled();
  };
  const showFlow = (...kids: Node[]): void => {
    installed.hidden = true;
    add.hidden = true;
    flow.hidden = false;
    const back = ui.button({ label: 'Back to connectors', size: 's', variant: 'ghost' });
    back.addEventListener('click', () => { void showList(); });
    flow.replaceChildren(el('div', { style: 'display:grid;gap:var(--sp-3)' }, ...kids, back));
  };
  const card = (spec: FormSpec, handlers: Handlers): HTMLElement => {
    useFormsHost(sink(handlers));
    const c = ui.card('form', spec as unknown as Record<string, unknown>, { size: 'inline' });
    queueMicrotask(() => { c.querySelector<HTMLElement>('.cd-form .ui-input, .cd-form .cd-opt[tabindex="0"], .cd-form .ui-switch, .cd-form [data-action="signin"]')?.focus(); });
    return c;
  };
  const later = (fn: () => void): void => { window.setTimeout(fn, settle); };

  /* ───────── installed ───────── */
  async function drawInstalled(): Promise<void> {
    let rows: string[];
    let list: ConnectorInfo[] = [];
    try {
      list = await bridge.list();
      rows = list.length
        ? list.map((c) => {
          const v = describeConnector(c);
          const id = 'hx-conn-' + c.name.replace(/[^a-z0-9_-]/gi, '_');
          const controls = c.plugin ? '' : [
            v.canSignIn ? ui.html.button({ label: 'Sign in', size: 's', variant: 'primary', attrs: { 'data-conn-signin': c.name, 'aria-label': 'Sign in to ' + c.name } }) : '',
            ui.html.switch({ id, name: c.name, checked: c.enabled, label: c.name + (c.enabled ? ' is on' : ' is off') }),
            ui.html.button({ label: 'Test', size: 's', attrs: { 'data-conn-test': c.name, 'aria-label': 'Test ' + c.name } }),
            ui.html.button({ label: 'Remove', size: 's', variant: 'ghost', attrs: { 'data-conn-remove': c.name, 'aria-label': 'Remove ' + c.name } })
          ].join('');
          /* an installed connector is the user's item: its own name is shown as it is (ADR-0031's store exception) */
          return storeItem(ui.html.setRow({ label: c.name, hint: v.hint, ...(c.plugin ? {} : { for: id }), control: controls ? '<span style="display:inline-flex;gap:var(--sp-2);align-items:center">' + controls + '</span>' : '' }));
        })
        : [ui.html.setRow({ label: 'No connectors yet', hint: 'boopis has no connectors yet. Add one below.' })];
    } catch (e) {
      rows = [ui.html.setRow({ label: 'Connectors', hint: `boopis could not read the list, so it is not shown: ${message(e)}` })];
    }
    installed.innerHTML = ui.html.setHead({ id: 'hx-conn-installed-h', label: 'Installed' }) + rows.join('') + '<p class="ui-field__hint" role="status" aria-live="polite" data-conn-status></p>';
    ui.hydrate(installed);
    const byName = new Map(list.map((c) => [c.name, c]));
    for (const sw of installed.querySelectorAll<HTMLInputElement>('input[role=switch]')) sw.addEventListener('change', () => { void toggle(sw.name, sw); });
    for (const b of installed.querySelectorAll<HTMLElement>('[data-conn-test]')) b.addEventListener('click', () => { void test(b.dataset['connTest'] ?? ''); });
    for (const b of installed.querySelectorAll<HTMLElement>('[data-conn-signin]')) b.addEventListener('click', () => { void signinFlow(b.dataset['connSignin'] ?? ''); });
    for (const b of installed.querySelectorAll<HTMLElement>('[data-conn-remove]')) b.addEventListener('click', () => { const c = byName.get(b.dataset['connRemove'] ?? ''); if (c) removeFlow(c); });
  }

  async function toggle(name: string, sw: HTMLInputElement): Promise<void> {
    if (busy) { sw.checked = !sw.checked; return; }
    busy = true;
    try {
      await bridge.setEnabled(name, sw.checked);
      deps.toast(`${name} is ${sw.checked ? 'on' : 'off'}. Open sessions keep the tools they started with; new ones use this.`);
    } catch (e) {
      sw.checked = !sw.checked;
      deps.toast(message(e));
    } finally { busy = false; }
    await drawInstalled();
  }

  async function test(name: string): Promise<void> {
    say(`Testing ${name}…`);
    try {
      const t = await bridge.test(name);
      say(t.ok ? `${name}: connected, ${String(t.tools.length)} tool${t.tools.length === 1 ? '' : 's'}${t.tools.length ? ': ' + t.tools.slice(0, 8).map((x) => x.name).join(', ') : ''}.` : `${name}: ${t.signin_needed ? 'needs you to sign in. ' : ''}${t.error ?? 'it did not connect'}`);
    } catch (e) { say(`${name}: ${message(e)}`); }
  }

  /* ───────── sign in ───────── */
  function signinCard(name: string, provider: string, host: string, then: () => void): HTMLElement {
    const model = connectorSigninForm(name, provider, host);
    return card(model.spec, {
      submit: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
      signin: async () => { await bridge.signin(name); later(then); },
      cancelSignin: async () => { await bridge.cancelSignin(name); }
    });
  }
  async function signinFlow(name: string): Promise<void> {
    let host = name;
    try { const c = (await bridge.list()).find((x) => x.name === name); try { if (c?.url) host = new URL(c.url).host; } catch { /* a URL Hermes holds that does not parse: the name stands */ } } catch { /* the card still works by name */ }
    showFlow(signinCard(name, name, host, () => { void showList(); }));
  }

  /* ───────── remove ───────── */
  function removeFlow(c: ConnectorInfo): void {
    const keys = c.secrets.length > 0;
    const spec: FormSpec = {
      id: 'connector.remove.' + c.name, kind: 'choice', title: `Remove ${c.name}?`, origin: { kind: 'host' }, defer: false,
      why: keys ? 'It has keys in your keychain. Removing the connector does not delete them unless you say so.' : 'boopis drops it from its connectors (and its sign-in tokens, if it had any).',
      schema: keys ? { properties: { keys: { type: 'string', title: 'Its keys', enum: ['keep', 'delete'], enumNames: ['Keep them in my keychain', 'Delete them too'], default: 'keep' } }, required: ['keys'] } : { properties: {} },
      submit: { label: 'Remove', hold: true }, cancel: { label: 'Keep it' }, receipt: `Removed ${c.name}`
    };
    showFlow(card(spec, {
      async submit(_id, outcome) {
        try {
          const r = await bridge.remove(c.name, outcome.values['keys'] === 'delete');
          deps.toast([`Removed ${c.name}.`, ...r.notes.slice(0, 1)].join(' '));
        } catch (e) { throw new Error(message(e)); }
        later(() => { void showList(); });
      },
      cancel() { void showList(); return Promise.resolve(); }
    }));
  }

  /* ───────── add ───────── */
  async function addFlow(source: ConnectorSource, entry?: { id: string; variant: string }): Promise<void> {
    let form;
    try { form = await bridge.inputs(source, entry?.id, entry?.variant); } catch (e) { deps.toast(message(e)); return; }
    const model = fromConnectorForm(form as ConnectorFormIn);
    const request = (values: Readonly<Record<string, unknown>>): ConnectorRequest => ({ source, values: { ...textValues(values), ...(entry ? { connector: entry.id, variant: entry.variant } : {}) } });
    showFlow(card({ ...model.spec, receipt: 'Checked. The review is next.' }, {
      async submit(_id, outcome) {
        let review;
        try { review = await bridge.review(request(outcome.values)); } catch (e) { throw new Error(message(e)); }
        later(() => { reviewFlow(request(outcome.values), review.plan_hash, review.name, fromConnectorForm(review.form as ConnectorFormIn)); });
      },
      cancel() { void showList(); return Promise.resolve(); }
    }));
  }

  function reviewFlow(request: ConnectorRequest, hash: string, name: string, model: ReturnType<typeof fromConnectorForm>): void {
    const result = el('div', { style: 'display:grid;gap:var(--sp-3)', 'aria-live': 'polite' });
    showFlow(card({ ...model.spec, name }, {
      async submit(_id, outcome) {
        let report: ConnectorInstall;
        const choice = outcome.values['restart']; try { report = await bridge.install(request, hash, outcome.secrets, choice === 'now' || choice === 'when_idle' ? choice : undefined); } catch (e) { throw new Error(message(e)); }
        later(() => { drawResult(result, report, request); });
      },
      cancel() { void showList(); return Promise.resolve(); }
    }), result);
  }

  function drawResult(into: HTMLElement, r: ConnectorInstall, request: ConnectorRequest): void {
    const list = el('ul', { style: 'margin:0;padding-left:1.2em;color:var(--text-dim)' });
    for (const line of installLines(r)) list.append(el('li', {}, line));
    const kids: Node[] = [el('h3', { class: 'ui-set__head' }, r.test?.ok ? `${r.name} is ready` : `${r.name} is added`), list];
    if (r.signin_needed) {
      let host = r.name;
      try { if (request.values['url']) host = new URL(request.values['url']).host; } catch { /* the name stands */ }
      kids.push(signinCard(r.name, r.name, host, () => { void showList(); }));
    } else {
      const done = ui.button({ label: 'Done', variant: 'primary', size: 's' });
      done.addEventListener('click', () => { void showList(); });
      kids.push(done);
    }
    into.replaceChildren(...kids);
    log.info('connector installed', r.name);
  }

  /* ───────── the add rows ───────── */
  function drawAdd(): void {
    const rows: string[] = [];
    for (const c of catalog) {
      for (const v of c.variants) {
        /* a collection item keeps its own name and publisher, whatever they say (ADR-0031's store exception) */
        rows.push(storeItem(ui.html.setRow({
          label: `${c.name}: ${v.label}`, hint: `${v.summary} Reaches: ${v.reaches}.${v.pinned ? ' Pinned to ' + v.pinned + '.' : ''}`,
          control: ui.html.button({ label: 'Add', size: 's', attrs: { 'data-add-catalog': c.id, 'data-add-variant': v.id, 'aria-label': `Add ${c.name}, ${v.label}` } })
        })));
      }
    }
    rows.push(ui.html.setRow({ label: 'From a URL', hint: 'A remote MCP server. https only; keys go to your keychain.', control: ui.html.button({ label: 'Add', size: 's', attrs: { 'data-add-url': '', 'aria-label': 'Add a connector from a URL' } }) }));
    rows.push(ui.html.setRow({ label: 'From a command', hint: 'A local program that speaks MCP. It runs on this computer as you.', control: ui.html.button({ label: 'Add', size: 's', attrs: { 'data-add-command': '', 'aria-label': 'Add a connector from a command' } }) }));
    add.innerHTML = ui.html.setHead({ id: 'hx-conn-add-h', label: 'Add' }) + rows.join('');
    ui.hydrate(add);
    for (const b of add.querySelectorAll<HTMLElement>('[data-add-catalog]')) b.addEventListener('click', () => { void addFlow('catalog', { id: b.dataset['addCatalog'] ?? '', variant: b.dataset['addVariant'] ?? '' }); });
    add.querySelector('[data-add-url]')?.addEventListener('click', () => { void addFlow('url'); });
    add.querySelector('[data-add-command]')?.addEventListener('click', () => { void addFlow('command'); });
  }

  try { catalog = await bridge.catalog(); } catch (e) { log.warn('the collection did not load', e); }
  drawAdd();
  await drawInstalled();
  return { refresh: showList };
}
