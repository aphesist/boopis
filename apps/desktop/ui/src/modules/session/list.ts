/* The Sessions sidebar as an inbox, as board S17 draws it (docs/design/v7/boards: sessiontab.js `inbox`, kit.css `.inbox-h`, `.sess-row`):
   sections with their counts (Needs you, Working, Pinned, Recent, and Settled folded), a row per session: the mark of the model that
   answers in it, its title, under it its branch in mono and when it last moved, and at the end what it waits on you for (an amber
   badge), a dot while it works, or nothing. The sections are the provider's own facts: a session that waits on an approval needs
   you; one that runs is working (a question does not stop it); a pinned one is pinned; the rest are recent; the archived ones are
   settled. Keys (KEYMAP section 4): arrows and j k move, Enter or a click opens, F2 renames, Esc goes to the conversation.
   The board's hover actions (S30: Snooze, Settle) are that board's; until then a row's menu (the context menu, or shift+F10) holds
   Rename, Fork and Settle. */
import { emit } from '../../core/bus';
import { attrs, esc, frag } from '../../core/dom';
import { kit, ui } from '@boopis/ui';
import { data } from '../../data';
import type { SessionSummary } from '../../data';
import { isDraft, selectSession, toConversation, VIEW } from './conversation';
import { onChanged } from './state';
import { modKeyOf } from './keys';

type Section = 'needs' | 'working' | 'pinned' | 'recent';
const TITLES: Record<Section, string> = { needs: 'Needs you', working: 'Working', pinned: 'Pinned', recent: 'Recent' };
const ORDER: readonly Section[] = ['needs', 'working', 'pinned', 'recent'];
/** which section a session is in: an approval stops it (Needs you); a running one works, also with a question open */
export const sectionOf = (s: SessionSummary): Section => (s.needs === 'approval' ? 'needs' : s.running ? 'working' : s.needs ? 'needs' : s.pinned ? 'pinned' : 'recent');
export const needWord = (s: SessionSummary): string => (s.needs === 'approval' ? 'Approval' : s.needs === 'question' ? 'Question' : '');

