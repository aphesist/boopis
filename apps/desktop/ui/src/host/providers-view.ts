/* The Providers section of Settings > Models (ADR-0039, report section 9). Everything it lists is drawn from the catalogue
   (`data/providers.ts`, one file) and the host's `ProviderState` per way; it holds no list of labs of its own.

   Shape: a search field and a filter (All, Connected, Sign in, API key, On this computer, Custom); "Found on this computer" at the
   top when a probe answered; one head per lab with one row per way (a status word and the buttons it needs); the labs under
   "More providers" collapsed, which search and any filter still reach. A status is always a word, never colour alone. Terms
   notes are quiet lines under their row. A button opens a form card in place of the list (as Connectors does), with a way back.

   Built from the v7 kit only (step 7a): a section head and a settings Card of rows per lab, the search Field, filter Chips, Buttons and
   StatusWords, and the one form card family. A lab's own sign-in button keeps its brand (ADR-0040). No CSS of its own. */
import { kit, ui } from '@boopis/ui';
import type { RowOpts } from '@boopis/ui';
import '../modules/cards';
import { useFormsHost } from '../modules/cards/forms-host';
import { esc } from '../core/dom';
import { entries, groups, listed, search as searchEntries, STATUS_WORDS } from '../data/providers';
import type { Entry, Way } from '../data/providers';
import type { FormSpec, FormsSource } from '../data';
import { startEndpointFlow } from './endpoint-form';
import type { FlowHandlers, FlowUi } from './endpoint-form';
import type { ProviderState, ProvidersBridge } from './providers-bridge';
import { mountChatgptSignin } from './chatgpt-signin';
import type { ChatgptBridge } from './chatgpt-signin';
import { localUseNote, useLocalRuntime } from './local-runtime';
import { commands } from './bindings';
import type { ConnectorLogin, InstallHint } from './bindings';
import { brandOf } from './signin-brands';
import { focusForm } from '../modules/cards/form';

export type Filter = 'all' | 'connected' | 'signin' | 'key' | 'local' | 'custom';
export const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'connected', label: 'Connected' }, { value: 'signin', label: 'Sign in' },
  { value: 'key', label: 'API key' }, { value: 'local', label: 'On this computer' }, { value: 'custom', label: 'Custom' }
];

/** what a row's button does */
export type Do = 'key' | 'remove' | 'signin' | 'signout' | 'continue' | 'recheck' | 'use' | 'endpoint' | 'copy' | 'guide';
export interface Action { do: Do; label: string; primary?: boolean; ghost?: boolean }

/** A sign-in card a stream other than this one draws (xAI, Copilot): mounted in place of the list for its way. */
export type SigninMount = (host: HTMLElement, done: () => void) => { destroy: () => void };
const SIGNIN_CARDS = new Map<string, SigninMount>();
/** register the card for a sign-in way (`xai.signin`); the row offers Sign in once there is one */
export function registerSigninCard(way: string, mount: SigninMount): void { SIGNIN_CARDS.set(way, mount); }

export interface ProvidersDeps {
  bridge: ProvidersBridge;
  /** the host's sign-in for a provider id in its table (Claude Code's own login) */
  login?: (provider: string) => Promise<ConnectorLogin>;
  /** boopis's own ChatGPT sign-in, whose card mounts for `openai.signin` */
  chatgpt?: ChatgptBridge;
  toast: (text: string) => void;
  /** how long a card's receipt shows before the list is drawn again (ms) */
  settle?: number;
  /** cards for other sign-ins, by way id; the registry's are used when absent */
  signinCards?: Readonly<Record<string, SigninMount>>;
  /** another arrangement of the same list (first-run setup's hub, `providers-hub.ts`); the section's own when absent. The rows keep
      their `data-do` and `data-way` buttons, so every action below is the section's own. */
  layout?: ProvidersLayout;
  /** told after every read with what the host said (the hub counts what is connected) */
  onStates?: (states: ReadonlyMap<string, ProviderState>) => void;
  /** open a page in the system browser (the program's install guide); the host's opener when absent */
  open?: (url: string) => Promise<void>;
  /** put text on the clipboard (the install command); the browser's clipboard when absent */
  copy?: (text: string) => Promise<void>;
}

