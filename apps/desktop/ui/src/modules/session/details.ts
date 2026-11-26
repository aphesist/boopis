/* The session's right panel, on the kit's Pane.

   Its details, as board S40 draws them (docs/design/v7/boards: sessiontab2.js `s20`), opened by the chrome's details button or
   mod+I: the session's name with its overflow (Fork and Settle where they exist), the folder and the branch; "Session" (Model,
   Effort, How careful, each opening the menu the composer's line opens; Workspace); "Use" (Context, Cost; Pull request once that
   exists). Under them what S40 draws no place for and Settings will hold (the lead, 26 November: kept here as plain rows until
   step 7, so nothing is lost): the Context row opens what fills the context with "Compact conversation"; the Cost row changes
   the cap; "Environment" (folder, branch, sandbox, runtime, harness, gate); "Connectors" (each with its switch or its sign-in,
   the store; the project's "no engine plugins and no plugin hooks" moved to Settings › Sessions, This project, at step 7a).

   Its diff, as board S24 draws the tools' Diff tab, shown alone (no strip of tabs until a second tab exists): the turn's changed
   files, each a kit DiffView that folds; a FilesCard's "Open diff" (or D on a turn) opens it. Review comments, the scope and
   Split are 0.3.0 and are not drawn.

   A mod's pane is a tab of this panel (MODS.md section 3; `surface.panelTabs`). Reads the provider's details and sends its
   commands (compact, the cap, a connector, a sign-in); nothing here is kept, so a redraw is the whole state. */
import { emit, on } from '../../core/bus';
import { cap1, esc } from '../../core/dom';
import { setState, state } from '../../core/state';
import { kit, ui } from '@boopis/ui';
import type { DiffLine } from '@boopis/ui';
import { data } from '../../data';
import { CAREFUL } from '../../data';
import type { DiffFile } from '../../data';
import { later } from '../chat/compose';
import { answersNext, openEffortMenu, openWhoAnswers, setGovernance } from './composer';
import { VIEW, selectSession } from './conversation';
import { launchView, openCarefulFor } from './launch';
import { kTokens } from './shared';
import { v7Attrs } from './s0';
import { onChanged } from './state';
import { surface } from '../mods/surfaces';

export type PanelKind = 'details' | 'diff';
const P = {
  kind: 'details' as PanelKind,
  /** the Context row is open: what fills the context shows under the card */ context: false,
  /** what the last compaction did, said once under the button */ note: null as string | null,
  /** the diff's files that are open (the first is, until the reader folds it) */ folded: new Set<string>(), opened: new Set<string>(),
  refresh: null as (() => void) | null
};
const d = () => data().details;
const base = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
const summary = () => data().sessions.list.get().find((s) => s.id === VIEW.current) ?? data().sessions.archived.get().find((s) => s.id === VIEW.current);
/** the caps the cost row offers (what the v6 control offered) */
export const CAPS = ['$0.30', '$0.60', '$1.00', '$2.00'] as const;
const COMPACT_NOTE = 'Compacting summarises older turns. Files and project memory stay. It runs on its own at 90%.';

/* ───────── opening it ───────── */
function show(kind: PanelKind): void {
  P.kind = kind;
  /* the diff is the tools' width (520), the details the pane's (356): the shell measures `--right-w` (shell.css) */
  document.documentElement.toggleAttribute('data-right-tools', kind === 'diff');
  /* the shell opens the panel and lays the window out again (the width follows what the panel shows) */
  emit('hx:open-panel', { panel: kind === 'diff' ? 'changes' : 'details', from: 'session' });
  P.refresh?.();
}
/** the session's details; `part` opens what its row holds ("context": what fills the context, with Compact) and scrolls to it */
export function openDetails(part?: string): void {
  if (part === 'context') P.context = true;
  show('details');
  const at = part ? document.querySelector<HTMLElement>('#hx-right [data-pane-part="' + part + '"]') : null;
  if (at) { at.scrollIntoView({ block: 'nearest' }); at.setAttribute('data-flash', ''); setTimeout(() => { at.removeAttribute('data-flash'); }, 1200); }
}
/** the session's changed files, as the tools' Diff */
export function openDiff(): void { show('diff'); }
export const panelKind = (): PanelKind => P.kind;

