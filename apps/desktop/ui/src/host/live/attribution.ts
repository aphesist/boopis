/* Who answered, per message, and the one-message "@" switch. The engine's transcript has no model column, so the plugin keeps a book
   of turns (`turns.bind` writes it when a turn completes, with the rows the engine stored for it; `turns.models` reads it back on a
   resume): a turn the book does not list is shown as unknown, never as the model the session has now (invariant 5).
   The one-message switch is `prompt.submit`'s `model_override` (model-switch.ts): that admission alone runs the mentioned model and
   the session's own model is never written, so the session's default and the sticky pick stay as they were and nothing is put back.
   In a governed session the plugin is told first (`mode.once`) to run the turn outside governed mode (ADR-0036). */
import { logger } from '../../core/log';
import type { ChildStatus, ChildTask, CouncilMember, CouncilTurn } from '../../data/types';
import type { GatewayClient } from '../gateway';
import { valueOfSlot } from './council';
import { splitValue } from './models';
import { overrideOf } from './model-switch';
import type { ModelOverride } from './model-switch';
import { isUnknownMethod } from './wire';

const log = logger('live.attribution');
const PLUGIN = 'plugin.boopis.';

/** one recorded turn: the model that answered ('provider/model'), the tiers a governed turn ran on, and the engine's rows */
export interface TurnRecord {
  model: string; route: readonly string[]; ungoverned: boolean; rowIds: readonly number[];
  /** what the turn showed besides its answer, as the plugin kept it (ADR-0034, ADR-0035); absent when the turn showed none */
  council?: CouncilTurn;
  children?: readonly RestoredChild[];
}
/** a task card read back: everything a card shows except its id, which the transcript gives it (`transcriptToTurns`) */
export type RestoredChild = Omit<ChildTask, 'id'>;
/** the recorded turns of a session by each stored row they own */
export type TurnBook = ReadonlyMap<number, TurnRecord>;
export const EMPTY_BOOK: TurnBook = new Map();

/** what a record says answered: the tiers in order for a governed turn, else the one model */
export const answeredBy = (r: TurnRecord): string => (r.route.length ? r.route.join(' → ') : r.model);

/* ───────── what the turn showed: the council and the task cards, as the turn book keeps them ───────── */

const isStr = (v: unknown): v is string => typeof v === 'string';
type Wire = Record<string, unknown>;
const wire = (v: unknown): v is Wire => !!v && typeof v === 'object' && !Array.isArray(v);

/** a council as `turns.bind` takes it: a model is 'provider/model', a state is a word. The members' text goes whole; the plugin
    caps it and says so (`cut`) */
export function councilToWire(c: CouncilTurn): Wire {
  return {
    members: c.members.map((m) => ({ model: valueOfSlot(m.slot), state: m.state, text: m.state === 'answered' ? m.text : '' })),
    combiner: c.combiner ? valueOfSlot(c.combiner) : null
  };
}
/** the task cards as `turns.bind` takes them (a card that is not yet done is sent as it stands; a resume draws it as stopped) */
export const childrenToWire = (list: readonly ChildTask[]): Wire[] => list.map((c) => ({
  model: c.model, goal: c.goal, status: c.status, summary: c.summary, child_session_id: c.childSession, tool_count: c.tools,
  ...(c.seconds != null ? { duration_ms: Math.round(c.seconds * 1000) } : {})
}));

/** a council read back: it is over. A member the book has as still waiting never reported, which a resume says as "did not answer" */
export function councilFromWire(v: unknown): CouncilTurn | undefined {
  if (!wire(v) || !Array.isArray(v['members'])) return undefined;
  const members: CouncilMember[] = [];
  for (const m of v['members'] as unknown[]) {
    if (!wire(m) || !isStr(m['model']) || !m['model']) continue;
    const answered = m['state'] === 'answered';
    members.push({ slot: splitValue(m['model']), state: answered ? 'answered' : 'failed', text: answered && isStr(m['text']) ? m['text'] : '', ...(answered && m['cut'] === true ? { cut: true } : {}) });
  }
  const done = members.filter((m) => m.state === 'answered').length;
  return { members, combiner: isStr(v['combiner']) && v['combiner'] ? splitValue(v['combiner']) : null, phase: 'done', done, total: members.length };
}

const STATUSES: ReadonlySet<string> = new Set<ChildStatus>(['queued', 'running', 'done', 'failed', 'stopped']);
/** the task cards read back: none is live, so one the book has as queued or running is drawn as stopped (never as working) */
export function childrenFromWire(v: unknown): RestoredChild[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: RestoredChild[] = [];
  for (const [index, c] of (v as unknown[]).entries()) {
    if (!wire(c) || !isStr(c['status']) || !STATUSES.has(c['status'])) continue;
    const live = c['status'] === 'queued' || c['status'] === 'running';
    out.push({
      subagentId: '', childSession: isStr(c['child_session_id']) ? c['child_session_id'] : '', index, goal: isStr(c['goal']) ? c['goal'] : '', model: isStr(c['model']) ? c['model'] : '',
      status: live ? 'stopped' : c['status'] as ChildStatus, startedAt: null, seconds: typeof c['duration_ms'] === 'number' ? c['duration_ms'] / 1000 : null,
      tools: typeof c['tool_count'] === 'number' ? c['tool_count'] : 0, now: '', summary: isStr(c['summary']) ? c['summary'] : '', ...(c['cut'] === true ? { cut: true } : {})
    });
  }
  return out.length ? out : undefined;
}

