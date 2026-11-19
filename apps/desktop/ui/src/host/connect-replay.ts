/* The live provider over recorded frames, for the Playwright smoke (e2e build only; see `data/select.ts`). */
import type { DataProvider } from '../data/provider';
import { GatewayClient } from './gateway';
import { createLiveProvider } from './live-provider';
import { ReplayHost, ReplaySecrets, loadFrames } from './replay';
import type { RecordedFrame } from './replay';

/** `present` changes the recording before it plays (the lab restates what the recorder typed, see lab/provider.ts); the smoke plays it as recorded */
export async function connectReplay(name: string, present?: (frames: readonly RecordedFrame[]) => readonly RecordedFrame[]): Promise<DataProvider> {
  const frames = await loadFrames(name);
  const host = new ReplayHost(present ? present(frames) : frames);
  (window as unknown as Record<string, unknown>)['__hxReplay'] = host; // the smoke reads what the UI asked for
  const secrets = new ReplaySecrets();
  (window as unknown as Record<string, unknown>)['__hxReplaySecrets'] = secrets; // the smoke asks what reached the keychain
  const client = new GatewayClient(host);
  await client.connect();
  return createLiveProvider({ client, secrets });
}