/* ───────── the details (board S40) ───────── */
const note = (name: string): string => { const t = (d().notes.get() as Record<string, string | undefined>)[name]; return t ? '<p class="k7-pane__note" role="status">' + esc(t) + '</p>' : ''; };
const sel = (part: string, label: string, value: string, o: { leadHTML?: string; icon?: string } = {}): string =>
  kit.html.selectorItem({ variant: 'field', label, value, ...(o.leadHTML ? { leadHTML: o.leadHTML } : {}), ...(o.icon ? { icon: o.icon } : {}), attrs: { 'data-pane': part } });

/** what the overflow holds: only what exists (Pin does not yet; Fork where the engine can; Settle puts the session away) */
export function overflowEntries(): Array<{ label: string; value: string; icon: string }> {
  const s = summary();
  if (!s) return [];
  const settled = data().sessions.archived.get().some((x) => x.id === s.id);
  if (settled) return [{ label: 'Restore', value: 'restore', icon: 'unarchive' }];
  return [...(later('pin') ? [{ label: s.pinned ? 'Unpin' : 'Pin', value: 'pin', icon: 'pin' }] : []), ...(data().info.unavailable['sessions.fork'] ? [] : [{ label: 'Fork', value: 'fork', icon: 'fork' }]), { label: 'Settle', value: 'settle', icon: 'check' }];
}

function sessionCard(): string {
  const controls = data().sessionControls;
  const who = answersNext(VIEW.current), view = launchView();
  const rows = [
    { label: 'Model', control: sel('model', 'Model', who.name, who.model ? { leadHTML: ui.html.modelMark(who.model, { size: 14, label: false }) } : { icon: who.icon ?? 'spark' }) },
    ...(view.effort !== null ? [{ label: 'Effort', control: sel('effort', 'Effort', view.effort) }] : []),
    ...(controls ? [{ label: 'How careful', control: sel('careful', 'How careful', CAREFUL[view.careful].name) }] : []),
    /* where it works: a worktree once that choice exists (S40); until then the folder it was started in, which is what is known */
    ...(later('worktree') ? [{ label: 'Workspace', value: 'worktree' }] : view.folder || d().environment.get().cwd ? [{ label: 'Workspace', value: view.folder ?? base(d().environment.get().cwd), mono: true }] : [])
  ];
  return '<h3 class="k7-pane__sec">Session</h3>' + kit.html.card({ variant: 'pane', rows });
}
function useCard(): string {
  const c = d().context.get(), G = d().governance.get(), s = summary();
  const known = c.total > 0;
  const cost = G.spent ? (G.governed && G.cap ? G.spent + ' of ' + G.cap : G.spent) : G.governed && G.cap ? 'cap ' + G.cap : '';
  const rows = [
    { label: 'Context', value: known ? kTokens(c.used) + ' / ' + kTokens(c.total) : 'unknown', mono: known, action: P.context ? 'hides what fills it' : 'shows what fills it', attrs: { 'data-pane': 'context', 'data-pane-part': 'context', 'aria-expanded': String(P.context), 'aria-controls': 'ss-pane-context' } },
    /* the cap is a governed session's: its row changes it (what the v6 "Change cap" did); an ungoverned session has no cap to change */
    ...(cost ? [G.governed ? { label: 'Cost', value: cost, mono: true, action: 'changes the cap', attrs: { 'data-pane': 'cap', 'data-tip': 'Change cap', 'aria-haspopup': 'menu' } } : { label: 'Cost', value: cost, mono: true }] : []),
    ...(later('pull-request') && s?.pullRequest ? [{ label: 'Pull request', valueHTML: '<span class="k7-row__link">' + esc(s.pullRequest) + '</span>', value: s.pullRequest, action: 'opens it', attrs: { 'data-pane': 'pr' } }] : [])
  ];
  /* what the engine cannot say of the cost, or why governance does not apply, in words under the card */
  return '<h3 class="k7-pane__sec">Use</h3>' + kit.html.card({ variant: 'pane', rows }) + (P.context ? contextMore() : '') + note('governance');
}
/** what fills the context, part by part, and the way to shrink it: the kit's Disclosure under the Use card, opened by the Context row */
function contextMore(): string {
  const c = d().context.get(), can = d().can.get().compact;
  const said = P.note; P.note = null;
  return kit.html.disclosure({
    summary: 'What fills the context', open: true, attrs: { 'data-pane-open': 'context', id: 'ss-pane-context' },
    steps: c.total > 0 ? c.parts.map(([label, tokens]) => ({ text: cap1(label), time: kTokens(tokens), state: 'log' as const })) : [],
    after: kit.html.button({ label: 'Compact conversation', size: 28, variant: 'tint', ...(can ? {} : { disabled: true }), attrs: { 'data-pane': 'compact' } }) +
      '<p class="k7-pane__note"' + (said ? ' role="status"' : '') + '>' + esc(said ?? COMPACT_NOTE) + '</p>' + note('context')
  });
}
function environmentCard(): string {
  const e = d().environment.get();
  const rows = ([['Folder', e.cwd], ['Branch', e.branch], ['Sandbox', e.sandbox], ['Runtime', e.runtime], ['Harness', e.harness], ['Gate', e.gate]] as const)
    .filter(([, v]) => !!v).map(([label, v]) => ({ label, value: v.split(/\s+·\s+/).join(', '), mono: true, attrs: { 'data-tip': v.split(/\s+·\s+/).join(', '), tabindex: '0' } }));
  if (!rows.length && !note('environment')) return '';
  return '<h3 class="k7-pane__sec" data-pane-part="environment">Environment</h3>' + (rows.length ? kit.html.card({ variant: 'pane', rows }) : '') + note('environment');
}
function connectorsCard(): string {
  const can = d().can.get(), list = d().connectors.get();
  const rows = list.map((c) => ({
    label: cap1(c.name), sub: c.hint ?? c.tools + ' tools',
    control: c.state === 'sign in'
      ? kit.html.button({ label: 'Sign in', size: 28, variant: 'tint', ...(can.signIn ? {} : { disabled: true }), attrs: { 'data-signin': c.name } })
      : kit.html.switch({ label: cap1(c.name), checked: c.state === 'on', ...(can.connectors ? {} : { disabled: true }), attrs: { 'data-conn': c.name } })
  }));
  const none = !list.length && data().info.live ? '<p class="k7-pane__note">No connectors are set up yet.</p>' : '';
  return '<h3 class="k7-pane__sec" data-pane-part="connectors">Connectors</h3>' + kit.html.card({ variant: 'pane', rows: [...rows, { label: 'Browse the store', action: 'opens the store', attrs: { 'data-pane': 'store' } }] }) + none;
}
/** the details pane's markup for the open session (pure but for its reads): the tests and the lab read it as the app draws it */
export function detailsHTML(o: { overlay?: boolean; strip?: Parameters<typeof kit.html.pane>[0]['strip'] } = {}): string {
  const s = summary(), e = d().environment.get();
  const title = s?.title ?? 'New session';
  return kit.html.pane({
    variant: 'session', title, label: title + ', details', ...(o.overlay ? { overlay: true } : {}), ...(o.strip ? { strip: o.strip } : {}),
    ...(s?.project || e.cwd ? { folder: s?.project || base(e.cwd) } : {}), ...(e.branch || s?.branch ? { branch: e.branch || s?.branch } : {}), more: overflowEntries().length > 0,
    body: sessionCard() + useCard() + environmentCard() + connectorsCard()
  });
}

