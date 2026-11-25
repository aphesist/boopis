/* A bot's details pane, as board 11 draws it (docs/design/v7/boards: botscreens.js `pane`): the kit's Pane at the window's right
   edge (356, --bg-pane), opened by the chrome's title pill or details button. Its head: the bot's 64 orb, its name, Activity |
   Library. Under it only what exists: Upcoming (the bot's routines, each with its switch) and Work (its model, what it spent
   against its cap, where it works). A value the provider does not have is left out, never guessed. The Library side, and any
   editing of the bot beyond a routine's switch, have no board yet (an owner question): Library says so in one line. */
import { on } from '../../core/bus';
import { el, esc } from '../../core/dom';
import { state } from '../../core/state';
import { kit, ui } from '@boopis/ui';
import { data } from '../../data';
import type { Bot, Schedule } from '../../data';
import { bot, group, S } from './model';
import { onRoomPaneBlur, onRoomPaneClick, onRoomPaneKey, roomPaneHTML, roomPaneSig } from './group-details';
import { openSettings } from './settings';

let host: HTMLElement | null = null;
let tab: 'activity' | 'library' = 'activity';
let sig = '';
let watching = false;

const base = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
function schedulesOf(b: Bot): readonly Schedule[] { return data().schedules.list.get().filter((s) => s.bot === b.id); }

const count = (n: number, one: string, many: string): string => n + ' ' + (n === 1 ? one : many);
/** Library: what the engine reports the bot has (the live provider's `info`): its recent sessions, each opening that session, and its
    skills and toolsets by count; a bot the provider knows nothing more about has nothing here */
function libraryHTML(b: Bot): string {
  const info = b.info;
  if (!info) return '<p class="k7-pane__none">Nothing in ' + esc(b.name) + '’s library yet.</p>';
  const sessions = info.sessions ?? [];
  const on = (list: readonly { enabled: boolean }[] | null): string => (list === null ? 'unknown' : count(list.filter((x) => x.enabled).length, 'on', 'on') + ' of ' + list.length);
  return (sessions.length
    ? '<h3 class="k7-pane__sec">Recent sessions</h3>' + kit.html.card({ variant: 'pane', rows: sessions.map((x) => ({ label: x.title || 'Untitled session', value: x.when, action: 'opens the session', attrs: { 'data-session': x.id } })) })
    : '<p class="k7-pane__none">' + esc(info.sessions === null ? 'Its sessions are unknown. ' + (info.notes.sessions ?? '') : b.name + ' has not run a session yet.') + '</p>') +
    '<h3 class="k7-pane__sec">It can use</h3>' + kit.html.card({ variant: 'pane', rows: [{ label: 'Skills', value: on(info.skills), action: 'opens its settings', attrs: { 'data-settings': 'role' } }, { label: 'Toolsets', value: on(info.toolsets), action: 'opens its settings', attrs: { 'data-settings': 'role' } }] });
}
function bodyHTML(b: Bot): string {
  if (tab === 'library') return libraryHTML(b);
  const rows = schedulesOf(b);
  const upcoming = rows.length
    ? '<h3 class="k7-pane__sec">Upcoming</h3>' + kit.html.card({ variant: 'pane', rows: rows.map((s) => ({
      label: s.what, labelHTML: esc(s.what) + '<br><span class="k7-row__sub">' + esc(s.when) + '</span>',
      control: kit.html.switch({ label: s.what, checked: !s.paused, attrs: { 'data-schedule': s.id } })
    })) })
    : '';
  const model = b.info?.model ?? b.cfg.model;
  const run = S.spend[b.id], cap = run?.cap ?? (b.cfg.cap ? '$' + b.cfg.cap : null), spent = run?.spent ?? (b.spent ? '$' + b.spent : null);
  const where = data().bots.workspace?.(b.id);
  /* each row opens the bot's settings where its value is set: the pane is the pointer's way to them (board 11 draws no other) */
  const work = [
    ...(model ? [{ label: 'Model', valueHTML: ui.html.modelMark(model, { size: 14, label: false }) + esc(ui.modelMark.short(model) || model), value: ui.modelMark.short(model) || model, action: 'opens its settings', attrs: { 'data-settings': 'model' } }] : []),
    ...(spent ? [{ label: 'Spend', value: cap ? spent + ' of ' + cap : spent, mono: true, action: 'opens its settings', attrs: { 'data-settings': 'model' } }] : []),
    { label: 'Workspace', value: b.cfg.workspace + (where ? ' ' + base(where) : ''), mono: true, action: 'opens its settings', attrs: { 'data-settings': 'workspace' } }
  ];
  return upcoming + '<h3 class="k7-pane__sec">Work</h3>' + kit.html.card({ variant: 'pane', rows: work });
}

