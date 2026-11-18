/* Which provider the app runs on. The live provider (the Hermes gateway and the hypotaxis plugin's streams) is another
   workstream: until it exists the choice is the mock provider, made explicitly, and a `live` build says so instead of
   quietly serving mock data (AGENTS.md invariant 5). */
import type { DataProvider } from './provider';
import { createMockProvider } from './mock-provider';

export function selectProvider(): DataProvider {
  const which = (import.meta.env['VITE_DATA_PROVIDER'] as string | undefined) ?? 'mock';
  if (which === 'mock') return createMockProvider();
  throw new Error('The "' + which + '" data provider is not implemented yet; see src/data/README.md');
}
