import { describe, expect, it } from 'vitest';
import fixtures from '../../../../../shared/data/store.fixtures.json';
import type { InstallPlan, StoreItem, UpdateDiff } from '../../data';
import { ageWords, byKind, countsWords, endWord, freshness, hostsWords, markRef, needsWord, remoteUrl, reviewSpec, rowLine, sourceState, stateOf, TIER_WORDS } from './model';

const FX = fixtures as unknown as { items: StoreItem[]; plans: InstallPlan[]; diffs: UpdateDiff[] };
const plan = (id: string): InstallPlan => FX.plans.find((p) => p.item_id === id) as InstallPlan;

describe('the store\'s words', () => {
  it('says the tier in words', () => { expect(TIER_WORDS).toEqual({ recommended: 'Recommended by boopis', verified: 'Verified by its source', 'not-reviewed': 'Not reviewed' }); });
  it('says undeclared egress is not known, never none', () => {
    expect(hostsWords({ basis: 'unknown', hosts: [] })).toMatch(/^Not known/);
    expect(hostsWords({ basis: 'declared', hosts: ['a.example'] })).toMatch(/not enforced/);
    expect(hostsWords({ basis: 'loopback', hosts: [] })).toBe('This computer only.');
  });
  it('says how old a copy is, and unknown when it has no time', () => {
    expect(ageWords('2026-11-21T07:00:00Z', Date.parse('2026-11-21T10:00:00Z'))).toBe('3 hours ago');
    expect(ageWords(null)).toBe('not known');
    expect(freshness({ offline: true, stale: true, refreshed_at: '2026-11-20T10:00:00Z' }, Date.parse('2026-11-21T10:00:00Z'))).toMatch(/offline.*24 hours ago/);
  });
  it('removed wins, then update, then installed', () => {
    const rec = { item_id: 'a:b' } as never;
    expect(stateOf({ id: 'a:b', removed: { reason: 'x', by: 'source' } }, [], [])).toBe('removed');
    expect(stateOf({ id: 'a:b', removed: null }, [rec], [{ item_id: 'a:b', status: 'available' } as never])).toBe('update');
    expect(stateOf({ id: 'a:b', removed: null }, [rec], [])).toBe('installed');
    expect(stateOf({ id: 'a:b', removed: null }, [], [])).toBeNull();
  });
  it('shows a source with unverified terms as off, with the reason', () => {
    const s = sourceState({ id: 'anthropic', label: 'x', kinds: [], fetch: 'git-repo', default_tier: 'verified', default_on: false, user_added: false, engine_origin: false, terms: 'unverified', note: 'Terms not read.', enabled: false });
    expect(s.word).toBe('off'); expect(s.text).toMatch(/Off until its terms are checked/);
  });
  it('counts components, and says unknown before staging', () => {
    expect(countsWords({ known: false, skills: 0, commands: 0, agents: 0, hooks: 0, mcp_servers: 0, modules: 0, scripts: 0, python: 0 })).toMatch(/Not known/);
    expect(countsWords({ known: true, skills: 2, commands: 0, agents: 0, hooks: 1, mcp_servers: 0, modules: 0, scripts: 0, python: 0 })).toBe('2 skills, 1 hook');
  });
});

describe('the review card', () => {
  it('is a connector card with a hold, the hash, the sessions notice and the consent items', () => {
    const p = plan('boopis:firecrawl');
    const spec = reviewSpec({ ...p, sessions_open: 2 });
    expect(spec.kind).toBe('connector');
    expect(spec.submit).toMatchObject({ hold: true });
    expect(spec.contents?.some(([l, t]) => l === 'Plan hash' && t === p.plan_hash)).toBe(true);
    expect(spec.effect).toContain('2 sessions have a turn running; they keep the tools they started with.');
    for (const c of p.consent) expect(spec.contents?.some(([, t]) => t === c.text)).toBe(true);
    expect(JSON.stringify(spec)).not.toMatch(/hermes/i);
  });
  it('warns first and strongly for an engine plugin and for an item nobody reviewed', () => {
    const p = plan('engine-plugins:example-metrics');
    const rows = reviewSpec(p).contents ?? [];
    expect(rows[0]?.[0]).toBe('Read this first');
    expect(rows.some(([, t]) => /outside/i.test(t ?? ''))).toBe(true);
    const unreviewed = reviewSpec({ ...plan('boopis:firecrawl'), tier: 'not-reviewed', warnings: [{ code: 'unreviewed', level: 'strong', text: 'Nobody has reviewed this item.' }] });
    expect(unreviewed.contents?.[0]).toEqual(['Read this first', 'Nobody has reviewed this item.']);
  });
  it('warns plainly for a hosted connector, in the plan and never hidden', () => {
    const p = { ...plan('boopis:firecrawl'), pinned: { type: 'version' as const, value: '1', repo: 'remote:https://mcp.example.com/' }, warnings: [] };
    const rows = reviewSpec(p).contents ?? [];
    expect(rows[0]?.[0]).toBe('Take care');
    expect(rows[0]?.[1]).toContain('can change without a new version');
  });
  it('asks for a key as a secret field and for the restart choice while a turn runs', () => {
    const p = { ...plan('boopis:firecrawl'), sessions_open: 1 };
    const spec = reviewSpec(p);
    if (p.secrets.length) {
      const first = p.secrets[0];
      expect(spec.schema.properties?.[first?.id ?? '']?.['x-secret']).toBe(true);
      expect(spec.schema.properties?.['restart']).toBeDefined();
    }
  });
  it('leads an update with what changed and says when it reaches further', () => {
    const d = FX.diffs.find((x) => x.status === 'available') as UpdateDiff;
    const rows = reviewSpec(plan('boopis:firecrawl'), { update: d }).contents ?? [];
    expect(rows.some(([l]) => l === 'Changes')).toBe(true);
    expect(rows.some(([l]) => l === 'Reaches further')).toBe(d.widened);
  });
});

