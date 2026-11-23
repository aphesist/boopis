/* What the store says, without a DOM (docs/STORE.md): the words for tiers, kinds, states, hosts and pins, the filters, and the
   review card's form built from an `InstallPlan`. Every sentence is boopis's: a tier is words (never colour alone), an unknown
   is said as unknown, and the engine is never named (an item's own text is data, marked `data-store-item` where it is drawn). */
import type {
  FormSpec, InstallPlan, InstallReceipt, StoreBrowse, StoreCodeRun, StoreComponent, StoreError, StoreFilter, StoreHosts, StoreItem, StoreKind, StorePin, StoreScanVerdict, StoreSource, StoreTier, UpdateDiff
} from '../../data';
import type { ItemRef } from '@boopis/ui';
import { isRefreshable, isStale } from './reading';
import type { ReadState, Reading } from './reading';

export const TIER_WORDS: Readonly<Record<StoreTier, string>> = { recommended: 'Recommended by boopis', verified: 'Verified by its source', 'not-reviewed': 'Not reviewed' };
export const TIER_TIPS: Readonly<Record<StoreTier, string>> = {
  recommended: 'A person at boopis read this item against its publisher\'s own sources.',
  verified: 'Its source vouches for it. boopis has not repeated that check.',
  'not-reviewed': 'Nobody has reviewed this item. Read what it runs before you install it.'
};
export const KIND_LABEL: Readonly<Record<StoreKind, string>> = { skill: 'Skill', connector: 'Connector', plugin: 'Plugin', mod: 'Mod', 'engine-plugin': 'Plugin from the engine\'s store' };
export const KIND_FILTERS: ReadonlyArray<readonly [value: 'all' | StoreKind, label: string, name: string]> = [
  ['all', 'All', 'All kinds'], ['skill', 'Skills', 'Skills'], ['connector', 'Connectors', 'Connectors'], ['plugin', 'Plugins', 'Plugins'], ['mod', 'Mods', 'Mods'],
  ['engine-plugin', 'Engine plugins', 'Engine plugins, from the engine\'s store']
];

export type ItemState = 'installed' | 'update' | 'removed';
export const STATE_WORDS: Readonly<Record<ItemState, string>> = { installed: 'Installed', update: 'Update', removed: 'Removed' };

/** the state a row shows: removed wins (a kill-listed item cannot be installed), then an update, then installed */
export function stateOf(item: Pick<StoreItem, 'id' | 'removed'>, installed: readonly InstallReceipt[], updates: readonly UpdateDiff[]): ItemState | null {
  const have = installed.find((r) => r.item_id === item.id);
  if (item.removed || have?.kill_listed) return 'removed';
  if (!have) return null;
  return updates.some((d) => d.item_id === item.id && d.status === 'available') ? 'update' : 'installed';
}

/* ───────── how an item reads in a list (the redesign of 23 November 2026) ─────────
   A row is the item's tile, its title, one line that says what it is (kind, publisher, "not reviewed" when nobody has, then
   its own summary) and, at its end, the one word a person needs before opening it: its state when it has one, else what it
   needs. Each word is the data's; nothing here ranks, counts or features anything. */
export const KIND_SHORT: Readonly<Record<StoreKind, string>> = { skill: 'Skill', connector: 'Connector', plugin: 'Plugin', mod: 'Mod', 'engine-plugin': 'Engine plugin' };
/** the order kinds are grouped in on the front page: the kind filter's order */
export const KIND_ORDER: readonly StoreKind[] = KIND_FILTERS.map(([v]) => v).filter((v): v is StoreKind => v !== 'all');
export const KIND_GROUP: Readonly<Record<StoreKind, string>> = { skill: 'Skills', connector: 'Connectors', plugin: 'Plugins', mod: 'Mods', 'engine-plugin': 'Engine plugins' };

/** the row's second line: what it is and who published it ("Skill by Supabase", so a publisher's mark on the tile reads as who made
    it, not as the item being that company's product), a missing review, then its summary; a publisher whose name is the title
    ("Notion" by Notion) is said once, by the title */
