/* A session's kept ships as the thread reads them (ADR-0058; docs/specs/checkpoint-rewind.md section 8): which agent
   turn kept which ships (what "Rewind files to here" goes back to), the rewinds as lines between the turns, and the
   head a rewind expects. Read from `checkpoint.list {chain: true}` on a resume; the live path adds to it as
   `ship.completed` and `checkpoint.rewound` arrive. Pure. */
import type { AgentTurn, Turn } from '../../data/types';
import type { ThreadLine } from '../../data/session-s0';

export interface CheckpointWire { ship_id: string; files?: string[]; ts?: string; kind?: string; session_id?: string; turn_id?: string; rewind_to?: string }

/** the checkpoints from `checkpoint.list`'s answer, the malformed ones left out */
export function checkpointsFrom(res: unknown): CheckpointWire[] {
  const list = (res as { checkpoints?: unknown } | null)?.checkpoints;
  return Array.isArray(list) ? (list as CheckpointWire[]).filter((c) => typeof c?.ship_id === 'string' && !!c.ship_id) : [];
}

const agents = (turns: readonly Turn[]): AgentTurn[] => turns.filter((t): t is AgentTurn => t.role === 'assistant');

/** each agent turn's kept ships (not rewinds), by the engine's turn id the plugin recorded on them */
export function keptByTurn(turns: readonly Turn[], entries: readonly CheckpointWire[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const byEngine = new Map(agents(turns).filter((t) => t.engineTurn).map((t) => [t.engineTurn as string, t.id]));
  for (const e of entries) {
    if (e.kind === 'rewind' || !e.turn_id) continue;
    const id = byEngine.get(e.turn_id);
    if (id) out.set(id, [...(out.get(id) ?? []), e.ship_id]);
  }
  return out;
}

/** the words for where a rewind went: "after turn 3", "before this session's changes"; a ship no turn here kept is "an earlier change" */
export function rewindLabel(turns: readonly Turn[], shipId: string | null): string {
  if (shipId === null) return 'before this session\'s changes';
  const list = agents(turns);
  const i = list.findIndex((t) => t.kept?.includes(shipId));
  return i >= 0 ? 'after turn ' + (i + 1) : 'after an earlier change';
}

/** the rewinds as lines, each after the turn it followed; only the last change of the session offers its undo */
export function rewindLines(turns: readonly Turn[], entries: readonly CheckpointWire[]): ThreadLine[] {
  const byEngine = new Map(agents(turns).filter((t) => t.engineTurn).map((t) => [t.engineTurn as string, t.id]));
  const lines: ThreadLine[] = [];
  let head: string | null = null, before: string | null = null;
  entries.forEach((e, i) => {
    if (e.kind === 'rewind') {
      const to = e.rewind_to === 'base' || e.rewind_to == null ? null : e.rewind_to;
      const undone = before !== null && to === before;
      lines.push({
        kind: 'checkpoint', id: 'rw-' + e.ship_id, afterTurn: e.turn_id ? byEngine.get(e.turn_id) ?? null : null, at: e.ts ?? '',
        action: undone ? 'undone' : 'rewound', to: { shipId: to, label: rewindLabel(turns, to) }, files: e.files?.length ?? 0,
        rewindShipId: e.ship_id, undoShipId: i === entries.length - 1 ? head : null
      });
    }
    before = head;
    head = e.ship_id;
  });
  return lines;
}

/** the head checkpoint a rewind expects: the last kept ship */
export const headOf = (entries: readonly CheckpointWire[]): string | null => entries[entries.length - 1]?.ship_id ?? null;
