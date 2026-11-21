import { describe, expect, it } from 'vitest';
import file from '../../../../shared/data/providers.json';
import { isFrontier } from './frontier';
import * as P from './providers';

const raw = file as unknown as { examples: Array<{ way: string; expect: Record<string, unknown> }>; never_frontier: { examples: Array<{ provider: string; model: string; frontier: boolean }> } };

describe('the provider catalogue, read in the UI (the same file and examples as the host)', () => {
  it.each(raw.examples.map((e) => [e.way, e] as const))('%s', (_n, e) => {
    for (const [path, want] of Object.entries(e.expect)) expect(P.field(e.way, path), path).toEqual(want);
  });

  it('has unique ids, ways under their entry, known groups and rank order', () => {
    const ids = new Set<string>(), ws = new Set<string>(), groups = new Set(P.groups().map((g) => g.id));
    for (const e of P.entries()) {
      expect(ids.has(e.id), e.id).toBe(false); ids.add(e.id);
      expect(groups.has(e.group), e.group).toBe(true);
      for (const w of e.ways) { expect(ws.has(w.id), w.id).toBe(false); ws.add(w.id); expect(w.id.startsWith(e.id + '.')).toBe(true); }
    }
    const ranks = P.entries().map((e) => e.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('lists ranks 1-13 by default and the rest under More providers, with search finding both', () => {
    for (const e of P.entries()) expect(e.shown).toBe(e.rank <= 13 ? 'default' : 'more');
    expect(P.listed('default').map((e) => e.id).slice(0, 3)).toEqual(['anthropic', 'openai', 'google']);
    expect(P.search('muse').map((e) => e.id)).toEqual(['meta']);
    expect(P.search('glm').map((e) => e.id)).toEqual(['zai']);
    expect(P.search('').length).toBe(P.listed('default').length + P.listed('more').length);
  });

  it('hides the Qwen sign-in everywhere, even from search, and says which engine slug to leave out of the picker', () => {
    expect(P.hiddenEngines()).toEqual(['qwen-oauth']);
    const alibaba = P.search('qwen').find((e) => e.id === 'alibaba');
    expect(alibaba?.ways.map((w) => w.id)).toEqual(['alibaba.key']);
    expect(P.way('alibaba.qwen-signin')?.way.hidden_reason).toMatch(/15 April 2026/);
  });

  it('keeps the coding plans out, says why, and tells Google has no subscription sign-in on the row', () => {
    const kimi = P.way('moonshot.key')!.way;
    expect(kimi.key?.refuse_prefixes).toContain('sk-kimi-');
    expect(kimi.base_url?.pin).toBe(true);
    expect(P.way('zai.key')!.way.base_url?.pin).toBe(true);
    for (const id of ['zai.key', 'moonshot.key']) expect(P.way(id)!.way.notes.some((n) => n.kind === 'terms')).toBe(true);
    expect(P.way('google.key')!.way.notes.find((n) => n.id === 'no-subscription-signin')?.where).toBe('row');
  });

  it('writes the direct OpenAI key under the registry slug, not the legacy alias', () => {
    const w = P.way('openai.key')!.way;
    expect(w.engine).toBe('openai-api');
    expect(P.secretRef(w)).toBe('secret://provider.openai-api/api_key');
  });

  it('names the three heavy switches by family', () => {
    expect(P.heavySwitches().map((h) => h.id)).toEqual(['fable', 'grok', 'carbon']);
    expect(P.heavySwitches().find((h) => h.id === 'carbon')?.applies_when_unset).toBe(false);
  });

  it('never calls a custom endpoint or a local runtime frontier, and follows the file otherwise', () => {
    for (const e of raw.never_frontier.examples) {
      expect(P.neverFrontier(e.provider) ? false : isFrontier(e.provider, e.model), `${e.provider}/${e.model}`).toBe(e.frontier);
    }
    for (const { way } of P.ways()) if (way.kind === 'local' || way.kind === 'custom') expect(P.neverFrontier(way.engine ?? way.slug ?? 'custom'), way.id).toBe(true);
  });

  it('has a word for every status', () => {
    expect(Object.keys(P.STATUS_WORDS).sort()).toEqual(['connected', 'error', 'found_local', 'needs_key', 'not_found', 'signed_out', 'signing_in']);
  });

  it('builds the endpoint form: the checklist only after a Test, the key secret and never given a value', () => {
    const before = P.endpointSchema();
    expect(Object.keys(before.properties ?? {})).toEqual(['name', 'base_url', 'api_mode', 'key', 'discover', 'extra_models']);
    expect(before.required).toEqual(['name', 'base_url', 'api_mode']);
    const after = P.endpointSchema(['a', 'b']);
    expect(after.properties?.['picks']).toMatchObject({ 'x-multi': true, enum: ['a', 'b'], default: ['a', 'b'] });
    const secrets = Object.entries(after.properties ?? {}).filter(([, f]) => f['x-secret']);
    expect(secrets.map(([n]) => n)).toEqual(['key']);
    const key = secrets[0]![1];
    expect(key.default).toBeUndefined(); expect(key.enum).toBeUndefined(); expect(key['x-secret-ref']).toBeUndefined();
  });

  it('names the engine nowhere a person reads', () => {
    const walk = (v: unknown, path: string, skip: ReadonlySet<string>): string[] => {
      if (typeof v === 'string') return /hermes/i.test(v) ? [path] : [];
      if (Array.isArray(v)) return v.flatMap((x, i) => walk(x, `${path}[${i}]`, skip));
      if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => (skip.has(k) ? [] : walk(x, `${path}.${k}`, skip)));
      return [];
    };
    expect(walk(file, '', new Set(['engine_source', 'spikes', 'not_offered']))).toEqual([]);
  });
});
