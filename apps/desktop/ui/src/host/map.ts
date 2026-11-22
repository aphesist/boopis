/* Pure mappings from gateway frames and rows to the UI's entities (`data/types.ts`). No state, no I/O, so each one is
   tested against recorded frames. A field the gateway does not send is empty or `null` and the UI shows it as
   unknown (AGENTS.md invariant 5): nothing here invents a model name, a cost or a project. */
import type { SessionListRow, TranscriptMessage } from '../vendor/hermes-shared/gateway-contract.generated';
import type { AgentTurn, ApprovalWait, ChildTask, SessionSummary, Step, Turn, UserTurn, WaitOutcome } from '../data/types';
import type { GatewayEvent } from './gateway';
import { EMPTY_BOOK, answeredBy } from './live/attribution';
import type { TurnBook } from './live/attribution';
import { valueOfSlot } from './live/council';

const pad = (n: number): string => String(n).padStart(2, '0');
export const clock = (d: Date): string => pad(d.getHours()) + ':' + pad(d.getMinutes());
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "now", "5m", "2h", "yesterday", "mon", or a date: how long ago a session started, as the list shows it */
export function whenLabel(startedSeconds: number | null | undefined, now: Date): string {
  if (startedSeconds == null || !Number.isFinite(startedSeconds)) return '';
  const then = new Date(startedSeconds * 1000);
  const mins = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  if (mins < 24 * 60 && then.getDate() === now.getDate()) return Math.floor(mins / 60) + 'h';
  const days = Math.floor((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 1) return 'yesterday';
  if (days < 7) return DAYS[then.getDay()] ?? '';
  return pad(then.getDate()) + '/' + pad(then.getMonth() + 1);
}
const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** elapsed time as the turn header shows it: "3s", "1m 12s" */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

/** an engine value, not words: a tool call marker (`@@call name {...}`) or a JSON object or array (R-copy-9) */
const isEngineText = (t: string): boolean => /^@@\w/.test(t) || /^[{[]\s*"/.test(t);
/** the title a session row shows: its title, else its preview, skipping any that is an engine value (the gateway titles a session from its first line) */
export function sessionTitle(row: Pick<SessionListRow, 'title' | 'preview'>): string {
  for (const t of [row.title, row.preview]) { const w = (t ?? '').trim(); if (w && !isEngineText(w)) return w; }
  return 'Untitled session';
}

export function sessionRowToSummary(row: SessionListRow, now: Date): SessionSummary {
  return { id: row.id, project: '', title: sessionTitle(row), when: whenLabel(row.started_at, now) };
}

/** an answer's text as paragraphs: split on blank lines, empty ones dropped; a paragraph keeps the indent of its first line (code
    and nested lists read by the markdown renderer need it) and loses only the blank space around it */
export function paragraphs(text: string | null | undefined): string[] {
  return (text ?? '').split(/\n{2,}/).map((p) => p.replace(/^\s*\n/, '').trimEnd()).filter((p) => p.trim().length > 0);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** the step a tool call is: its name, and what it was asked to do */
export function toolStep(payload: Record<string, unknown> | undefined, time = ''): Step {
  const p = obj(payload);
  const name = str(p['name']) || str(p['tool_name']);
  const context = str(p['context']);
  const meta = context && context !== name ? [context] : [];
  return { title: name, mono: true, ...(meta.length ? { meta } : {}), time };
}

/** the step that records a tool call that failed */
export function failedStep(payload: Record<string, unknown> | undefined): Step {
  const p = obj(payload);
  const name = str(p['name']) || str(p['tool_name']);
  const seconds = typeof p['duration_s'] === 'number' ? elapsed(p['duration_s'] * 1000) : '';
  return { title: name + ' failed', kind: 'fail', time: seconds };
}

/** the engine's own note that the model changed ("[Model switched to X via provider Y ...]"): a stored user row, not a message
 *  the person wrote. The divider between two answers replaces it, so it is not a turn. */
const isModelSwitchNote = (r: TranscriptMessage, text: string): boolean => r.display_kind === 'model_switch' || /^\[Model switched to /.test(text);

/** the stored transcript as turns: each user message is a turn, and everything the agent did until the next one is a
 *  finished agent turn (its tool rows are its steps). Each agent turn says which model answered it from `book` (what the
 *  plugin recorded, by stored row); a turn the book does not list has an empty `model`: unknown, never the session's
 *  current model (invariant 5). */
export function transcriptToTurns(rows: readonly TranscriptMessage[], idPrefix: string, book: TurnBook = EMPTY_BOOK): Turn[] {
  const turns: Turn[] = [];
  let agent: { steps: Step[]; texts: string[]; rowIds: number[] } | null = null;
  let userRow: number | null = null;
  const flush = (): void => {
    if (!agent) return;
    const rec = [...(userRow !== null ? [userRow] : []), ...agent.rowIds].map((id) => book.get(id)).find((r) => r !== undefined);
    const id = idPrefix + 't' + turns.length;
    /* a council's turn: the engine named it by its preset ('moa/boopis-council'), which is not a model; the combiner answered */
    const council = rec?.council;
    const combiner = council?.combiner ? valueOfSlot(council.combiner) : '';
    const a: AgentTurn = {
      id, role: 'assistant', model: council ? combiner : rec ? answeredBy(rec) : '', ...(rec?.ungoverned ? { ungoverned: true } : {}), ...(council ? { ...(council.members.length ? { why: 'Council of ' + council.members.length } : {}), council } : {}),
      ...(rec?.children ? { children: rec.children.map((c, i): ChildTask => ({ ...c, id: id + ':k' + i })) } : {}),
      time: '', cost: '', stepCount: agent.steps.length, steps: agent.steps, paragraphs: agent.texts.flatMap((t) => paragraphs(t)), bullets: [], status: 'done'
    };
    turns.push(a);
    agent = null;
  };
  const rowOf = (r: TranscriptMessage): number[] => (typeof r.row_id === 'number' ? [r.row_id] : []);
  for (const r of rows) {
    const text = r.text ?? (typeof r.content === 'string' ? r.content : '');
    if (isModelSwitchNote(r, text ?? '')) continue;
    if (r.role === 'user') {
      flush();
      userRow = typeof r.row_id === 'number' ? r.row_id : null;
      const u: UserTurn = { id: idPrefix + 't' + turns.length, role: 'user', at: r.timestamp ? clock(new Date(r.timestamp * 1000)) : '', text: text ?? '' };
      turns.push(u);
    } else if (r.role === 'assistant') {
      agent ??= { steps: [], texts: [], rowIds: [] };
      agent.rowIds.push(...rowOf(r));
      if (text) agent.texts.push(text);
    } else if (r.role === 'tool') {
      agent ??= { steps: [], texts: [], rowIds: [] };
      agent.rowIds.push(...rowOf(r));
      agent.steps.push(toolStep({ name: r.name, context: r.context }));
    }
  }
  flush();
  return turns;
}

/** an `approval.request` event as a wait the dock shows */
export function approvalToWait(ev: GatewayEvent): ApprovalWait | null {
  const p = obj(ev.payload);
  const id = str(p['prompt_id']);
  if (!id) return null;
  const command = str(p['command']);
  const why = str(p['description']);
  return { id, kind: 'approval', bot: '', who: 'agent', title: command || why || 'Approval needed', data: { id, title: command || why, quote: command, meta: why, from: 'agent', item: [] } };
}

/** the gateway's choice for the UI's outcome: approved is "once", anything else is a denial (fail closed) */
export function choiceFor(outcome: WaitOutcome): 'once' | 'deny' {
  return outcome === 'approved' ? 'once' : 'deny';
}

/** what a ledger event adds to the running totals the details panel shows; unknown shapes add nothing */
export interface LedgerTotals { tokens: number; trips: number }
export function reduceLedger(totals: LedgerTotals, event: { type?: unknown; payload?: unknown }): LedgerTotals {
  if (event.type !== 'usage.recorded') return totals;
  const p = obj(event.payload);
  const n = (k: string): number => (typeof p[k] === 'number' ? p[k] : 0);
  const tokens = n('input_tokens') + n('output_tokens') + n('cache_read_tokens') + n('cache_write_5m_tokens') + n('cache_write_1h_tokens');
  return { tokens: totals.tokens + tokens, trips: totals.trips + 1 };
}