/** How the list is arranged: the heading, the markup of a plan, and the words of the way back from a form card. */
export interface ProvidersLayout {
  title: string;
  /** the level of every heading in the section (first run's title is the h1; Settings' headings sit under its dialog's) */
  level?: 2 | 3;
  /** no search field and no filter: the page lists everything it has room for (first run) */
  bare?: boolean;
  planHtml: (p: Plan, canSignin: (w: Way) => boolean, tailOpen: boolean) => string;
  back: string;
}

/* ───────── what to say and what to offer: pure, tested ───────── */
const CODE_WORDS: Readonly<Record<string, string>> = {
  'hx.provider.not_installed': 'Not installed', 'hx.provider.cli_failed': 'Did not start', 'hx.provider.needs_update': 'Needs an update', 'hx.provider.metered': 'Not your subscription',
  'hx.provider.key_rejected': 'Key refused', 'hx.provider.unreachable': 'Not reachable'
};

/** Problems a person fixes with an ordinary step (update the program, sign in with the right account): said calmly, never as a
    failure. Everything else in `error` is a real failure. */
export const CALM_CODES: ReadonlySet<string> = new Set(['hx.provider.needs_update', 'hx.provider.metered']);
/** whether a state is a real failure (drawn as one), not a calm step to take */
export const failed = (state: ProviderState | null | undefined): boolean => state?.status === 'error' && !CALM_CODES.has(state.code ?? '');

/** the two buttons an install or update hint adds: copy its command, open the maker's guide */
export const installActions = (hint: InstallHint): Action[] => [
  { do: 'copy', label: 'Copy command' }, { do: 'guide', label: hint.kind === 'update' ? 'Update guide' : 'Install guide', ghost: true }
];
/** the command line under a row or on a plate: where to paste it, then the command as the kit's code (on a line of its own where
    the column is narrow, so it wraps at its spaces and not after the first word) */
export const installLineHtml = (hint: InstallHint, cls: string, ownLine = false): string =>
  `<p class="${cls}" data-install>In ${esc(hint.shell)}: ${ownLine ? '<br>' : ''}${ui.html.code(hint.command)}</p>`;

/** the word a way's state gets (text, never colour alone) */
export function statusWord(state: ProviderState | null | undefined): string {
  if (!state) return 'Not read';
  if (state.status === 'connected') return state.plan ? `${STATUS_WORDS.connected} (${state.plan})` : STATUS_WORDS.connected;
  if (state.status === 'error') return CODE_WORDS[state.code ?? ''] ?? STATUS_WORDS.error;
  if (state.kind === 'local' && state.status === 'not_found' && state.checked_at == null) return 'Not checked';
  return STATUS_WORDS[state.status];
}

/** the line under a way's label: what it is, then what is known of it now (a count, or the reason it is not working) */
export function hintOf(way: Way, state: ProviderState | null | undefined): string {
  const parts = [way.hint];
  if (state?.detail) parts.push(state.detail);
  else if (state?.status === 'connected' && state.models_count != null) parts.push(`${String(state.models_count)} ${state.models_count === 1 ? 'model' : 'models'} found.`);
  return parts.filter(Boolean).join(' ');
}

/** which buttons a row has, from the way and its state; `canSignin` says whether this build can run that sign-in */
export function actionsFor(way: Way, state: ProviderState | null | undefined, canSignin: boolean): Action[] {
  /* the host lists the endpoints made, not the catalogue's add-one row: that row always offers the form */
  if (way.kind === 'custom') return [{ do: 'endpoint', label: 'Add endpoint', primary: true }];
  if (!state) return [];
  const s = state.status;
  switch (way.kind) {
    case 'key':
      if (s === 'needs_key') return [{ do: 'key', label: 'Add key', primary: true }];
      return [{ do: 'key', label: 'Change key' }, { do: 'remove', label: 'Remove', ghost: true }];
    case 'local':
      return s === 'found_local' ? [{ do: 'use', label: 'Use', primary: true }] : [{ do: 'recheck', label: 'Check again' }];
    case 'signin': {
      const flow = way.signin?.flow;
      if (s === 'connected') return flow === 'device_code' || flow === 'official_program' ? [{ do: 'signout', label: 'Sign out', ghost: true }] : [];
      if (flow === 'cli') {
        const out: Action[] = [];
        if (s === 'signed_out' || state.code === 'hx.provider.metered') out.push({ do: 'signin', label: 'Sign in', primary: true });
        if (state.install) out.push(...installActions(state.install));
        out.push({ do: 'recheck', label: 'Check again' });
        return out;
      }
      if (flow === 'cli_drive') return [{ do: 'recheck', label: 'Check again' }];
      if (s === 'signing_in') return canSignin ? [{ do: 'continue', label: 'Continue', primary: true }] : [];
      return canSignin ? [{ do: 'signin', label: 'Sign in', primary: true }] : [];
    }
  }
}

