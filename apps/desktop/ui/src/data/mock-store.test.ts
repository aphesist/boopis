import { describe, expect, it } from 'vitest';
import { createMockStore } from './mock-store';
import type { StoreError } from './types';

const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'resolved'; } catch (e) { return (e as StoreError).code; } };

describe('the mock store plays the host\'s part', () => {
  it('browses the front page, filters and searches locally, and leaves out sources that are switched off', async () => {
    const s = createMockStore();
    const front = await s.browse();
    expect(front.recommended?.map((i) => i.id)).toEqual(['boopis:firecrawl', 'boopis:release-notes']);
    expect((await s.browse({ kind: 'mod' })).items.map((i) => i.id)).toEqual(['local:focus-theme']);
    expect((await s.search('sql')).items.map((i) => i.id)).toEqual(['skills-hub:example-org/sql-review']);
    expect((await s.browse({ hide_unpinned: true })).items.some((i) => i.pinned === null)).toBe(false);
    await s.setSourceEnabled('skills-hub', false);
    expect((await s.search('sql')).total).toBe(0);
    expect(await code(s.setSourceEnabled('nope', true))).toBe('hx.store.invalid_source');
  });
  it('refuses a removed item, an unpinned one and an unknown one, with the contract\'s codes', async () => {
    const s = createMockStore();
    expect(await code(s.review('engine-plugins:example-old-sync'))).toBe('hx.store.removed');
    expect(await code(s.review('github:example-org/loose-skill'))).toBe('hx.store.unpinned');
    expect(await code(s.review('boopis:nothing'))).toBe('hx.store.not_found');
    expect(await code(s.detail('boopis:nothing'))).toBe('hx.store.not_found');
  });
  it('installs only the plan that was shown, then lists, updates, rolls back and removes it', async () => {
    const s = createMockStore({ empty: true });
    const { stage, plan } = await s.review('skills-hub:example-org/sql-review');
    expect(await code(s.install({ stage_id: stage.stage_id, plan_hash: 'f'.repeat(64) }))).toBe('hx.store.plan_changed');
    const receipt = await s.install({ stage_id: stage.stage_id, plan_hash: plan.plan_hash });
    expect(receipt.effective).toBe('next-session');
    expect(s.installed.get().map((r) => r.item_id)).toEqual(['skills-hub:example-org/sql-review']);
    expect(await code(s.rollback(receipt.item_id))).toBe('hx.store.no_previous');
    expect((await s.uninstall(receipt.item_id)).item_id).toBe(receipt.item_id);
    expect(s.installed.get()).toEqual([]);
    expect(await code(s.uninstall(receipt.item_id))).toBe('hx.store.not_installed');
  });
  it('an update is a diff, then a review, then an install; and it can be rolled back', async () => {
    const s = createMockStore();
    const [diff] = await s.checkUpdates('anthropic:example-lint-kit');
    expect(diff?.widened).toBe(true);
    expect(s.updates.get()).toHaveLength(1);
    const { stage, plan } = await s.reviewUpdate('anthropic:example-lint-kit');
    expect(plan.version).toBe('2.1.0');
    const receipt = await s.install({ stage_id: stage.stage_id, plan_hash: plan.plan_hash });
    expect(receipt.previous?.version).toBe('2.0.3');
    expect(s.updates.get()).toEqual([]);
    expect((await s.rollback('anthropic:example-lint-kit')).version).toBe('2.0.3');
  });
  it('sources: add by address, refuse a bad one, remove only what was added; offline serves the cache and rejects a refresh', async () => {
    const s = createMockStore();
    const added = await s.addSource({ url: 'https://example.com/marketplace.json' });
    expect(added.user_added).toBe(true);
    expect(await code(s.addSource({ url: 'http://example.com/x' }))).toBe('hx.store.invalid_source');
    await s.removeSource(added.id);
    expect(await code(s.removeSource('boopis'))).toBe('hx.store.invalid_source');
    const off = createMockStore({ offline: true });
    expect((await off.browse()).offline).toBe(true);
    expect(await code(off.refresh())).toBe('hx.store.offline');
  });
  it('the project switch is on for a governed project unless the user chose otherwise', async () => {
    const s = createMockStore();
    expect((await s.projectPolicy('~/work/api')).effective).toBe(true);
    expect((await s.projectPolicy('~/work/site')).effective).toBe(false);
    expect((await s.setProjectPolicy('~/work/api', false)).effective).toBe(false);
  });
});
