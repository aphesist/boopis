/* Provider patches for the kanban board view: the board of the mock's group ("release crew"), in the states the view draws. A
   fixed clock is not needed: every time is relative to now, so the words under a task ("started 1 h ago") stay the same. */
import type { DataProvider, KanbanBoardInfo, KanbanTask, KanbanView } from '../data';

const now = (): number => Math.floor(Date.now() / 1000);
const ago = (min: number): number => now() - min * 60;
const t = (id: string, title: string, status: string, assignee: string | null, o: Partial<KanbanTask> = {}): KanbanTask => ({ id, title, status, assignee, priority: 0, createdAt: ago(300), startedAt: null, completedAt: null, problem: null, ...o });

export const TASKS: readonly KanbanTask[] = [
  t('t_01', 'Publish the Tuesday issue', 'todo', null),
  t('t_02', 'Check the changelog against the merged pull requests', 'ready', 'nina', { createdAt: ago(200) }),
  t('t_03', 'Cut the release tag', 'running', 'atlas', { createdAt: ago(240), startedAt: ago(35) }),
  t('t_04', 'Write the announcement', 'running', 'kai', { createdAt: ago(240), startedAt: ago(12) }),
  t('t_05', 'Translate the announcement', 'blocked', 'nina', { createdAt: ago(180), startedAt: ago(90), problem: 'the translation model has no key' }),
  t('t_06', 'Review the migration notes', 'review', 'atlas', { createdAt: ago(1500), startedAt: ago(1400) }),
  t('t_07', 'Update the install guide', 'done', 'kai', { createdAt: ago(3000), startedAt: ago(2900), completedAt: ago(2800) })
];
const board = (slug: string, name: string, tasks: readonly KanbanTask[], archived = false): KanbanBoardInfo => ({ slug, name, archived, counts: tasks.reduce<Record<string, number>>((n, k) => ({ ...n, [k.status]: (n[k.status] ?? 0) + 1 }), {}) });

export interface Kanban { boards?: readonly KanbanBoardInfo[]; tasks?: readonly KanbanTask[]; slug?: string; failBoards?: string; failView?: string; never?: boolean }
export function withKanban(p: DataProvider, k: Kanban = {}): DataProvider {
  const tasks = k.tasks ?? TASKS;
  const slug = k.slug ?? 'release-crew';
  const boards = k.boards ?? [board('default', 'Default', []), board(slug, 'Release crew', tasks)];
  return {
    ...p,
    kanban: {
      boards: () => (k.never ? new Promise(() => undefined) : k.failBoards ? Promise.reject(new Error(k.failBoards)) : Promise.resolve(boards)),
      view: (s): Promise<KanbanView> => (k.failView ? Promise.reject(new Error(k.failView)) : Promise.resolve({ board: boards.find((b) => b.slug === s) ?? board(s, s, []), tasks: s === slug ? tasks : [] }))
    }
  };
}
export const MANY: readonly KanbanTask[] = Array.from({ length: 40 }, (_, i) => t('t_' + String(i + 10), 'Task number ' + String(i + 1) + ' of the quarterly close checklist', ['todo', 'ready', 'running', 'done'][i % 4] as string, ['atlas', 'nina', 'kai'][i % 3] as string, { createdAt: ago(60 + i * 30) }));
