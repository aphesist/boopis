/* The tasks a session hands to other models, from the engine's `subagent.*` frames on the parent's session. Pure: a frame in,
   the child's new state out, so it is tested against recorded shapes. The frames carry a delegation, a task index and (once the
   child exists) a subagent id; `spawn_requested` has no id yet, so a child is found by its id when there is one, else by the
   delegation and task index it was requested with. Nothing is invented: a field the engine did not send stays as it was. */
import type { ChildStatus, ChildTask } from '../../data/types';
import type { SubagentEventPayload } from '../../vendor/hermes-shared/gateway-contract.generated';

export const SUBAGENT_EVENTS = ['subagent.spawn_requested', 'subagent.start', 'subagent.progress', 'subagent.thinking', 'subagent.tool', 'subagent.complete'] as const;
export const isSubagentEvent = (type: string): boolean => (SUBAGENT_EVENTS as readonly string[]).includes(type);

const TERMINAL: ReadonlySet<ChildStatus> = new Set(['done', 'failed', 'stopped']);
export const isLive = (c: Pick<ChildTask, 'status'>): boolean => !TERMINAL.has(c.status);

/** the engine's status word as the card's */
export function statusOf(s: string | null | undefined): ChildStatus {
  switch (s) {
    case 'completed': return 'done';
    case 'failed': case 'error': case 'timeout': return 'failed';
    case 'interrupted': return 'stopped';
    case 'queued': return 'queued';
    default: return 'running';
  }
}

const clip = (t: string, n = 140): string => { const one = t.replace(/\s+/g, ' ').trim(); return one.length > n ? one.slice(0, n - 1) + '…' : one; };
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
type Delegation = SubagentEventPayload & { delegation_id?: string | null };

function find(list: readonly ChildTask[], p: Delegation): number {
  const id = str(p.subagent_id);
  if (id) {
    const byId = list.findIndex((c) => c.subagentId === id);
    if (byId >= 0) return byId;
  }
  /* no id yet (or one this list has not seen): the task this delegation asked for, which has no id of its own yet */
  const d = str(p.delegation_id);
  return list.findIndex((c) => c.subagentId === '' && c.index === (p.task_index ?? 0) && (c.id.startsWith(d + ':') || (!d && c.id.startsWith(':'))));
}

/** one `subagent.*` frame folded into the turn's children: the new list and the child it touched */
export function foldChild(list: readonly ChildTask[], type: string, p: Delegation, now: number): { list: ChildTask[]; child: ChildTask } | null {
  if (!isSubagentEvent(type)) return null;
  const at = find(list, p);
  const prev = at >= 0 ? list[at] : undefined;
  const index = p.task_index ?? 0;
  const base: ChildTask = prev ?? { id: (str(p.delegation_id) + ':' + index) || ':' + index, subagentId: '', childSession: '', index, goal: '', model: '', status: 'queued', startedAt: null, seconds: null, tools: 0, now: '', summary: '' };
  const next: ChildTask = { ...base };
  if (str(p.subagent_id) && !next.subagentId) { next.subagentId = str(p.subagent_id); next.id = next.subagentId; }
  if (str(p.goal)) next.goal = str(p.goal);
  if (str(p.model)) next.model = str(p.model);
  if (str(p.child_session_id)) next.childSession = str(p.child_session_id);
  if (typeof p.tool_count === 'number') next.tools = p.tool_count;
  if (!isLive(prev ?? next) && type !== 'subagent.complete') return { list: [...list], child: base };   /* a late frame never revives a child that ended */
  switch (type) {
    case 'subagent.spawn_requested': next.status = 'queued'; break;
    case 'subagent.start': next.status = 'running'; next.startedAt ??= now; break;
    case 'subagent.tool': {
      next.status = 'running'; next.startedAt ??= now;
      const tool = str(p.tool_name), preview = str(p.tool_preview) || str(p.text);
      next.now = clip((tool + ' ' + (preview && preview !== tool ? preview : '')).trim());
      if (typeof p.tool_count !== 'number') next.tools = prev ? prev.tools + 1 : 1;
      break;
    }
    case 'subagent.thinking': case 'subagent.progress': {
      next.status = 'running'; next.startedAt ??= now;
      if (str(p.text)) next.now = clip(str(p.text));
      break;
    }
    case 'subagent.complete': {
      next.status = statusOf(p.status ?? 'completed');
      next.now = '';
      next.summary = str(p.summary) || (next.status === 'failed' ? 'It ended without saying why.' : next.status === 'stopped' ? 'Stopped before it finished.' : '');
      next.seconds = typeof p.duration_seconds === 'number' ? p.duration_seconds : null;
      break;
    }
  }
  const out = [...list];
  if (at >= 0) out[at] = next; else out.push(next);
  return { list: out, child: next };
}

/** "12s", "1m 04s": how long a child has run (live) or ran (ended) */
export function childTime(c: Pick<ChildTask, 'startedAt' | 'seconds' | 'status'>, now: number): string | undefined {
  const s = c.seconds ?? (c.startedAt != null && isLive(c) ? Math.max(0, Math.round((now - c.startedAt) / 1000)) : null);
  if (s == null) return undefined;
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
}