const matchesFilter = (f: Filter, way: Way, state: ProviderState | null | undefined): boolean =>
  f === 'all' || (f === 'connected' ? state?.status === 'connected' : f === way.kind);

export interface Row { entry: Entry; way: Way; state: ProviderState | null }
export interface Block { id: string; head: string; rows: Row[]; /** endpoints the person added, which no catalogue way describes */ endpoints?: ProviderState[] }
export interface Plan { found: Row[]; main: Block[]; more: Block[]; flat: boolean; empty: boolean }

/** terms and what a row says in its own word stay in view under the row; limits and plain information are in the form */
export const rowNote = (n: Way['notes'][number]): boolean => n.where === 'row' || n.kind === 'terms';

/** an endpoint the person added is a state whose way is `custom.<slug>` and no catalogue way */
const isAddedEndpoint = (s: ProviderState): boolean => s.way.startsWith('custom.') && s.way !== 'custom.endpoint';

/** Lay out what to show. With a search or a filter everything is listed in one run, the "More providers" labs included: a
    collapsed tail is only for the unfiltered page. */
export function plan(states: ReadonlyMap<string, ProviderState>, filter: Filter, query: string): Plan {
  const q = query.trim();
  const flat = q !== '' || filter !== 'all';
  const pool: Entry[] = q ? searchEntries(q) : flat ? [...listed('default'), ...listed('more')] : [];
  /* a way offered only when the entry's sign-in is not in use (driving xAI's own program) is left out while that sign-in is connected */
  const offered = (e: Entry, w: Way): boolean => w.offered_when !== 'signin_unused' || !e.ways.some((x) => x.kind === 'signin' && x.offered_when === 'always' && states.get(x.id)?.status === 'connected');
  const rowsOf = (e: Entry): Row[] => e.ways.filter((w) => !w.hidden && offered(e, w)).map((w) => ({ entry: e, way: w, state: states.get(w.id) ?? null })).filter((r) => matchesFilter(filter, r.way, r.state));
  const blocks = (list: readonly Entry[], bucket: Block[]): void => {
    for (const e of list) {
      let rows = rowsOf(e);
      if (!rows.length && e.group !== 'custom') continue;
      if (e.group === 'local') {
        /* a runtime that answered is in "Found on this computer", not twice */
        rows = rows.filter((r) => r.state?.status !== 'found_local');
        if (!rows.length) continue;
        const last = bucket[bucket.length - 1];
        if (last?.id === 'group-local') { last.rows.push(...rows); continue; }
        bucket.push({ id: 'group-local', head: groups().find((g) => g.id === 'local')?.label ?? 'On this computer', rows });
      } else if (e.group === 'custom') {
        const added = [...states.values()].filter(isAddedEndpoint).filter((s) => (filter === 'all' || filter === 'custom' || (filter === 'connected' && s.status === 'connected')) && (!q || (s.way + ' ' + (s.base_url ?? '')).toLowerCase().includes(q.toLowerCase())));
        if (!rows.length && !added.length) continue;
        bucket.push({ id: 'group-custom', head: groups().find((g) => g.id === 'custom')?.label ?? 'Your own endpoint', rows, endpoints: added });
      } else bucket.push({ id: e.id, head: e.label, rows });
    }
  };
  const main: Block[] = [];
  const more: Block[] = [];
  if (flat) blocks(pool, main);
  else { blocks(listed('default'), main); blocks(listed('more'), more); }
  const found: Row[] = [];
  if (filter === 'all' || filter === 'local') {
    const qq = q.toLowerCase();
    for (const e of entries()) {
      if (e.group !== 'local') continue;
      if (qq && !searchEntries(q).some((x) => x.id === e.id)) continue;
      for (const w of e.ways) {
        const st = states.get(w.id) ?? null;
        if (!w.hidden && st?.status === 'found_local') found.push({ entry: e, way: w, state: st });
      }
    }
  }
  return { found, main, more, flat, empty: !found.length && !main.length && !more.length };
}

