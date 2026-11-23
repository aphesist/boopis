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
/* The sidebar follows the window until the person sets it: closed on a phone, a rail when narrow, open from 900px. A frame can
   boot small and grow (the claude.ai artifact viewer mounts its iframe small), so the width at boot decides nothing for good:
   the shell re-reads the width on every resize while the sidebar is automatic. What is stored never breaks the layout: a stored
   choice is only honoured when the person made it (older stores without `leftBy` are ignored), and a stored open sidebar or
   details panel never boots as an overlay over the work. */
export const autoLeft = (w: number): AppState['left'] => (w < 640 ? 'closed' : w < 900 ? 'rail' : 'open');
const queryLeft = (LEFT as readonly string[]).includes(query.get('left') ?? '') ? (query.get('left') as AppState['left']) : null;
const userLeft = saved.leftBy === 'user' && saved.left && LEFT.includes(saved.left) && !(saved.left === 'open' && innerW < 900) ? saved.left : null;
let leftAuto = !queryLeft && !userLeft;
export const isLeftAuto = (): boolean => leftAuto;

/** the live state object: modules read it, only `setState` writes it */
export const state: AppState = {
  tab: hashTab ?? pick('tab', TABS, 'session'),
  left: queryLeft ?? userLeft ?? autoLeft(innerW),
  right: innerW < 1200 && !query.get('right') ? 'closed' : pick('right', RIGHT, 'closed'),
  dock: pick('dock', DOCK, 'on'),
  theme: themeApi.scheme(),
  orbGrow: saved.orbGrow !== false,
  dockCentred: saved.dockCentred === true
};
export const prefs: Prefs = { collapse: saved.collapse && COLLAPSE.includes(saved.collapse) ? saved.collapse : 'rail' };
export const urlQuery = query;

export function saveState(): void {
  /* the sidebar is stored only once the person has set it; while it follows the window it is not */
  writeJSON(KEYS.shell, { tab: state.tab, left: leftAuto ? undefined : state.left, leftBy: leftAuto ? undefined : 'user', right: state.right, dock: state.dock, theme: state.theme, collapse: prefs.collapse, orbGrow: state.orbGrow, dockCentred: state.dockCentred });
}

export interface StatePatch {
  tab?: string; left?: string; right?: string; dock?: string; orbGrow?: boolean; dockCentred?: boolean;
  /** 'light' or 'dark' pick the Bone or Card catalog preset; any other value is a preset id */
  theme?: string;
  /** set by back and forward so history is not pushed again */
  _fromHistory?: boolean;
  /** the shell following the window's width, not a choice of the person's */
  _auto?: boolean;
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

const KEYS_OF_STATE: ReadonlyArray<keyof AppState> = ['tab', 'left', 'right', 'dock', 'theme', 'orbGrow', 'dockCentred'];
const has = (a: readonly string[], v: string | undefined): v is string => !!v && a.includes(v);

export function setState(input: StatePatch): Readonly<AppState> {
  let patch = input;
  const auto = !!patch._auto;
  if (mounting && patch.tab) { patch = { ...patch }; delete patch.tab; }
  const next: Partial<AppState> = {};
  if (has(TABS, patch.tab)) next.tab = patch.tab as Tab;
  if (has(LEFT, patch.left)) next.left = patch.left as AppState['left'];
  if (has(RIGHT, patch.right)) next.right = patch.right as AppState['right'];
  if (has(DOCK, patch.dock)) next.dock = patch.dock as AppState['dock'];
  if (typeof patch.orbGrow === 'boolean') next.orbGrow = patch.orbGrow;
  if (typeof patch.dockCentred === 'boolean') next.dockCentred = patch.dockCentred;
  if (patch.theme) {
    const id = patch.theme === 'light' ? 'bone' : patch.theme === 'dark' ? 'catalog' : patch.theme;
    if (themeApi.presets[id]) themeApi.preset(id);
    patch = { ...patch }; delete patch.theme;   // state.theme follows hx:theme
  }
  if ('left' in next && !auto) leftAuto = false;   /* the person set it: it stays, and it is stored */
  const changed = KEYS_OF_STATE.filter((k) => k in next && state[k] !== next[k]);
  if (!changed.length) { if ('left' in next && !auto) saveState(); return state; }
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

/** the shell calls this when the window's width changes: an automatic sidebar follows it, and an open one the person chose does
    not turn into an overlay by itself when the window narrows past 900px: it goes back to following the window */
export function followWindowWidth(W: number, wasW: number): void {
  if (!leftAuto && state.left === 'open' && W > 0 && W < 900 && wasW >= 900) leftAuto = true;
  if (leftAuto && W > 0 && state.left !== autoLeft(W)) setState({ left: autoLeft(W), _auto: true });
}