/* ───────── the diff (board S24's Diff tab, alone) ───────── */
/** a file's hunks as the kit DiffView's lines: a hunk's header gives its first line's number; a removed line keeps the old one */
export function diffLines(f: DiffFile): DiffLine[] {
  const out: DiffLine[] = [];
  for (const [h, lines] of f.hunks) {
    let n = +((/\+(\d+)/.exec(h) ?? [0, 1])[1] ?? 1), old = +((/-(\d+)/.exec(h) ?? [0, n])[1] ?? n);
    for (const l of lines) {
      const sign = l[0] === '+' ? '+' : l[0] === '-' ? '-' : ' ';
      out.push({ n: sign === '-' ? old++ : n++, sign, text: l.slice(1) });
      if (sign === ' ') old++;
    }
  }
  return out;
}
export function diffHTML(o: { overlay?: boolean } = {}): string {
  const files = data().sessions.diff(VIEW.current, { blank: VIEW.blank });
  const add = files.reduce((a, f) => a + f.add, 0), del = files.reduce((a, f) => a + f.del, 0);
  const summaryHTML = files.length ? esc(files.length + (files.length === 1 ? ' file' : ' files')) + '<span class="k7-files__counts k7-mono"><span data-tone="add">+' + add + '</span><span data-tone="del">−' + del + '</span></span>' : 'Diff';
  const body = files.length
    ? files.map((f, i) => kit.html.diffView({ path: f.path, lines: diffLines(f), add: f.add, del: f.del, fold: true, open: P.opened.has(f.path) || (i === 0 && !P.folded.has(f.path)), attrs: { 'data-file': f.path } })).join('')
    : kit.html.emptyState({ text: data().info.live ? 'Nothing has shipped in this session.' : 'No changes yet.' });
  return kit.html.pane({ variant: 'tools', tabs: false, summary: summaryHTML, label: 'Diff', ...(o.overlay ? { overlay: true } : {}), body: body + note('changes') });
}

