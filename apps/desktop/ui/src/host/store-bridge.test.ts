import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown> | undefined]>, fail: null as unknown }));
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: (command: string, args?: Record<string, unknown>) => {
    sent.calls.push([command, args]);
    return sent.fail === null ? Promise.resolve({}) : Promise.reject(sent.fail);
  }
}));

import { tauriStoreBridge } from './store-bridge';

/* The generated bindings are the host's own signatures (`cargo test bindings` keeps the file fresh), so they are what the bridge
   is held to: the command and the argument names the host takes, read from the file, against what actually goes over `invoke`. */
const GENERATED = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bindings.ts'), 'utf8');
const hostSignatures = (): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const m of GENERATED.matchAll(/__TAURI_INVOKE<[^>]*>\("(store_[a-z_]+)", (undefined|\{([^}]*)\})/g)) {
    out.set(m[1]!, (m[3] ?? '').split(',').map((k) => k.trim()).filter(Boolean));
  }
  return out;
};

async function everyCall(): Promise<void> {
  const b = tauriStoreBridge();
  await b.catalogList({ kind: 'skill' }, 'c', 20);
  await b.search('sql', { tier: 'recommended' }, null, 10);
  await b.refresh('boopis');
  await b.itemDetail('boopis:x');
  await b.stage('boopis:x');
  await b.plan('stg-1', { level: 'bot', bot: 'default' });
  await b.install({ stage_id: 'stg-1', plan_hash: 'h', secrets: { key: 'v' }, restart: 'when-idle' });
  await b.uninstall('boopis:x', true);
  await b.installed();
  await b.updateCheck('boopis:x');
  await b.update('boopis:x', { stage_id: 's', plan_hash: 'h' });
  await b.rollback('boopis:x');
  await b.setEnabled('boopis:x', false);
  await b.sources();
  await b.sourceSetEnabled('mcp-registry', false);
  await b.sourceAdd({ url: 'https://example.com/m.json' });
  await b.sourceRemove('added-1');
}

describe('the store bridge and the host\'s real commands', () => {
  beforeEach(() => { sent.calls.length = 0; sent.fail = null; });

  it('reaches every store command the host has, and only those', async () => {
    await everyCall();
    const host = [...hostSignatures().keys()].sort();
    expect(host.length).toBeGreaterThanOrEqual(17);
    expect([...new Set(sent.calls.map((c) => c[0]))].sort()).toEqual(host);
  });

  it('sends each command exactly the argument names the host declares, none missing and none extra', async () => {
    await everyCall();
    const host = hostSignatures();
    for (const [command, args] of sent.calls) {
      expect(Object.keys(args ?? {}).sort(), command).toEqual([...(host.get(command) ?? [])].sort());
    }
  });

  it('sends the values the host reads: a missing option is null, a scope and a request go whole', async () => {
    await everyCall();
    const by = (c: string): Record<string, unknown> | undefined => sent.calls.find((x) => x[0] === c)?.[1];
    expect(by('store_catalog_list')).toEqual({ filter: { kind: 'skill' }, cursor: 'c', limit: 20 });
    expect(by('store_plan')).toEqual({ stageId: 'stg-1', scope: { level: 'bot', bot: 'default' }, profile: null });
    expect(by('store_uninstall')).toEqual({ id: 'boopis:x', deleteCredentials: true, profile: null });
    expect(by('store_set_enabled')).toEqual({ id: 'boopis:x', enabled: false, profile: null });
    expect(by('store_source_add')).toEqual({ url: 'https://example.com/m.json', path: null, label: null });
    expect(by('store_install')?.['request']).toEqual({ stage_id: 'stg-1', plan_hash: 'h', secrets: { key: 'v' }, restart: 'when-idle' });
  });

  it('turns a host rejection into a HostError with its stable code', async () => {
    sent.fail = { code: 'hx.store.offline', message: 'You are offline.' };
    await expect(tauriStoreBridge().sources()).rejects.toMatchObject({ code: 'hx.store.offline', message: 'You are offline.' });
  });
});
