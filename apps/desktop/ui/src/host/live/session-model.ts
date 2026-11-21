/* What the panels know about one session: a plain record the events and the reads fill in, and a reducer for the
   events. The reducer is pure apart from the record it is given. It reports which parts changed so the details source
   knows what to publish and what to fetch again. */
import type { Todo } from '../../data/types';
import type { GatewayEvent } from '../gateway';
import { isCouncilReport } from './council';
import { capLines, outputFor, shipLine, todosFrom } from './map-details';
import type { BlankWire, BreakdownWire, CascadeWire, DescribeWire, DiffWire, InfoWire, InventoryWire, ShipWire, StatsWire, TodoWire, UsageWire } from './wire';

export interface BlankState { id: string; question: string; options: readonly string[]; blocks: readonly string[]; answer: string | null; lapsed: boolean }
export interface SessionModel {
  todos: Todo[]; todoRevision: number;
  usage: UsageWire | null; breakdown: BreakdownWire | null; info: InfoWire | null;
  output: string[]; steps: number; running: boolean; stopped: boolean; turnStartedAt: number | null; turnEndedAt: number | null; title: string;
  /** a message was sent, so the mode is locked on the plugin's side from here */
  started: boolean;
  stats: StatsWire | null; cascade: CascadeWire | null; describe: DescribeWire | null; diff: DiffWire | null; inventory: InventoryWire | null;
  blanks: BlankState[];
  /** the mode the user chose before the first message (applied when the session is created on the gateway) */
  wantGoverned: boolean | null; wantModel: string | null;
  /** Smart is on: each message's model is chosen by the rule (`data/smart.ts`) */
  smart: boolean;
  /** the last turns, oldest first: did each fail (a tool error, a stopped turn, a ship rolled back) */
  history: boolean[]; turnFailed: boolean;
  /** the model the engine was last told to use for this session ('provider/model'), so a pick is switched once */
  appliedModel: string | null;
  /** the tier the plugin was last told to start on */
  appliedTier: string | null;
  /** the model that answered the last turn, as the engine reported it (`usage.model` of `message.complete`) */
  answered: string | null;
  /** a message went to one model only (an "@" mention): the model the session answers with by default, which the engine puts back
   *  after that turn; the engine's reports in between name the mentioned model and are not the session's. Cleared by the next send. */
  once: { default: string } | null;
  /** a council answers this turn, of this many members: the chip says so, and the engine's reports in between name its preset, not a model */
  council: number | null;
}

/** an engine report of the session's info without a model that is the council's preset (see `isCouncilReport`): the session's stays */
export function infoReport(info: InfoWire): InfoWire {
  if (!isCouncilReport(info.provider, info.model)) return info;
  const { model: _model, provider: _provider, ...rest } = info;
  return rest;
}
/** a usage report without a model that is the council's preset */
export function usageReport(usage: UsageWire): UsageWire {
  if (!isCouncilReport(null, usage.model)) return usage;
  const { model: _model, ...rest } = usage;
  return rest;
}
export function newModel(): SessionModel {
  return {
    todos: [], todoRevision: -1, usage: null, breakdown: null, info: null, output: [], steps: 0, running: false, stopped: false, turnStartedAt: null, turnEndedAt: null, title: '', started: false,
    stats: null, cascade: null, describe: null, diff: null, inventory: null, blanks: [], wantGoverned: null, wantModel: null,
    smart: false, history: [], turnFailed: false, appliedModel: null, appliedTier: null, answered: null, once: null, council: null
  };
}

export type Part = 'todos' | 'usage' | 'info' | 'output' | 'run' | 'blanks' | 'stats' | 'cascade' | 'diff';
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** apply one gateway or plugin event; the parts it changed */
export function applyEvent(m: SessionModel, ev: GatewayEvent, nowMs: number): Part[] {
  const p = obj(ev.payload);
  switch (ev.type) {
    case 'todo.updated': {
      const rev = typeof p['revision'] === 'number' ? p['revision'] : m.todoRevision + 1;
      if (rev < m.todoRevision) return []; // an older snapshot arriving late
      m.todoRevision = rev; m.todos = todosFrom(p['todos'] as TodoWire[] | undefined);
      return ['todos'];
    }
    case 'session.usage': { const u = p['usage']; if (u && typeof u === 'object') { m.usage = usageReport(u as UsageWire); return ['usage']; } return []; }
    case 'session.info': {
      const info = { ...(m.info ?? {}), ...infoReport(p as InfoWire) } as InfoWire;
      m.info = info;
      if (info.usage) m.usage = usageReport(info.usage);
      if (typeof p['turn_started_at'] === 'number' && m.running) m.turnStartedAt = p['turn_started_at'] * 1000;
      return ['info', 'usage'];
    }
    case 'message.start': m.turnFailed = false; m.running = true; m.stopped = false; m.steps = 0; m.turnStartedAt = nowMs; m.turnEndedAt = null; return ['run'];
    case 'tool.start': if (!m.running) { m.running = true; m.turnStartedAt ??= nowMs; } m.steps++; return ['run'];
    case 'tool.complete': if (p['is_error'] === true) m.turnFailed = true; m.output = capLines([...m.output, ...outputFor(p as Parameters<typeof outputFor>[0])]); return ['output'];
    case 'message.complete': {
      m.running = false; m.turnEndedAt = nowMs; m.stopped = typeof p['outcome'] === 'string' && p['outcome'] !== 'completed';
      if (p['usage'] && typeof p['usage'] === 'object') { m.usage = usageReport(p['usage'] as UsageWire); if (typeof m.usage.model === 'string' && m.usage.model) m.answered = m.usage.model; }
      m.history = [...m.history, m.turnFailed || m.stopped].slice(-6); m.turnFailed = false;
      return ['run', 'usage', 'stats', 'cascade', 'diff'];
    }
    case 'plugin.boopis.ship.completed': if ((p as { status?: string }).status === 'restored') m.turnFailed = true; m.output = capLines([...m.output, ...shipLine(p as unknown as ShipWire)]); return ['output', 'diff'];
    case 'plugin.boopis.cascade.updated': return ['cascade', 'stats'];
    case 'plugin.boopis.ledger.appended': return ['stats'];
    case 'plugin.boopis.blank.opened': {
      const b = p as unknown as BlankWire;
      if (!b.blank_id || m.blanks.some((x) => x.id === b.blank_id)) return [];
      m.blanks.push({ id: b.blank_id, question: b.question ?? '', options: b.options ?? [], blocks: b.blocks ?? [], answer: null, lapsed: false });
      return ['blanks'];
    }
    case 'plugin.boopis.blank.filled': {
      const b = m.blanks.find((x) => x.id === p['blank_id']);
      if (!b || b.answer !== null) return [];
      b.answer = typeof p['answer'] === 'string' ? p['answer'] : '';
      return ['blanks'];
    }
    case 'plugin.boopis.blank.lapsed': {
      const b = m.blanks.find((x) => x.id === p['blank_id']);
      if (!b || b.lapsed) return [];
      b.lapsed = true;
      return ['blanks'];
    }
    default: return [];
  }
}