describe('how an item reads in a list', () => {
  const item = (id: string): StoreItem => FX.items.find((i) => i.id === id) as StoreItem;
  it('says what it is, by whom, a missing review, then its summary', () => {
    expect(rowLine(item('github:example-org/changelog-skills'))).toBe('Skill by example-org · not reviewed · ' + item('github:example-org/changelog-skills').summary);
    expect(rowLine(item('anthropic:example-lint-kit'))).toMatch(/^Plugin by Example Org · A plugin/);
  });
  it('says a publisher whose name is the title once, by the title', () => {
    expect(rowLine(item('boopis:firecrawl'))).toMatch(/^Connector · Scrape/);
  });
  it('says what an item needs: keys it cannot do without, or that it will not be installed', () => {
    expect(needsWord({ secrets: [{ id: 'k', title: 'Key', optional: false }], pinned: { type: 'version', value: '1' }, removed: null })).toBe('needs a key');
    expect(needsWord({ secrets: [{ id: 'a', title: 'A', optional: false }, { id: 'b', title: 'B', optional: false }, { id: 'c', title: 'C', optional: true }], pinned: { type: 'version', value: '1' }, removed: null })).toBe('needs 2 keys');
    expect(needsWord({ secrets: [{ id: 'k', title: 'Key', optional: true }], pinned: { type: 'version', value: '1' }, removed: null })).toBe('');
    expect(needsWord({ secrets: [], pinned: null, removed: null })).toBe('not pinned');
    expect(needsWord({ secrets: [], pinned: { type: 'version', value: '1' }, removed: { reason: 'x', by: 'source' } })).toBe('taken down');
  });
  it('ends a row with its state first, then what it needs', () => {
    const keyed = { secrets: [{ id: 'k', title: 'Key', optional: false }], pinned: { type: 'version' as const, value: '1' }, removed: null };
    expect(endWord(keyed, 'installed')).toEqual({ word: 'installed', tone: null });
    expect(endWord(keyed, 'update')).toEqual({ word: 'update', tone: 'busy' });
    expect(endWord(keyed, 'removed')).toEqual({ word: 'taken down', tone: 'attention' });
    expect(endWord(keyed, null)).toEqual({ word: 'needs a key', tone: null });
  });
  it('groups by kind in the kind filter\'s order, each keeping the host\'s order', () => {
    const g = byKind(FX.items);
    expect(g.map((x) => x.label)).toEqual(['Skills', 'Connectors', 'Plugins', 'Mods', 'Engine plugins']);
    expect(g[0]?.items.map((i) => i.id)).toEqual(FX.items.filter((i) => i.kind === 'skill').map((i) => i.id));
    expect(byKind([])).toEqual([]);
  });
  it('draws the tile from the item\'s own evidence: a curated connector\'s collection id, a hosted one\'s address', () => {
    expect(markRef(item('boopis:firecrawl'))).toMatchObject({ name: 'Firecrawl', kind: 'connector', collection: 'firecrawl' });
    expect(markRef(item('boopis:release-notes'))).toMatchObject({ publisher: 'Example Org', proven: true });
    expect(markRef({ ...item('local:focus-theme'), provenance: { ...item('local:focus-theme').provenance, namespace_proof: 'none' } }).proven).toBe(false);
    expect(markRef({ item_id: 'boopis:skills/pdf', kind: 'skill', source: 'boopis' })).toMatchObject({ publisher: null, proven: false });   /* a receipt names no publisher */
    expect(markRef(item('boopis:release-notes')).collection).toBeNull();
    expect(markRef(item('mcp-registry:com.example/tickets')).collection).toBeNull();
    expect(remoteUrl({ type: 'version', value: 'hosted', repo: 'remote:https://mcp.notion.com/mcp' })).toBe('https://mcp.notion.com/mcp');
    expect(remoteUrl({ type: 'commit', value: 'abc', repo: 'https://github.com/x/y' })).toBeNull();
    expect(markRef({ item_id: 'boopis:notion', kind: 'connector', source: 'boopis', pinned: { type: 'version', value: 'hosted', repo: 'remote:https://mcp.notion.com/mcp' } })).toMatchObject({ name: 'notion', collection: 'notion', url: 'https://mcp.notion.com/mcp' });
  });
});
