/* The typed event bus: `HX.on/emit` of the v6 mock-up, with every event name and payload in one map.
   `on` returns its unsubscribe; a handler that throws is logged and never stops the others. */
import { logger } from './log';
import type { AppState, Layout, Tab, ThemeScheme } from './types';

const log = logger('bus');

export type PanelName = 'context' | 'tasks' | 'changes' | 'output' | 'governance' | 'connectors' | 'environment';
export type RegionName = 'bar' | 'list' | 'messages' | 'composer' | 'panel' | 'dock';
export type DockMode = 'off' | 'minimal' | 'normal' | 'expanded' | 'edit';

export interface EventMap {
  /** the shell emits on every layout change; the composer and the dock centre themselves on `centerX` */
  'hx:layout': Layout;
  'hx:state': { state: Readonly<AppState>; changed: ReadonlyArray<keyof AppState>; initial?: boolean };
  'hx:tab': { tab: Tab; initial?: boolean };
  'hx:theme': { preset: string; scheme: ThemeScheme };
  /** a preview of colours started or ended (`theme.preview`, `theme.endPreview`) */
  'hx:theme-preview': { previewing: boolean };
  'hx:ready': { state: Readonly<AppState> };
  'hx:bot-select': { id: string; from?: string; source?: string };
  'hx:session-select': { id: string; from?: string; title?: string; project?: string };
  'hx:title': { tab?: Tab; title?: string | null; text?: string; project?: string };
  /** something needs the user: the shell and the dock show a dot */
  'hx:attention': { source: string; count: number; tab?: Tab; ids?: readonly string[] };
  'hx:open-panel': { panel: PanelName | string; from?: string; source?: string };
  'hx:new': { tab: Tab };
  'hx:new-session': { from?: string; project?: string };
  'hx:new-bot': { from?: string; source?: string };
  'hx:new-group': { from?: string };
  'hx:nav': { action: 'first' | 'last'; region: RegionName | null };
  'hx:region': { region: RegionName };
  /** a surface asks the shell to open Settings at a section (`models`) */
  'hx:open-settings': { section: string; from?: string };
  'hx:bot-settings': { open?: boolean; toggle?: boolean; from?: string };
  'hx:view-inset': { tab?: Tab; left?: number; right?: number; source?: string };
  'hx:toast': { text?: string; message?: string };
  /** the dock reports its size: the room the composer keeps above it */
  'hx:dock': { mode: DockMode; page: string; width: number; height: number; /** the slab at rest, without the hover headroom */ rest?: number };
  'hx:dock-expand': { toggle: boolean; from: string };
  /** the title bar's controls changed (the setting, or the host's answer); the lab sends it to draw a layout */
  'hx:window-controls': { layout: 'close' | 'all' | 'mac' };
  'hx:governance': { governed: boolean; smart: boolean; model: string; cap: string };
}
export type EventName = keyof EventMap;
export type Handler<K extends EventName> = (detail: EventMap[K]) => void;

const handlers = new Map<EventName, Set<Handler<never>>>();

export function on<K extends EventName>(type: K, fn: Handler<K>): () => void {
  let set = handlers.get(type);
  if (!set) { set = new Set(); handlers.set(type, set); }
  set.add(fn as Handler<never>);
  return () => off(type, fn);
}
export function off<K extends EventName>(type: K, fn: Handler<K>): void {
  handlers.get(type)?.delete(fn as Handler<never>);
}
export function emit<K extends EventName>(type: K, detail: EventMap[K]): void {
  const set = handlers.get(type);
  if (!set) return;
  for (const fn of [...set]) {
    try { (fn as Handler<K>)(detail); } catch (err) { log.error('handler for ' + type + ' failed', err); }
  }
}
/** test hook: drop every handler (unit tests only) */
export function resetBus(): void { handlers.clear(); }
