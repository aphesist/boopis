/* A group's kanban board, read only: the engine's board for the group, as its columns and their tasks, each with its assignee (the
   bot's orb and name) and its times. It is reached from the group room's header and takes the thread's place in the same column; it
   is never a part of the message list. Nothing here moves or edits a task: the engine's agents and its own command do that.
   The view asks the provider's `kanban` source, shows what it says (loading, an empty board, no board, an error) and reads again
   every few seconds while it is open, drawing again only when something changed. Which board belongs to a group is the engine's
   convention, not a link: a board whose name is the group's name, said as a slug (`paper past` is `paper-past`); another can be chosen,
   and the choice is remembered for the group.
   On the kit (the repass's step 2a; no board draws it, the lead's decision): one read-only Card column per state, its name and count
   over it, its tasks as ListRow items each carrying its assignee's orb at 20; nothing drags. The board's chooser is the kit's
   SelectorItem opening the kit's Menu; what the board cannot show is one quiet EmptyState line. */
import { el, frag } from '../../core/dom';
import { loadBoardChoice, saveBoardChoice } from '../../core/settings';
import { kit } from '@boopis/ui';
import type { BotLike } from '@boopis/ui';
import type { KanbanBoardInfo, KanbanSource, KanbanTask, KanbanView } from '../../data';
import { lookFor } from '@boopis/ui';
import { bot } from './model';
import { livenIn } from './orbs';
import { openSelect } from '../settings/rows';

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
  const status = el('p', { class: 'k7-pane__note bt-board-status', role: 'status', 'aria-live': 'polite' });
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
    const nameOf = (b: KanbanBoardInfo): string => b.name + (b.archived ? ' (archived)' : '');
    const cur = boards.find((b) => b.slug === slug);
    const pick = kit.wire(frag(kit.html.selectorItem({ variant: 'field', label: 'Board', value: cur ? nameOf(cur) : 'Choose a board', attrs: { id: 'hx-board-pick', 'data-board-pick': slug ?? '' } })));
    pick.addEventListener('click', () => {
      openSelect(pick, { label: 'Board', value: slug ?? '', choices: boards.map((b) => ({ value: b.slug, label: nameOf(b) })), onPick: (v) => {
        if (!v || v === slug || !group) return;
        slug = v; saveBoardChoice(group.id, v); last = ''; drawBar(); void read(true);
      } });
    });
    bar.append(pick);
  };
  const empty = (text: string): void => { body.replaceChildren(kit.wire(frag(kit.html.emptyState({ text })))); };

  function drawView(v: KanbanView): void {
    const cols = columnsOf(v.tasks);
    if (!cols.length) { empty('Nothing on ' + v.board.name + ' yet: the group’s tasks show here, by state.'); return; }
    const t = now();
    const html = cols.map((c) => '<section class="bt-state" data-state="' + c.key + '" aria-label="' + c.label + '">' + kit.html.sectionHead({ title: c.label, count: String(c.tasks.length) }) +
      kit.html.card({ variant: 'settings', rows: [], attrs: { 'data-column': c.key }, body: kit.html.list({ label: c.label, attrs: { 'data-kit-part': null }, rows: c.tasks.map((k) => {
        const who = k.assignee ? assigneeBot(k.assignee) : null;
        const sub = [who ? who.name : 'nobody yet', timeline(k, t), k.problem ? 'stopped: ' + k.problem : ''].filter(Boolean).join(' · ');
        return { variant: 'item' as const, title: k.title || k.id, sub, ...(who ? { markHTML: kit.html.avatar({ bot: who, size: 20, state: 'idle' }) } : { markText: '–' }),
          ...(k.status === 'blocked' ? { endHTML: kit.html.statusWord({ text: 'blocked', tone: 'red' }) } : {}), attrs: { 'data-task': k.id } };
      }) }) }) + '</section>').join('');
    body.replaceChildren(kit.wire(frag('<div class="bt-states">' + html + '</div>')));
    livenIn(body);
  }

  async function read(force: boolean): Promise<void> {
    const src = deps.source();
    const mine = ++gen;
    if (!src) { empty('This build cannot read kanban boards.'); note(''); return; }
    try {
      if (!boards.length || force) {
        const all = await src.boards();
        if (mine !== gen) return;
        boards = all; drawBar();
      }
      if (!group) return;
      if (slug === null || !boards.some((b) => b.slug === slug)) slug = boardFor(group.name, boards, loadBoardChoice(group.id));
      if (slug === null) {
        empty(boards.length ? 'No board is named like ' + group.name + ': choose one above.' : 'No kanban board yet: one named ' + (slugOf(group.name) || 'like this group') + ' shows here.'); note(''); return;
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
      empty('The board could not be read: ' + message(e));
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