/* ───────── drawing ───────── */
const button = (a: Action, way: string, label: string, calm = false): string => {
  /* a sign-in button of a lab with a brand is that lab's own (ADR-0040); its name is its words, so it needs no label of ours */
  const brand = a.do === 'signin' ? brandOf(way) : null;
  if (brand) return ui.html.signinButton({ brand, attrs: { 'data-do': a.do, 'data-way': way } });
  return plainButton(calm ? { ...a, primary: false } : a, way, label);
};
const plainButton = (a: Action, way: string, label: string): string => kit.html.button({
  label: a.label, size: 28, variant: a.primary ? 'primary' : a.ghost ? 'ghost' : 'secondary',
  attrs: { 'data-do': a.do, 'data-way': way, 'aria-label': `${a.label}, ${label}` }
});
/** a state's word at the row's end (a word, never colour alone): a real failure in red, a calm step in amber */
const word = (state: ProviderState | null | undefined): string => kit.html.statusWord({ text: statusWord(state), tone: failed(state) ? 'red' : state?.status === 'connected' ? 'ok' : state?.status === 'error' ? 'owe' : 'neutral', attrs: { 'data-status': state?.status ?? 'unread' } });
/** the host's words with `a command` as the kit's inline code, never raw backticks */
export const withCode = (text: string): string => text.split('`').map((part, i) => (i % 2 ? kit.html.inlineChip({ kind: 'code', text: part }) : esc(part))).join('');
const acts = (html: string): string => '<span class="hx-set__acts">' + html + '</span>';
/** the command line under a row: where to paste it, then the command as the kit's inline code */
const installLine = (hint: InstallHint): string => `<p class="k7-page__note" data-install>In ${esc(hint.shell)}: ${kit.html.inlineChip({ kind: 'code', text: hint.command })}</p>`;

/** a way's row; `calm`: no row action is the primary one */
export function rowOpts(r: Row, canSignin: (w: Way) => boolean, calm = false): RowOpts {
  const actions = actionsFor(r.way, r.state, canSignin(r.way));
  /* the add-an-endpoint row is an action, not a state: it says no word */
  const control = acts((r.way.kind === 'custom' ? '' : word(r.state)) + actions.map((a) => button(a, r.way.id, r.way.label, calm)).join(''));
  const sub = hintOf(r.way, r.state);
  return { label: r.way.label, ...(sub ? { subHTML: withCode(sub) } : {}), control, attrs: { 'data-row-way': r.way.id } };
}
/** what stays in view under a row: its terms notes and the install command */
const rowNotes = (r: Row): string => (r.state?.install ? installLine(r.state.install) : '') + r.way.notes.filter(rowNote).map((n) => `<p class="k7-page__note" data-note="${esc(n.id)}">${esc(n.text)}</p>`).join('');
function endpointRow(s: ProviderState, calm = false): RowOpts {
  const slug = s.way.slice('custom.'.length);
  const sub = [s.base_url, s.detail].filter(Boolean).join(' ');
  return { label: slug, ...(sub ? { sub } : {}), control: acts(word(s) + button({ do: 'remove', label: 'Remove', ghost: true }, s.way, slug, calm)), attrs: { 'data-row-way': s.way } };
}
/** a lab's section: its head, a card of its ways, then the notes of the ways that have them */
export const blockHtml = (b: Block, canSignin: (w: Way) => boolean, calm = false): string =>
  kit.section(b.head, kit.html.card({ variant: 'settings', rows: [...b.rows.map((r) => rowOpts(r, canSignin, calm)), ...(b.endpoints ?? []).map((e) => endpointRow(e, calm))], attrs: { 'data-block': b.id } }) + b.rows.map(rowNotes).join(''));
/** a single row's markup in its own card (the lab draws one way at a time) */
export const rowHtml = (r: Row, canSignin: (w: Way) => boolean, calm = false): string => kit.html.card({ variant: 'settings', rows: [rowOpts(r, canSignin, calm)] }) + rowNotes(r);

