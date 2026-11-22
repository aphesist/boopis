/* Every lab and route boopis can set up (ADR-0039). One data file, apps/shared/data/providers.json (schema providers.schema.json),
   read by the host (Rust), the plugin (a copy) and this file; each reader is tested against the file's own `examples`.
   Settings > Models and first-run setup are drawn from it, never from a list in code. A new lab is one entry in the file.

   Pure: no client, no DOM. */
import file from '../../../../shared/data/providers.json';
import type { FieldSchema, FormSchema } from './types';
import type { ProviderStatus } from '../host/bindings';

export type WayKind = 'signin' | 'key' | 'local' | 'custom';
export type ApiMode = 'chat_completions' | 'codex_responses' | 'anthropic_messages';
export type Shown = 'default' | 'more';
export interface Note { id: string; kind: 'terms' | 'limit' | 'info'; where: 'row' | 'detail'; text: string; source?: string }
/** `check`: the provider's own route that refuses a wrong key, asked by the host's key check (ADR-0041); the UI never calls it */
export interface KeyRoute { url: string; method: 'GET' | 'POST' }
export interface KeyRule { vars: readonly string[]; wire_var: string | null; url: string | null; required: boolean; refuse_prefixes: readonly string[]; check?: KeyRoute }
export interface BaseUrlRule { default: string | null; env: string | null; editable: boolean; pin: boolean; pin_reason: string | null }
export interface Discovery { method: 'engine_options' | 'get_models' | 'probe' | 'none'; host?: string; port?: number; path?: string; fallback_path?: string | null; shape?: string; timeout_ms?: number }
export interface Way {
  id: string; kind: WayKind; label: string; hint: string; engine: string | null; slug: string | null; config: 'builtin' | 'external' | 'endpoint';
  hidden: boolean; hidden_reason?: string; offered_when: 'always' | 'signin_unused'; region?: 'china'; slug_spike?: string;
  key: KeyRule | null; base_url: BaseUrlRule | null; api_mode: ApiMode | null; discovery: Discovery;
  signin: { flow: 'cli' | 'cli_drive' | 'device_code' | 'official_program' | 'external_token'; login: string | null; owner: string } | null;
  frontier: 'by_name' | 'never'; engine_source: readonly string[]; notes: readonly Note[];
}
export interface Entry { id: string; lab: string; label: string; summary: string; group: string; rank: number; shown: Shown; keywords: readonly string[]; ways: readonly Way[] }
export interface Group { id: string; label: string; order: number }
export interface HeavySwitch {
  id: string; family: string; label: string; reason: string; engines: readonly string[]; key_way: string; applies_when_unset: boolean;
  pick: 'route_alias' | 'lowest_in_family'; not_applicable: string; none_listed: string | null; empty_ladder: 'keep' | 'unset';
}
export interface EndpointField {
  name: string; type: 'string' | 'boolean' | 'integer'; format?: string; title: string; description: string; placeholder?: string; required: boolean;
  enum?: readonly string[]; enumNames?: readonly string[]; default?: unknown; secret?: boolean; multi?: boolean; multiline?: boolean; mono?: boolean; after_test?: boolean;
}
interface File {
  groups: readonly Group[]; providers: readonly Entry[]; heavy_switches: readonly HeavySwitch[];
  never_frontier: { engines: readonly string[]; slug_prefixes: readonly string[]; examples: ReadonlyArray<{ provider: string; model: string; frontier: boolean }> };
  endpoint: {
    api_modes: ReadonlyArray<{ id: ApiMode; label: string }>; default_api_mode: ApiMode; fields: readonly EndpointField[];
    limits: { max_models: number; max_model_id_chars: number; request_timeout_loopback_s: number; request_timeout_s: number; context_length_min: number };
    slug: { pattern: string; prefix: string; examples: ReadonlyArray<{ name: string; taken: readonly string[]; slug: string }>; invalid_names: readonly string[] };
  };
  not_offered: ReadonlyArray<{ id: string; lab: string; route: string; why: string; waits_for: 'owner' | 'terms' | 'later' | 'none' }>;
  examples: ReadonlyArray<{ way: string; expect: Record<string, unknown> }>;
}
const F = file as unknown as File;

export const groups = (): readonly Group[] => [...F.groups].sort((a, b) => a.order - b.order);
/** every entry, in display order (the file's order, which is by rank) */
export const entries = (): readonly Entry[] => F.providers;
export const entry = (id: string): Entry | undefined => F.providers.find((e) => e.id === id);
export const heavySwitches = (): readonly HeavySwitch[] => F.heavy_switches;
export const notOffered = (): typeof F.not_offered => F.not_offered;
export const examples = (): typeof F.examples => F.examples;
export const endpointRules = (): File['endpoint'] => F.endpoint;
export const neverFrontierExamples = (): File['never_frontier']['examples'] => F.never_frontier.examples;

