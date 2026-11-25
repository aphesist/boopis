/* The Providers section of Settings > Models (ADR-0039, report section 9). Everything it lists is drawn from the catalogue
   (`data/providers.ts`, one file) and the host's `ProviderState` per way; it holds no list of labs of its own.

   Shape: a search field and a filter (All, Connected, Sign in, API key, On this computer, Custom); "Found on this computer" at the
   top when a probe answered; one head per lab with one row per way (a status word and the buttons it needs); the labs under
   "More providers" collapsed, which search and any filter still reach. A status is always a word, never colour alone. Terms
   notes are quiet lines under their row. A button opens a form card in place of the list (as Connectors does), with a way back.

   Settings draws it on the v7 kit (`planHtml7`: SectionHeads over Cards of Rows, the status a StatusWord, a row's first action a
   Button and its others in an overflow Menu, the explanation and the terms notes behind the label's mark, "More providers" a
   SectionHead with its disclosure); first run's hub (`layout`) keeps its own arrangement on the v6 kit until it moves (wave C's
   onboarding). The forms are the one form card family. No CSS of its own. */
import { kit, ui } from '@boopis/ui';
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
  /** a line the person should see now (Settings: the floating Notice) */
  notify?: (text: string) => void;
  /** the same, for first run's hub (its own name for it until it moves to the v7 kit) */
  toast?: (text: string) => void;
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
const plainButton = (a: Action, way: string, label: string): string => ui.html.button({
  label: a.label, size: 's', ...(a.primary ? { variant: 'primary' as const } : a.ghost ? { variant: 'ghost' as const } : {}),
  attrs: { 'data-do': a.do, 'data-way': way, 'aria-label': `${a.label}, ${label}` }
});

/** `calm`: no row action is the primary one (the hub's one primary action is Continue) */
export function rowHtml(r: Row, canSignin: (w: Way) => boolean, calm = false): string {
  const actions = actionsFor(r.way, r.state, canSignin(r.way));
  /* the add-an-endpoint row is an action, not a state: it says no word */
  const word = r.way.kind === 'custom' ? '' : `<span class="ui-set__value" data-status="${esc(r.state?.status ?? 'unread')}">${esc(statusWord(r.state))}</span>`;
  const control = `<span style="display:inline-flex;flex-wrap:wrap;gap:var(--sp-2);align-items:center;justify-content:flex-end">${word}${actions.map((a) => button(a, r.way.id, r.way.label, calm)).join('')}</span>`;
  const notes = r.way.notes.filter(rowNote).map((n) => `<p class="ui-field__hint" data-note="${esc(n.id)}">${esc(n.text)}</p>`).join('');
  const install = r.state?.install ? installLineHtml(r.state.install, 'ui-field__hint') : '';
  return ui.html.setRow({ label: r.way.label, hint: hintOf(r.way, r.state), control }) + install + notes;
}
function endpointRowHtml(s: ProviderState, calm = false): string {
  const slug = s.way.slice('custom.'.length);
  const control = `<span style="display:inline-flex;flex-wrap:wrap;gap:var(--sp-2);align-items:center;justify-content:flex-end"><span class="ui-set__value" data-status="${esc(s.status)}">${esc(statusWord(s))}</span>${button({ do: 'remove', label: 'Remove', ghost: true }, s.way, slug, calm)}</span>`;
  return ui.html.setRow({ label: slug, hint: [s.base_url, s.detail].filter(Boolean).join(' '), control });
}
export const head = (id: string, label: string, level: 2 | 3 = 3): string => ui.html.setHead({ id: 'hx-prov-h-' + id, label, level });
export const blockHtml = (b: Block, canSignin: (w: Way) => boolean, calm = false, level: 2 | 3 = 3): string =>
  head(b.id, b.head, level) + b.rows.map((r) => rowHtml(r, canSignin, calm)).join('') + (b.endpoints ?? []).map((e) => endpointRowHtml(e, calm)).join('');

