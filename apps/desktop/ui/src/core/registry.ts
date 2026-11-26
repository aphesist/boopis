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

/* ───────── the dock's hooks for the shell (`window.hxDock` of the mock-up): the shell never imports the dock ───────── */
export interface DockApi {
  /** 'expanded' opens the asks (v7 has one row and one open size); anything else returns to the row */
  setMode(mode: string): void;
  setOn(on: boolean): void;
  focus(): void;
  /** KEYMAP section 3: the n-th bot (1-based) as the dock shows them */
  botAt(n: number): string | null;
  /** a bot's card */
  openSession(id: string): void;
  /** the stack of asks (D03 C) */
  openAsks(): void;
  closeSession(): void;
  readonly state: { shown: boolean; compact: boolean; open: 'stack' | 'card' | null; card: string | null; asks: number; row: readonly string[]; more: number; hover: string | null; width: number };
  /** tests slow or speed the dock's motion */
  timeScale(f: number): void;
  hover(x: number | null): void;
}
let dockApi: DockApi | null = null;
export const setDockApi = (a: DockApi): void => { dockApi = a; };
export const getDockApi = (): DockApi | null => dockApi;
