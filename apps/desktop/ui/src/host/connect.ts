/* Start the live provider: connect to the gateway through the host, then serve the UI from it. Only the desktop app
   can do this (the webview talks to the host; a plain browser has no host), so anywhere else it is an error shown to
   the user, never a quiet fall back to the mock. */
import { createLiveProvider } from './live-provider';
import type { LiveProvider } from './live-provider';
import { GatewayClient } from './gateway';
import { loadPlan, registerPlanSource } from './free-tier';
import { asHostError, inTauri, tauriBridge } from './bridge';
import { commands } from './bindings';
import type { DataProvider } from '../data/provider';

export async function connectLive(profile: string | null = null): Promise<DataProvider> {
  if (!inTauri()) throw new Error('The live data provider needs the desktop app: this page cannot reach boopis\'s engine.');
  const client = new GatewayClient(tauriBridge());
  await client.connect(profile);
  registerPlanSource(() => loadPlan(client));   /* Settings and Diagnostics ask Hermes about the plan through this connection */
  const restartEngine = async (): Promise<void> => { try { await commands.hermesRetry(profile); } catch (e) { throw asHostError(e); } };
  const provider: LiveProvider = createLiveProvider({ client, restartEngine, linkTo: async (name) => { const c = new GatewayClient(tauriBridge()); await c.connect(name); return c; } });
  return provider;
}