/** the list's markup for a plan; `tailOpen` says whether "More providers" is expanded */
export function planHtml(p: Plan, canSignin: (w: Way) => boolean, tailOpen: boolean): string {
  if (p.empty) return '<p class="ui-field__hint" role="status" data-prov-none>No provider matches. Try another word, or choose All.</p>';
  const out: string[] = [];
  if (p.found.length) out.push(head('found', 'Found on this computer') + p.found.map((r) => rowHtml(r, canSignin)).join(''));
  out.push(...p.main.map((b) => blockHtml(b, canSignin)));
  if (p.more.length) {
    const n = p.more.reduce((c, b) => c + b.rows.length, 0);
    out.push('<div style="margin-top:var(--sp-4)">' + ui.html.button({ label: `More providers (${String(n)})`, size: 's', variant: 'ghost', attrs: { id: 'hx-prov-more', 'aria-expanded': String(tailOpen), 'aria-controls': 'hx-prov-tail' } }) + '</div>');
    out.push(`<div id="hx-prov-tail"${tailOpen ? '' : ' hidden'}>${p.more.map((b) => blockHtml(b, canSignin)).join('')}</div>`);
  }
  return out.join('');
}

/* ───────── drawing on the v7 kit (Settings) ───────── */
type SetRow = Parameters<typeof kit.html.card>[0]['rows'][number];
/** a status as a StatusWord: ok when connected, red for a real failure, else neutral (a word, never colour alone) */
const statusHtml = (state: ProviderState | null | undefined, word: string): string =>
  kit.html.statusWord({ text: word, tone: state?.status === 'connected' ? 'ok' : failed(state) ? 'red' : 'neutral', attrs: { 'data-status': state?.status ?? 'unread' } });
/** a row's actions: the first one a Button (a lab's sign-in its own branded button, ADR-0040), the others in its overflow Menu */
function actionsHtml(actions: readonly Action[], way: string, label: string): string {
  const [first, ...rest] = actions;
  if (!first) return '';
  const brand = first.do === 'signin' ? brandOf(way) : null;
  const main = brand ? ui.html.signinButton({ brand, attrs: { 'data-do': first.do, 'data-way': way } })
    : kit.html.button({ label: first.label, size: 28, variant: first.ghost ? 'ghost' : 'tint', attrs: { 'data-do': first.do, 'data-way': way, 'aria-label': `${first.label}, ${label}` } });
  const more = rest.length ? kit.html.iconButton({ icon: 'more', label: 'More for ' + label, variant: 'tinted', haspopup: 'menu', tip: 'More', attrs: { 'data-prov-more': way, 'data-prov-actions': rest.map((a) => a.do + ':' + a.label).join('|') } }) : '';
  return main + more;
}
/** a way as a settings Row: its label, its status word, its actions; what it is, its state's detail, its install line and its terms
    notes behind the label's mark */
