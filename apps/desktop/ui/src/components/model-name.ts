/* Model names people can read. The engine reports ids, not names ('claude-sonnet-5-5[1m]', 'gpt-6-luna',
   'qwen3-coder-480b-a35b-instruct'); this turns an id into 'Claude Sonnet 5.5', 'GPT-6 Luna', 'Qwen3 Coder 480B'. A raw
   `provider/id` is never what the UI shows: the host path is dropped (a model is named by its id, never its host), and an id
   no rule knows is still cleaned word by word, never printed as it came.

   The rules are data (apps/shared/data/model-names.json: aliases, the few families that write themselves differently, the
   words that are not Title Case, the words to drop, the provider plans); this file is the small parser around them. The
   engine reports no label for a model (`model.options` has a provider's `name` and its ids; the Claude subscription plugin's
   own labels exist only while it discovers models in setup), so the provider's name is the only engine label used, and only
   where the table has none. The provider's plan ("Claude subscription") is secondary text, never the model's name. */
import table from '../../../../shared/data/model-names.json';

interface Alias { name: string; pinned: string }
interface FamilyRule { id: string; match: string; brand?: string; unbranded?: readonly string[]; joinVersion?: string; verbatim?: boolean }
interface Table {
  aliases: Record<string, Alias | string>;
  families: readonly FamilyRule[];
  words: Record<string, string>;
  drop: { words: readonly string[] };
  providers: Record<string, string>;
}
const T = table as unknown as Table;
const ALIASES = new Map(Object.entries(T.aliases).filter((e): e is [string, Alias] => typeof e[1] === 'object'));
const FAMILIES = T.families.map((f) => ({ ...f, re: new RegExp(f.match, 'i') }));
const WORDS = new Map(Object.entries(T.words).filter((e): e is [string, string] => typeof e[1] === 'string'));
const DROP = new Set(T.drop.words);
const PROVIDERS = new Map(Object.entries(T.providers).filter((e): e is [string, string] => typeof e[1] === 'string'));
const TAGS_DROPPED = /^(free|beta|latest|thinking|extended|nitro|floor|online|exacto|instruct|default)$/i;

/** a model id, optionally behind a host path ('openrouter/anthropic/claude-sonnet-4.5'), or `{model, host}` */
export type ModelRef = string | { model?: string; id?: string; host?: string; provider?: string; via?: string };

/** the id and the host of a ref: the last path segment and everything before it */
export function splitRef(ref: ModelRef | null | undefined): { model: string; host: string } {
  if (ref && typeof ref === 'object') return { model: String(ref.model ?? ref.id ?? ''), host: String(ref.host ?? ref.provider ?? ref.via ?? '').toLowerCase() };
  const s = String(ref ?? '').trim(), i = s.lastIndexOf('/');
  return i < 0 ? { model: s, host: '' } : { model: s.slice(i + 1), host: s.slice(0, i).toLowerCase() };
}

const title = (w: string): string => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);

/** `llama3:8b` -> 'llama3-8b'; `x:free` -> 'x'; `anthropic:claude-x` (a provider before the colon) -> 'claude-x' */
function untag(id: string): string {
  const i = id.indexOf(':');
  if (i < 0) return id;
  const base = id.slice(0, i), tag = id.slice(i + 1);
  if (PROVIDERS.has(base)) return tag;
  if (/^\d+(\.\d+)?[bm]$/i.test(tag)) return base + '-' + tag;
  if (TAGS_DROPPED.test(tag) || !tag) return base;
  return base + '-' + tag.replace(/:/g, '-');
}

function token(w: string): string {
  const known = WORDS.get(w);
  if (known) return known;
  if (/^\d/.test(w)) return /^\d+(\.\d+)?b$/.test(w) ? w.toUpperCase() : /^\d+(\.\d+)?m$/.test(w) ? w.toUpperCase() : w;
  return title(w);
}

const cache = new Map<string, string>();
/** the name of a model, for people: 'Claude Haiku', 'Claude Sonnet 5.5', 'GPT-6 Luna', 'Gemini 3.8 Flash'. An id that is only a
    host or empty gives ''. */
