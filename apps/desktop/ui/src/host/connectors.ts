/* Settings > Connectors: the MCP servers Hermes has (docs/CONNECTORS.md), and how to add one. Adding is three forms in the
   card family (docs/FORMS.md): the inputs (a collection entry's setup values, a URL, or a command), the review (the `connector`
   card: exactly what will be added, the command and its arguments, the hosts it reaches, the pinned version, the config diff,
   the keys it needs as secret fields), and, when the server signs in with OAuth, a `signin` card. Every change goes through the
   host, which validates it again and drives Hermes's own mechanisms; this view knows no Hermes file and holds no key (a key
   goes from its field to the host's keychain and no further). It is drawn with the v7 kit (DESIGN-SYSTEM.md v7 21): a settings
   Page of SectionHeads and Cards. The forms stay the card family's form card (owner decision: forms are one card family).

   The redesign (the owner, 23 November 2026: "it's hard to actually find stuff in the screen"): a search over everything on the
   tab (the search Field); each installed connector a Row (its name, its state as the value or a StatusWord, where it runs behind
   the label's mark, its Switch, Test and Remove in its overflow Menu); boopis's collection as one ListRow per connector (the
   Store's item row: its mark, its publisher and what it does, the ways it can run as a Badge), where choosing a connector with
   several ways opens a Menu that says what each one does and reaches; then the other ways to add. */
import { STORE_ITEM, storeItem } from '../core/engine-words';
import { esc } from '../core/dom';
import { unlessEngine } from './errors';
import { itemGlyphHTML, kit, ui } from '@boopis/ui';
import { reduced } from '../core/dom';
import { logger } from '../core/log';
import '../modules/cards';
import { useFormsHost } from '../modules/cards/forms-host';
import type { FormOutcome, FormSpec, FormsSource } from '../data';
import type { ItemRef } from '@boopis/ui';
import { clipSpots, tipsIfClipped, watchCuts } from '../core/clip';
import { connectorSigninForm, fromConnectorForm } from './forms';
import type { ConnectorFormIn } from './forms';
import type { ConnectorCatalogEntry, ConnectorInfo, ConnectorInstall, ConnectorRequest, ConnectorSource, ConnectorsBridge } from './connectors-bridge';

const log = logger('connectors');

export interface ConnectorsDeps {
  bridge: ConnectorsBridge;
  /** a line the person should see now (the floating Notice) */
  notify: (text: string) => void;
  /** opens the store view ("Browse the store"); absent: the row is left out */
  openStore?: () => void;
  /** the bots a connector can be set up for, asked each time the tab shows; absent or empty: the choice is not drawn and the main profile's connectors are the only ones */
  bots?: () => readonly { id: string; name: string }[];
  /** the connectors of one bot (its own link); the bridge of the main profile is `bridge` */
  bridgeFor?: (bot: string) => ConnectorsBridge;
  /** the delay before the next card replaces one that just answered, so its receipt shows (0 in tests) */
  settle?: number;
}

const plural = (n: number, one: string): string => String(n) + ' ' + one + (n === 1 ? '' : 's');
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || 'That did not work';

/** how a connector reads in the list: the word the design system's state vocabulary lets a row say, and its second line */
export interface ConnectorView {
  name: string; state: 'on' | 'off' | 'sign in' | 'plugin'; word: string; hint: string; canSignIn: boolean;
  /** the state word's tone: attention for what the person owes (a sign-in, a failure), busy while it connects */
  tone: 'attention' | 'busy' | null;
  /** where it runs, shortened: its address, or its command and arguments; then its keys */
  where: string;
}
export function describeConnector(c: ConnectorInfo): ConnectorView {
  const where = c.url ?? [c.command, ...c.args].filter(Boolean).join(' ');
  const shown = where.length > 90 ? where.slice(0, 89) + '…' : where;
  if (c.plugin) return { name: c.name, state: 'plugin', word: 'from a plugin', hint: `Provided by the plugin ${c.plugin}; change the plugin to change it. ${shown}`.trim(), canSignIn: false, tone: null, where: `Provided by the plugin ${c.plugin}; change the plugin to change it. ${shown}`.trim() };
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
  const tone = !c.enabled ? null : needsSignIn || c.status === 'failed' ? 'attention' : c.status === 'connecting' ? 'busy' : null;
  return { name: c.name, state: !c.enabled ? 'off' : needsSignIn ? 'sign in' : 'on', word, hint: `${word} · ${shown}${keys}`, canSignIn: c.enabled && needsSignIn, tone, where: `${shown}${keys}` };
}

