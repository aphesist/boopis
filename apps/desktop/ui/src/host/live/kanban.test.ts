import { describe, expect, it } from 'vitest';
import { liveKanban } from './kanban';
import type { KanbanBoard, KanbanView } from '../bindings';

const b: KanbanBoard = { slug: 'paper-past', name: 'Paper past', archived: false, counts: { todo: 2, done: 1 } };
const view = { board: b, tasks: [{ id: 't_1', title: 'Fact-check', status: 'running', assignee: 'kai', priority: 1, created_at: 1700000000, started_at: 1700000100, completed_at: null, problem: null }] } as unknown as KanbanView;

describe('the kanban source over the host', () => {
  it('maps boards and a board\'s tasks to the data layer\'s names', async () => {
    const k = liveKanban({ kanbanBoards: () => Promise.resolve([b]), kanbanView: (s) => { expect(s).toBe('paper-past'); return Promise.resolve(view); } });
    expect(await k.boards()).toEqual([{ slug: 'paper-past', name: 'Paper past', archived: false, counts: { todo: 2, done: 1 } }]);
    const v = await k.view('paper-past');
    expect(v.tasks[0]).toEqual({ id: 't_1', title: 'Fact-check', status: 'running', assignee: 'kai', priority: 1, createdAt: 1700000000, startedAt: 1700000100, completedAt: null, problem: null });
  });
  it('rejects with the host\'s sentence', async () => {
    const k = liveKanban({ kanbanBoards: () => Promise.reject({ code: 'hx.engine.unavailable', message: 'The board could not be read.' }), kanbanView: () => Promise.reject(new Error('x')) });
    await expect(k.boards()).rejects.toMatchObject({ message: 'The board could not be read.' });
  });
});