export function rowLine(item: Pick<StoreItem, 'kind' | 'publisher' | 'tier' | 'summary' | 'title'>): string {
  /* a publisher whose name is the item's own (Notion's Notion) is said once, by the title */
  const by = item.publisher.trim().toLowerCase() === item.title.trim().toLowerCase() ? '' : item.publisher;
  return [KIND_SHORT[item.kind] + (by ? ' by ' + by : ''), item.tier === 'not-reviewed' ? 'not reviewed' : '', item.summary.trim()].filter(Boolean).join(' · ');
}
/** what an item needs before it can work, in two words: the keys it cannot do without, or that boopis will not install it */
export function needsWord(item: Pick<StoreItem, 'secrets' | 'pinned' | 'removed'>): string {
  if (item.removed) return 'taken down';
  if (!item.pinned) return 'not pinned';
  const keys = item.secrets.filter((s) => !s.optional).length;
  return keys ? (keys === 1 ? 'needs a key' : 'needs ' + String(keys) + ' keys') : '';
}
/** the word at a row's end: its state (installed, an update, taken down) first, else what it needs, else nothing */
export function endWord(item: Pick<StoreItem, 'secrets' | 'pinned' | 'removed'>, state: ItemState | null): { word: string; tone: 'attention' | 'busy' | null } {
  if (state === 'removed') return { word: 'taken down', tone: 'attention' };
  if (state === 'update') return { word: 'update', tone: 'busy' };
  if (state === 'installed') return { word: 'installed', tone: null };
  return { word: needsWord(item), tone: null };
}
/** the items, grouped by kind in the kind filter's order, each keeping the order it came in (the host's own order) */
export function byKind<T extends { kind: StoreKind }>(items: readonly T[]): Array<{ kind: StoreKind; label: string; items: T[] }> {
  return KIND_ORDER.map((kind) => ({ kind, label: KIND_GROUP[kind], items: items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0);
}
/** a remote connector's address, from its pin (`remote:<url>`); null for anything that runs from code */
export const remoteUrl = (p: StorePin | null | undefined): string | null => (isRemote(p) ? (p?.repo ?? '').slice('remote:'.length) || null : null);
/** what the tile is drawn from: the item's own evidence (docs: components/item-mark.ts). A curated connector's id is its id in
    boopis's collection; a hosted one connects to its pinned address; a skill, plugin or mod shows its publisher's mark when its
    provenance proves the publisher. */
export function markRef(item: { id?: string; item_id?: string; title?: string | undefined; kind: StoreKind; source: string; homepage?: string | null; pinned?: StorePin | null; publisher?: string; provenance?: { namespace_proof: string } }): ItemRef {
  const id = item.id ?? item.item_id ?? '';
  return {
    name: item.title ?? id.replace(/^[^:]*:/, ''), kind: item.kind,
    collection: item.source === 'boopis' && item.kind === 'connector' ? id.replace(/^boopis:/, '') : null,
    url: remoteUrl(item.pinned), homepage: item.homepage ?? null,
    /* a publisher's mark only for a publisher the source proved: a receipt carries neither, so an installed item keeps its monogram */
    publisher: item.publisher ?? null, proven: !!item.provenance && item.provenance.namespace_proof !== 'none'
  };
}

/** "3 hours ago", from an ISO time; null stays unknown */
export function ageWords(iso: string | null | undefined, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'not known';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60); if (m < 90) return m + ' minutes ago';
  const h = Math.round(m / 60); if (h < 36) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24); return d + (d === 1 ? ' day ago' : ' days ago');
}
export const plural = (n: number, one: string, many = one + 's'): string => String(n) + ' ' + (n === 1 ? one : many);

/** where an item reaches, in words: declared is the publisher's word and enforced by nothing; unknown is never "none" */
export function hostsWords(h: StoreHosts, verified?: string | null): string {
  if (h.basis === 'unknown') return 'Not known: the publisher did not say which hosts it reaches.';
  if (h.basis === 'loopback') return 'This computer only.';
  const list = h.hosts.length ? h.hosts.join(', ') : 'no host';
  return h.basis === 'verified' ? `${list}. Checked by boopis${verified ? ' on ' + verified : ''}.` : `${list}. Declared by the publisher, not enforced.`;
}
export const REMOTE_WORDS = 'Hosted by the publisher, can change without a new version.';
/** a hosted connector has no code or digest to pin: the host pins it as `remote:<url>` */
export const isRemote = (p: StorePin | null | undefined): boolean => !!p?.repo?.startsWith('remote:');
export function pinWords(p: StorePin | null): string {
  if (!p) return 'Not pinned: boopis will not install it.';
  if (isRemote(p)) return 'Not pinned to code: the service is hosted by the publisher.';
  const kind: Record<StorePin['type'], string> = { commit: 'commit', 'archive-sha256': 'archive hash', 'tree-sha256': 'folder hash', 'oci-digest': 'image digest', version: 'version' };
  return `${kind[p.type]} ${p.value}`;
}
export const scanWords = (v: StoreScanVerdict): string => ({ safe: 'Nothing found', caution: 'Needs a closer look', dangerous: 'Dangerous: it cannot be installed', 'not-scanned': 'Not checked' } as const)[v];
export const licenseWords = (l: string | null | undefined): string => (l && l.trim() ? l : 'not stated');

