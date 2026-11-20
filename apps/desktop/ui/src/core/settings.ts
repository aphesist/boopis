/* UI preferences persistence (STANDARDS sections 2 and 9: `ui/core/settings`). Storage can be missing, full or
   blocked (private windows, previews, thumbnails), so every read and write is wrapped and the app renders
   without it. What is written carries a schema version `v`. Keys keep the v6 names, so a saved theme survives the port. */
import { logger } from './log';

const log = logger('settings');

export const KEYS = {
  shell: 'hx.v6.shell',
  theme: 'hx.v6.theme',
  lastDark: 'hx.v6.lastDark',
  dock: 'hx.dock.v6',
  bots: 'hx.v6.bots',
  preview: 'hx.v6.preview',
  window: 'hx.v6.window'
} as const;
export type StoreKey = (typeof KEYS)[keyof typeof KEYS];

export const SCHEMA_VERSION = 1;

export function readText(key: StoreKey): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeText(key: StoreKey, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch (e) { log.debug('storage blocked: ' + key, e); return false; }
}
export function readJSON<T = unknown>(key: StoreKey): T | null {
  const t = readText(key);
  if (t == null) return null;
  try { return JSON.parse(t) as T; } catch { return null; }
}
/** Writes `{ v, ...value }`. Readers ignore `v` and unknown keys, so older data keeps loading. */
export function writeJSON(key: StoreKey, value: Record<string, unknown>): boolean {
  return writeText(key, JSON.stringify({ v: SCHEMA_VERSION, ...value }));
}
export function clearAll(): void {
  try { for (const k of Object.values(KEYS)) localStorage.removeItem(k); } catch { /* blocked */ }
}

/* ───────── the shell's saved layout ───────── */
export const TABS = ['session', 'bots'] as const;
export const LEFT = ['open', 'rail', 'closed'] as const;
export const RIGHT = ['closed', 'open'] as const;
export const DOCK = ['on', 'off'] as const;
export const COLLAPSE = ['rail', 'closed'] as const;
export type Tab = (typeof TABS)[number];
export type LeftMode = (typeof LEFT)[number];
export type RightMode = (typeof RIGHT)[number];
export type DockSwitch = (typeof DOCK)[number];
export type CollapseMode = (typeof COLLAPSE)[number];

export interface SavedShell {
  tab?: Tab; left?: LeftMode; leftBy?: 'user'; right?: RightMode; dock?: DockSwitch; collapse?: CollapseMode; orbGrow?: boolean;
}
export const loadShell = (): SavedShell => {
  const o = readJSON<Record<string, unknown>>(KEYS.shell);
  return o && typeof o === 'object' ? (o as SavedShell) : {};
};

/* ───────── the Bots tab's own: the Archived group is collapsed until the user opens it, and stays as they left it ───────── */
export interface SavedBots { archivedOpen?: boolean }
export const loadBots = (): SavedBots => {
  const o = readJSON<Record<string, unknown>>(KEYS.bots);
  return { archivedOpen: o?.['archivedOpen'] === true };
};
export const saveBots = (v: SavedBots): boolean => writeJSON(KEYS.bots, { archivedOpen: v.archivedOpen === true });

/* ───────── preview flags: mock content a live build shows only when asked, always marked as a preview ───────── */
/** `hx.v6.preview` is `{ "feedforward": true }` to turn a preview on; the default is off, and `VITE_PREVIEW_<NAME>=1` does the same in a build */
export function readFlag(name: 'feedforward'): boolean {
  const o = readJSON<Record<string, unknown>>(KEYS.preview);
  const env = (import.meta.env as Record<string, string | undefined>)['VITE_PREVIEW_' + name.toUpperCase()];
  return o?.[name] === true || env === '1';
}

/* ───────── the title bar's controls: automatic (the host reads the desktop), close only, or all three ───────── */
export type WindowControlsPref = 'auto' | 'close' | 'all';
export const loadWindowPref = (): WindowControlsPref => {
  const v = readJSON<Record<string, unknown>>(KEYS.window)?.['controls'];
  return v === 'close' || v === 'all' ? v : 'auto';
};
export const saveWindowPref = (controls: WindowControlsPref): boolean => writeJSON(KEYS.window, { controls });
