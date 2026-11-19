/* The bots module's view model: local copies of the provider's bots and threads, kept current by its events.
   The copies are mutated in place (closures in the settings sheet hold them); the provider stays the source of truth. */
import { emit } from '../../core/bus';
import { state } from '../../core/state';
import { ui } from '../../components';
import type { Bot, BotsEvent, ThreadMessage } from '../../data';
import type { Follower } from './orbs';
import { data } from '../../data';

export interface Draft { name: string; role: string; color: string; shape: string; tab: string }
type Row = { li: HTMLElement; btn: HTMLElement };
export interface RunMark { id: string }

export const S = {
  bots: [] as Bot[], threads: {} as Record<string, ThreadMessage[]>, sel: null as string | null, view: 'bot' as 'bot' | 'new',
  listRoot: null as HTMLElement | null, listWrap: null as HTMLElement | null, rowsEl: null as HTMLElement | null, viewRoot: null as HTMLElement | null, rows: new Map<string, Row>(),
  room: null as HTMLElement | null, newPane: null as HTMLElement | null, sheet: null as HTMLElement | null, presence: null as (HTMLElement & { _hover?: boolean; _held?: boolean }) | null, presenceEl: null as HTMLElement | null,
  scroll: null as HTMLElement | null, log: null as HTMLElement | null, zone: null as HTMLElement | null, pLine: null as HTMLElement | null, pActs: null as HTMLElement | null,
  composer: null as import('../../components').ComposerEl | null, transient: null as string | null, typing: false,
  follow: null as Follower | null,
  /** the new-bot preview's own follower, disposed when the form is built again */
  newFollow: null as Follower | null,
  draft: null as Draft | null, draftRow: null as { li: HTMLElement; o: HTMLElement; name: HTMLElement; btn: HTMLElement } | null,
  runs: new Set<string>(),
  /** the Archived group under the roster, and the way to stop listening to the provider's archived bots */
  archivedEl: null as HTMLElement | null, offArchived: null as (() => void) | null,
  sheetOpen: false, sheetFor: null as string | null, sheetReturn: null as Element | null
};

export function initModel(): void {
  if (S.bots.length) return;
  const snap = data().bots.snapshot();
  S.bots = snap.bots.map((b) => ({ ...b, cfg: { ...b.cfg, channels: { ...b.cfg.channels }, approvals: { ...b.cfg.approvals } } }));
  S.threads = Object.fromEntries(Object.entries(snap.threads).map(([k, v]) => [k, [...v]]));
  S.sel = (S.bots.find((b) => b.attention) ?? S.bots[0])?.id ?? null;
}
/** the sidebar is a rail of orbs: names and states move into tooltips */
export const railOn = (): boolean => state.left === 'rail';
export const bot = (id: string | null | undefined): Bot | undefined => S.bots.find((b) => b.id === id);
export const thread = (id: string): ThreadMessage[] => (S.threads[id] ??= []);
export const pending = (): Bot[] => S.bots.filter((b) => b.attention);
/** the one state map (ui.botState); a transient reaction (listening while you type) overlays it */
export const stateOf = (b: Bot, transient: string | null) => ui.botState(transient && !b.attention ? { ...b, state: transient } : b);
export const BUSY_STATES = new Set(['working', 'thinking', 'speaking', 'compute']);

export function announceAttention(): void {
  /* preview bots are sample data: what they "need" never counts as something that needs you */
  const p = data().info.preview.has('bots') ? [] : pending();
  emit('hx:attention', { source: 'bots', tab: 'bots', count: p.length, ids: p.map((b) => b.id) });
}

export type { BotsEvent };
