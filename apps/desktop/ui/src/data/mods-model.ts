/* What a session's mods draw, as a model: the `mod.*` events of the plugin (docs/PROTOCOL.md section 3, the shapes are
   `apps/shared/data/mods.schema.json`) folded into one `ModSession` per session. Pure: no client, no DOM. The live provider
   (`host/live/mods.ts`) feeds it from the gateway and adds the commands; the tests feed it recorded events.
   Only what the plugin really sends is drawn. A site the app has no drawing for (the redraw sites of Claude Code's own
   parts, the backdrop) is ignored and logged, never pretended. */
import type { ModDrawing, ModLogLine, ModPane, ModPlaced, ModSession, ModTheme, ModTree, ModsEvent } from './types';
import { emitter, store } from './store';
import type { Store } from './store';
import type { ModsSource } from './provider';

export const NO_MODS: ModSession = { active: false, plugins: [], stopped: '', panes: [], band: null, status: [], log: [], placed: [], theme: null };
/** the log keeps this many lines: a chatty mod cannot grow the page without end */
export const LOG_MAX = 200;
/** the sites that draw the band above the composer */
const BAND_SITES: readonly string[] = ['AbovePrompt', 'AbovePromptList'];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

const isTree = (v: unknown): v is ModTree => !!v && typeof v === 'object' && typeof (v as ModTree).type === 'string';
/** the drawing a `mod.render` payload carries */
export function drawingOf(p: Obj): ModDrawing {
  const kind = p['kind'];
  if (kind === 'tree') return isTree(p['tree']) ? { kind: 'tree', tree: p['tree'] } : { kind: 'skipped', reason: 'the plugin sent a tree that is not an element' };
  if (kind === 'skipped') return { kind: 'skipped', reason: str(p['reason'], 'the tree was refused') };
  return { kind: 'default' };
}

type WithoutSession = ModsEvent extends infer E ? (E extends unknown ? Omit<E, 'sessionId'> : never) : never;
export interface Reduced {
  state: ModSession;
  /** a toast or a notification the event carried */
  event?: WithoutSession;
  /** the event was ignored, and why (for the debug log) */
  ignored?: string;
}
export interface Clock { now: number; id: number }

const same = (a: ModDrawing | null, b: ModDrawing | null): boolean => a === b || (!!a && !!b && a.kind === b.kind && (a.kind === 'tree' ? a.tree === (b as typeof a).tree : a.kind === 'skipped' ? a.reason === (b as typeof a).reason : true));

