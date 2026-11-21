/* What the store says, without a DOM (docs/STORE.md): the words for tiers, kinds, states, hosts and pins, the filters, and the
   review card's form built from an `InstallPlan`. Every sentence is boopis's: a tier is words (never colour alone), an unknown
   is said as unknown, and the engine is never named (an item's own text is data, marked `data-store-item` where it is drawn). */
import type {
  FormSpec, InstallPlan, InstallReceipt, StoreBrowse, StoreCodeRun, StoreComponent, StoreError, StoreFilter, StoreHosts, StoreItem, StoreKind, StorePin, StoreScanVerdict, StoreSource, StoreTier, UpdateDiff
} from '../../data';

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
export function pinWords(p: StorePin | null): string {
  if (!p) return 'Not pinned: boopis will not install it.';
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

/** a source's state in words: off (and why), unreachable, or its age */
export function sourceState(s: StoreSource, now: number = Date.now()): { word: 'off' | 'on' | 'trouble'; text: string } {
  if (s.enabled === false) {
    return { word: 'off', text: s.terms === 'unverified' ? 'Off until its terms are checked. ' + (s.note ?? '') : (s.note ?? 'Switched off.') };
  }
  if (s.error) return { word: 'trouble', text: s.error };
  const n = s.items == null ? '' : plural(s.items, 'item') + '. ';
  return { word: 'on', text: n + (s.refreshed_at ? 'Read ' + ageWords(s.refreshed_at, now) + '.' : 'Not read yet.') };
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
/** what a browse page says when there is nothing, or the catalogue is old */
export function freshness(b: Pick<StoreBrowse, 'offline' | 'stale' | 'refreshed_at'>, now: number = Date.now()): string | null {
  if (b.offline) return `You are offline. This is the last copy boopis saved${b.refreshed_at ? ', from ' + ageWords(b.refreshed_at, now) : ''}.`;
  if (b.stale) return `This list is out of date${b.refreshed_at ? ': it was read ' + ageWords(b.refreshed_at, now) : ''}.`;
  return null;
}

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
  const warnings = [...plan.warnings].sort((a, b) => ['strong', 'caution', 'info'].indexOf(a.level) - ['strong', 'caution', 'info'].indexOf(b.level));
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
    schema: { properties, required }, contents: rows, pinned: plan.pinned.value,
    effect: sessions + ' It takes effect in new sessions.', name: plan.title,
    submit: { label: o.update ? 'Update' : 'Install', hold: true }, cancel: { label: 'Back' }, receipt: (o.update ? 'Updated ' : 'Installed ') + plan.title + '. It takes effect in new sessions.'
  };
}
