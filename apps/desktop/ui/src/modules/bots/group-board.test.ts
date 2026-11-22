// @vitest-environment jsdom
/* A group's kanban board: which board belongs to a group, the columns and what a task shows, and what the view says while it
   reads, when there is nothing, no board or an error. Read only: the source has no call that changes a task. */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProvider } from '../../data';
import type { KanbanBoardInfo, KanbanSource, KanbanTask, KanbanView } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { loadBoardChoice } from '../../core/settings';
import { ago, boardFor, columnsOf, mountBoard, slugOf, timeline } from './group-board';

const NOW = new Date('2026-11-22T12:00:00Z');
const sec = (iso: string): number => Date.parse(iso) / 1000;
const task = (o: Partial<KanbanTask>): KanbanTask => ({ id: 't1', title: 'Fact-check the draft', status: 'todo', assignee: null, priority: 0, createdAt: null, startedAt: null, completedAt: null, problem: null, ...o });
const board = (slug: string, o: Partial<KanbanBoardInfo> = {}): KanbanBoardInfo => ({ slug, name: slug, archived: false, counts: {}, ...o });
const tick = async (n = 6): Promise<void> => { for (let i = 0; i < n; i++) await Promise.resolve(); };

describe('which board belongs to a group', () => {
  it('writes a name as the engine writes a slug', () => {
    expect(slugOf('Paper Past!')).toBe('paper-past');
    expect(slugOf('  a  b ')).toBe('a-b');
    expect(slugOf('???')).toBe('');
  });
  it('takes the chosen board while it exists, else the one named like the group, else none', () => {
    const boards = [board('default'), board('paper-past'), board('old', { archived: true })];
    expect(boardFor('paper past', boards, null)).toBe('paper-past');
    expect(boardFor('paper past', boards, 'default')).toBe('default');
    expect(boardFor('paper past', boards, 'gone')).toBe('paper-past');
    expect(boardFor('news', boards, null)).toBeNull();
    expect(boardFor('old', boards, null)).toBeNull();
    expect(boardFor('old', boards, 'old')).toBe('old');
    expect(boardFor('x', [], null)).toBeNull();
  });
});

describe('the columns and the times', () => {
  it('lists the columns that hold tasks in the board\'s order and adds a state it does not know', () => {
    const cols = columnsOf([task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'running' }), task({ id: 'c', status: 'qa' }), task({ id: 'd', status: 'archived' }), task({ id: 'e', status: 'running' })]);
    expect(cols.map((c) => [c.key, c.tasks.length])).toEqual([['running', 2], ['done', 1], ['qa', 1]]);
    expect(cols[2]?.label).toBe('Qa');
  });
  it('says how long ago in words', () => {
    expect(ago(sec('2026-11-22T11:59:40Z'), NOW)).toBe('just now');
    expect(ago(sec('2026-11-22T11:55:00Z'), NOW)).toBe('5 min ago');
    expect(ago(sec('2026-11-22T09:00:00Z'), NOW)).toBe('3 h ago');
    expect(ago(sec('2026-11-20T12:00:00Z'), NOW)).toBe('2 days ago');
    expect(timeline(task({ createdAt: sec('2026-11-22T09:00:00Z'), startedAt: sec('2026-11-22T11:00:00Z'), completedAt: null }), NOW)).toBe('added 3 h ago · started 1 h ago');
    expect(timeline(task({}), NOW)).toBe('');
  });
});

function source(views: Record<string, KanbanView | Error>, boards = Object.keys(views).map((s) => board(s))): KanbanSource & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    boards: () => Promise.resolve(boards),
    view: (slug) => { reads.push(slug); const v = views[slug]; return v instanceof Error || !v ? Promise.reject(v ?? new Error('no board')) : Promise.resolve(v); }
  };
}
const v = (slug: string, tasks: KanbanTask[]): KanbanView => ({ board: board(slug), tasks });
function mount(src: KanbanSource | undefined, poll: number | null = null): { host: HTMLElement; view: ReturnType<typeof mountBoard> } {
  const host = document.createElement('div');
  document.body.append(host);
  return { host, view: mountBoard(host, { source: () => src, now: () => NOW, pollMs: poll }) };
}

beforeAll(() => { setProvider(createMockProvider({ simulate: false })); });
beforeEach(() => { document.body.replaceChildren(); try { localStorage.clear(); } catch { /* none */ } vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });

