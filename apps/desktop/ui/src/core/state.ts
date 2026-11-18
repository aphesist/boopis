/* The typed `HX.state` and `setState`. A patch is validated against the allowed values, merged, persisted, and
   announced as `hx:state`. The shell registers hooks to apply the DOM before the event goes out (every module that
   listens then sees the applied state) and to record history and queue a layout after it. */
import { emit } from './bus';
import { DOCK, LEFT, RIGHT, TABS, COLLAPSE, loadShell, writeJSON, KEYS } from './settings';
import type { CollapseMode, Tab } from './settings';
import type { AppState, ThemeScheme } from './types';
import { themeApi } from '../styles/theme';

export type { AppState };

export interface Prefs { collapse: CollapseMode }

const saved = loadShell();
const query = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();
const pick = <T extends string>(k: string, allowed: readonly T[], fallback: T): T => {
  const q = query.get(k);
  if (q && (allowed as readonly string[]).includes(q)) return q as T;
  const s = (saved as Record<string, unknown>)[k];
  if (typeof s === 'string' && (allowed as readonly string[]).includes(s)) return s as T;
  return fallback;
};
const hashTab: Tab | null = (TABS as readonly string[]).includes((location.hash || '').slice(1)) ? (location.hash.slice(1) as Tab) : null;
const innerW = typeof window !== 'undefined' ? window.innerWidth || 1920 : 1920;
const narrowAtBoot = innerW < 900;

/** the live state object: modules read it, only `setState` writes it */
export const state: AppState = {
  tab: hashTab ?? pick('tab', TABS, 'session'),
  left: pick('left', LEFT, narrowAtBoot ? (innerW < 640 ? 'closed' : 'rail') : 'open'),
  right: pick('right', RIGHT, 'closed'),
  dock: pick('dock', DOCK, 'on'),
  theme: themeApi.scheme(),
  orbGrow: saved.orbGrow !== false
};
export const prefs: Prefs = { collapse: saved.collapse && COLLAPSE.includes(saved.collapse) ? saved.collapse : 'rail' };
export const urlQuery = query;

export function saveState(): void {
  writeJSON(KEYS.shell, { tab: state.tab, left: state.left, right: state.right, dock: state.dock, theme: state.theme, collapse: prefs.collapse, orbGrow: state.orbGrow });
}

export interface StatePatch {
  tab?: string; left?: string; right?: string; dock?: string; orbGrow?: boolean;
  /** 'light' or 'dark' pick the Bone or Card catalog preset; any other value is a preset id */
  theme?: string;
  /** set by back and forward so history is not pushed again */
  _fromHistory?: boolean;
}
export interface StateHooks {
  apply(changed: ReadonlyArray<keyof AppState>): void;
  after(changed: ReadonlyArray<keyof AppState>, patch: StatePatch): void;
}
let hooks: StateHooks | null = null;
export function setStateHooks(h: StateHooks): void { hooks = h; }

/* while modules mount, the initial tab stays the shell's decision */
let mounting = false;
export function setMounting(v: boolean): void { mounting = v; }

const KEYS_OF_STATE: ReadonlyArray<keyof AppState> = ['tab', 'left', 'right', 'dock', 'theme', 'orbGrow'];
const has = (a: readonly string[], v: string | undefined): v is string => !!v && a.includes(v);

export function setState(input: StatePatch): Readonly<AppState> {
  let patch = input;
  if (mounting && patch.tab) { patch = { ...patch }; delete patch.tab; }
  const next: Partial<AppState> = {};
  if (has(TABS, patch.tab)) next.tab = patch.tab as Tab;
  if (has(LEFT, patch.left)) next.left = patch.left as AppState['left'];
  if (has(RIGHT, patch.right)) next.right = patch.right as AppState['right'];
  if (has(DOCK, patch.dock)) next.dock = patch.dock as AppState['dock'];
  if (typeof patch.orbGrow === 'boolean') next.orbGrow = patch.orbGrow;
  if (patch.theme) {
    const id = patch.theme === 'light' ? 'bone' : patch.theme === 'dark' ? 'catalog' : patch.theme;
    if (themeApi.presets[id]) themeApi.preset(id);
    patch = { ...patch }; delete patch.theme;   // state.theme follows hx:theme
  }
  const changed = KEYS_OF_STATE.filter((k) => k in next && state[k] !== next[k]);
  if (!changed.length) return state;
  Object.assign(state, next);
  hooks?.apply(changed);
  saveState();
  emit('hx:state', { state, changed });
  if (changed.includes('tab')) emit('hx:tab', { tab: state.tab });
  hooks?.after(changed, patch);
  return state;
}

/** the theme follows `hx:theme`: the shell calls this when the scheme changes */
export function followScheme(scheme: ThemeScheme): void {
  if (state.theme === scheme) return;
  state.theme = scheme;
  saveState();
  emit('hx:state', { state, changed: ['theme'] });
}

export function toggle(key: 'left' | 'right' | 'dock' | 'tab'): Readonly<AppState> {
  if (key === 'left') return setState({ left: state.left === 'open' ? prefs.collapse : 'open' });
  if (key === 'right') return setState({ right: state.right === 'open' ? 'closed' : 'open' });
  if (key === 'dock') return setState({ dock: state.dock === 'on' ? 'off' : 'on' });
  return setState({ tab: state.tab === 'session' ? 'bots' : 'session' });
}

/* the last layout the shell computed (`HX.layout`); the dock and the shell's Esc rules read it */
import type { Layout } from './types';
let layout: Layout | null = null;
export const setLayout = (l: Layout): void => { layout = l; };
export const getLayout = (): Layout | null => layout;
