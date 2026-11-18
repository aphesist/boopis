/* session list (KEYMAP section 4): library rows grouped by project, actions as sibling buttons */
import { emit } from '../../core/bus';
import { el } from '../../core/dom';
import { ui } from '../../components';
import { data } from '../../data';
import type { SessionSummary } from '../../data';
import { selectSession, sessionNeedsYou, toConversation, VIEW } from './conversation';
import { onChanged } from './state';
import { modKeyOf } from './keys';

export function mountList(root: HTMLElement): void {
  root.classList.add('ssl');
  const collapsed = new Set<string>(['__arch']);
  let renaming: string | null = null;
  const sessions = () => data().sessions;
  const ib = (icon: string, label: string, act: string): string => ui.html.iconButton({ icon, label, size: 's', attrs: { 'data-act': act } });
  function rowHTML(s: SessionSummary, archived: boolean): string {
    const isCur = s.id === VIEW.current && !archived, needs = !archived && sessionNeedsYou(s.id);
    const acts = archived ? ib('unarchive', 'Restore ' + s.title, 'restore')
      : (isCur ? '' : ib('play', 'Resume ' + s.title, 'resume')) + ib('fork', 'Fork ' + s.title, 'fork') + ib('pen', 'Rename ' + s.title, 'rename') + ib('archive', 'Archive ' + s.title, 'archive');
    return ui.html.row({
      title: s.title, end: ui.esc(s.running ? 'now' : (s.when || '')), current: isCur, archived, value: s.id, acts,
      lead: archived ? '' : ui.html.leadFor({ running: !!s.running, attention: needs, current: isCur }),
      attrs: { 'data-id': s.id, 'aria-label': s.title + (needs ? ', needs you' : '') + (s.running ? ', running' : '') + (archived ? ', archived' : ''), 'data-hx-focus': isCur ? 'list' : null }
    });
  }
  const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.ui-row')].filter((r) => r.offsetParent !== null);
  function rove(r: HTMLElement | null | undefined): void { rows().forEach((x) => { x.tabIndex = x === r ? 0 : -1; }); }
  function draw(): void {
    const a = document.activeElement as HTMLElement | null;
    const focusRow = a && root.contains(a) ? a.closest<HTMLElement>('[data-id]') : null;
    const focusId = focusRow ? focusRow.dataset['id'] : null, focusAct = a && a.dataset ? a.dataset['act'] : undefined;
    const list = sessions().list.get(), arch = sessions().archived.get();
    const groups: Record<string, SessionSummary[]> = {};
    list.forEach((s) => (groups[s.project] ??= []).push(s));
    root.replaceChildren();
    Object.keys(groups).forEach((p) => root.append(ui.group({ label: p, collapsible: true, expanded: !collapsed.has(p), rows: (groups[p] ?? []).map((s) => rowHTML(s, false)).join('') })));
    if (arch.length) root.append(ui.group({ label: 'Archived', collapsible: true, expanded: !collapsed.has('__arch'), rows: arch.map((s) => rowHTML(s, true)).join('') }));
    if (!list.length) root.append(ui.empty({ title: 'No sessions yet', text: 'Start one with New session.' }));
    root.querySelectorAll<HTMLElement>('.ui-group').forEach((g, i) => { g.dataset['group'] = Object.keys(groups)[i] || '__arch'; });
    if (renaming) startRename(renaming);
    else if (focusId) {
      const r = root.querySelector<HTMLElement>(`[data-id="${focusId}"]`);
      const t = (r && focusAct && r.closest('li')?.querySelector<HTMLElement>(`[data-act="${focusAct}"]`)) || r;
      if (t && r) { rove(r); t.focus({ preventScroll: true }); }
    }
  }
  root.addEventListener('ui:change', (e) => {
    const head = (e.target as Element).closest('.ui-group__head'); if (!head) return;
    const name = head.closest<HTMLElement>('.ui-group')?.dataset['group'] ?? '';
    if ((e as CustomEvent<{ value: boolean }>).detail.value) collapsed.delete(name); else collapsed.add(name);
  });
  root.addEventListener('ui:select', (e) => {
    const id = (e as CustomEvent<{ value?: string }>).detail.value;
    if (id && sessions().list.get().some((s) => s.id === id) && id !== VIEW.current) selectSession(id);
  });
  root.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-act]'); if (!b) return;
    const id = b.closest('li')?.querySelector<HTMLElement>('.ui-row')?.dataset['id']; if (!id) return;
    const act: Record<string, () => void> = { resume: () => selectSession(id, { focus: true }), fork: () => fork(id), rename: () => startRename(id), archive: () => archive(id), restore: () => restore(id) };
    act[b.dataset['act'] ?? '']?.();
  });
  /* ↑ ↓ j k Home End across groups; shift+↑ ↓ between groups; Enter opens and keeps focus; Esc to the conversation */
  root.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const r = target.closest ? target.closest<HTMLElement>('.ui-row') : null;
    if (e.key === 'Escape' && !renaming) { e.preventDefault(); e.stopPropagation(); toConversation(); return; }
    if (!r || target !== r || modKeyOf(e) || e.altKey) return;
    const list = rows(), i = list.indexOf(r);
    let n: number | null | undefined = null;
    if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const groups = [...root.querySelectorAll<HTMLElement>('.ui-group')], gi = groups.indexOf(r.closest<HTMLElement>('.ui-group') as HTMLElement);
      for (let g = gi + (e.key === 'ArrowDown' ? 1 : -1); g >= 0 && g < groups.length; g += e.key === 'ArrowDown' ? 1 : -1) { const f = groups[g]?.querySelector<HTMLElement>('.ui-row'); if (f && f.offsetParent) { n = list.indexOf(f); break; } }
      if (n == null) { e.preventDefault(); e.stopPropagation(); return; }
    } else n = ({ ArrowDown: i + 1, j: i + 1, ArrowUp: i - 1, k: i - 1, Home: 0, End: list.length - 1 } as Record<string, number>)[e.key];
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
    const r = root.querySelector<HTMLElement>(`.ui-row[data-id="${id}"]`); if (!r) return;
    const s = sessions().list.get().find((x) => x.id === id), li = r.closest('li');
    if (!s || !li) return;
    const input = el('input', { class: 'ui-input ss-rename', type: 'text', value: s.title, 'aria-label': 'Rename session' });
    li.replaceChildren(input); input.focus(); input.select();
    const done = (save: boolean): void => {
      if (renaming !== id) return; renaming = null;
      if (save && input.value.trim()) { sessions().rename(id, input.value.trim()); if (id === VIEW.current) emit('hx:title', { title: input.value.trim(), project: s.project, tab: 'session' }); }
      draw(); const nr = root.querySelector<HTMLElement>(`.ui-row[data-id="${id}"]`); if (nr) { rove(nr); nr.focus(); }
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.preventDefault(); done(false); } });
    input.addEventListener('blur', () => done(true));
  }
  function archive(id: string): void {
    const list = sessions().list.get(), i = list.findIndex((s) => s.id === id); if (i < 0) return;
    const s = list[i] as SessionSummary;
    sessions().archive(id);
    const rest = sessions().list.get();
    if (VIEW.current === id && rest.length) selectSession((rest[Math.min(i, rest.length - 1)] as SessionSummary).id);
    const next = rows()[0]; if (next) { rove(next); next.focus(); }
    ui.toast('Archived "' + s.title + '"', { action: { label: 'Undo', onClick: () => restore(id) } });
  }
  function restore(id: string): void { sessions().restore(id); }
  sessions().list.subscribe(draw);
  sessions().archived.subscribe(draw);
  onChanged(draw);
  draw();
}
