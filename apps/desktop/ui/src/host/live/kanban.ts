/* The kanban boards of the engine, read only, for a group's board view: the host asks the engine's own command
   (`src-tauri/src/kanban.rs`) and this maps what it says. Nothing here changes a board: there is no call that moves a task. */
import { commands } from '../bindings';
import type { KanbanBoard, KanbanView as HostView } from '../bindings';
import { asHostError } from '../bridge';
import type { KanbanBoardInfo, KanbanView } from '../../data/types';
import type { KanbanSource } from '../../data/provider';

const board = (b: KanbanBoard): KanbanBoardInfo => ({ slug: b.slug, name: b.name, archived: b.archived, counts: { ...b.counts } });
export const viewFrom = (v: HostView): KanbanView => ({
  board: board(v.board),
  tasks: v.tasks.map((t) => ({
    id: t.id, title: t.title, status: t.status, assignee: t.assignee ?? null, priority: t.priority,
    createdAt: t.created_at ?? null, startedAt: t.started_at ?? null, completedAt: t.completed_at ?? null, problem: t.problem ?? null
  }))
});

export interface KanbanCommands { kanbanBoards(): Promise<KanbanBoard[]>; kanbanView(slug: string): Promise<HostView> }

export function liveKanban(host: KanbanCommands = commands): KanbanSource {
  return {
    boards: async () => { try { return (await host.kanbanBoards()).map(board); } catch (e) { throw asHostError(e); } },
    view: async (slug) => { try { return viewFrom(await host.kanbanView(slug)); } catch (e) { throw asHostError(e); } }
  };
}
