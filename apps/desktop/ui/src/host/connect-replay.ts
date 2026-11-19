/* The live provider over recorded frames, for the Playwright smoke (e2e build only; see `data/select.ts`). */
import type { DataProvider } from '../data/provider';
import { GatewayClient } from './gateway';
import { createLiveProvider } from './live-provider';
import { ReplayHost, loadFrames } from './replay';

export async function connectReplay(name: string): Promise<DataProvider> {
  const client = new GatewayClient(new ReplayHost(await loadFrames(name)));
  await client.connect();
  return createLiveProvider({ client });
}