/** one `mod.*` event folded into a session's state */
export function reduceMod(s: ModSession, type: string, payload: unknown, clock: Clock): Reduced {
  const p = obj(payload);
  const base: ModSession = s.active ? s : { ...s, active: true };
  switch (type) {
    case 'mod.pane': {
      const id = str(p['id']), plugin = str(p['plugin']);
      if (!id) return { state: s, ignored: 'a pane event with no id' };
      if (p['action'] === 'close') return { state: { ...base, panes: base.panes.filter((x) => x.id !== id) } };
      const old = base.panes.find((x) => x.id === id);
      const pane: ModPane = { id, plugin, title: str(p['title'], id), focus: p['focus'] === true, closeOnEscape: p['closeOnEscape'] === true, opens: (old?.opens ?? 0) + 1, drawing: old?.drawing ?? null };
      return { state: { ...base, panes: old ? base.panes.map((x) => (x.id === id ? pane : x)) : [...base.panes, pane] } };
    }
    case 'mod.render': {
      const component = str(p['component']), id = typeof p['id'] === 'string' ? p['id'] : null;
      const drawing = drawingOf(p);
      if (component === 'Pane') {
        const at = base.panes.find((x) => x.id === id);
        if (!at) return { state: s, ignored: 'a draw for a pane that is not open: ' + String(id) };
        if (same(at.drawing, drawing)) return { state: s };
        return { state: { ...base, panes: base.panes.map((x) => (x === at ? { ...x, drawing } : x)) } };
      }
      if (BAND_SITES.includes(component)) {
        /* the app has no drawing of its own for the band: "no mod drew it" is an empty band */
        const band = drawing.kind === 'default' ? null : { plugin: typeof p['plugin'] === 'string' ? p['plugin'] : null, drawing };
        if (band === null && base.band === null) return { state: s };
        return { state: { ...base, band } };
      }
      if (component === 'Placed' && id !== null) {
        const rest = base.placed.filter((x) => x.id !== id);
        if (drawing.kind !== 'tree') return { state: { ...base, placed: rest } };
        const placed: ModPlaced = { id, plugin: typeof p['plugin'] === 'string' ? p['plugin'] : null, tree: drawing.tree, at: base.placed.find((x) => x.id === id)?.at ?? clock.now };
        return { state: { ...base, placed: [...rest, placed] } };
      }
      return { state: s, ignored: 'a draw for ' + component + ', which this app does not draw yet' };
    }
    case 'mod.status': {
      const plugin = str(p['plugin']), text = str(p['text']);
      const rest = base.status.filter((x) => x.plugin !== plugin);
      if (!text) return { state: { ...base, status: rest } };
      const i = base.status.findIndex((x) => x.plugin === plugin);
      const next = { plugin, text };
      return { state: { ...base, status: i >= 0 ? base.status.map((x, j) => (j === i ? next : x)) : [...rest, next] } };
    }
    case 'mod.log': {
      const level = p['level'];
      /* debug lines go to the debug log: they are for whoever wrote the mod, not for the conversation */
      if (level === 'debug') return { state: s, ignored: 'a debug line: ' + str(p['text']) };
      const line: ModLogLine = { id: clock.id, plugin: str(p['plugin']), level: level === 'warn' ? 'warn' : 'info', text: str(p['text']), at: clock.now };
      return { state: { ...base, log: [...base.log, line].slice(-LOG_MAX) } };
    }
    case 'mod.theme': {
      if (p['action'] === 'clear') return { state: { ...base, theme: base.theme && base.theme.plugin === str(p['plugin']) ? null : base.theme } };
      const t = obj(p['theme']), colors: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj(t['colors']))) if (typeof v === 'string') colors[k] = v;
      const theme: ModTheme = { plugin: str(p['plugin']), colors, label: typeof t['label'] === 'string' ? t['label'] : null };
      return { state: { ...base, theme } };
    }
    case 'mod.toast': return { state: s, event: { type: 'toast', plugin: str(p['plugin']), text: str(p['text']), timeoutMs: typeof p['timeout_ms'] === 'number' ? p['timeout_ms'] : 4000 } };
    case 'mod.notify': return { state: s, event: { type: 'notify', plugin: str(p['plugin']), title: str(p['title']), text: str(p['text']) } };
    case 'mod.command': return { state: s, ignored: 'a mod command: the slash commands list it' };
    default: return { state: s, ignored: 'an event this app does not know: ' + type };
  }
}

/** one session's entry of `mod.list`: who is loaded, and whether the worker is gone. A stopped session draws nothing. */
export function applyList(s: ModSession, entry: unknown): ModSession {
  const e = obj(entry);
  const plugins = (Array.isArray(e['plugins']) ? e['plugins'] : []).map((x) => str(obj(x)['name'])).filter(Boolean);
  const stopped = str(e['exited']);
  if (stopped) return { ...NO_MODS, plugins: [], stopped, log: s.log };
  if (!plugins.length && !s.active) return s;
  return { ...s, active: s.active || plugins.length > 0, plugins, stopped: '' };
}

export interface ModsModel {
  /** the read half of `ModsSource` */
  source: Pick<ModsSource, 'session' | 'events'>;
  /** an event of one session */
  handle(sessionId: string, type: string, payload: unknown): Reduced;
  /** `mod.list`'s entry for one session (or null when the plugin has no mods for it) */
  list(sessionId: string, entry: unknown): void;
  state(sessionId: string): ModSession;
}

export function createModsModel(now: () => number = Date.now): ModsModel {
  const sessions = new Map<string, Store<ModSession>>();
  const events = emitter<ModsEvent>();
  let counter = 0;
  const of = (id: string): Store<ModSession> => { let s = sessions.get(id); if (!s) { s = store<ModSession>(NO_MODS); sessions.set(id, s); } return s; };
  return {
    source: { session: (id) => of(id), events: { subscribe: (fn) => events.subscribe(fn) } },
    state: (id) => of(id).get(),
    handle(id, type, payload) {
      const st = of(id), r = reduceMod(st.get(), type, payload, { now: now(), id: ++counter });
      if (r.state !== st.get()) st.set(r.state);
      if (r.event) events.emit({ ...r.event, sessionId: id } as ModsEvent);
      return r;
    },
    list(id, entry) { const st = of(id), next = applyList(st.get(), entry); if (next !== st.get()) st.set(next); }
  };
}
