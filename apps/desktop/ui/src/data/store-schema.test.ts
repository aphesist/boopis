/* The store's contract (ADR-0038): apps/shared/data/store.schema.json is the one description of the store's shapes. This test
   validates the fixture items, the sources file and what the mock store returns against it, with a validator for exactly the
   keywords the schema uses (it refuses a keyword it does not know, so the schema cannot grow past its tests). The Rust types
   (src-tauri/src/store/types.rs) round-trip the same files. */
import { describe, expect, it } from 'vitest';
import schema from '../../../../shared/data/store.schema.json';
import fixtures from '../../../../shared/data/store.fixtures.json';
import sources from '../../../../shared/data/store-sources.json';
import errors from '../../../../../crates/hx-proto/errors.json';
import { createMockStore } from './mock-store';

type Json = unknown;
type Schema = Record<string, Json>;
const ROOT = schema as unknown as Schema;
const KEYWORDS = new Set(['$schema', '$id', '$ref', '$defs', 'title', 'description', 'type', 'enum', 'const', 'required', 'properties', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'pattern', 'format', 'oneOf']);
const typeOf = (v: Json): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v: Json, t: string): boolean => (t === 'number' ? typeof v === 'number' : typeOf(v) === t);

export function validate(value: Json, s: Schema, path = '$'): string[] {
  for (const k of Object.keys(s)) if (!KEYWORDS.has(k)) throw new Error(`the test's validator does not know the keyword "${k}" (at ${path})`);
  if (typeof s['$ref'] === 'string') {
    let target: Json = ROOT;
    for (const part of s['$ref'].replace(/^#\//, '').split('/')) target = (target as Schema)[part];
    return validate(value, target as Schema, path);
  }
  const out: string[] = [];
  if (s['oneOf']) {
    const branches = s['oneOf'] as Schema[];
    const ok = branches.filter((b) => validate(value, b, path).length === 0).length;
    if (ok !== 1) out.push(`${path}: matches ${ok} of ${branches.length} alternatives`);
  }
  if ('const' in s && value !== s['const']) out.push(`${path}: expected ${JSON.stringify(s['const'])}`);
  if (s['enum'] && !(s['enum'] as Json[]).includes(value)) out.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(s['enum'])}`);
  if (s['type'] && !isType(value, s['type'] as string)) { out.push(`${path}: expected ${String(s['type'])}, found ${typeOf(value)}`); return out; }
  if (typeof value === 'string') {
    if (typeof s['minLength'] === 'number' && value.length < s['minLength']) out.push(`${path}: shorter than ${s['minLength']}`);
    if (typeof s['maxLength'] === 'number' && value.length > s['maxLength']) out.push(`${path}: longer than ${s['maxLength']}`);
    if (typeof s['pattern'] === 'string' && !new RegExp(s['pattern']).test(value)) out.push(`${path}: "${value}" does not match ${s['pattern']}`);
    if (s['format'] === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) out.push(`${path}: not a date`);
    if (s['format'] === 'date-time' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) out.push(`${path}: not a date-time`);
    if (s['format'] === 'uri' && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(value)) out.push(`${path}: not a uri`);
  }
  if (typeof value === 'number' && typeof s['minimum'] === 'number' && value < s['minimum']) out.push(`${path}: below ${s['minimum']}`);
  if (Array.isArray(value)) {
    if (typeof s['minItems'] === 'number' && value.length < s['minItems']) out.push(`${path}: fewer than ${s['minItems']} items`);
    if (typeof s['maxItems'] === 'number' && value.length > s['maxItems']) out.push(`${path}: more than ${s['maxItems']} items`);
    if (s['items']) value.forEach((v, i) => out.push(...validate(v, s['items'] as Schema, `${path}[${i}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, Json>;
    const props = (s['properties'] ?? {}) as Record<string, Schema>;
    for (const r of (s['required'] ?? []) as string[]) if (!(r in o)) out.push(`${path}: missing "${r}"`);
    for (const [k, v] of Object.entries(o)) {
      if (props[k]) out.push(...validate(v, props[k], `${path}.${k}`));
      else if (s['additionalProperties'] === false) out.push(`${path}: unexpected "${k}"`);
      else if (typeof s['additionalProperties'] === 'object') out.push(...validate(v, s['additionalProperties'] as Schema, `${path}.${k}`));
    }
  }
  return out;
}
const check = (value: Json, def?: string): string[] => validate(value, def ? { $ref: `#/$defs/${def}` } : ROOT);

describe('the schema is the contract', () => {
  it('validates the fixture file and the sources file', () => {
    expect(check(fixtures)).toEqual([]);
    expect(check(sources)).toEqual([]);
  });
  it('the fixture holds one item of every kind and of every tier, an unpinned one and a kill-listed one', () => {
    const items = fixtures.items as { kind: string; tier: string; pinned: unknown; removed: unknown }[];
    for (const k of ['skill', 'connector', 'plugin', 'mod', 'engine-plugin']) expect(items.some((i) => i.kind === k), k).toBe(true);
    for (const t of ['recommended', 'verified', 'not-reviewed']) expect(items.some((i) => i.tier === t), t).toBe(true);
    expect(items.some((i) => i.pinned === null)).toBe(true);
    expect(items.some((i) => i.removed !== null)).toBe(true);
  });
  it('refuses what is wrong: a bad id, an unknown key, a missing field, an unknown tier', () => {
    const item = structuredClone(fixtures.items[0]) as Record<string, unknown>;
    expect(check(item, 'StoreItem')).toEqual([]);
    expect(check({ ...item, id: 'no-colon' }, 'StoreItem')).not.toEqual([]);
    expect(check({ ...item, surprise: 1 }, 'StoreItem')).not.toEqual([]);
    expect(check({ ...item, tier: 'gold' }, 'StoreItem')).not.toEqual([]);
    const { license: _l, ...rest } = item;
    expect(check(rest, 'StoreItem')).not.toEqual([]);
  });
  it('the sources are the brief\'s, in boopis\'s words: no engine name, only anthropic off', () => {
    expect(sources.sources.map((s) => s.id)).toEqual(['boopis', 'engine-plugins', 'skills-hub', 'anthropic', 'mcp-registry', 'github', 'marketplace-url', 'local']);
    expect(sources.sources.filter((s) => !s.default_on).map((s) => s.id)).toEqual(['anthropic']);
    for (const s of sources.sources) expect(s.label.toLowerCase()).not.toContain('hermes');
    expect(sources.sources.filter((s) => s.engine_origin).map((s) => s.id)).toEqual(['engine-plugins', 'skills-hub']);
  });
  it('every error code the contract names is in the catalogue, with a sentence for the user', () => {
    const codes = new Map(errors.errors.map((e) => [e.code, e] as const));
    for (const c of ['unpinned', 'digest_mismatch', 'plan_changed', 'source_unreachable', 'too_large', 'unsafe_archive', 'dangerous_verdict', 'kind_unsupported', 'governed_refused', 'not_installed', 'offline', 'not_found', 'already_installed', 'removed', 'invalid_source', 'invalid_manifest', 'stage_missing', 'no_previous', 'rate_limited', 'install_failed']) {
      const e = codes.get('hx.store.' + c) as { user?: string } | undefined;
      expect(e, c).toBeDefined();
      expect(e?.user, c).toBeTruthy();
    }
  });
});

describe('what the mock store returns matches the schema', () => {
  it('browse, search, detail, review, install, receipts and diffs', async () => {
    const s = createMockStore();
    const page = await s.browse();
    expect(check(page, 'StoreBrowse')).toEqual([]);
    expect(page.recommended?.every((i) => i.tier === 'recommended')).toBe(true);
    expect(check(await s.search('lint'), 'StoreBrowse')).toEqual([]);
    expect(check(await s.detail('boopis:firecrawl'), 'StoreDetail')).toEqual([]);
    const { stage, plan } = await s.review('engine-plugins:example-metrics');
    expect(check(stage, 'StageResult')).toEqual([]);
    expect(check(plan, 'InstallPlan')).toEqual([]);
    const synthesized = await s.review('skills-hub:example-org/sql-review');
    expect(check(synthesized.plan, 'InstallPlan')).toEqual([]);
    expect(check({ stage_id: stage.stage_id, plan_hash: plan.plan_hash, restart: 'when-idle' }, 'InstallRequest')).toEqual([]);
    const receipt = await s.install({ stage_id: stage.stage_id, plan_hash: plan.plan_hash });
    expect(check(receipt, 'InstallReceipt')).toEqual([]);
    for (const d of await s.checkUpdates()) expect(check(d, 'UpdateDiff')).toEqual([]);
    expect(check(await s.uninstall('boopis:firecrawl'), 'UninstallResult')).toEqual([]);
    expect(check(await s.projectPolicy('~/work/api'), 'ProjectPolicy')).toEqual([]);
    for (const src of s.sources.get()) expect(check(src, 'StoreSource')).toEqual([]);
  });
});