export function countsWords(c: StoreItem['components']): string {
  if (!c.known) return 'Not known until it is downloaded.';
  const parts: string[] = [];
  const add = (n: number, one: string, many?: string): void => { if (n) parts.push(plural(n, one, many)); };
  add(c.skills, 'skill'); add(c.commands, 'command'); add(c.agents, 'agent'); add(c.hooks, 'hook'); add(c.mcp_servers, 'server'); add(c.modules, 'module'); add(c.scripts, 'script'); add(c.python, 'Python file');
  return parts.length ? parts.join(', ') : 'Nothing but its description.';
}
export function runWords(r: StoreCodeRun): string {
  const where = { sandbox: 'in the sandbox', 'outside-sandbox': 'on this computer, outside the sandbox', 'engine-process': 'inside the engine, in every session, outside the sandbox' }[r.where];
  const what = { hook: 'Hook', 'mcp-command': 'Server', 'package-start': 'Package', script: 'Script', module: 'Module', python: 'Python' }[r.what];
  return `${what}: ${r.command}, ${where}`;
}
export const componentWords = (c: StoreComponent): string => `${c.type.replace('-', ' ')} ${c.name}${c.detail ? ' (' + c.detail + ')' : ''}`;

/** the item's own sentence for an engine plugin, said plainly on its page and its card */
export const ENGINE_PLUGIN_NOTE = 'This is Python that runs inside the engine, in every session, governed ones included. It runs outside the sandbox, and permission rules do not see it.';

/** a source's state in words: off (and why), being read, why it could not be read, what it holds and when it was read, or, for a
    source a read does not reach, what it is (built in; GitHub without a sign-in; empty until you add one) */
export function sourceState(s: StoreSource, now: number = Date.now(), reading?: ReadState): { word: 'off' | 'on' | 'trouble' | 'reading'; text: string } {
  if (s.enabled === false) {
    return { word: 'off', text: s.terms === 'unverified' ? 'Off until its terms are checked. ' + (s.note ?? '') : (s.note ?? 'Switched off.') };
  }
  if (reading === 'reading') return { word: 'reading', text: 'Reading it now…' };
  if (reading === 'waiting') return { word: 'reading', text: 'Waiting for its turn to be read…' };
  if (s.error) return { word: 'trouble', text: s.error };
  /* a source that was never read holds nothing yet: no count, only that it is read when the store opens */
  const n = s.items == null || (isRefreshable(s) && !s.refreshed_at) ? '' : plural(s.items, 'item') + '. ';
  if (!isRefreshable(s)) {
    if (s.fetch === 'compiled-in') return { word: 'on', text: n + 'Built into this version of boopis.' };
    if (s.fetch === 'github-api') return { word: 'on', text: 'Searching GitHub needs a GitHub sign-in, which boopis does not have yet. Add a repository by its address under Add a source.' };
    return { word: 'on', text: 'Empty until you add one under Add a source.' };
  }
  return { word: 'on', text: n + (s.refreshed_at ? 'Read ' + ageWords(s.refreshed_at, now) + '.' : 'Not read yet: it is read when the store opens.') };
}

/** the progress of a read in words: how far it is, then how it ended */
export function readingWords(r: Pick<Reading, 'running' | 'done' | 'total' | 'last'>): string {
  if (r.running) return `Reading the sources: ${r.done} of ${r.total} read…`;
  if (!r.last) return '';
  if (!r.last.failed) return r.last.total === 1 ? 'The source was read.' : `The ${r.last.total} sources were read.`;
  return r.last.failed === r.last.total ? (r.last.total === 1 ? 'The source could not be read. Its row says why.' : 'No source could be read. Each row says why.')
    : `${plural(r.last.total - r.last.failed, 'source')} read; ${r.last.failed} could not be, and ${r.last.failed === 1 ? 'its row says' : 'their rows say'} why.`;
}

/** the sentence for a failure: the host's own (a stable `hx.*` code) and never raw engine text */
export const errorText = (e: unknown): string => {
  const o = (e && typeof e === 'object' ? e : {}) as Partial<StoreError>;
  return typeof o.message === 'string' && o.message ? o.message : 'boopis could not do that. Try again.';
};
export const errorCode = (e: unknown): string => ((e && typeof e === 'object' ? (e as Partial<StoreError>).code : '') ?? '') as string;