/* ───────── drawing and wiring ───────── */
export function mountDetails(root: HTMLElement): void {
  root.classList.add('ss-pane');
  P.kind = 'details'; P.context = false; P.note = null; P.folded.clear(); P.opened.clear();
  const isOpen = (): boolean => state.right === 'open';
  const overlay = (): boolean => document.getElementById('hx-app')?.dataset['rightMode'] === 'overlay';
  let last = '';

  function draw(): void {
    if (!isOpen()) { if (last) { root.replaceChildren(); last = ''; } if (P.kind === 'diff') { P.kind = 'details'; document.documentElement.removeAttribute('data-right-tools'); } return; }
    /* a mod's panes are tabs of this panel (MODS.md section 3): the strip shows only while there is one */
    const tabs = P.kind === 'details' ? surface.panelTabs?.() ?? null : null;
    const strip = tabs ? { label: 'Session details and mod panes', items: tabs.items, value: tabs.value } : undefined;
    const mod = tabs && tabs.value !== 'details' ? tabs.body() : null;
    const html = P.kind === 'diff' ? diffHTML({ overlay: overlay() })
      : mod ? kit.html.pane({ variant: 'session', label: tabs?.label ?? 'Mod pane', ...(overlay() ? { overlay: true } : {}), ...(strip ? { strip } : {}), body: '<div class="ss-pane__mod" role="tabpanel"></div>' })
      : detailsHTML({ overlay: overlay(), ...(strip ? { strip } : {}) });
    const sig = html + (mod ? '\u0000' + (tabs?.sig ?? '') : '');
    if (sig === last) return;
    const a = document.activeElement as HTMLElement | null, held = a && root.contains(a) ? a.closest<HTMLElement>('[data-pane], [data-conn], [data-file], [data-pane-more], [data-pane-close]') : null;
    const scroll = root.querySelector('.k7-pane__body')?.scrollTop ?? 0;
    last = sig;
    root.innerHTML = html;
    if (mod) root.querySelector('.ss-pane__mod')?.append(mod);
    kit.wire(root);
    const body = root.querySelector<HTMLElement>('.k7-pane__body');
    if (body) { body.classList.add('ui-scroll'); body.scrollTop = scroll; }
    root.querySelector<HTMLElement>('[data-pane="model"], [data-pane-close]')?.setAttribute('data-hx-focus', 'panel');
    /* the focus stays on the control it was on across a redraw */
    if (held) {
      const key = held.dataset['pane'] ? '[data-pane="' + held.dataset['pane'] + '"]' : held.dataset['conn'] ? '[data-conn="' + CSS.escape(held.dataset['conn']) + '"]' : held.dataset['file'] ? '[data-file="' + CSS.escape(held.dataset['file']) + '"] > button' : held.hasAttribute('data-pane-more') ? '[data-pane-more]' : '[data-pane-close]';
      root.querySelector<HTMLElement>(key)?.focus({ preventScroll: true });
    }
  }

  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-pane-close]')) { setState({ right: 'closed' }); return; }
    const more = t.closest<HTMLElement>('[data-pane-more]');
    if (more) { openOverflow(more); return; }
    const sign = t.closest<HTMLButtonElement>('[data-signin]');
    if (sign) { sign.disabled = true; const l = sign.querySelector('span'); if (l) l.textContent = 'Connecting'; void d().signIn(sign.dataset['signin'] as string); return; }
    const p = t.closest<HTMLElement>('[data-pane]');
    if (!p) return;
    const part = p.dataset['pane'];
    if (part === 'model') openWhoAnswers(p, { sessionId: VIEW.current, place: 'below', align: 'end', then: draw });
    else if (part === 'effort') openEffortMenu(p);
    else if (part === 'careful') openCarefulFor(p, 'below');
    else if (part === 'context') { P.context = !P.context; draw(); }
    else if (part === 'cap') openCap(p);
    else if (part === 'compact') { (p as HTMLButtonElement).disabled = true; void d().compactContext().then((freed) => { P.note = freed ? 'Compacted. Freed ' + kTokens(freed) + ' tokens.' : 'Nothing left to compact.'; last = ''; draw(); }); }
    else if (part === 'store') emit('hx:open-store', { screen: 'browse', from: 'details' });
    else if (part === 'pr') data().sessions.openPullRequest(VIEW.current);
  });
  root.addEventListener('ui:change', (e) => {
    const t = e.target as HTMLElement, v = (e as CustomEvent<{ value: boolean | string }>).detail.value;
    const conn = t.closest<HTMLElement>('[data-conn]');
    if (conn) { d().setConnector(conn.dataset['conn'] as string, v === true); return; }
    /* the strip: the session's details, or a mod's pane */
    if (t.closest('.k7-pane__tabs')) { surface.panelTabs?.()?.select(String(v)); draw(); requestAnimationFrame(() => { root.querySelector<HTMLElement>('.k7-pane__tabs [aria-selected="true"], .k7-pane__tabs [aria-checked="true"]')?.focus(); }); }
  });
  /* which of the diff's files are open is the reader's, kept across a redraw; the context's own chevron folds it away again */
  root.addEventListener('ui:toggle', (e) => {
    if ((e.target as HTMLElement).closest('[data-pane-open="context"]')) { e.preventDefault(); P.context = false; draw(); root.querySelector<HTMLElement>('[data-pane="context"]')?.focus({ preventScroll: true }); return; }
    const f = (e.target as HTMLElement).closest<HTMLElement>('[data-file]')?.dataset['file'];
    if (!f) return;
    const open = (e as CustomEvent<{ open: boolean }>).detail.open;
    if (open) { P.opened.add(f); P.folded.delete(f); } else { P.folded.add(f); P.opened.delete(f); }
    last = '';   /* the page now differs from what was written: the next draw writes it again, as the reader left it */
  });
  /* KEYMAP section 9: the arrows move between the panel's stops (its selectors, the rows that open something, its switches and
     buttons); Esc in the diff closes it (the details stay until their button closes them) */
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && P.kind === 'diff' && !e.defaultPrevented) { e.preventDefault(); setState({ right: 'closed' }); return; }
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const stops = [...root.querySelectorAll<HTMLElement>('.k7-pane__head button, .k7-pane__body button:not(:disabled), .k7-pane__body .k7-row[data-action], .k7-pane__body [tabindex="0"]')].filter((x) => !x.closest('.ss-pane__mod'));
    const i = stops.indexOf(e.target as HTMLElement);
    const to = i < 0 ? undefined : stops[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (to) { e.preventDefault(); to.focus(); }
  });

  function openCap(anchor: HTMLElement): void {
    const cap = d().governance.get().cap;
    kit.openMenu(anchor, { label: 'Change cap', place: 'below', align: 'end', attrs: v7Attrs(), entries: [{ heading: 'Change cap: stop the session at' }, ...CAPS.map((v) => ({ label: v, value: v, checked: v === cap, role: 'menuitemradio' }))], onSelect: (v) => { setGovernance({ cap: v }); } });
  }
  function openOverflow(anchor: HTMLElement): void {
    const id = VIEW.current, s = summary();
    kit.openMenu(anchor, { label: 'More for this session', place: 'below', align: 'end', attrs: v7Attrs(), entries: overflowEntries(), onSelect: (v) => {
      if (v === 'fork') { const n = data().sessions.fork(id); if (n) { selectSession(n.id); ui.announce('Forked ' + (s?.title ?? '')); } }
      else if (v === 'settle') { data().sessions.archive(id); ui.announce('Settled ' + (s?.title ?? '')); }
      else if (v === 'restore') data().sessions.restore(id);
    } });
  }

  P.refresh = draw;
  surface.redrawRight = () => { last = ''; draw(); };
  on('hx:state', draw);
  on('hx:layout', draw);
  /* the palette's and the keys' ways in: a part of the details, or the diff ("changes") */
  on('hx:open-panel', (e) => { if (e.from === 'session') return; if (e.panel === 'changes') openDiff(); else openDetails(e.panel === 'context' ? 'context' : e.panel === 'connectors' || e.panel === 'environment' ? e.panel : undefined); });
  for (const w of [d().context, d().governance, d().notes, d().can, d().changes, d().connectors, d().environment, d().choices]) (w as { subscribe(fn: () => void): unknown }).subscribe(draw);
  data().sessions.list.subscribe(draw); data().sessions.archived.subscribe(draw); data().council.subscribe(draw);
  const c = data().sessionControls;
  c?.launch.subscribe(draw); c?.capabilities.subscribe(draw);
  onChanged(draw);
  draw();
}
