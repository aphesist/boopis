/* A group's kanban board, read only: the engine's board for the group, as its columns and their tasks, each with its assignee (the
   bot's orb and name) and its times. It is reached from the group room's header and takes the thread's place in the same column; it
   is never a part of the message list. Nothing here moves or edits a task: the engine's agents and its own command do that.
   The view asks the provider's `kanban` source, shows what it says (loading, an empty board, no board, an error) and reads again
   every few seconds while it is open, drawing again only when something changed. Which board belongs to a group is the engine's
   convention, not a link: a board whose name is the group's name, said as a slug (`paper past` is `paper-past`); another can be chosen,
   and the choice is remembered for the group. */
import { el, esc } from '../../core/dom';
import { ui } from '@boopis/ui';
import type { BotLike } from '@boopis/ui';
import type { KanbanBoardInfo, KanbanSource, KanbanTask, KanbanView } from '../../data';
import { lookFor } from '../../data/looks';
import { bot } from './model';
import { livenIn, orbHTML } from './orbs';

/** the columns of the engine's board, in its order; a state it adds later is drawn after these under its own name */
export const COLUMNS: ReadonlyArray<readonly [key: string, label: string]> = [
  ['triage', 'Triage'], ['todo', 'Todo'], ['scheduled', 'Scheduled'], ['ready', 'Ready'], ['running', 'Running'], ['blocked', 'Blocked'], ['review', 'Review'], ['done', 'Done']
];
export const POLL_MS = 6000;

/** a name as the engine writes a board's slug: `Paper Past!` is `paper-past` */
export const slugOf = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** the board that belongs to a group: the one that was chosen for it and still exists, else the one named like it, else none */
export function boardFor(groupName: string, boards: readonly KanbanBoardInfo[], chosen: string | null): string | null {
  const live = boards.filter((b) => !b.archived || b.slug === chosen);
  if (chosen && live.some((b) => b.slug === chosen)) return chosen;
  const want = slugOf(groupName);
  return want ? (live.find((b) => b.slug === want || slugOf(b.name) === want)?.slug ?? null) : null;
}

