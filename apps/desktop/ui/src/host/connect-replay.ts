/* The live provider over recorded frames, for the Playwright smoke (e2e build only; see `data/select.ts`). */
import type { DataProvider } from '../data/provider';
import { GatewayClient } from './gateway';
import { createLiveProvider } from './live-provider';
import { ReplayHost, loadFrames } from './replay';

export async function connectReplay(name: string): Promise<DataProvider> {
  const host = new ReplayHost(await loadFrames(name));
  (window as unknown as Record<string, unknown>)['__hxReplay'] = host; // the smoke reads what the UI asked for
  const client = new GatewayClient(host);
  await client.connect();
  return createLiveProvider({ client });
}
