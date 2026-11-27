/* UI preferences persistence (STANDARDS sections 2 and 9: `ui/core/settings`). Storage can be missing, full or
   blocked (private windows, previews, thumbnails), so every read and write is wrapped and the app renders
   without it. What is written carries a schema version `v`. Keys keep the v6 names, so a saved theme survives the port. */
import accentData from '../styles/accents.v7.json';
import { logger } from './log';

const log = logger('settings');

export const KEYS = {
  shell: 'hx.v6.shell',
  theme: 'hx.v6.theme',
  lastDark: 'hx.v6.lastDark',
  dock: 'hx.dock.v6',
  bots: 'hx.v6.bots',
  boards: 'hx.v6.boards',
  preview: 'hx.v6.preview',
  window: 'hx.v6.window',
  size: 'hx.v6.size',
  /** the Session tab's last launch pick (how careful, the folder): a new session starts from it (ADR-0057) */
  sessionLaunch: 'hx.v7.sessionLaunch',
  /** what the session composer's line leaves out (its quick menu, board S05 B) */
  sessionLine: 'hx.v7.sessionLine',
  /** the chrome's own choices (Settings › General, board 14): the rail's size and how search shows */
  chrome: 'hx.v7.chrome',
  /** the v7 look (Settings › Appearance, board 14): the accent and the corners */
  look: 'hx.v7.look',
  /** the first run's ledger (board O01: "only for resume, skip and returning users"): which parts are done, put off or skipped */
  onboarding: 'hx.v7.onboarding'
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
  tab?: Tab; left?: LeftMode; leftBy?: 'user'; right?: RightMode; dock?: DockSwitch; collapse?: CollapseMode; orbGrow?: boolean; dockCentred?: boolean; dockCompact?: boolean;
}
export const loadShell = (): SavedShell => {
  const o = readJSON<Record<string, unknown>>(KEYS.shell);
  return o && typeof o === 'object' ? (o as SavedShell) : {};
};

/* ───────── the Bots tab's own: the Archived group is collapsed until the user opens it, and stays as they left it ───────── */
export interface SavedBots { archivedOpen?: boolean; archivedGroups?: readonly string[] }
export const loadBots = (): Required<SavedBots> => {
  const o = readJSON<Record<string, unknown>>(KEYS.bots);
  const groups = o?.['archivedGroups'];
  return { archivedOpen: o?.['archivedOpen'] === true, archivedGroups: Array.isArray(groups) ? groups.filter((x): x is string => typeof x === 'string') : [] };
};
/** merges into what is kept: a field left out stays as it was */
export const saveBots = (v: SavedBots): boolean => { const cur = loadBots(); return writeJSON(KEYS.bots, { archivedOpen: (v.archivedOpen ?? cur.archivedOpen) === true, archivedGroups: v.archivedGroups ?? cur.archivedGroups }); };

/* ───────── a group's kanban board: which of the engine's boards the user chose for it (the default is the board named like the group) ───────── */
export const loadBoardChoice = (group: string): string | null => {
  const m = readJSON<Record<string, unknown>>(KEYS.boards)?.['groups'];
  const v = m && typeof m === 'object' ? (m as Record<string, unknown>)[group] : null;
  return typeof v === 'string' && v ? v : null;
};
export const saveBoardChoice = (group: string, slug: string): boolean => {
  const m = readJSON<Record<string, unknown>>(KEYS.boards)?.['groups'];
  const cur = m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
  return writeJSON(KEYS.boards, { groups: { ...cur, [group]: slug } });
};

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

/* ───────── the interface size: the window's zoom, one of three steps (Settings > Appearance > Size) ───────── */
export const UI_SIZES = ['default', 'larger', 'largest'] as const;
export type UiSize = (typeof UI_SIZES)[number];
/** what each step scales the web view by: text, layout and bots together, so no size changes against another */
export const UI_ZOOM: Readonly<Record<UiSize, number>> = { default: 1, larger: 1.12, largest: 1.25 };
export const isUiSize = (v: unknown): v is UiSize => typeof v === 'string' && (UI_SIZES as readonly string[]).includes(v);
export const loadUiSize = (): UiSize => { const v = readJSON<Record<string, unknown>>(KEYS.size)?.['size']; return isUiSize(v) ? v : 'default'; };
export const saveUiSize = (size: UiSize): boolean => writeJSON(KEYS.size, { size });

