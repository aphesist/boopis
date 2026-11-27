/* The first run's setup, as data (boards O-P02, O-P03 to O-P03e): the three settings the consent changes, and the model question's
   rows from the catalogue and the host's states. Pure: no DOM, no host. */
import { entries, ways } from '../../data/providers';
import type { Entry, Way } from '../../data/providers';
import type { ProviderState } from '../../host/providers-bridge';
import { loginFor } from '../../host/logins';

/* ───────── O-P02: the settings boopis needs ───────── */
/** each setting the host's consent names, in the board's words; one the board does not name keeps the host's own reason */
const SETTING_WORDS: Readonly<Record<string, string>> = {
  'tools.tool_search.enabled': 'Show boopis’s tools directly',
  'delegation.backend': 'Route governed work to each model tier',
  'plugins.entries.boopis.allow_gateway_injection': 'Let a held message continue a turn'
};
export interface Setting { label: string; line: string }
/** the consent's settings: its `diff` (key, from, to) where the host sends one, else its body, one line per setting
    ("tools.tool_search.enabled = off (so pack, ship and dispatch show directly)") */
export function settingsOf(form: { body: string; diff?: unknown }): Setting[] {
  const reasons = new Map<string, string>();
  const out: Setting[] = [];
  for (const raw of form.body.split('\n')) {
    const m = /^\s*([\w.-]+)\s*=\s*([^\s(]+)\s*(?:\((.*)\))?\s*$/.exec(raw);
    if (!m) continue;
    const [, key = '', value = '', why = ''] = m;
    reasons.set(key, why.replace(/^so\s+/i, '').trim());
    out.push({ label: '', line: key + ' = ' + value });
  }
  const diff = Array.isArray(form.diff) ? (form.diff as Array<{ key?: unknown; to?: unknown }>).filter((d) => typeof d.key === 'string') : [];
  const rows = diff.length ? diff.map((d) => ({ key: String(d.key), line: String(d.key) + ' = ' + String(d.to) })) : out.map((o) => ({ key: o.line.split(' = ')[0] ?? '', line: o.line }));
  return rows.map(({ key, line }) => {
    const reason = reasons.get(key) ?? '';
    return { label: SETTING_WORDS[key] ?? (reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : key), line };
  });
}

/* ───────── O-P03: a model to think with ───────── */
/** the host's choice for a way in `setup.ladder`, when its enum has one: the way's id, its slug or engine, or the id it used before the
    catalogue */
const LEGACY: Readonly<Record<string, string>> = {
  'anthropic.signin': 'claude-subscription', 'openai.signin': 'chatgpt-subscription', 'anthropic.key': 'anthropic',
  'openai.key': 'openai-key', 'google.key': 'gemini', 'xai.key': 'xai', 'openrouter.key': 'openrouter-free'
};
export function choiceFor(way: Way, offered: readonly string[]): string | null {
  return [way.id, LEGACY[way.id], way.slug, way.engine].filter((x): x is string => !!x).find((c) => offered.includes(c)) ?? null;
}

/** what a row does when it is the choice: use it (it is connected, or a runtime answered), sign in, or take a key */
export type RowKind = 'use' | 'local' | 'signin' | 'key';
export interface ModelRow { way: string; kind: RowKind; name: string; meaning: string; /** the provider's mark, by a model of its family */ model: string | null }

/** a way's short name: a sign-in's product ("Claude subscription": "Claude"), else the lab's ("Google Gemini": "Gemini") */
export function nameOf(e: Entry, w: Way): string {
  if (w.kind === 'signin') return w.label.replace(/\s+subscription$/i, '');
  return e.label.replace(/^Google\s+/, '').replace(/\s*\(.*\)$/, '');
}
/** a model of the way's family, so the row leads with its provider's mark (model-mark.ts) */
const MARK_MODEL: Readonly<Record<string, string>> = { anthropic: 'claude-sonnet', openai: 'gpt-5', google: 'gemini-pro', xai: 'grok-4', deepseek: 'deepseek-chat' };
const markOf = (e: Entry): string | null => MARK_MODEL[e.id] ?? null;
/** where a key comes from, from the way's own hint ("A free key from Google AI Studio works.": "Paste a key from Google AI Studio") */
export function keyMeaning(w: Way): string {
  const m = /\bfrom (the [A-Z][\w-]*(?: [\w-]+)*?|[A-Z][\w-]*(?: [A-Z][\w-]*)*)(?=\.| works|,|$)/.exec(w.hint);
  return m ? 'Paste a key from ' + m[1] : 'Paste a key';
}
/** a sign-in that runs a program of the person's own (Claude Code) is named by it */
const programOf = (w: Way): string | null => (w.signin?.flow === 'cli' ? loginFor(w.signin.login ?? undefined)?.name ?? null : null);

/** a found way as a row: connected (signed in, a key in place) or a runtime that answered on this computer */
function foundRow(e: Entry, w: Way, s: ProviderState): ModelRow {
  const name = nameOf(e, w);
  const meaning = w.kind === 'local' ? (s.models_count != null ? `${String(s.models_count)} ${s.models_count === 1 ? 'model' : 'models'} on this computer` : 'On this computer')
    : w.kind === 'signin' ? (programOf(w) ? `${programOf(w) ?? ''}, signed in` : `Your ${name} plan, signed in`)
    : w.kind === 'key' ? 'Your key is saved' : 'Connected';
  return { way: w.id, kind: w.kind === 'local' ? 'local' : 'use', name, meaning, model: markOf(e) };
}
/** a way not set up yet, as a row to offer */
function offerRow(e: Entry, w: Way): ModelRow {
  const name = nameOf(e, w);
  return w.kind === 'signin' ? { way: w.id, kind: 'signin', name: 'Sign in with ' + name, meaning: `Your ${name} plan`, model: markOf(e) }
    : { way: w.id, kind: 'key', name: `Use a${/^[aeiou]/i.test(name) ? 'n' : ''} ${name} key`, meaning: keyMeaning(w), model: markOf(e) };
}
const shownWays = (): ReadonlyArray<{ entry: Entry; way: Way }> => ways().filter(({ entry, way }) => entry.shown === 'default' && !way.hidden && way.kind !== 'custom');
const ORDER: Readonly<Record<string, number>> = { signin: 0, key: 1, local: 2 };

/** what this computer has: every connected way and every runtime that answered, sign-ins first, in the catalogue's order */
export function foundRows(states: ReadonlyMap<string, ProviderState>): ModelRow[] {
  const rows: Array<ModelRow & { o: number }> = [];
  for (const { entry, way } of shownWays()) {
    const s = states.get(way.id);
    if (!s || !(s.status === 'connected' || s.status === 'found_local')) continue;
    rows.push({ ...foundRow(entry, way, s), o: (ORDER[way.kind] ?? 3) * 1000 + entry.rank });
  }
  return rows.sort((a, b) => a.o - b.o).map(({ o: _o, ...r }) => r);
}
/** nothing found (O-P03b): the plans most people already pay for, then a free key: the catalogue's first two sign-ins and the first
    key of a lab with no sign-in */
export function offerRows(): ModelRow[] {
  const ordered = [...entries()].sort((a, b) => a.rank - b.rank).filter((e) => e.shown === 'default');
  const signins = ordered.flatMap((e) => e.ways.filter((w) => w.kind === 'signin' && !w.hidden && w.signin?.flow !== 'external_token').map((w) => offerRow(e, w))).slice(0, 2);
  const keyEntry = ordered.find((e) => !e.ways.some((w) => w.kind === 'signin') && e.ways.some((w) => w.kind === 'key' && !w.hidden));
  const key = keyEntry?.ways.find((w) => w.kind === 'key' && !w.hidden);
  return [...signins, ...(keyEntry && key ? [offerRow(keyEntry, key)] : [])];
}
/** "Add another": every way there is, those found first as they are, the rest to set up */
export function allRows(states: ReadonlyMap<string, ProviderState>): ModelRow[] {
  const found = foundRows(states);
  const rest = shownWays().filter(({ way }) => !found.some((f) => f.way === way.id) && way.kind !== 'local').map(({ entry, way }) => offerRow(entry, way));
  return [...found, ...rest];
}
/** the primary's words for a row that is the choice (O-P03: "Use Claude"; O-P03b: "Sign in with Claude") */
export const primaryOf = (r: ModelRow): string => (r.kind === 'use' || r.kind === 'local' ? 'Use ' + r.name : r.name);
