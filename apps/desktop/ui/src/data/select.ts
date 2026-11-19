/* Which provider the app runs on: `VITE_DATA_PROVIDER` is `mock` (the default; development, smoke and parity tests) or
   `live` (the desktop build, `--mode desktop`: the Hermes gateway through the host, `src/host`). The live provider serves
   sessions and the conversation from the gateway; its remaining sources are the mock's, named in `MOCK_SOURCES`. A
   failure to connect is shown to the user and never falls back to the mock (AGENTS.md invariant 5). */
import type { DataProvider } from './provider';
import { createMockProvider } from './mock-provider';

export async function selectProvider(): Promise<DataProvider> {
  const which = (import.meta.env['VITE_DATA_PROVIDER'] as string | undefined) ?? 'mock';
  if (which === 'mock') return createMockProvider();
  if (which === 'live') return (await import('../host/connect')).connectLive();
  throw new Error('Unknown data provider "' + which + '"; use "mock" or "live"');
}