/** the items of the session composer's line (board S05 B: everything shows; the quick menu turns items off) */
export const LINE_ITEMS = ['careful', 'branch', 'model', 'context', 'cost'] as const;
export type LineItemId = (typeof LINE_ITEMS)[number];
/** each item's name, in the quick menu and in Settings › General › Under the composer (one list, the spec's S05 row) */
export const LINE_NAMES: Readonly<Record<LineItemId, string>> = { careful: 'How careful', branch: 'Branch', model: 'Model and effort', context: 'Context', cost: 'Cost' };
export const loadLineHidden = (): LineItemId[] => { const v = readJSON<Record<string, unknown>>(KEYS.sessionLine)?.['hidden']; return Array.isArray(v) ? LINE_ITEMS.filter((i) => v.includes(i)) : []; };
export const saveLineHidden = (hidden: readonly LineItemId[]): boolean => writeJSON(KEYS.sessionLine, { hidden: LINE_ITEMS.filter((i) => hidden.includes(i)) });

/* ───────── the chrome (Settings › General › Layout, board 14): the rail's size and how search shows ───────── */
export const RAIL_SIZES = ['auto', 'a', 'b'] as const;
export type RailSize = (typeof RAIL_SIZES)[number];
/** how search shows in the chrome when it shows (the owner: "Search default S5 … button and pill as Settings options") */
export const SEARCH_AS = ['hint', 'button', 'pill'] as const;
export type SearchAs = (typeof SEARCH_AS)[number];
export interface ChromePrefs { rail: RailSize; search: boolean; searchAs: SearchAs }
export const loadChrome = (): ChromePrefs => {
  const o = readJSON<Record<string, unknown>>(KEYS.chrome) ?? {};
  const rail = RAIL_SIZES.find((r) => r === o['rail']) ?? 'auto';
  const searchAs = SEARCH_AS.find((r) => r === o['searchAs']) ?? 'hint';
  return { rail, search: o['search'] !== false, searchAs };
};
/** the rail's size now: the one chosen, or Automatic's (compact under 1200 wide) */
export const railSizeNow = (): 'a' | 'b' => { const r = loadChrome().rail; return r !== 'auto' ? r : typeof window !== 'undefined' && window.innerWidth < 1200 ? 'b' : 'a'; };
export const saveChrome = (p: ChromePrefs): boolean => writeJSON(KEYS.chrome, { rail: p.rail, search: p.search, searchAs: p.searchAs });

/* ───────── the v7 look (Settings › Appearance, board 14, P1): the accent and the corners ───────── */
/** the accents a person chooses from: Iris, the owner's pick (P1), then the other candidates board P1 drew, each fill as P1 wrote it;
    the text, focus and on-accent shades are derived per theme (kit theme.ts `deriveAccent`, section 18). The fills are data
    (`styles/accents.v7.json`) */
export const ACCENTS: ReadonlyArray<{ id: AccentId; label: string; hex: string }> = accentData.accents as ReadonlyArray<{ id: AccentId; label: string; hex: string }>;
export type AccentId = 'iris' | 'indigo' | 'ultramarine' | 'violet' | 'soft';
export const CORNERS_V7 = ['standard', 'rounder'] as const;
export type CornersV7 = (typeof CORNERS_V7)[number];
/** `followSystem`: the theme follows the system's light or dark (board 14's "Follow system"); off, the theme is the one chosen */
export interface LookPrefs { accent: AccentId; corners: CornersV7; followSystem: boolean }
export const loadLook = (): LookPrefs => {
  const o = readJSON<Record<string, unknown>>(KEYS.look) ?? {};
  return { accent: ACCENTS.find((a) => a.id === o['accent'])?.id ?? 'iris', corners: o['corners'] === 'rounder' ? 'rounder' : 'standard', followSystem: o['followSystem'] === true };
};
export const saveLook = (p: LookPrefs): boolean => writeJSON(KEYS.look, { accent: p.accent, corners: p.corners, followSystem: p.followSystem });