export function modelName(ref: ModelRef | null | undefined): string {
  const raw = splitRef(ref).model;
  let out = cache.get(raw);
  if (out === undefined) { out = parse(raw); cache.set(raw, out); }
  return out;
}

function parse(raw: string): string {
  let s = raw.trim().replace(/\[[^\]]*\]/g, '');
  if (!s) return '';
  s = untag(s).toLowerCase();
  const alias = ALIASES.get(s);
  if (alias) return alias.name;
  s = s.replace(/_/g, '-').replace(/\s+/g, '-')
    .replace(/-\d{4}-\d{2}-\d{2}(?=-|$)/g, '')          /* 2025-06-05 */
    .replace(/-\d{2}-\d{2}$/, '')                       /* preview-06-05 */
    .replace(/-(?:\d{6}|\d{8})(?=-|$)/g, '');           /* 20251001 */
  const family = FAMILIES.find((f) => f.re.test(s));
  let tokens = s.split('-').filter(Boolean);
  tokens = tokens.filter((t, i) => !DROP.has(t) && !(i > 0 && /^\d{4}$/.test(t)) && !/^a\d+b$/.test(t));
  if (!tokens.length) return title(s) || raw;
  if (family?.verbatim) return tokens.join('-');
  if (family?.brand && family.unbranded?.includes(tokens[0] ?? '')) tokens = [family.brand.toLowerCase(), ...tokens];
  /* claude-3-5-sonnet: two one- or two-digit numbers in a row are one version, 3.5 */
  const merged: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string, next = tokens[i + 1];
    if (/^\d{1,2}$/.test(t) && next !== undefined && /^\d{1,2}$/.test(next)) { merged.push(t + '.' + next); i++; } else merged.push(t);
  }
  const words = merged.map(token);
  const join = family?.joinVersion;
  if (join && words.length > 1 && /^\d/.test(words[1] as string)) return [(words[0] as string) + join + (words[1] as string), ...words.slice(2)].join(' ');
  return words.join(' ');
}

/** the model's name beside its provider's mark, as the v7 boards write it ("sonnet 5.5" after the Claude mark, board 11 and S17): the
    readable name without its family's brand word, which the mark already says, in lower case */
export function shortName(ref: ModelRef | null | undefined): string {
  const name = modelName(ref);
  const brand = FAMILIES.find((f) => f.re.test(splitRef(ref).model.toLowerCase()))?.brand;
  return (brand && name.toLowerCase().startsWith(brand.toLowerCase() + ' ') ? name.slice(brand.length + 1) : name).toLowerCase();
}

/** the provider's service or plan, as the secondary text under a model: 'Claude subscription'. The table first; else the
    engine's own name for it (`model.options`); else the slug read as words. */
export function providerName(slug: string | null | undefined, engineName?: string | null): string {
  const s = String(slug ?? '').trim().toLowerCase();
  if (!s) return engineName?.trim() ?? '';
  const known = PROVIDERS.get(s);
  if (known) return known;
  const en = engineName?.trim();
  if (en) return en;
  return s.replace(/^custom:/, '').split(/[-_:]+/).filter(Boolean).map(title).join(' ');
}

/** whether two refs name the same model: the same id with or without a host, an alias and the id it points at today */
export function sameModel(a: ModelRef | null | undefined, b: ModelRef | null | undefined): boolean {
  const x = splitRef(a), y = splitRef(b);
  if (!x.model || !y.model) return false;
  if (x.host && y.host && x.host !== y.host) return false;
  return canon(x.model) === canon(y.model);
}
/** an id with its bracketed suffix and its alias resolved ('haiku' and 'claude-haiku-5-5[1m]' are one model today) */
export function canon(id: string): string {
  const s = id.trim().toLowerCase().replace(/\[[^\]]*\]/g, '');
  return ALIASES.get(s)?.pinned ?? s;
}
/** the alias an id is the pinned form of ('claude-haiku-5-5[1m]' -> 'haiku'), else null: the same model listed under two names is one row */
export function aliasOf(id: string): string | null {
  const c = canon(id);
  for (const [alias, a] of ALIASES) if (a.pinned === c) return alias;
  return null;
}
