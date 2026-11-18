/* The one place the app learns which provider it runs on. Modules call `data()`; `main.ts` calls `setProvider`. */
import type { DataProvider } from './provider';

let current: DataProvider | null = null;
export function setProvider(p: DataProvider): void { current = p; }
export function data(): DataProvider {
  if (!current) throw new Error('no data provider: call setProvider() before the modules mount');
  return current;
}
export type * from './types';
export type * from './provider';