export function row7(r: Row, canSignin: (w: Way) => boolean): SetRow {
  const actions = actionsFor(r.way, r.state, canSignin(r.way));
  const notes = r.way.notes.filter(rowNote).map((n) => n.text);
  const install = r.state?.install ? `In ${r.state.install.shell}: ${r.state.install.command}` : '';
  /* the explanation is plain text: a command the host wrote between backticks is said as the command itself */
  const explain = [hintOf(r.way, r.state), install, ...notes].filter(Boolean).join(' ').replace(/`([^`]+)`/g, '$1');
  return {
    label: r.way.label, attrs: { 'data-way-row': r.way.id }, ...(explain ? { explain } : {}),
    control: (r.way.kind === 'custom' ? '' : statusHtml(r.state, statusWord(r.state))) + actionsHtml(actions, r.way.id, r.way.label)
  };
}
function endpointRow7(s: ProviderState): SetRow {
  const slug = s.way.slice('custom.'.length);
  const explain = [s.base_url, s.detail].filter(Boolean).join(' ');
  return { label: slug, attrs: { 'data-way-row': s.way }, ...(explain ? { explain } : {}), control: statusHtml(s, statusWord(s)) + actionsHtml([{ do: 'remove', label: 'Remove', ghost: true }], s.way, slug) };
}
const block7 = (b: Block, canSignin: (w: Way) => boolean): string =>
  '<div class="k7-section" data-prov-block="' + esc(b.id) + '">' + kit.html.sectionHead({ title: b.head, attrs: { id: 'hx-prov-h-' + b.id } }) +
  kit.html.card({ rows: [...b.rows.map((r) => row7(r, canSignin)), ...(b.endpoints ?? []).map(endpointRow7)] }) + '</div>';
/** the list's markup for a plan on the v7 kit; `tailOpen` says whether "More providers" is expanded */
export function planHtml7(p: Plan, canSignin: (w: Way) => boolean, tailOpen: boolean): string {
  if (p.empty) return kit.html.emptyState({ text: 'No provider matches. Try another word, or choose All.' }).replace('class="k7-empty"', 'class="k7-empty" data-prov-none');
  const out: string[] = [];
  if (p.found.length) out.push(block7({ id: 'found', head: 'Found on this computer', rows: p.found }, canSignin));
  out.push(...p.main.map((b) => block7(b, canSignin)));
  if (p.more.length) {
    const n = p.more.reduce((c, b) => c + b.rows.length, 0);
    out.push(kit.html.sectionHead({ title: 'More providers', count: String(n), disclosure: true, collapsed: !tailOpen, attrs: { id: 'hx-prov-more' } }));
    out.push(`<div class="hx-prov-tail" id="hx-prov-tail"${tailOpen ? '' : ' hidden'}>${p.more.map((b) => block7(b, canSignin)).join('')}</div>`);
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

  const tell = (text: string): void => { (deps.notify ?? deps.toast ?? (() => undefined))(text); };
  /* Settings (no layout): the v7 kit; first run's hub: its own arrangement on the v6 kit */
  const v7 = !deps.layout;
  if (v7) {
    host.innerHTML = kit.html.sectionHead({ title: 'Providers', attrs: { id: 'hx-set-providers-h' } }) +
      '<div class="hx-prov-bar" data-prov-bar>' + kit.html.field({ id: 'hx-prov-q', kind: 'search', ariaLabel: 'Search providers', placeholder: 'Search providers' }) +
      '<div class="hx-prov-chips" role="radiogroup" aria-label="Show providers">' + FILTERS.map((f) => kit.html.chip({ label: f.label, variant: 'filter', chosen: f.value === 'all', value: f.value, attrs: { role: 'radio', 'aria-pressed': null, 'aria-checked': String(f.value === 'all') } })).join('') + '</div></div>' +
      '<p role="status" data-prov-status hidden></p><div class="hx-prov-body" data-prov-body></div><div class="hx-prov-flow" data-prov-flow hidden></div>';
    kit.wire(host);
  } else {
    host.innerHTML = (deps.layout?.bare ? '' : ui.html.setHead({ id: 'hx-set-providers-h', label: deps.layout?.title ?? 'Providers', level: deps.layout?.level ?? 3 })) +
      '<div data-prov-bar' + (deps.layout?.bare ? ' hidden' : '') + ' style="display:flex;flex-wrap:wrap;gap:var(--sp-3);align-items:center;padding:var(--sp-2) 0">' +
      ui.html.search({ size: 'm', as: 'input', id: 'hx-prov-q', label: 'Search providers', placeholder: 'Search providers' }) +
      ui.html.chipGroup({ options: FILTERS, value: 'all', label: 'Show providers' }) + '</div>' +
      '<p class="ui-field__hint" role="status" data-prov-status></p><div data-prov-body></div><div data-prov-flow hidden></div>';
    ui.hydrate(host);
  }
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

  const say = (): HTMLElement | null => {
    const text = [readError && `Not read: ${readError}`, probeError && `Could not look for runtimes on this computer: ${probeError}`].filter(Boolean).join(' ');
    status.textContent = text;
    /* on the v7 kit what could not be read is a page Notice above the list, not a line that only a screen reader hears */
    if (!v7 || !text) return null;
    const n = document.createElement('div'); n.innerHTML = kit.html.notice({ text, tone: readError ? 'red' : 'neutral', place: 'page' });
    return n.firstElementChild as HTMLElement;
  };
  const draw = (): void => {
    deps.onStates?.(states);
    if (readError && !states.size) { body.innerHTML = ''; const n = say(); if (n) body.append(n); return; }
    body.innerHTML = v7 ? planHtml7(plan(states, filter, query), canSignin, tailOpen) : (deps.layout?.planHtml ?? planHtml)(plan(states, filter, query), canSignin, tailOpen);
    if (v7) kit.wire(body); else ui.hydrate(body);
    const n = say(); if (n) body.prepend(n);
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
    const backBtn = v7 ? kit.button({ label: 'Back to providers', size: 32, variant: 'ghost', icon: 'back' }) : ui.button({ label: deps.layout?.back ?? 'Back to providers', size: 's', variant: 'ghost' });
    backBtn.addEventListener('click', back);
    if (v7) { backBtn.classList.add('hx-prov-back'); flow.replaceChildren(backBtn, ...kids); }
    else flow.replaceChildren(el('div', { style: 'display:grid;gap:var(--sp-3);padding:var(--sp-3) 0' }, ...kids, backBtn));
  };
  const later = (fn: () => void): void => { window.setTimeout(() => { if (flowOpen) fn(); }, settle); };
  const cardOf = (spec: FormSpec, handlers: FlowHandlers): HTMLElement => {
    useFormsHost(sink(handlers));
    const c = ui.card('form', spec as unknown as Record<string, unknown>, { size: 'inline' });
    queueMicrotask(() => { c.querySelector<HTMLElement>('.cd-form .ui-input, .cd-form .cd-opt[tabindex="0"], .cd-form .ui-switch')?.focus(); });
    return c;
  };
  const flowUi: FlowUi = { card: cardOf, show, back, later, notify: tell };

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
    const hostEl = v7 ? el('div', { class: 'hx-prov-flow' }) : el('div', { style: 'display:grid;gap:var(--sp-3)' }, el('p', { style: 'margin:0' }, w.label), ...w.notes.map((n) => el('p', { class: 'ui-field__hint' }, n.text)));
    if (v7) hostEl.innerHTML = kit.html.sectionHead({ title: w.label }) + (w.notes.length ? kit.html.card({ rows: w.notes.map((n) => ({ label: n.text, explain: n.text })) }) : '');
    show(hostEl);
    card = mount(hostEl, () => { later(back); });
  };
  const claudeSignin = (btn: HTMLButtonElement, w: Way): void => {
    const login = deps.login;
    const id = w.signin?.login ?? 'claude-code';
    if (!login) return;
    btn.disabled = true;
    tell('Finish signing in to Claude in your browser.');
    login(id).then((r) => {
      if (!r.ok) tell(r.timed_out ? 'The Claude sign-in took too long and was stopped. Choose Sign in to try again.' : 'The Claude sign-in did not finish. Choose Sign in to try again.');
      return read(false);
    }, (e: unknown) => { tell(message(e)); btn.disabled = false; });
  };
  /** Use a runtime that answered (`local-runtime.ts`): LM Studio through the engine's own provider, the others as endpoints under the
      catalogue's own name; the first model it listed becomes the person's model. */
  const useLocal = async (r: Row): Promise<void> => {
    try {
      const use = await useLocalRuntime(bridge, r.way, r.state?.base_url ?? r.way.base_url?.default ?? '');
      tell(localUseNote(r.entry, use));
    } catch (e) { tell(message(e)); }
    await read(false);
  };

  const rowFor = (way: string): Row | null => {
    for (const e of entries()) { const w = e.ways.find((x) => x.id === way); if (w) return { entry: e, way: w, state: states.get(way) ?? null }; }
    return null;
  };
  body.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!t) return;
    if (t.id === 'hx-prov-more' || t.closest('#hx-prov-more')) {
      tailOpen = !tailOpen; t.setAttribute('aria-expanded', String(tailOpen)); t.closest('#hx-prov-more')?.toggleAttribute('data-collapsed', !tailOpen);
      body.querySelector<HTMLElement>('#hx-prov-tail')?.toggleAttribute('hidden', !tailOpen); return;
    }
    /* a row's overflow Menu: its other actions, each one the row's own */
    if (t.dataset['provMore']) {
      const way = t.dataset['provMore'];
      const entries = (t.dataset['provActions'] ?? '').split('|').filter(Boolean).map((x) => { const [d, ...l] = x.split(':'); return { label: l.join(':'), value: d ?? '', danger: d === 'remove' }; });
      kit.openMenu(t, { label: t.getAttribute('aria-label') ?? 'More', align: 'end', entries, onSelect: (v) => { run(v as Do, way, t); } });
      return;
    }
    const act = t.dataset['do'] as Do | undefined;
    const wayId = t.dataset['way'] ?? '';
    if (!act) return;
    run(act, wayId, t);
  });
  function run(act: Do, wayId: string, t: HTMLButtonElement): void {
    const r = rowFor(wayId);
    switch (act) {
      case 'key': if (r) keyFlow(r, r.state?.status !== 'needs_key'); break;
      case 'endpoint': abort = startEndpointFlow(flowUi, bridge).abort; break;
      case 'signin': case 'continue': if (r?.way.signin?.flow === 'cli') claudeSignin(t, r.way); else if (r) signinFlow(r.way); break;
      case 'signout': bridge.signOut(wayId).then(() => read(false), (e: unknown) => { tell(message(e)); }); break;
      case 'recheck': void read(true); break;
      case 'copy': {
        const hint = r?.state?.install;
        if (hint) copyText(hint.command).then(() => { tell(`Copied. Paste it into ${hint.shell} and run it, then choose Check again.`); }, () => { tell('Could not copy: select the command and copy it.'); });
        break;
      }
      case 'guide': { const hint = r?.state?.install; if (hint) openPage(hint.page).catch((e: unknown) => { tell(message(e)); }); break; }
      case 'use': if (r) void useLocal(r); break;
      case 'remove': {
        if (r) removeFlow(wayId, r.way.label, 'Its key leaves your keychain. A ladder tier that names it stays as it is, and governed mode says why it cannot run.');
        else removeFlow(wayId, wayId.slice('custom.'.length), 'The endpoint and its key are removed. Models you chose from it stay named in your ladder until you change them.');
        break;
      }
    }
  }
  host.querySelector<HTMLInputElement>('#hx-prov-q')?.addEventListener('input', (e) => { query = (e.target as HTMLInputElement).value; draw(); });
  bar.addEventListener('ui:change', (e) => {
    if (v7) {
      /* the filter Chips are one choice: the chosen one inverted */
      e.preventDefault();
      const c = (e.target as Element).closest<HTMLElement>('[data-value]'); const v = c?.dataset['value'];
      if (!c || !v || v === filter) return;
      for (const x of bar.querySelectorAll<HTMLElement>('.hx-prov-chips [data-value]')) { const on = x === c; x.toggleAttribute('data-chosen', on); x.setAttribute('aria-checked', String(on)); }
      filter = v as Filter; draw(); return;
    }
    filter = (e as CustomEvent<{ value: string }>).detail.value as Filter; draw();
  });

  const ready = read(true);
  return {
    ready,
    refresh: async (o) => { if (flowOpen) return; await read(o?.probe ?? false); },
    destroy: () => { closeFlow(); }
  };
}