/** the filter a screen asks for: `all` is no kind, `any` no source */
export function filterOf(kind: 'all' | StoreKind, source: string): StoreFilter {
  return { ...(kind !== 'all' ? { kind } : {}), ...(source !== 'any' ? { source } : {}) };
}
export const isFront = (f: StoreFilter, query: string): boolean => !query.trim() && Object.keys(f).length === 0;
/** why a list is out of date, and what puts it right */
export interface OutOfDate {
  /** the sentence over Browse: what is old, and why (the host's own reason when a source could not be read) */
  text: string;
  /** the cause: you are offline; a source could not be read; a source was never read; a source is older than its period */
  why: 'offline' | 'failed' | 'unread' | 'old' | 'unknown';
  /** how many sources could not be read: Sources says why for each, so the line offers to show it */
  failed: number;
}
/** `a`, `a and b`, `a, b and c`, `a, b and 2 more` */
export function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0] ?? ''} and ${names[1] ?? ''}`;
  if (names.length === 3) return `${names[0] ?? ''}, ${names[1] ?? ''} and ${names[2] ?? ''}`;
  return `${names[0] ?? ''}, ${names[1] ?? ''} and ${String(names.length - 2)} more`;
}
/** what a browse page says when the catalogue is old, and why: you are offline, the sources that could not be read (with the
    reason when there is one), the ones not read yet, or the ones older than their period and how old. Null when it is current.
    `sources` are the store's sources. */
export function outOfDate(b: Pick<StoreBrowse, 'offline' | 'stale' | 'refreshed_at'>, now: number = Date.now(), sources: readonly StoreSource[] = []): OutOfDate | null {
  if (b.offline) return { why: 'offline', failed: 0, text: `You are offline. This is the last copy boopis saved${b.refreshed_at ? ', from ' + ageWords(b.refreshed_at, now) : ''}. Read the sources again when you are back online.` };
  if (!b.stale) return null;
  const on = sources.filter((s) => s.enabled !== false && isRefreshable(s));
  const failed = on.filter((s) => s.error);
  const unread = on.filter((s) => !s.error && !s.refreshed_at);
  const old = on.filter((s) => !s.error && s.refreshed_at && isStale(s));
  const one = failed[0];
  if (failed.length === 1 && one) return { why: 'failed', failed: 1, text: `This list is out of date: ${one.label} could not be read. ${one.error ?? ''}`.trim() };
  if (failed.length > 1) return { why: 'failed', failed: failed.length, text: `This list is out of date: ${listWords(failed.map((s) => s.label))} could not be read. Sources gives the reason for each.` };
  const first = unread[0];
  if (unread.length === 1 && first) return { why: 'unread', failed: 0, text: `This list is out of date: ${first.label} has not been read yet.` };
  if (unread.length > 1) return { why: 'unread', failed: 0, text: `This list is out of date: ${listWords(unread.map((s) => s.label))} have not been read yet.` };
  const oldest = old.reduce<StoreSource | null>((a, s) => (!a || Date.parse(s.refreshed_at ?? '') < Date.parse(a.refreshed_at ?? '') ? s : a), null);
  if (old.length === 1 && oldest) return { why: 'old', failed: 0, text: `This list is out of date: ${oldest.label} was last read ${ageWords(oldest.refreshed_at, now)}.` };
  if (old.length > 1 && oldest) return { why: 'old', failed: 0, text: `This list is out of date: ${listWords(old.map((s) => s.label))} are due a read; the oldest was read ${ageWords(oldest.refreshed_at, now)}.` };
  return { why: 'unknown', failed: 0, text: `This list is out of date${b.refreshed_at ? ': it was read ' + ageWords(b.refreshed_at, now) : ''}.` };
}
export const freshness = (b: Pick<StoreBrowse, 'offline' | 'stale' | 'refreshed_at'>, now: number = Date.now(), sources: readonly StoreSource[] = []): string | null => outOfDate(b, now, sources)?.text ?? null;

/** the line after a read, once it has put the list right: the check that the fix worked */
export function upToDateWords(r: Pick<Reading, 'last'>): string {
  const n = r.last?.total ?? 0;
  if (!n) return '';
  return `The list is up to date: ${n === 1 ? 'the source was' : `the ${String(n)} sources were`} read just now.`;
}
/** the words on a source's badge in the progress of a read */
export const READ_BADGE = { waiting: 'Waiting', reading: 'Reading', done: 'Read', failed: 'Could not read' } as const;

/* ───────── the review card ───────── */
export interface ReviewOpts {
  /** the card is for an update: its title and what changed lead */
  update?: UpdateDiff | null;
  /** the project the scope choice offers trust for, when the session has one */
  project?: string | null;
  verified?: string | null;
}
const WARN_LABEL = { strong: 'Read this first', caution: 'Take care', info: 'Note' } as const;

/** the review as a `connector`-kind form: plan sections as rows, the consent items, the hash, keys as secret fields, and a hold */
export function reviewSpec(plan: InstallPlan, o: ReviewOpts = {}): FormSpec {
  const rows: Array<readonly [string, string?]> = [];
  const warnings = [...plan.warnings];
  if (isRemote(plan.pinned) && !warnings.some((w) => /remote|hosted/i.test(w.code + ' ' + w.text))) warnings.push({ code: 'remote-hosted', level: 'caution', text: 'This connector is a service the publisher hosts. ' + REMOTE_WORDS + ' What you approve now is its address, not its code.' });
  warnings.sort((a, b) => ['strong', 'caution', 'info'].indexOf(a.level) - ['strong', 'caution', 'info'].indexOf(b.level));
  for (const w of warnings) rows.push([WARN_LABEL[w.level], w.text]);
  if (o.update) {
    rows.push(['Changes', o.update.changes.length ? o.update.changes.map((c) => `${c.change} ${c.type} ${c.name}`).join('; ') : 'No component changes.']);
    if (o.update.widened) rows.push(['Reaches further', 'This update adds new code, hosts or keys. Read all of it again.']);
  }
  rows.push(['Adds', plan.components.length ? plan.components.map(componentWords).join('; ') : 'Nothing but its description.']);
  rows.push(['Runs', plan.code_runs.length ? plan.code_runs.map(runWords).join('; ') : 'Nothing: it adds no code that runs.']);
  rows.push(['Reaches', hostsWords(plan.hosts, o.verified)]);
  if (plan.secrets.length) rows.push(['Keys', plan.secrets.map((s) => s.title + (s.optional ? ' (optional)' : '')).join('; ') + '. They go to your keychain.']);
  rows.push(['Writes', plan.files_written.length ? plan.files_written.map((f) => f.path + ' (' + f.purpose + ')').join('; ') : 'No files.']);
  rows.push(['Governed', plan.governed.text]);
  rows.push(['Check', scanWords(plan.scan.verdict) + (plan.scan.findings.length ? ': ' + plan.scan.findings.map((f) => f.text).join('; ') : '')]);
  rows.push(['Tier', TIER_WORDS[plan.tier]]);
  for (const c of plan.consent) rows.push([c.runs_code ? 'You agree, it runs code' : 'You agree', c.text]);
  rows.push(['Plan hash', plan.plan_hash]);
  const properties: Record<string, import('../../data').FieldSchema> = {};
  const required: string[] = [];
  for (const s of plan.secrets) {
    properties[s.id] = { type: 'string', title: s.title, 'x-secret': true, 'x-secret-ref': 'secret://store.' + plan.item_id + '/' + s.id, ...(s.env ? { description: 'Kept in your keychain and given to it as ' + s.env + '.' } : {}) };
    if (!s.optional) required.push(s.id);
  }
  if (plan.layer === 'connector' && plan.secrets.length && plan.sessions_open !== 0) {
    properties['restart'] = { type: 'string', title: 'A key means the engine restarts', enum: ['when-idle', 'now'], enumNames: ['When no turn is running', 'Now'], default: 'when-idle' };
    required.push('restart');
  }
  const sessions = plan.sessions_open == null ? 'boopis could not tell how many sessions have a turn running.' : plan.sessions_open === 0 ? 'No session has a turn running.' : `${plural(plan.sessions_open, 'session')} ${plan.sessions_open === 1 ? 'has' : 'have'} a turn running; they keep the tools they started with.`;
  const strong = plan.warnings.some((w) => w.level === 'strong');
  return {
    id: 'store.review.' + plan.item_id, kind: 'connector', title: (o.update ? 'Update ' : 'Install ') + plan.title, origin: { kind: 'host' }, defer: false,
    why: `${KIND_LABEL[plan.kind]} by ${plan.publisher}${plan.version ? ', version ' + plan.version : ''}. ${strong ? 'Nobody has vouched for everything in it, so read each line.' : 'This is what it adds and what it runs.'}`,
    schema: { properties, required }, contents: rows, pinned: isRemote(plan.pinned) ? (plan.pinned.repo ?? plan.pinned.value) : plan.pinned.value,
    effect: sessions + ' It takes effect in new sessions.', name: plan.title,
    submit: { label: o.update ? 'Update' : 'Install', hold: true }, cancel: { label: 'Back' }, receipt: (o.update ? 'Updated ' : 'Installed ') + plan.title + '. It takes effect in new sessions.'
  };
}