describe('the board view', () => {
  it('draws the columns with each task\'s assignee, times and state', async () => {
    const src = source({ 'paper-past': v('paper-past', [
      task({ id: 'a', title: 'Fact-check', status: 'running', assignee: 'kai', createdAt: sec('2026-11-22T09:00:00Z'), startedAt: sec('2026-11-22T11:00:00Z') }),
      task({ id: 'b', title: 'Translate', status: 'blocked', assignee: 'nina', problem: 'no key' }),
      task({ id: 'c', title: 'Publish', status: 'todo' })
    ]) });
    const { host, view } = mount(src);
    view.show({ id: 'g1', name: 'paper past' });
    await view.settled(); await tick();
    expect([...host.querySelectorAll('.ui-sec__label')].map((n) => n.textContent)).toEqual(['Todo', 'Running', 'Blocked']);
    const a = host.querySelector('[data-task="a"]') as HTMLElement;
    expect(a.textContent).toContain('Fact-check');
    expect(a.textContent).toContain('kai');
    expect(a.textContent).toContain('started 1 h ago');
    expect(a.querySelector('orb-avatar, .ui-orb')).toBeTruthy();
    expect(host.querySelector('[data-task="b"]')?.textContent).toContain('stopped: no key');
    expect(host.querySelector('[data-task="c"]')?.textContent).toContain('nobody yet');
    expect(host.querySelector('[data-task="b"] .ui-row__end')?.getAttribute('data-tone')).toBe('attention');
    expect(src.reads).toEqual(['paper-past']);
  });

  it('says so when the board is empty, when no board is named like the group, and when there is no board at all', async () => {
    let r = mount(source({ news: v('news', []) }));
    r.view.show({ id: 'g', name: 'news' }); await r.view.settled(); await tick();
    expect(r.host.textContent).toContain('Nothing on this board yet');
    r = mount(source({ default: v('default', []) }));
    r.view.show({ id: 'g', name: 'paper past' }); await r.view.settled(); await tick();
    expect(r.host.textContent).toContain('No board chosen');
    expect(r.host.querySelector('#hx-board-pick')).toBeTruthy();
    r = mount(source({}, []));
    r.view.show({ id: 'g', name: 'paper past' }); await r.view.settled(); await tick();
    expect(r.host.textContent).toContain('No board yet');
    expect(r.host.textContent).toContain('paper-past');
    r = mount(undefined);
    r.view.show({ id: 'g', name: 'x' }); await r.view.settled(); await tick();
    expect(r.host.textContent).toContain('No board here');
  });

  it('shows the board the user chooses and remembers it for the group', async () => {
    const src = source({ default: v('default', [task({ id: 'd1', title: 'Default task' })]), other: v('other', [task({ id: 'o1', title: 'Other task', status: 'done' })]) });
    const { host, view } = mount(src);
    view.show({ id: 'g9', name: 'zzz' }); await view.settled(); await tick();
    host.querySelector('#hx-board-pick')?.dispatchEvent(new CustomEvent('ui:change', { detail: { value: 'other' }, bubbles: true }));
    await view.settled(); await tick();
    expect(host.textContent).toContain('Other task');
    expect(loadBoardChoice('g9')).toBe('other');
    const again = mount(src);
    again.view.show({ id: 'g9', name: 'zzz' }); await again.view.settled(); await tick();
    expect(again.host.textContent).toContain('Other task');
  });

  it('says when the board could not be read and draws it when it can again', async () => {
    const views: Record<string, KanbanView | Error> = { 'paper-past': new Error('The engine is not running.') };
    const { host, view } = mount(source(views), 50);
    vi.useFakeTimers();
    view.show({ id: 'g1', name: 'paper past' }); await view.settled(); await tick();
    expect(host.textContent).toContain('The board could not be read');
    expect(host.textContent).toContain('The engine is not running.');
    views['paper-past'] = v('paper-past', [task({ title: 'Back again', status: 'ready' })]);
    await vi.advanceTimersByTimeAsync(60); await tick(10);
    expect(host.textContent).toContain('Back again');
    view.stop();
    vi.useRealTimers();
  });

  it('reads again while it is open and draws again only when something changed', async () => {
    const first = v('paper-past', [task({ id: 'a', title: 'One', status: 'ready' })]);
    const views: Record<string, KanbanView | Error> = { 'paper-past': first };
    const src = source(views);
    vi.useFakeTimers();
    const { host, view } = mount(src, 50);
    view.show({ id: 'g1', name: 'paper past' }); await view.settled(); await tick();
    const row = host.querySelector('[data-task="a"]');
    await vi.advanceTimersByTimeAsync(60); await tick(10);
    expect(src.reads.length).toBeGreaterThan(1);
    expect(host.querySelector('[data-task="a"]')).toBe(row);
    views['paper-past'] = v('paper-past', [task({ id: 'a', title: 'One', status: 'running' })]);
    await vi.advanceTimersByTimeAsync(60); await tick(10);
    expect(host.querySelector('[data-task="a"]')).not.toBe(row);
    expect(host.querySelector('.ui-sec__label')?.textContent).toBe('Running');
    const n = src.reads.length;
    view.stop();
    await vi.advanceTimersByTimeAsync(200); await tick(10);
    expect(src.reads.length).toBe(n);
    vi.useRealTimers();
  });
});