export function mountList(root: HTMLElement): void {
  root.classList.add('ssl');
  let settledOpen = false, renaming: string | null = null;
  const sessions = () => data().sessions;
  const head = (title: string, n: number, more = ''): string => '<h3 class="ssl-h"' + (more ? '' : '') + '><span>' + esc(title) + '</span><span class="ssl-h__n k7-mono">' + n + '</span><span class="k7-grow"></span>' + more + '</h3>';
  function rowHTML(s: SessionSummary, o: { current: boolean; settled: boolean }): string {
    /* the badge is the Needs you section's (board S17: a working session with a question open shows its dot; the canvas lists it under Waiting on you) */
    const need = o.settled || sectionOf(s) !== 'needs' ? '' : needWord(s);
    const end = need ? kit.html.badge({ text: need, tone: 'owe' }) : s.running && !o.settled ? '<span class="k7-dot" data-pulse data-live aria-hidden="true"></span>' : '';
    const sub = (s.branch ? '<span class="k7-mono">' + esc(s.branch) + '</span>' : '') + (s.when && !s.running && !need ? '<span>' + esc(s.when) + '</span>' : '');
    return '<div class="ssl-row" role="option" data-sq data-sq-mode="frame"' + attrs({ 'data-id': s.id, tabindex: o.current ? '0' : '-1', 'aria-selected': String(o.current), 'data-current': o.current ? '' : null, 'data-settled': o.settled ? '' : null, 'data-hx-focus': o.current ? 'list' : null,
      'aria-label': s.title + (s.branch ? ', ' + s.branch : '') + (need ? ', needs you: ' + need.toLowerCase() : '') + (s.running ? ', working' : '') + (o.settled ? ', settled' : '') }) + '>' +
      '<span class="ssl-row__mark" aria-hidden="true">' + (s.model ? ui.html.modelMark(s.model, { size: 16, label: false }) : ui.icon('session')) + '</span>' +
      '<span class="ssl-row__text"><span class="ssl-row__t k7-ell">' + esc(s.title) + '</span>' + (sub ? '<span class="ssl-row__sub">' + sub + '</span>' : '') + '</span>' + end + '</div>';
  }
  const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.ssl-row')];
  function rove(r: HTMLElement | null | undefined): void { rows().forEach((x) => { x.tabIndex = x === r ? 0 : -1; }); }
  function draw(): void {
    const a = document.activeElement as HTMLElement | null;
    const focusId = a && root.contains(a) ? a.closest<HTMLElement>('[data-id]')?.dataset['id'] ?? null : null;
    /* a session that has not started (the new session's canvas is its place) is not a row yet; while its canvas is open, the session
       you came from keeps its mark (board S17) */
    const list = sessions().list.get().filter((s) => !isDraft(s.id)), settled = sessions().archived.get();
    const cur = isDraft(VIEW.current) ? VIEW.from : VIEW.current;
    let out = '';
    for (const sec of ORDER) {
      const of = list.filter((s) => sectionOf(s) === sec);
      if (of.length) out += head(TITLES[sec], of.length) + of.map((s) => rowHTML(s, { current: s.id === cur, settled: false })).join('');
    }
    if (settled.length) {
      out += '<h3 class="ssl-h"><button class="k7-reset ssl-h__fold" type="button" aria-expanded="' + String(settledOpen) + '" data-fold><span>Settled</span><span class="ssl-h__n k7-mono">' + settled.length + '</span><span class="k7-grow"></span>' + ui.icon(settledOpen ? 'chevron-down' : 'chevron', { size: 'm', class: 'k7-ic' }) + '</button></h3>' +
        (settledOpen ? settled.map((s) => rowHTML(s, { current: false, settled: true })).join('') : '');
    }
    if (!list.length && !settled.length) out = kit.html.emptyState({ text: 'No sessions yet. Start one with New session.' });
    root.setAttribute('role', 'listbox'); root.setAttribute('aria-label', 'Sessions');
    root.innerHTML = out;
    if (!rows().some((r) => r.tabIndex === 0)) rove(rows()[0]);
    if (renaming) startRename(renaming);
    else if (focusId) { const r = root.querySelector<HTMLElement>('.ssl-row[data-id="' + CSS.escape(focusId) + '"]'); if (r) { rove(r); r.focus({ preventScroll: true }); } }
  }
  const idOf = (n: Element | null): string | null => n?.closest<HTMLElement>('.ssl-row')?.dataset['id'] ?? null;
  const settledRow = (id: string): boolean => sessions().archived.get().some((s) => s.id === id);
  function open(id: string): void {
    if (settledRow(id)) { restore(id); return; }
    if (sessions().list.get().some((s) => s.id === id) && id !== VIEW.current) selectSession(id);
  }
  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-fold]')) { settledOpen = !settledOpen; draw(); root.querySelector<HTMLElement>('[data-fold]')?.focus(); return; }
    const id = idOf(t); if (id) open(id);
  });
  function menu(row: HTMLElement): void {
    const id = row.dataset['id'] as string, settled = settledRow(id);
    kit.openMenu(row, {
      label: 'Session', place: 'below', align: 'start',
      entries: settled ? [{ label: 'Restore', icon: 'unarchive', value: 'restore' }]
        : [{ label: 'Rename', icon: 'pen', value: 'rename', keys: 'F2' }, ...(data().info.unavailable['sessions.fork'] ? [] : [{ label: 'Fork', icon: 'fork', value: 'fork' }]), { label: 'Settle', icon: 'check', value: 'settle' }],
      onSelect: (v) => { if (v === 'rename') startRename(id); else if (v === 'fork') fork(id); else if (v === 'settle') settle(id); else restore(id); }
    });
  }
  root.addEventListener('contextmenu', (e) => { const r = (e.target as Element).closest<HTMLElement>('.ssl-row'); if (r) { e.preventDefault(); menu(r); } });
  /* ↑ ↓ j k Home End across the sections; Enter opens and keeps focus; Esc to the conversation */
  root.addEventListener('keydown', (e) => {
    const r = (e.target as Element).closest?.<HTMLElement>('.ssl-row') ?? null;
    if (e.key === 'Escape' && !renaming) { e.preventDefault(); e.stopPropagation(); toConversation(); return; }
    if (!r || e.target !== r || modKeyOf(e) || e.altKey) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(r.dataset['id'] as string); return; }
    if (e.key === 'F2') { e.preventDefault(); if (!settledRow(r.dataset['id'] as string)) startRename(r.dataset['id'] as string); return; }
    if (e.key === 'F10' && e.shiftKey) { e.preventDefault(); menu(r); return; }
    const list = rows(), i = list.indexOf(r);
    const n = ({ ArrowDown: i + 1, j: i + 1, ArrowUp: i - 1, k: i - 1, Home: 0, End: list.length - 1 } as Record<string, number>)[e.key];
    if (n == null) return;
    e.preventDefault(); e.stopPropagation();
    const t = list[Math.max(0, Math.min(list.length - 1, n))]; if (t) { rove(t); t.focus(); }
  }, true);
  function fork(id: string): void {
    const s = sessions().list.get().find((x) => x.id === id);
    const n = sessions().fork(id);
    if (n) { selectSession(n.id); ui.announce('Forked ' + (s ? s.title : '')); }
  }
  function startRename(id: string): void {
    renaming = id;
    const r = root.querySelector<HTMLElement>('.ssl-row[data-id="' + CSS.escape(id) + '"]'), s = sessions().list.get().find((x) => x.id === id);
    const t = r?.querySelector<HTMLElement>('.ssl-row__t');
    if (!r || !s || !t) { renaming = null; return; }
    const input = frag<HTMLInputElement>('<input class="ssl-rename" type="text" aria-label="Rename session" spellcheck="false">');
    input.value = s.title;
    t.replaceWith(input); input.focus(); input.select();
    const done = (save: boolean): void => {
      if (renaming !== id) return; renaming = null;
      if (save && input.value.trim()) { sessions().rename(id, input.value.trim()); if (id === VIEW.current) emit('hx:title', { title: input.value.trim(), project: s.project, tab: 'session' }); }
      draw(); const nr = root.querySelector<HTMLElement>('.ssl-row[data-id="' + CSS.escape(id) + '"]'); if (nr) { rove(nr); nr.focus(); }
    };
    input.addEventListener('click', (e) => { e.stopPropagation(); });
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.preventDefault(); done(false); } });
    input.addEventListener('blur', () => { done(true); });
  }
  function settle(id: string): void {
    const list = sessions().list.get(), i = list.findIndex((s) => s.id === id); if (i < 0) return;
    const s = list[i] as SessionSummary;
    sessions().archive(id);
    const rest = sessions().list.get();
    if (VIEW.current === id && rest.length) selectSession((rest[Math.min(i, rest.length - 1)] as SessionSummary).id);
    const next = rows()[0]; if (next) { rove(next); next.focus(); }
    kit.notify('Settled "' + s.title + '"', { action: { label: 'Undo', onClick: () => { restore(id); } } });
  }
  function restore(id: string): void { sessions().restore(id); }
  sessions().list.subscribe(draw);
  sessions().archived.subscribe(draw);
  onChanged(draw);
  draw();
}
