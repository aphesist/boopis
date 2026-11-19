/* Start the live provider: connect to the gateway through the host, then serve the UI from it. Only the desktop app
   can do this (the webview talks to the host; a plain browser has no host), so anywhere else it is an error shown to
   the user, never a quiet fall back to the mock. */
import { createLiveProvider } from './live-provider';
import type { LiveProvider } from './live-provider';
import { GatewayClient } from './gateway';
import { inTauri, tauriBridge } from './bridge';
import type { DataProvider } from '../data/provider';

export async function connectLive(profile: string | null = null): Promise<DataProvider> {
  if (!inTauri()) throw new Error('The live data provider needs the desktop app: this page has no host to reach Hermes through.');
  const client = new GatewayClient(tauriBridge());
  await client.connect(profile);
  const provider: LiveProvider = createLiveProvider({ client });
  return provider;
}