/** what a connector's tile is drawn from: what it runs (its address, or its command and arguments), and its name */
export const connectorRef = (c: Pick<ConnectorInfo, 'name' | 'url' | 'command' | 'args'>): ItemRef => ({ name: c.name, collection: c.name, url: c.url ?? null, command: c.command ?? null, args: c.args });

/** every word of `query` is somewhere in `fields` (case aside); an empty query matches everything */
export function matches(query: string, ...fields: ReadonlyArray<string | null | undefined>): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
}
/** a collection entry as its row says it: by whom (unless the name says it) and what it does; its ways to run at the end, or
    that it is added already (an installed connector of the same name, as the host names a collection install) */
export function collectionRow(c: Pick<ConnectorCatalogEntry, 'id' | 'name' | 'publisher' | 'description' | 'variants'>, installed: ReadonlySet<string>): { sub: string; end: string } {
  const by = c.publisher.trim().toLowerCase() === c.name.trim().toLowerCase() ? '' : c.publisher;
  const ways = c.variants.map((v) => v.label.toLowerCase()).join(' · ');
  /* the ways it can run, by their own names while they are short; else how many there are (the menu names them) */
  return { sub: [by, c.description.trim()].filter(Boolean).join(' · '), end: installed.has(c.id) ? 'added' : ways.length <= 24 ? ways : plural(c.variants.length, 'way') };
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

/** a row of a kit Menu (v7 21.2 rows 5, 19) */
type MenuEntry = Parameters<typeof kit.openMenu>[1]['entries'][number];
const h = (html: string): HTMLElement => kit.wire(document.createRange().createContextualFragment(html).firstElementChild as HTMLElement);

/** Put the tab into `panel`. `refresh` asks the host again and drops any form that was open; call it each time the tab shows. */
export async function mountConnectors(panel: HTMLElement, deps: ConnectorsDeps): Promise<{ refresh: () => Promise<void> }> {
  /* who the tab is about: null is the main profile, else a bot's profile name. Every list, switch, test, add and removal goes to that one. */
  let target: string | null = null;
  const br = (): ConnectorsBridge => (target !== null && deps.bridgeFor ? deps.bridgeFor(target) : deps.bridge);
  const settle = deps.settle ?? (reduced() ? 200 : 700);
  panel.classList.add('hx-conn');
  const pageEl = h(kit.html.page({ variant: 'settings', title: 'Connectors', body: '' }));
  const body = pageEl.querySelector('.k7-page__body') as HTMLElement;
  const find = el('div', { class: 'hx-conn__find', role: 'search' });
  const forBot = el('div', { class: 'k7-section', hidden: '' });
  const installed = el('div', { class: 'k7-section hx-conn__installed', id: 'hx-conn-installed' });
  const collection = el('div', { class: 'k7-section', id: 'hx-conn-coll' });
  const add = el('div', { class: 'k7-section', id: 'hx-conn-add' });
  const flow = el('div', { class: 'hx-conn__flow', 'aria-label': 'Add a connector', role: 'region', hidden: '' });
  const live = el('p', { class: 'k7-sr', role: 'status', 'aria-live': 'polite', 'data-conn-status': '' });
  body.append(find, live, forBot, installed, collection, add, flow);
  panel.replaceChildren(pageEl);
  let catalog: ConnectorCatalogEntry[] = [];
  let busy = false;
  let query = '';
  let have: ConnectorInfo[] = [];
  /* one search over the tab: it narrows the installed connectors and the collection as you type */
  const search = h(kit.html.field({ id: 'hx-conn-q', kind: 'search', ariaLabel: 'Find a connector', placeholder: 'Find a connector by name, publisher or what it does' }));
  find.append(search);
  const qInput = search.querySelector<HTMLInputElement>('input');
  qInput?.addEventListener('input', () => { query = qInput.value; drawInstalledRows(); drawCollection(); });
  qInput?.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { const r = collection.querySelector<HTMLElement>('[data-add-entry][tabindex="0"], [data-add-entry]'); if (r) { e.preventDefault(); r.focus(); } } });

  const say = (text: string): void => { live.textContent = text; deps.notify(text); };
  const release = (): void => { useFormsHost(null); };
  const head = (title: string): string => kit.html.sectionHead({ title });
  const showList = async (): Promise<void> => {
    release();
    flow.hidden = true;
    flow.replaceChildren();
    installed.hidden = false;
    add.hidden = false;
    collection.hidden = !catalog.length;
    find.hidden = false;
    drawFor();
    await drawInstalled();
  };
  const showFlow = (...kids: Node[]): void => {
    installed.hidden = true;
    add.hidden = true;
    collection.hidden = true;
    find.hidden = true;
    forBot.hidden = true;
    flow.hidden = false;
    const back = h(kit.html.button({ label: 'Back to connectors', variant: 'ghost', size: 32, icon: 'back' }));
    back.classList.add('hx-conn__back');
    back.addEventListener('click', () => { void showList(); });
    flow.replaceChildren(back, ...kids);
  };
  const card = (spec: FormSpec, handlers: Handlers): HTMLElement => {
    useFormsHost(sink(handlers));
    const c = ui.card('form', spec as unknown as Record<string, unknown>, { size: 'inline' });
    queueMicrotask(() => { c.querySelector<HTMLElement>('.cd-form .ui-input, .cd-form .cd-opt[tabindex="0"], .cd-form .ui-switch, .cd-form [data-action="signin"]')?.focus(); });
    return c;
  };
  const later = (fn: () => void): void => { window.setTimeout(fn, settle); };

  /* ───────── for: the main profile or one bot ───────── */
  function drawFor(): void {
    const bots = deps.bots?.() ?? [];
    if (!bots.length || !deps.bridgeFor) { target = null; forBot.hidden = true; forBot.replaceChildren(); return; }
    if (target !== null && !bots.some((b) => b.id === target)) target = null;
    forBot.hidden = false;
    const name = target === null ? 'The main profile' : bots.find((b) => b.id === target)?.name ?? target;
    forBot.innerHTML = head('For') + kit.html.card({ rows: [{
      label: 'Connectors for', explain: target === null ? 'The main profile. Each bot keeps connectors of its own: pick a bot to see and change its.' : `Only ${name} has these. The main profile and the other bots are not changed.`,
      control: kit.html.selectorItem({ variant: 'field', label: 'Connectors for', value: name, attrs: { id: 'hx-conn-for' } })
    }] });
    kit.wire(forBot);
    const pick = forBot.querySelector<HTMLElement>('#hx-conn-for') as HTMLElement;
    pick.addEventListener('click', () => {
      const entries: MenuEntry[] = [{ value: '', label: 'The main profile', checked: target === null, role: 'menuitemradio' as const }, ...bots.map((b) => ({ value: b.id, label: b.name, checked: target === b.id, role: 'menuitemradio' as const }))];
      kit.openMenu(pick, { label: 'Connectors for', entries, align: 'start', onSelect: (v) => { target = v || null; void showList(); } });
    });
  }

  /* ───────── installed ───────── */
  let listError = '';
  async function drawInstalled(): Promise<void> {
    try { have = await br().list(); listError = ''; } catch (e) { have = []; listError = message(e); }
    drawInstalledRows();
    drawCollection();
  }
  function drawInstalledRows(): void {
    const keep = document.activeElement instanceof HTMLElement && installed.contains(document.activeElement) ? document.activeElement.id : '';
    const shown = have.filter((c) => matches(query, c.name, c.url, c.command, ...c.args, c.plugin));
    let inner: string;
    if (listError) inner = kit.html.notice({ text: `boopis could not read the list, so it is not shown: ${listError}`, tone: 'red', place: 'page' });
    else if (!have.length) inner = kit.html.emptyState({ text: catalog.length ? 'No connectors yet. Pick one from boopis\'s collection below, or add your own.' : 'No connectors yet. Add one below.' });
    else if (!shown.length) inner = kit.html.emptyState({ text: `No installed connector matches “${query.trim()}”.` });
    else inner = kit.html.card({ attrs: { id: 'hx-conn-have' }, rows: shown.map((c) => {
      const v = describeConnector(c);
      const id = 'hx-conn-' + c.name.replace(/[^a-z0-9_-]/gi, '_');
      /* the state: a plain value at rest; a StatusWord when the person owes something (a sign-in: amber), it failed (red) or it is busy */
      const word = v.tone ? kit.html.statusWord({ text: v.word, tone: v.tone === 'attention' ? (c.status === 'failed' ? 'red' : 'owe') : 'neutral', dot: true, pulse: v.tone === 'busy' }) : '';
      const control = c.plugin ? '' : [
        word,
        v.canSignIn ? kit.html.button({ label: 'Sign in', variant: 'tint', size: 28, attrs: { 'data-conn-signin': c.name, 'aria-label': 'Sign in to ' + c.name } }) : '',
        kit.html.switch({ id, checked: c.enabled, label: c.name, attrs: { 'data-conn-switch': c.name } }),
        kit.html.iconButton({ icon: 'more', label: 'More for ' + c.name, variant: 'tinted', haspopup: 'menu', tip: 'More', attrs: { 'data-conn-more': c.name } })
      ].join('');
      /* an installed connector is the user's item: its own name is shown as it is (ADR-0031's store exception) */
      return { label: c.name, labelHTML: storeItem(esc(c.name)), explain: v.where, ...(v.tone ? {} : { value: v.word }), control };
    }) });
    installed.innerHTML = head('Installed') + inner;
    kit.wire(installed);
    for (const sw of installed.querySelectorAll<HTMLButtonElement>('[data-conn-switch]')) sw.addEventListener('ui:change', (e) => { void toggle(sw.dataset['connSwitch'] ?? '', (e as CustomEvent<{ value: boolean }>).detail.value, sw); });
    for (const b of installed.querySelectorAll<HTMLElement>('[data-conn-signin]')) b.addEventListener('click', () => { void signinFlow(b.dataset['connSignin'] ?? ''); });
    const byName = new Map(have.map((c) => [c.name, c]));
    for (const b of installed.querySelectorAll<HTMLElement>('[data-conn-more]')) b.addEventListener('click', () => {
      const c = byName.get(b.dataset['connMore'] ?? ''); if (!c) return;
      kit.openMenu(b, { label: 'More for ' + c.name, align: 'end', entries: [{ label: 'Test', value: 'test' }, '-', { label: 'Remove', value: 'remove', danger: true }],
        onSelect: (v) => { if (v === 'test') void test(c.name); else removeFlow(c); } });
    });
    if (keep) installed.querySelector<HTMLElement>('#' + CSS.escape(keep))?.focus({ preventScroll: true });
  }

  /* ───────── boopis's collection: one ListRow per connector ───────── */
  function drawCollection(): void {
    collection.hidden = !catalog.length || !flow.hidden;
    if (!catalog.length) { collection.replaceChildren(); return; }
    const added = new Set(have.map((c) => c.name));
    const shown = catalog.filter((c) => matches(query, c.name, c.publisher, c.description, ...c.variants.map((v) => v.label)));
    const rows = shown.map((c, i) => {
      const w = collectionRow(c, added);
      /* a collection item keeps its own name and publisher, whatever they say (ADR-0031's store exception) */
      return kit.html.listRow({ variant: 'item', title: c.name, sub: w.sub, markHTML: itemGlyphHTML({ name: c.name, collection: c.id }), count: w.end,
        attrs: { role: 'button', tabindex: i === 0 ? '0' : '-1', 'aria-selected': null, 'data-add-entry': c.id, [STORE_ITEM]: '', 'data-ways': String(c.variants.length), 'aria-haspopup': c.variants.length > 1 ? 'menu' : null } });
    });
    const none = query.trim() && !shown.length ? kit.html.emptyState({ text: `Nothing in boopis's collection matches “${query.trim()}”.` }) : '';
    collection.innerHTML = head('From boopis\'s collection') + (rows.length ? '<div class="k7-list hx-conn__rows" role="group" aria-label="From boopis\'s collection">' + rows.join('') + '</div>' : '') + none;
    kit.wire(collection);
    tipsIfClipped(clipSpots(collection));   /* measured at once, so every draw of the list carries the same tooltips */
  }
  /* a cut name or line is checked again whenever the collection's width changes */
  watchCuts(collection);
  /* choosing a connector: one way to run adds it at once; several open a Menu that says what each one does and where it reaches */
  const choose = (row: HTMLElement): void => {
    const c = catalog.find((x) => x.id === row.dataset['addEntry']); if (!c) return;
    const only = c.variants.length === 1 ? c.variants[0] : undefined;
    if (only) { void addFlow('catalog', { id: c.id, variant: only.id }); return; }
    kit.openMenu(row, {
      label: 'Ways to add ' + c.name, align: 'start',
      entries: [{ heading: 'Add ' + c.name }, ...c.variants.map((v) => ({ label: v.label, value: v.id, desc: `${v.summary} Reaches: ${v.reaches}.${v.pinned ? ' Pinned to ' + v.pinned + '.' : ''}` }))],
      onSelect: (v) => { void addFlow('catalog', { id: c.id, variant: v }); }
    });
  };
  collection.addEventListener('click', (e) => { const r = (e.target as Element).closest<HTMLElement>('[data-add-entry]'); if (r) choose(r); });
  collection.addEventListener('keydown', (e) => {
    const r = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-add-entry]'); if (!r) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(r); return; }
    const all = [...collection.querySelectorAll<HTMLElement>('[data-add-entry]')], i = all.indexOf(r);
    const n = ({ ArrowDown: i + 1, ArrowUp: i - 1 } as Record<string, number>)[e.key];
    if (n == null) return;
    e.preventDefault();
    if (n < 0) { qInput?.focus(); return; }
    const next = all[n]; if (!next) return;
    for (const x of all) x.tabIndex = x === next ? 0 : -1;
    next.focus();
  });

  async function toggle(name: string, on: boolean, sw: HTMLButtonElement): Promise<void> {
    if (busy) { sw.setAttribute('aria-checked', String(!on)); return; }
    busy = true;
    try {
      await br().setEnabled(name, on);
      deps.notify(`${name} is ${on ? 'on' : 'off'}. Open sessions keep the tools they started with; new ones use this.`);
    } catch (e) {
      sw.setAttribute('aria-checked', String(!on));
      deps.notify(message(e));
    } finally { busy = false; }
    await drawInstalled();
  }

  async function test(name: string): Promise<void> {
    say(`Testing ${name}…`);
    try {
      const t = await br().test(name);
      say(t.ok ? `${name}: connected, ${String(t.tools.length)} tool${t.tools.length === 1 ? '' : 's'}${t.tools.length ? ': ' + t.tools.slice(0, 8).map((x) => x.name).join(', ') : ''}.` : `${name}: ${t.signin_needed ? 'needs you to sign in. ' : ''}${t.error ?? 'it did not connect'}`);
    } catch (e) { say(`${name}: ${message(e)}`); }
  }

  /* ───────── sign in ───────── */
  function signinCard(name: string, provider: string, host: string, then: () => void): HTMLElement {
    const model = connectorSigninForm(name, provider, host);
    return card(model.spec, {
      submit: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
      signin: async () => { await br().signin(name); later(then); },
      cancelSignin: async () => { await br().cancelSignin(name); }
    });
  }
  async function signinFlow(name: string): Promise<void> {
    let host = name;
    try { const c = (await br().list()).find((x) => x.name === name); try { if (c?.url) host = new URL(c.url).host; } catch { /* a URL Hermes holds that does not parse: the name stands */ } } catch { /* the card still works by name */ }
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
          const r = await br().remove(c.name, outcome.values['keys'] === 'delete');
          deps.notify([`Removed ${c.name}.`, ...r.notes.slice(0, 1)].join(' '));
        } catch (e) { throw new Error(message(e)); }
        later(() => { void showList(); });
      },
      cancel() { void showList(); return Promise.resolve(); }
    }));
  }

  /* ───────── add ───────── */
  async function addFlow(source: ConnectorSource, entry?: { id: string; variant: string }): Promise<void> {
    let form;
    try { form = await br().inputs(source, entry?.id, entry?.variant); } catch (e) { deps.notify(message(e)); return; }
    const model = fromConnectorForm(form as ConnectorFormIn);
    const request = (values: Readonly<Record<string, unknown>>): ConnectorRequest => ({ source, values: { ...textValues(values), ...(entry ? { connector: entry.id, variant: entry.variant } : {}) } });
    showFlow(card({ ...model.spec, receipt: 'Checked. The review is next.' }, {
      async submit(_id, outcome) {
        let review;
        try { review = await br().review(request(outcome.values)); } catch (e) { throw new Error(message(e)); }
        later(() => { reviewFlow(request(outcome.values), review.plan_hash, review.name, fromConnectorForm(review.form as ConnectorFormIn)); });
      },
      cancel() { void showList(); return Promise.resolve(); }
    }));
  }

  function reviewFlow(request: ConnectorRequest, hash: string, name: string, model: ReturnType<typeof fromConnectorForm>): void {
    const result = el('div', { class: 'hx-conn__result', 'aria-live': 'polite' });
    showFlow(card({ ...model.spec, name }, {
      async submit(_id, outcome) {
        let report: ConnectorInstall;
        const choice = outcome.values['restart']; try { report = await br().install(request, hash, outcome.secrets, choice === 'now' || choice === 'when_idle' ? choice : undefined); } catch (e) { throw new Error(message(e)); }
        later(() => { drawResult(result, report, request); });
      },
      cancel() { void showList(); return Promise.resolve(); }
    }), result);
  }

  function drawResult(into: HTMLElement, r: ConnectorInstall, request: ConnectorRequest): void {
    const kids: Node[] = [h(kit.html.sectionHead({ title: r.test?.ok ? `${r.name} is ready` : `${r.name} is added` })), h(kit.html.card({ rows: installLines(r).map((line) => ({ label: line, explain: line })) }))];
    if (r.signin_needed) {
      let host = r.name;
      try { if (request.values['url']) host = new URL(request.values['url']).host; } catch { /* the name stands */ }
      kids.push(signinCard(r.name, r.name, host, () => { void showList(); }));
    } else {
      const done = h(kit.html.button({ label: 'Done', variant: 'primary', size: 32 }));
      done.classList.add('hx-conn__back');
      done.addEventListener('click', () => { void showList(); });
      kids.push(done);
    }
    into.replaceChildren(...kids);
    log.info('connector installed', r.name);
  }

  /* ───────── the add rows ───────── */
  function drawAdd(): void {
    const rows: Array<{ label: string; explain: string; control: string }> = [];
    if (deps.openStore) rows.push({ label: 'From the store', explain: 'Recommended connectors, and every other source boopis can read, to search and review.', control: kit.html.button({ label: 'Browse the store', size: 28, variant: 'tint', attrs: { 'data-add-store': '' } }) });
    rows.push({ label: 'From a URL', explain: 'A remote MCP server. https only; keys go to your keychain.', control: kit.html.button({ label: 'Add', size: 28, variant: 'tint', attrs: { 'data-add-url': '', 'aria-label': 'Add a connector from a URL' } }) });
    rows.push({ label: 'From a command', explain: 'A local program that speaks MCP. It runs on this computer as you.', control: kit.html.button({ label: 'Add', size: 28, variant: 'tint', attrs: { 'data-add-command': '', 'aria-label': 'Add a connector from a command' } }) });
    add.innerHTML = head(catalog.length ? 'Other ways to add' : 'Add') + kit.html.card({ rows });
    kit.wire(add);
    add.querySelector('[data-add-store]')?.addEventListener('click', () => { deps.openStore?.(); });
    add.querySelector('[data-add-url]')?.addEventListener('click', () => { void addFlow('url'); });
    add.querySelector('[data-add-command]')?.addEventListener('click', () => { void addFlow('command'); });
  }

  try { catalog = await deps.bridge.catalog(); } catch (e) { log.warn('the collection did not load', e); }
  drawAdd();
  drawFor();
  collection.hidden = !catalog.length;
  await drawInstalled();
  return { refresh: showList };
}
