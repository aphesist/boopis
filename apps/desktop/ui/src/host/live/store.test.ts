import { describe, expect, it, vi } from 'vitest';
import { createLiveStore, toStoreError } from './store';
import type { StoreBridge } from '../store-bridge';
import type { InstallReceipt, InstallPlan, StageResult } from '../../data/types';

const receipt = (id: string): InstallReceipt => ({ item_id: id, kind: 'skill', source: 'boopis', layer: 'plugin', version: '1', pinned: { type: 'commit', value: 'a'.repeat(40) }, plan_hash: 'h', tree_sha256: null, installed_at: '2026-11-21T10:00:00Z', scope: { level: 'bot', bot: 'default' }, files: [], enabled: true, effective: 'next-session', previous: null, steps: [], notes: [] });
function bridge(over: Partial<StoreBridge> = {}): StoreBridge & { log: string[] } {
  const log: string[] = [];
  const stage: StageResult = { stage_id: 'stg-1', item_id: 'boopis:x', pinned: { type: 'commit', value: 'a'.repeat(40) }, tree_sha256: null, files: 1, bytes: 1, scan: { verdict: 'safe', scanner: 't', findings: [] }, expires_at: '' };
  const b = {
    log,
    catalogList: () => Promise.resolve({ items: [], total: 0, next_cursor: null, refreshed_at: null, stale: false, offline: false }),
    search: () => Promise.resolve({ items: [], total: 0, next_cursor: null, refreshed_at: null, stale: false, offline: false }),
    refresh: () => Promise.resolve([]), itemDetail: () => Promise.reject(new Error('unused')),
    stage: () => { log.push('stage'); return Promise.resolve(stage); },
    plan: (id: string) => { log.push('plan:' + id); return Promise.resolve({ item_id: 'boopis:x', plan_hash: 'h' } as unknown as InstallPlan); },
    install: () => { log.push('install'); return Promise.resolve(receipt('boopis:x')); },
    uninstall: () => Promise.resolve({ item_id: 'boopis:x', removed: [], kept_secrets: [], notes: [] }),
    installed: () => Promise.resolve([receipt('boopis:x')]), updateCheck: () => Promise.resolve([]),
    update: (id: string) => { log.push('update:' + id); return Promise.resolve(receipt(id)); },
    rollback: () => Promise.resolve(receipt('boopis:x')), setEnabled: () => { log.push('enable'); return Promise.resolve(); },
    sources: () => Promise.resolve([]), sourceSetEnabled: () => Promise.resolve(), sourceAdd: () => Promise.reject({ code: 'hx.store.invalid_source', message: 'That address is not one boopis can use as a source.' }), sourceRemove: () => Promise.resolve(),
    ...over
  };
  return b as unknown as StoreBridge & { log: string[] };
}

describe('the live store', () => {
  it('reads the host\'s installed list, never a fixture', async () => {
    const s = createLiveStore({ bridge: bridge() });
    await s.settled();
    expect(s.installed.get().map((r) => r.item_id)).toEqual(['boopis:x']);
    expect(s.sources.get()).toEqual([]);
  });
  it('review is stage then plan, and the install of an update stage goes to `store_update`', async () => {
    const b = bridge(); const s = createLiveStore({ bridge: b });
    const { stage } = await s.review('boopis:x');
    await s.install({ stage_id: stage.stage_id, plan_hash: 'h' });
    const up = await s.reviewUpdate('boopis:x');
    await s.install({ stage_id: up.stage.stage_id, plan_hash: 'h' });
    expect(b.log).toEqual(['stage', 'plan:stg-1', 'install', 'stage', 'plan:stg-1', 'update:boopis:x']);
  });
  it('without a host it says so and shows nothing', async () => {
    const s = createLiveStore({ bridge: null });
    expect(s.can.install).toBe(false);
    await expect(s.browse()).rejects.toMatchObject({ code: 'hx.host.unavailable' });
    expect(s.installed.get()).toEqual([]);
  });
  it('rejects with the host\'s code and sentence, and keeps the engine\'s words out', async () => {
    const s = createLiveStore({ bridge: bridge() });
    await expect(s.addSource({ url: 'x' })).rejects.toEqual({ code: 'hx.store.invalid_source', message: 'That address is not one boopis can use as a source.' });
    const e = toStoreError({ code: 'hx.engine.refused', message: 'Hermes said no' });
    expect(e.code).toBe('hx.engine.refused');
    expect(e.message).not.toMatch(/hermes/i);
  });
  it('reads and sets a project\'s switch through the plugin\'s RPCs', async () => {
    const plugin = vi.fn((_m: string, p: Record<string, unknown>) => Promise.resolve({ project: p['cwd'], governed: true, explicit: p['block'] ?? null, effective: p['block'] ?? true }));
    const s = createLiveStore({ bridge: bridge(), plugin });
    expect((await s.projectPolicy('~/w')).effective).toBe(true);
    expect((await s.setProjectPolicy('~/w', false)).effective).toBe(false);
    expect(plugin.mock.calls.map((c) => c[0])).toEqual(['store.policy.get', 'store.policy.set']);
  });
});