export interface Column { key: string; label: string; tasks: KanbanTask[] }
/** the columns that hold tasks, in the board's order, each with its tasks newest first (the host sorts them already) */
export function columnsOf(tasks: readonly KanbanTask[]): Column[] {
  const known = COLUMNS.map(([key, label]): Column => ({ key, label, tasks: [] }));
  const extra: Column[] = [];
  for (const t of tasks) {
    if (t.status === 'archived') continue;
    let col = known.find((c) => c.key === t.status) ?? extra.find((c) => c.key === t.status);
    if (!col) { col = { key: t.status, label: t.status.charAt(0).toUpperCase() + t.status.slice(1), tasks: [] }; extra.push(col); }
    col.tasks.push(t);
  }
  return [...known, ...extra].filter((c) => c.tasks.length);
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date */
export function ago(seconds: number, now: Date): string {
  const mins = Math.round((now.getTime() - seconds * 1000) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  if (mins < 24 * 60) return Math.round(mins / 60) + ' h ago';
  const days = Math.round(mins / 1440);
  if (days < 14) return days + (days === 1 ? ' day ago' : ' days ago');
  return new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
/** the line under a task: when it was made, started and finished, as far as the engine says */
export function timeline(t: KanbanTask, now: Date): string {
  return [
    t.createdAt !== null ? 'added ' + ago(t.createdAt, now) : '',
    t.startedAt !== null ? 'started ' + ago(t.startedAt, now) : '',
    t.completedAt !== null ? 'finished ' + ago(t.completedAt, now) : ''
  ].filter(Boolean).join(' · ');
}

/** the look an assignee's orb has: the bot it is when the user has it, else the look its name gives */
const assigneeBot = (profile: string): BotLike => bot(profile) ?? { id: profile, name: profile, ...lookFor(profile), state: 'idle' };

const KEY = 'hx.board.';
const remembered = (group: string): string | null => { try { return localStorage.getItem(KEY + group); } catch { return null; } };
const remember = (group: string, slug: string): void => { try { localStorage.setItem(KEY + group, slug); } catch { /* a convenience only */ } };

export interface BoardDeps {
  /** asked each time the board reads, so a provider that changes is followed */
  source: () => KanbanSource | undefined;
  now?: () => Date;
  /** how often an open board is read again; null: never (tests) */
  pollMs?: number | null;
}
export interface BoardView {
  /** shows the board of this group (its id and name) */
  show(group: { id: string; name: string }): void;
  /** stops reading; the element stays as it is */
  stop(): void;
  /** the last read has been drawn (tests) */
  settled(): Promise<void>;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || 'The board could not be read.';

export function mountBoard(host: HTMLElement, deps: BoardDeps): BoardView {
  const now = deps.now ?? ((): Date => new Date());
  const pollMs = deps.pollMs === undefined ? POLL_MS : deps.pollMs;
  const bar = el('div', { class: 'bt-board-bar' });
  const status = el('p', { class: 'ui-field__hint bt-board-status', role: 'status', 'aria-live': 'polite' });
  const body = el('div', { class: 'bt-board-body' });
  host.replaceChildren(bar, status, body);
  let group: { id: string; name: string } | null = null;
  let boards: readonly KanbanBoardInfo[] = [];
  let slug: string | null = null;
  let timer = 0;
  let gen = 0;
  let last = '';
  let inflight: Promise<void> = Promise.resolve();

  const note = (text: string): void => { status.textContent = text; };
  const drawBar = (): void => {
    bar.replaceChildren();
    if (!boards.length) return;
    const pick = ui.select({ id: 'hx-board-pick', label: 'Board', entries: boards.map((b) => ({ value: b.slug, label: b.name + (b.archived ? ' (archived)' : '') })), value: slug ?? '' });
    pick.addEventListener('ui:change', (e) => {
      const v = (e as CustomEvent<{ value: string }>).detail.value;
      if (!v || v === slug || !group) return;
      slug = v; remember(group.id, v); last = ''; drawBar(); void read(true);
    });
    bar.append(pick);
  };
  const empty = (title: string, text: string): void => { const e = ui.empty({ title, text }); e.classList.add('bt-empty'); body.replaceChildren(e); };

  function drawView(v: KanbanView): void {
    const cols = columnsOf(v.tasks);
    if (!cols.length) { empty('Nothing on this board yet', 'When the group’s bots add tasks to the board ' + v.board.name + ', they show here, by state.'); return; }
    const t = now();
    const sections = cols.map((c) => {
      const s = frag(ui.html.section({ label: c.label, meta: String(c.tasks.length), open: true, name: c.key }));
      const rows = c.tasks.map((k) => {
        const who = k.assignee ? assigneeBot(k.assignee) : null;
        const sub = [who ? who.name : 'nobody yet', timeline(k, t), k.problem ? 'stopped: ' + k.problem : ''].filter(Boolean).join(' · ');
        return ui.html.row({ tag: 'div', class: 'bt-task', title: k.title || k.id, sub, lead: who ? orbHTML(who, 20, { state: 'idle' }) : '', end: esc(c.label.toLowerCase()), endTone: k.status === 'blocked' ? 'attention' : null, attrs: { 'data-task': k.id } });
      });
      s.querySelector('.ui-sec__body')?.insertAdjacentHTML('beforeend', '<ul class="ui-rows bt-tasks">' + rows.join('') + '</ul>');
      return s;
    });
    body.replaceChildren(...sections);
    ui.hydrate(body);
    livenIn(body);
  }
  const frag = (html: string): HTMLElement => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild as HTMLElement; };

  async function read(force: boolean): Promise<void> {
    const src = deps.source();
    const mine = ++gen;
    if (!src) { empty('No board here', 'This build cannot read the engine’s kanban boards.'); note(''); return; }
    try {
      if (!boards.length || force) {
        const all = await src.boards();
        if (mine !== gen) return;
        boards = all; drawBar();
      }
      if (!group) return;
      if (slug === null || !boards.some((b) => b.slug === slug)) slug = boardFor(group.name, boards, remembered(group.id));
      if (slug === null) {
        const text = boards.length ? 'None of the engine’s boards is named like ' + group.name + '. Choose one above to see it here.' : 'The engine has no kanban board yet. When a board named ' + (slugOf(group.name) || 'like this group') + ' is made, it shows here.';
        empty(boards.length ? 'No board chosen' : 'No board yet', text); note(''); return;
      }
      drawBar();
      const v = await src.view(slug);
      if (mine !== gen) return;
      const sig = JSON.stringify(v);
      if (sig !== last) { last = sig; drawView(v); }
      note('Read ' + now().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '. It reads again while this is open.');
    } catch (e) {
      if (mine !== gen) return;
      last = '';
      const e1 = ui.empty({ title: 'The board could not be read', text: message(e) });
      e1.classList.add('bt-empty'); body.replaceChildren(e1);
      note('It will try again in a few seconds.');
    }
  }
  const schedule = (): void => {
    window.clearInterval(timer);
    if (pollMs) timer = window.setInterval(() => { if (!document.hidden) { inflight = read(false); } }, pollMs);
  };

  return {
    show(g) {
      group = g; slug = null; boards = []; last = ''; gen++;
      body.replaceChildren(); bar.replaceChildren(); note('Reading the board…');
      inflight = read(true); schedule();
    },
    stop() { window.clearInterval(timer); gen++; },
    settled: () => inflight
  };
}