/** every way with its entry, hidden ones included */
export function ways(): ReadonlyArray<{ entry: Entry; way: Way }> {
  return F.providers.flatMap((entry) => entry.ways.map((way) => ({ entry, way })));
}
export const way = (id: string): { entry: Entry; way: Way } | undefined => ways().find((w) => w.way.id === id);

/** the entries setup and Settings list: those not hidden, split by `shown` (a hidden way is left out; an entry with only hidden ways too) */
export function listed(shown: Shown): Entry[] {
  return F.providers.filter((e) => e.shown === shown && e.ways.some((w) => !w.hidden)).map((e) => ({ ...e, ways: e.ways.filter((w) => !w.hidden) }));
}

/** Search finds every entry that is not hidden, listed by default or not, by label, lab, summary, keywords, way labels and engine slugs. */
export function search(query: string): Entry[] {
  const q = query.trim().toLowerCase();
  const all = [...listed('default'), ...listed('more')];
  if (!q) return all;
  return all.filter((e) => [e.label, e.lab, e.summary, ...e.keywords, ...e.ways.flatMap((w) => [w.label, w.engine ?? '', w.slug ?? ''])].some((t) => t.toLowerCase().includes(q)));
}

/** the engine slugs the model picker leaves out (a hidden way's) */
export const hiddenEngines = (): string[] => ways().filter((w) => w.way.hidden && w.way.engine).map((w) => w.way.engine as string);

/** `secret://provider.<engine or slug>/api_key`, or null for a way with no key */
export function secretRef(w: Way): string | null {
  const id = w.engine ?? w.slug;
  return w.key && id ? 'secret://provider.' + id + '/api_key' : null;
}

/** a dotted path into a way (`key.wire_var`), as the file's examples spell it; `shown` and `secret_ref` are derived */
export function field(id: string, path: string): unknown {
  const hit = way(id);
  if (!hit) return undefined;
  if (path === 'shown') return hit.entry.shown;
  if (path === 'secret_ref') return secretRef(hit.way);
  let v: unknown = hit.way;
  for (const part of path.split('.')) v = (v as Record<string, unknown> | null | undefined)?.[part] ?? null;
  return v;
}

/** whether a provider's models can never be frontier: a custom endpoint or a runtime on this computer (fail closed). Callers
    ask this before the frontier list: `never` wins whatever the model is called. */
export function neverFrontier(provider: string): boolean {
  const n = F.never_frontier;
  const name = provider.trim().toLowerCase(); // the engine reads a provider name in lower case
  return n.engines.includes(name) || n.slug_prefixes.some((p) => name.startsWith(p));
}

/** the word a status gets beside a row (text, never colour alone) */
export const STATUS_WORDS: Readonly<Record<ProviderStatus, string>> = {
  connected: 'Connected',
  needs_key: 'No key',
  signed_out: 'Not signed in',
  signing_in: 'Signing in',
  found_local: 'Running on this computer',
  not_found: 'Not found',
  error: 'Problem'
};

/** the values the `endpoint` form yields (`FormOutcome.values`; the key is in `FormOutcome.secrets.key`, never here) */
export interface EndpointValues {
  name: string; base_url: string; api_mode: ApiMode; discover: boolean;
  /** the ticked ids of the checklist Test filled; absent before a Test */
  picks?: readonly string[];
  /** one id per line */
  extra_models?: string;
}

/** The schema of the `endpoint` form, from the file's `endpoint.fields`. `found` is what Test listed: absent before a Test (the
    checklist is not there), the ids after (the checklist offers exactly those, all ticked). The secret field has no default, no
    reference and no value: the card gives it to the host command and keeps it out of the page's text. */
export function endpointSchema(found?: readonly string[]): FormSchema {
  const properties: Record<string, FieldSchema> = {};
  const required: string[] = [];
  for (const f of F.endpoint.fields) {
    if (f.after_test && !(found && found.length)) continue;
    const p: FieldSchema = { type: f.type, title: f.title, description: f.description };
    if (f.format) p.format = f.format;
    if (f.placeholder) p.placeholder = f.placeholder;
    if (f.enum) p.enum = f.enum;
    if (f.enumNames) p.enumNames = f.enumNames;
    if (f.default !== undefined) p.default = f.default;
    if (f.secret) p['x-secret'] = true;
    if (f.multi) p['x-multi'] = true;
    if (f.multiline) p['x-multiline'] = true;
    if (f.mono) p['x-mono'] = true;
    if (f.after_test && found) { p.enum = found; p.enumNames = found; p.default = found; }
    properties[f.name] = p;
    if (f.required) required.push(f.name);
  }
  return { type: 'object', properties, required };
}
