/* Module registration into slots (`HX.register`) and the actions a module provides to the shell's global keys
   (`HX.provide`). The shell mounts each registered module into its slot at boot. */
import { logger } from './log';

const log = logger('registry');

export const SLOTS = ['session-list', 'bots-list', 'session', 'bots', 'session-right', 'dock'] as const;
export type SlotName = (typeof SLOTS)[number];

export interface UiModule {
  /** `root` is the slot element; the shell owns it and its placeholder if the module throws */
  mount(root: HTMLElement): void;
}

const registry = new Map<SlotName, UiModule>();
export function register(name: SlotName, mod: UiModule | ((root: HTMLElement) => void)): void {
  registry.set(name, typeof mod === 'function' ? { mount: mod } : mod);
}
export const registered = (name: SlotName): UiModule | undefined => registry.get(name);

/* ───────── provided actions: the shell takes a key from the browser only when someone answers it ───────── */
export interface ProvideDetail { tab?: string; toggle?: boolean; from?: string }
export type ProviderName = 'find' | 'stop' | 'bot-settings';
export type Provider = (detail: ProvideDetail) => boolean | void;
const providers: Record<ProviderName, Provider[]> = { find: [], stop: [], 'bot-settings': [] };

export function provide(name: ProviderName, fn: Provider): () => void {
  providers[name].push(fn);
  return () => { providers[name] = providers[name].filter((f) => f !== fn); };
}
export const hasProvider = (name: ProviderName): boolean => providers[name].length > 0;
export function callProvided(name: ProviderName, detail: ProvideDetail): boolean {
  for (const fn of providers[name]) {
    try { if (fn(detail) === true) return true; } catch (err) { log.error('provider ' + name + ' failed', err); }
  }
  return false;
}