/** draw the pane for the open bot; `newSession` is kept for the pane's own actions as they arrive (no board draws one yet) */
export function paintDetails(_newSession?: () => void): void {
  const shell = document.getElementById('hx-right-shell');
  if (!shell) return;
  if (!host || host.parentElement !== shell) {
    host = el('div', { class: 'bt-details', id: 'hx-right-bots' });
    shell.append(host);
    sig = '';
    host.addEventListener('click', (e) => {
      if (S.view === 'group') { onRoomPaneClick(e, () => { sig = ''; paintDetails(); }); return; }
      const t = e.target as Element, b = bot(S.sel);
      if (!b || t.closest('.k7-switch')) return;
      const set = t.closest<HTMLElement>('[data-settings]'), ses = t.closest<HTMLElement>('[data-session]');
      if (set) openSettings(b.id, set.dataset['settings'] ?? null);
      else if (ses) void data().bots.sessions?.open(b.id, ses.dataset['session'] as string).catch((err: unknown) => { kit.notify(err instanceof Error ? err.message : 'The session could not be opened.'); });
    });
    host.addEventListener('keydown', (e) => { if (S.view === 'group') onRoomPaneKey(e); });
    host.addEventListener('focusout', (e) => { if (S.view === 'group') onRoomPaneBlur(e); });
    host.addEventListener('ui:change', (e) => {
      const t = e.target as HTMLElement;
      const seg = t.closest('[data-kit~="Segmented"]');
      if (seg) { tab = (e as CustomEvent<{ value: string }>).detail.value === 'library' ? 'library' : 'activity'; sig = ''; paintDetails(); return; }
      const sw = t.closest<HTMLElement>('[data-schedule]');
      if (sw) data().schedules.setPaused(sw.dataset['schedule'] as string, !(e as CustomEvent<{ value: boolean }>).detail.value);   /* on is running: off pauses it */
    });
    if (!watching) { watching = true; data().schedules.list.subscribe(() => { paintDetails(); }); on('hx:state', () => { paintDetails(); }); }
  }
  /* a room's details: its members and what the room itself can be told (group-details.ts) */
  const g = state.tab === 'bots' && S.view === 'group' ? group(S.groupSel) : undefined;
  if (g) {
    host.hidden = state.right !== 'open';
    if (host.hidden) return;
    const next = roomPaneSig(g);
    if (next === sig || host.contains(document.activeElement) && document.activeElement?.matches('input')) return;
    sig = next;
    host.innerHTML = roomPaneHTML(g, () => { paintDetails(); });
    kit.wire(host);
    return;
  }
  const b = state.tab === 'bots' && S.view === 'bot' ? bot(S.sel) : undefined;
  const open = !!b && state.right === 'open';
  host.hidden = !open;
  if (!open || !b) { if (!b) { host.replaceChildren(); sig = ''; } return; }
  const body = bodyHTML(b);
  const next = [b.id, b.name, b.shape, b.color, b.state, tab, body].join('\u0000');
  if (next === sig) return;
  sig = next;
  /* written into the page as markup: an orb made in a template and moved in is not painted by its worker */
  host.innerHTML = kit.html.pane({ variant: 'details', bot: b, title: b.name, tab, body, label: b.name + ', details' });
  kit.wire(host);
}