/** the list's markup for a plan; `tailOpen` says whether "More providers" is expanded */
export function planHtml(p: Plan, canSignin: (w: Way) => boolean, tailOpen: boolean): string {
  if (p.empty) return '<p class="k7-page__note" role="status" data-prov-none>No provider matches. Try another word, or choose All.</p>';
  const out: string[] = [];
  if (p.found.length) out.push(blockHtml({ id: 'found', head: 'Found on this computer', rows: p.found }, canSignin));
  out.push(...p.main.map((b) => blockHtml(b, canSignin)));
  if (p.more.length) {
    const n = p.more.reduce((c, b) => c + b.rows.length, 0);
    out.push('<div class="hx-set__more">' + kit.html.button({ label: `More providers (${String(n)})`, size: 28, variant: 'ghost', attrs: { id: 'hx-prov-more', 'aria-expanded': String(tailOpen), 'aria-controls': 'hx-prov-tail' } }) + '</div>');
    out.push(`<div id="hx-prov-tail" class="hx-set__part"${tailOpen ? '' : ' hidden'}>${p.more.map((b) => blockHtml(b, canSignin)).join('')}</div>`);
  }
  return out.join('');
}

const message = (e: unknown): string => (e instanceof Error ? e.message : 'That did not work');
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};

/** the credential card for a key way */
export function keyForm(entry: Entry, way: Way, changing: boolean): FormSpec {
  const url = way.key?.url ? way.key.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
  const notes = way.notes.filter((n) => !rowNote(n)).map((n) => n.text);
  const why = [url ? `Make a key at ${url}.` : '', 'It is kept in your OS keychain and never shown again.', ...notes].filter(Boolean).join(' ');
  return {
    id: 'provider.key.' + way.id, kind: 'credential', title: `${changing ? 'Change the key for' : 'Add a key for'} ${way.label}`, origin: { kind: 'host' }, defer: false, why,
    provider: entry.label, receipt: 'Saved to your keychain. The row shows what the provider said.',
    schema: { properties: { key: { type: 'string', title: 'API key', 'x-secret': true } }, required: ['key'] },
    submit: { label: 'Save key' }, cancel: { label: 'Cancel' }
  };
}

/** the sink a form card answers into while it is on screen */
const sink = (h: FlowHandlers): FormsSource => ({
  submit: h.submit, cancel: h.cancel, signin: () => Promise.reject(new Error('There is nothing to sign in to here.')),
  can: { signin: false, upload: false, folder: false }, pickerItems: () => [], pickFolder: () => Promise.resolve(null)
});

export interface ProvidersView { refresh: (opts?: { probe?: boolean }) => Promise<void>; destroy: () => void; /** the first read of the host (and the probe) has been drawn */ ready: Promise<void> }

/** Draw the section into `host` (a `<section class="ui-set">`). It reads the host once now, and asks the runtimes on this computer
    once now; `refresh({probe: true})` does both again (the tab being shown, "Check again"). It never polls. */
