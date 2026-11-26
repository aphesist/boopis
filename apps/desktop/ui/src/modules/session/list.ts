/* The Sessions sidebar as an inbox, as board S17 draws it (docs/design/v7/boards: sessiontab.js `inbox`, kit.css `.inbox-h`, `.sess-row`):
   sections with their counts (Needs you, Working, Pinned, Recent, and Settled folded), a row per session: the mark of the model that
   answers in it, its title, under it its branch in mono and when it last moved, and at the end what it waits on you for (an amber
   badge), a dot while it works, or nothing. The sections are the provider's own facts: a session that waits on an approval needs
   you; one that runs is working (a question does not stop it); a pinned one is pinned; the rest are recent; the archived ones are
   settled. Keys (KEYMAP section 4): arrows and j k move, Enter or a click opens, F2 renames, Esc goes to the conversation.
   The board's hover actions (S30: Snooze, Settle) are that board's; until then a row's menu (the context menu, or shift+F10) holds
   Rename, Fork and Settle. */
import { emit } from '../../core/bus';
import { esc, frag } from '../../core/dom';
import { kit, ui } from '@boopis/ui';
import { data } from '../../data';
import type { SessionSummary } from '../../data';
import { isDraft, selectSession, toConversation, VIEW } from './conversation';
import { onChanged } from './state';
import { modKeyOf } from './keys';
import { needWord, sectionOf, SECTIONS, SECTION_TITLES } from './sections';

export function mountList(root: HTMLElement): void {
  root.classList.add('ssl');
  let settledOpen = false, renaming: string | null = null;
  const sessions = () => data().sessions;
  /* a row is the kit's ListRow, a section's name the kit's SectionHead: this file only orders them */
  function rowHTML(s: SessionSummary, o: { current: boolean; settled: boolean }): string {
    /* the badge is the Needs you section's (board S17: a working session with a question open shows its dot; the canvas lists it under Waiting on you) */
    const need = o.settled || sectionOf(s) !== 'needs' ? '' : needWord(s);
    return kit.html.listRow({
      variant: 'session', title: s.title, current: o.current, ...(s.model ? { model: s.model } : {}), ...(s.branch ? { branch: s.branch } : {}),
      ...(need ? { needs: true, count: need } : s.running && !o.settled ? { working: true } : s.when ? { time: s.when } : {}),
      attrs: { 'data-id': s.id, 'data-settled': o.settled ? '' : null, 'data-hx-focus': o.current ? 'list' : null,
        /* the name holds the row's visible words (WCAG 2.5.3): its title, its branch, then the count or when it ran, as drawn */
        'aria-label': s.title + (s.branch ? ', ' + s.branch : '') + (need ? ', needs you: ' + need.toLowerCase() : s.running && !o.settled ? ', working' : s.when ? ', ' + s.when : '') + (o.settled ? ', settled' : '') }
    });
  }
  /* a section's rows are a listbox of their own, named by the section; its head sits outside it (a listbox holds options only), as the
     Bots list's do. The panel itself stays the Sessions tab's (index.html: a tabpanel) */
  const listOf = (title: string, rowsHTML: string): string => '<div class="k7-list" role="listbox" aria-label="' + esc(title) + ' sessions">' + rowsHTML + '</div>';
  const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-kit~="ListRow"]')];
  function rove(r: HTMLElement | null | undefined): void { rows().forEach((x) => { x.tabIndex = x === r ? 0 : -1; }); }
  function draw(): void {
    const a = document.activeElement as HTMLElement | null;
    const focusId = a && root.contains(a) ? a.closest<HTMLElement>('[data-id]')?.dataset['id'] ?? null : null;
    /* a session that has not started (the new session's canvas is its place) is not a row yet; while its canvas is open, the session
       you came from keeps its mark (board S17) */
    const list = sessions().list.get().filter((s) => !isDraft(s.id)), settled = sessions().archived.get();
    const cur = isDraft(VIEW.current) ? VIEW.from : VIEW.current;
    let out = '';
    for (const sec of SECTIONS) {
      const of = list.filter((s) => sectionOf(s) === sec);
      if (of.length) out += kit.html.sectionHead({ title: SECTION_TITLES[sec], count: String(of.length) }) + listOf(SECTION_TITLES[sec], of.map((s) => rowHTML(s, { current: s.id === cur, settled: false })).join(''));
    }
    if (settled.length) {
      out += kit.html.sectionHead({ title: 'Settled', count: String(settled.length), disclosure: true, collapsed: !settledOpen, attrs: { 'data-fold': '' } }) + (settledOpen ? listOf('Settled', settled.map((s) => rowHTML(s, { current: false, settled: true })).join('')) : '');
    }
    if (!list.length && !settled.length) out = kit.html.emptyState({ text: 'No sessions yet. Start one with New session.' });
    root.innerHTML = out;
    if (!rows().some((r) => r.tabIndex === 0)) rove(rows()[0]);
    if (renaming) startRename(renaming);
    else if (focusId) { const r = root.querySelector<HTMLElement>('[data-kit~="ListRow"][data-id="' + CSS.escape(focusId) + '"]'); if (r) { rove(r); r.focus({ preventScroll: true }); } }
  }
  const idOf = (n: Element | null): string | null => n?.closest<HTMLElement>('[data-kit~="ListRow"]')?.dataset['id'] ?? null;
  const settledRow = (id: string): boolean => sessions().archived.get().some((s) => s.id === id);
  function open(id: string): void {
    if (settledRow(id)) { restore(id); return; }
    if (sessions().list.get().some((s) => s.id === id) && id !== VIEW.current) selectSession(id);
  }
  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-fold]')) { settledOpen = !settledOpen; draw(); root.querySelector<HTMLElement>('[data-fold] button')?.focus(); return; }
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
  root.addEventListener('contextmenu', (e) => { const r = (e.target as Element).closest<HTMLElement>('[data-kit~="ListRow"]'); if (r) { e.preventDefault(); menu(r); } });
  /* ↑ ↓ j k Home End across the sections; Enter opens and keeps focus; Esc to the conversation */
  root.addEventListener('keydown', (e) => {
    const r = (e.target as Element).closest?.<HTMLElement>('[data-kit~="ListRow"]') ?? null;
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
    const r = root.querySelector<HTMLElement>('[data-kit~="ListRow"][data-id="' + CSS.escape(id) + '"]'), s = sessions().list.get().find((x) => x.id === id);
    const t = r?.querySelector<HTMLElement>('.k7-lrow__title');
    if (!r || !s || !t) { renaming = null; return; }
    const input = frag<HTMLInputElement>('<input class="k7-reset k7-lrow__rename" type="text" aria-label="Rename session" spellcheck="false">');
    input.value = s.title;
    t.replaceWith(input); input.focus(); input.select();
    const done = (save: boolean): void => {
      if (renaming !== id) return; renaming = null;
      if (save && input.value.trim()) { sessions().rename(id, input.value.trim()); if (id === VIEW.current) emit('hx:title', { title: input.value.trim(), project: s.project, tab: 'session' }); }
      draw(); const nr = root.querySelector<HTMLElement>('[data-kit~="ListRow"][data-id="' + CSS.escape(id) + '"]'); if (nr) { rove(nr); nr.focus(); }
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