export function bookFrom(res: unknown): TurnBook {
  const list = (res as { turns?: unknown } | null)?.turns;
  const book = new Map<number, TurnRecord>();
  if (!Array.isArray(list)) return book;
  for (const t of list as Array<Record<string, unknown>>) {
    if (typeof t['model'] !== 'string' || !t['model'] || !Array.isArray(t['row_ids'])) continue;
    const rowIds = (t['row_ids'] as unknown[]).filter((n): n is number => typeof n === 'number');
    const council = councilFromWire(t['council']), children = childrenFromWire(t['children']);
    const rec: TurnRecord = { model: t['model'], route: Array.isArray(t['route']) ? (t['route'] as unknown[]).filter((x): x is string => typeof x === 'string') : [], ungoverned: t['ungoverned'] === true, rowIds, ...(council ? { council } : {}), ...(children ? { children } : {}) };
    for (const id of rowIds) book.set(id, rec);
  }
  return book;
}

/** the session's recorded turns; an empty book (every turn unknown) when the plugin cannot say */
export async function loadTurnBook(client: GatewayClient, gw: string): Promise<TurnBook> {
  try { return bookFrom(await client.requestRaw(PLUGIN + 'turns.models', { session_id: gw })); }
  catch (e) {
    /* a plugin that is older than this UI has no such method: its turns are unknown, which is not a fault to report */
    if (!isUnknownMethod(e)) log.warn('the models of the past turns could not be read; they show as unknown', e);
    return EMPTY_BOOK;
  }
}

/** what the turn showed, to be kept with it: the council's members and the task cards (the engine keeps neither) */
export interface Shown { council?: CouncilTurn | undefined; children?: readonly ChildTask[] | undefined }

/** `message.complete.persisted_turn`: bind the turn that just ended to its stored rows, with what it showed (best effort: a turn not bound is unknown) */
export function bindTurn(client: GatewayClient, gw: string, persisted: unknown, shown: Shown = {}): void {
  const p = persisted as { row_ids?: unknown; user_row_id?: unknown } | null | undefined;
  if (!p || !Array.isArray(p.row_ids) || !p.row_ids.length) return;
  client.requestRaw(PLUGIN + 'turns.bind', {
    session_id: gw, row_ids: p.row_ids, ...(typeof p.user_row_id === 'number' ? { user_row_id: p.user_row_id } : {}),
    ...(shown.council ? { council: councilToWire(shown.council) } : {}), ...(shown.children?.length ? { children: childrenToWire(shown.children) } : {})
  })
    .catch((e: unknown) => { if (!isUnknownMethod(e)) log.warn('the answering model of a turn was not recorded', e); });
}

export interface OnceDeps {
  client: GatewayClient;
  gw: string;
  /** the session is governed (the plugin's mode, fixed at its first prompt) */
  governed: boolean;
  pluginOk: boolean;
  /** no turn is running: the plugin's one-message exception is armed for the session's next turn, which must be this message's */
  idle: boolean;
  target: { provider: string; model: string };
  /** the target's readable name, for the words of a refusal */
  say: string;
}
export interface OnceRun {
  /** the message could not be submitted after all: take the arming back (the session's model was never changed) */
  abort(): Promise<void>;
  /** the turn runs outside governed mode */
  ungoverned: boolean;
  /** what `prompt.submit` carries as `model_override` for this message */
  override: ModelOverride;
}

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** set up the next turn to run on `target` only. Rejects (nothing armed) when it cannot, so the message is not sent to a model nobody chose */
export async function prepareOnce(d: OnceDeps): Promise<OnceRun> {
  if (!d.idle) throw new Error('A message to ' + d.say + ' goes out when the session is idle, so it was not sent. Wait for the answer, or stop it.');
  let armed = false;
  const disarm = async (): Promise<void> => {
    if (!armed) return;
    armed = false;
    try { await d.client.requestRaw(PLUGIN + 'mode.once', { session_id: d.gw, armed: false }); }
    catch (e) { log.warn('the one-message exception could not be withdrawn; it lapses on its own', e); }
  };
  if (d.governed) {
    if (!d.pluginOk) throw new Error('boopis\'s own part is not loaded, so this message cannot run outside governed mode, and was not sent.');
    try {
      const r = (await d.client.requestRaw(PLUGIN + 'mode.once', { session_id: d.gw, armed: true })) as { armed?: boolean } | null;
      if (r?.armed !== true) throw new Error('the plugin did not arm it');
      armed = true;
    } catch (e) { throw new Error('This message could not be set to run outside governed mode (' + why(e) + '), so it was not sent.'); }
  }
  return { abort: disarm, ungoverned: d.governed, override: overrideOf(d.target) };
}