export function mountProviders(host: HTMLElement, deps: ProvidersDeps): ProvidersView {
  const { bridge } = deps;
  const settle = deps.settle ?? 700;
  const openPage = deps.open ?? (async (url: string): Promise<void> => { await commands.openExternal(url); });
  const copyText = deps.copy ?? ((text: string): Promise<void> => navigator.clipboard.writeText(text));
  let filter: Filter = 'all';
  let query = '';
  let tailOpen = false;
  let states = new Map<string, ProviderState>();
  let readError = '';
  let probeError = '';
  let flowOpen = false;
  let abort: () => void = () => undefined;
  let card: { destroy: () => void } | null = null;

  host.innerHTML = (deps.layout?.bare ? '' : kit.html.sectionHead({ title: deps.layout?.title ?? 'Providers', attrs: { id: 'hx-set-providers-h' } })) +
    '<div class="hx-set__bar" data-prov-bar' + (deps.layout?.bare ? ' hidden' : '') + '>' +
    kit.html.field({ id: 'hx-prov-q', kind: 'search', ariaLabel: 'Search providers', placeholder: 'Search providers' }) +
    '<span class="hx-set__chips" role="group" aria-label="Show providers">' + FILTERS.map((f) => kit.html.chip({ label: f.label, value: f.value, chosen: f.value === 'all' })).join('') + '</span></div>' +
    '<p class="k7-page__note" role="status" data-prov-status></p><div class="hx-set__part" data-prov-body></div><div data-prov-flow hidden></div>';
  kit.wire(host);
  const bar = host.querySelector<HTMLElement>('[data-prov-bar]') as HTMLElement;
  const body = host.querySelector<HTMLElement>('[data-prov-body]') as HTMLElement;
  const flow = host.querySelector<HTMLElement>('[data-prov-flow]') as HTMLElement;
  const status = host.querySelector<HTMLElement>('[data-prov-status]') as HTMLElement;

  const signinMount = (w: Way): SigninMount | null => {
    if (w.id === 'openai.signin' && deps.chatgpt) {
      const bridge2 = deps.chatgpt;
      return (h, done) => mountChatgptSignin(h, bridge2, { onSignedIn: done });
    }
    return deps.signinCards?.[w.id] ?? SIGNIN_CARDS.get(w.id) ?? null;
  };
  const canSignin = (w: Way): boolean => (w.signin?.flow === 'cli' ? !!deps.login : signinMount(w) !== null);

  const say = (): void => {
    status.textContent = [readError && `Not read: ${readError}`, probeError && `Could not look for runtimes on this computer: ${probeError}`].filter(Boolean).join(' ');
  };
  const draw = (): void => {
    deps.onStates?.(states);
    if (readError && !states.size) { body.innerHTML = ''; say(); return; }
    body.innerHTML = (deps.layout?.planHtml ?? planHtml)(plan(states, filter, query), canSignin, tailOpen);
    if (deps.layout) ui.hydrate(body); else kit.wire(body);
    say();
  };

  const read = async (probe: boolean): Promise<void> => {
    const [list, local] = await Promise.allSettled([bridge.list(), probe ? bridge.probe() : Promise.resolve(null)]);
    if (list.status === 'fulfilled') { readError = ''; states = new Map(list.value.map((s) => [s.way, s])); } else { readError = message(list.reason); states = new Map(); }
    if (local.status === 'fulfilled') { probeError = ''; for (const s of local.value ?? []) states.set(s.way, s); } else probeError = message(local.reason);
    draw();
  };

  /* ───────── a form card in place of the list ───────── */
  const closeFlow = (): void => {
    abort(); abort = () => undefined;
    card?.destroy(); card = null;
    useFormsHost(null);
    flowOpen = false;
    flow.hidden = true; flow.replaceChildren();
    bar.hidden = !!deps.layout?.bare; body.hidden = false;
  };
  const back = (): void => { closeFlow(); void read(false); };
  const show = (...kids: Node[]): void => {
    flowOpen = true;
    bar.hidden = true; body.hidden = true; flow.hidden = false;
    const backBtn = kit.button({ label: deps.layout?.back ?? 'Back to providers', size: 28, variant: 'ghost' });
    backBtn.addEventListener('click', back);
    flow.replaceChildren(el('div', { class: 'hx-set__flow' }, ...kids, backBtn));
  };
  const later = (fn: () => void): void => { window.setTimeout(() => { if (flowOpen) fn(); }, settle); };
  const cardOf = (spec: FormSpec, handlers: FlowHandlers): HTMLElement => {
    useFormsHost(sink(handlers));
    const c = ui.card('form', spec as unknown as Record<string, unknown>, { size: 'inline' });
    queueMicrotask(() => { focusForm(c); });
    return c;
  };
  const flowUi: FlowUi = { card: cardOf, show, back, later, toast: deps.toast };

  const keyFlow = (r: Row, changing: boolean): void => {
    show(cardOf(keyForm(r.entry, r.way, changing), {
      async submit(_id, outcome) {
        const key = outcome.secrets['key'] ?? '';
        try { await bridge.setKey(r.way.id, key); } catch (e) { throw new Error(message(e)); }
        later(back);
      },
      cancel() { back(); return Promise.resolve(); }
    }));
  };
  const removeFlow = (way: string, label: string, what: string): void => {
    const spec: FormSpec = {
      id: 'provider.remove.' + way, kind: 'choice', title: `Remove ${label}?`, origin: { kind: 'host' }, defer: false,
      why: what, schema: { properties: {} }, submit: { label: 'Remove', hold: true }, cancel: { label: 'Keep it' }, receipt: `Removed ${label}`
    };
    show(cardOf(spec, {
      async submit() { try { await bridge.remove(way); } catch (e) { throw new Error(message(e)); } later(back); },
      cancel() { back(); return Promise.resolve(); }
    }));
  };
  const signinFlow = (w: Way): void => {
    const mount = signinMount(w);
    if (!mount) return;
    const hostEl = el('div', { class: 'hx-set__flow' }, el('p', { class: 'hx-set__lead' }, w.label), ...w.notes.map((n) => el('p', { class: 'k7-page__note' }, n.text)));
    show(hostEl);
    card = mount(hostEl, () => { later(back); });
  };
  const claudeSignin = (btn: HTMLButtonElement, w: Way): void => {
    const login = deps.login;
    const id = w.signin?.login ?? 'claude-code';
    if (!login) return;
    btn.disabled = true;
    deps.toast('Finish signing in to Claude in your browser.');
    login(id).then((r) => {
      if (!r.ok) deps.toast(r.timed_out ? 'The Claude sign-in took too long and was stopped. Choose Sign in to try again.' : 'The Claude sign-in did not finish. Choose Sign in to try again.');
      return read(false);
    }, (e: unknown) => { deps.toast(message(e)); btn.disabled = false; });
  };
  /** Use a runtime that answered (`local-runtime.ts`): LM Studio through the engine's own provider, the others as endpoints under the
      catalogue's own name; the first model it listed becomes the person's model. */
  const useLocal = async (r: Row): Promise<void> => {
    try {
      const use = await useLocalRuntime(bridge, r.way, r.state?.base_url ?? r.way.base_url?.default ?? '');
      deps.toast(localUseNote(r.entry, use));
    } catch (e) { deps.toast(message(e)); }
    await read(false);
  };

  const rowFor = (way: string): Row | null => {
    for (const e of entries()) { const w = e.ways.find((x) => x.id === way); if (w) return { entry: e, way: w, state: states.get(way) ?? null }; }
    return null;
  };
  body.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!t) return;
    if (t.id === 'hx-prov-more') { tailOpen = !tailOpen; t.setAttribute('aria-expanded', String(tailOpen)); body.querySelector<HTMLElement>('#hx-prov-tail')?.toggleAttribute('hidden', !tailOpen); return; }
    const act = t.dataset['do'] as Do | undefined;
    const wayId = t.dataset['way'] ?? '';
    if (!act) return;
    const r = rowFor(wayId);
    switch (act) {
      case 'key': if (r) keyFlow(r, r.state?.status !== 'needs_key'); break;
      case 'endpoint': abort = startEndpointFlow(flowUi, bridge).abort; break;
      case 'signin': case 'continue': if (r?.way.signin?.flow === 'cli') claudeSignin(t, r.way); else if (r) signinFlow(r.way); break;
      case 'signout': bridge.signOut(wayId).then(() => read(false), (e: unknown) => { deps.toast(message(e)); }); break;
      case 'recheck': void read(true); break;
      case 'copy': {
        const hint = r?.state?.install;
        if (hint) copyText(hint.command).then(() => { deps.toast(`Copied. Paste it into ${hint.shell} and run it, then choose Check again.`); }, () => { deps.toast('Could not copy: select the command and copy it.'); });
        break;
      }
      case 'guide': { const hint = r?.state?.install; if (hint) openPage(hint.page).catch((e: unknown) => { deps.toast(message(e)); }); break; }
      case 'use': if (r) void useLocal(r); break;
      case 'remove': {
        if (r) removeFlow(wayId, r.way.label, 'Its key leaves your keychain. A ladder tier that names it stays as it is, and governed mode says why it cannot run.');
        else removeFlow(wayId, wayId.slice('custom.'.length), 'The endpoint and its key are removed. Models you chose from it stay named in your ladder until you change them.');
        break;
      }
    }
  });
  host.querySelector<HTMLInputElement>('#hx-prov-q')?.addEventListener('input', (e) => { query = (e.target as HTMLInputElement).value; draw(); });
  /* the filter is one choice of the Chips: the pressed one is the only one pressed */
  bar.addEventListener('ui:change', (e) => {
    const c = (e.target as Element).closest<HTMLElement>('[data-kit~="Chip"]'); if (!c) return;
    e.preventDefault();
    filter = (c.dataset['value'] ?? 'all') as Filter;
    for (const x of bar.querySelectorAll<HTMLElement>('[data-kit~="Chip"]')) { const on = x === c; x.setAttribute('aria-pressed', String(on)); x.toggleAttribute('data-chosen', on); }
    draw();
  });

  const ready = read(true);
  return {
    ready,
    refresh: async (o) => { if (flowOpen) return; await read(o?.probe ?? false); },
    destroy: () => { closeFlow(); }
  };
}

