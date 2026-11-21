import { describe, expect, it } from 'vitest';
import { tauriStoreBridge } from './store-bridge';
import type { Invoke } from './store-bridge';

function fake(answer: unknown = {}): { invoke: Invoke; calls: Array<[string, Record<string, unknown> | undefined]> } {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  return { calls, invoke: ((c: string, a?: Record<string, unknown>) => { calls.push([c, a]); return Promise.resolve(answer); }) as Invoke };
}

describe('the store bridge sends the contract\'s commands with its argument names', () => {
  it('names each command and camel-cases the arguments Tauri renames', async () => {
    const f = fake();
    const b = tauriStoreBridge(f.invoke);
    await b.catalogList({ kind: 'skill' }, null, 20);
    await b.search('sql');
    await b.plan('stg-1', { level: 'bot', bot: 'default' });
    await b.install({ stage_id: 'stg-1', plan_hash: 'h', secrets: { key: 'v' }, restart: 'when-idle' });
    await b.uninstall('boopis:x', true);
    await b.updateCheck();
    await b.update('boopis:x', { stage_id: 's', plan_hash: 'h' });
    await b.sourceAdd({ url: 'https://example.com/m.json' });
    await b.setEnabled('boopis:x', false);
    expect(f.calls.map((c) => c[0])).toEqual(['store_catalog_list', 'store_search', 'store_plan', 'store_install', 'store_uninstall', 'store_update_check', 'store_update', 'store_source_add', 'store_set_enabled']);
    expect(f.calls[0]?.[1]).toEqual({ filter: { kind: 'skill' }, cursor: null, limit: 20 });
    expect(f.calls[2]?.[1]).toEqual({ stageId: 'stg-1', scope: { level: 'bot', bot: 'default' }, profile: null });
    expect(f.calls[4]?.[1]).toEqual({ id: 'boopis:x', deleteCredentials: true, profile: null });
    expect(f.calls[7]?.[1]).toEqual({ url: 'https://example.com/m.json', path: null, label: null });
  });
  it('turns a host rejection into a HostError with its stable code', async () => {
    const b = tauriStoreBridge((() => Promise.reject({ code: 'hx.store.offline', message: 'You are offline.' })) as Invoke);
    await expect(b.sources()).rejects.toMatchObject({ code: 'hx.store.offline', message: 'You are offline.' });
  });
});
