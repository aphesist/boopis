/* The Session tab's wave S0 on the v7 kit (DESIGN-SYSTEM.md v7 20.1 and 21; SESSION-TAB.md 1, 2, 6, 12; the owner's picks
   S01 B, S02 B, S41 A): the new session's canvas with its launch row, the "How careful" menu of four rows, the lines the
   thread says about itself (a setting changed, a rewind), the rewind on a finished turn and its dry-run sheet. Every piece
   is a kit component (`kit.*` from `@boopis/ui`) on a v7 root; this file only composes them and wires them to what the
   session view hands it. The canvas is the kit's documented pattern (21.2, "the new session's canvas"). */
import { on } from '../../core/bus';
import { kit, ui } from '@boopis/ui';
import { esc } from '../../core/dom';

const markHTML = (ref: string, o: { size: number; label: false }): string => ui.html.modelMark(ref, o);
const shortName = (ref: string): string => ui.modelMark.short(ref);
import { themeApi } from '../../styles/theme';
import { loadFont } from '../../styles/fonts';
import { CAREFUL, CAREFUL_STEPS } from '../../data/session-s0';
import type { Avail, CarefulStep, RewindResult, ThreadLine } from '../../data/session-s0';

/* ───────── the v7 root ───────── */
/* the scheme of the v7 root the page already is (the app's root once wave C moves it; the lab's body), else the app's own */
const mode = (): 'dark' | 'light' => {
  const root = document.querySelector('html[data-ui="v7"], body[data-ui="v7"], #hx-app[data-ui="v7"]');
  const t = root?.getAttribute('data-theme');
  return t === 'light' || t === 'dark' ? t : themeApi.scheme();
};
/** the attributes that make a floating piece (a menu, the sheet) a v7 root of its own, in the app's scheme */
export const v7Attrs = (): Record<string, string> => ({ 'data-ui': 'v7', 'data-theme': mode() });
const roots = new Set<WeakRef<HTMLElement>>();
let listening = false;
/** make `el` a v7 root in the app's scheme, and keep it in step when the scheme changes (wave C: until the app's root is v7) */
export function asV7<T extends HTMLElement>(el: T): T {
  kit.applyTheme(el, { theme: mode() });
  /* a v7 island on a v6 page is its own ground: its tokens resolve here, not on the page's root (the lab's token check reads
     [data-ground] as such a place, as it does the dock's black) */
  el.setAttribute('data-ground', 'v7');
  void loadFont('Geist'); void loadFont('Geist Mono');
  roots.add(new WeakRef(el));
  if (!listening) {
    listening = true;
    /* the app's theme, or the page's v7 root, changed: each root follows (applying the same theme again is a no-op, so the kit's
       own event for a root this changes ends here) */
    on('hx:theme', () => {
      for (const r of [...roots]) { const n = r.deref(); if (!n) { roots.delete(r); continue; } if (n.getAttribute('data-theme') !== mode()) kit.applyTheme(n, { theme: mode() }); }
    });
  }
  return el;
}

/* ───────── the "How careful" menu (S01 B: four rows, each with its one-line meaning) ───────── */
export const FOOT_DEFAULT = 'The default for new sessions is in Settings, Sessions.';
export interface CarefulMenuOpts {
  current: CarefulStep;
  /** each step's availability: a step that cannot be honoured stays in its place, says why, and cannot be picked */
  avail: Readonly<Record<CarefulStep, Avail>>;
  place?: 'above' | 'below';
  onPick(step: CarefulStep): void;
}
export function carefulEntries(o: Pick<CarefulMenuOpts, 'current' | 'avail'>): Parameters<typeof kit.html.menu>[0]['entries'] {
  return [
    { heading: 'How careful' },
    ...CAREFUL_STEPS.map((s) => {
      const a = o.avail[s];
      return { label: CAREFUL[s].name, meaning: a.ok ? CAREFUL[s].meaning : a.why, value: s, chosen: s === o.current, ...(a.ok ? {} : { disabled: true, attrs: { 'data-tip': a.why } }) };
    }),
    '-',
    { heading: FOOT_DEFAULT }
  ];
}
export function openCarefulMenu(anchor: HTMLElement, o: CarefulMenuOpts): HTMLElement | null {
  return kit.openMenu(anchor, { label: 'How careful', variant: 'options', entries: carefulEntries(o), place: o.place ?? 'below', align: 'center', attrs: v7Attrs(), onSelect: (v) => { o.onPick(v as CarefulStep); } });
}
/** the step as a selector's ticks: one to four, Supervised to Full access */
export const ticksOf = (s: CarefulStep): { of: number; on: number } => ({ of: 4, on: CAREFUL_STEPS.indexOf(s) + 1 });

/* ───────── the new session's canvas (boards S17, S37 and S41 A; sessionnew.js newSess, kit.css `.ns`) ─────────
   The "oo" logomark, the greeting, the launch row of quiet selectors (the folder, the worktree, the model with its provider's mark,
   the effort with its five ticks, how careful with the shield), and the sessions waiting on you, one line each. */
export interface LaunchView {
  /** the folder's name, null when none is chosen (the canvas then asks for one) */
  folder: string | null;
  /** the model that answers (its mark leads its short name), or null when no model is signed in ("+ Choose a model") */
  model: string | null;
  /** "Default", or the effort's name; null when the engine cannot set it */
  effort: string | null;
  /** the effort as ticks of five (Default is three) */
  effortTicks: number;
  careful: CarefulStep;
  /** the person's pick fell back (no trusted gate): the row says so */
  fellBack: boolean;
  /** the worktree choice exists (it does not yet: every session takes a new worktree) */ worktree?: boolean;
  /** the sessions waiting on the person, one line each: the model's mark, the title, where it works, what it waits for */
  waiting: readonly { id: string; title: string; sub: string; word: string; model: string | null }[];
}
export interface LaunchActions {
  folder(anchor: HTMLElement): void;
  model(anchor: HTMLElement): void;
  effort(anchor: HTMLElement): void;
  careful(anchor: HTMLElement): void;
  /** a session waiting on you: open it */
  open?(id: string): void;
  /** no model is signed in: go to where `lab` is signed in ("Claude", "ChatGPT", "Gemini"), or to every way there is ('') */
  signin?(lab: string): void;
}
/** S37: what the canvas says when no model is signed in, and the labs it offers first (each by a model of its family, for its mark) */
export const NO_MODEL = 'boopis needs a model to think with. Sign in once and every session can use it.';
export const LABS: readonly (readonly [name: string, model: string])[] = [['Claude', 'claude-sonnet'], ['ChatGPT', 'gpt-5'], ['Gemini', 'gemini-pro']];
const NO_FOLDER = 'Add a folder to start';
export function launchCanvas(v: LaunchView, act: LaunchActions): HTMLElement {
  const c = document.createElement('div');
  c.className = 'ss-new__canvas';
  c.setAttribute('data-kit-part', 'NewSession');
  const hello = '<p class="k7-type-2xl ss-new__h">' + (v.folder === null ? NO_FOLDER : 'What’s next for ' + esc(v.folder) + '?') + '</p>';
  const sel = (o: Parameters<typeof kit.html.selectorItem>[0], act0: string): string => kit.html.selectorItem({ variant: 'launch', ...o, attrs: { 'data-launch': act0, ...(o.attrs ?? {}) } });
  const row = v.folder === null
    ? kit.html.button({ label: 'Add a project', variant: 'primary', icon: 'folder', attrs: { 'data-launch': 'folder' } })
    : sel({ label: 'Folder', value: v.folder, icon: 'folder' }, 'folder') +
      /* where a session works is not a choice yet (every session takes a new worktree): the selector shows once it is */
      (v.worktree ? sel({ label: 'Workspace', value: 'New worktree', icon: 'fork' }, 'worktree') : '') +
      (v.model === null ? sel({ label: 'Model', value: 'Choose a model', icon: 'plus', need: true, chevron: false }, 'model') : sel({ label: 'Model', value: shortName(v.model) || v.model, leadHTML: markHTML(v.model, { size: 14, label: false }) }, 'model')) +
      (v.effort !== null && v.model !== null ? sel({ label: 'Effort', value: v.effort, ticks: { of: 5, on: v.effortTicks } }, 'effort') : '') +
      sel({ label: 'How careful', value: CAREFUL[v.careful].name, icon: 'shield', attrs: { 'data-step': v.careful, ...(v.fellBack ? { 'data-tip': 'No trusted gate here, so sessions start Supervised.' } : {}) } }, 'careful');
  const waiting = v.waiting.length
    ? '<div class="ss-new__wait">' + kit.html.sectionHead({ title: 'Waiting on you', count: String(v.waiting.length) }) +
      v.waiting.map((w) => kit.html.listRow({ variant: 'compact', title: w.title, sub: w.sub, needs: true, count: w.word, ...(w.model ? { model: w.model } : {}), attrs: { 'data-open': w.id, role: 'button', tabindex: '0', 'aria-selected': null } })).join('') + '</div>'
    : '';
  /* written as markup: the logomark is a custom element, drawn when it is in the page */
  c.innerHTML = kit.html.avatar({ variant: 'logomark', ...(v.model === null ? { state: 'sleeping', label: 'boopis, asleep' } : { label: 'boopis' }) }) + hello +
    '<div class="ss-new__launch" role="group" aria-label="How the session starts">' + row + '</div>' +
    /* no model yet (board S37): said kindly inside the canvas, with the sign-ins that exist one press away */
    (v.folder !== null && v.model === null ? kit.html.block({ variant: 'offer', text: NO_MODEL, body: '', attrs: { role: 'group', 'aria-label': 'Sign in to a model' }, actions: LABS.map(([name, model]) => kit.html.button({ label: name, size: 28, leadHTML: markHTML(model, { size: 14, label: false }), attrs: { 'data-signin': name } })).join('') + kit.html.button({ label: 'More', size: 28, variant: 'ghost', attrs: { 'data-signin': '' } }) }) : '') + waiting;
  c.addEventListener('keydown', (e) => { const r = (e.target as Element).closest<HTMLElement>('[data-open]'); if (r && e.target === r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); r.click(); } });
  c.addEventListener('click', (e) => {
    const t = e.target as Element;
    const open = t.closest<HTMLElement>('[data-open]');
    if (open) { act.open?.(open.dataset['open'] as string); return; }
    const lab = t.closest<HTMLElement>('[data-signin]');
    if (lab) { act.signin?.(lab.dataset['signin'] ?? ''); return; }
    const b = t.closest<HTMLElement>('[data-launch]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const k = b.dataset['launch'];
    if (k === 'folder') act.folder(b); else if (k === 'model') act.model(b); else if (k === 'effort') act.effort(b); else if (k === 'careful') act.careful(b);
  });
  return c;
}
/** the logomark looks at the composer while you type and lets go 1.2 s after the last key (20.1); focus alone does not move it */
export function watchTyping(canvas: HTMLElement, input: HTMLElement): () => void {
  let timer = 0;
  const logo = (): (HTMLElement & { look?: (x?: number, y?: number) => unknown }) | null => canvas.querySelector('boopis-logo');
  const onInput = (): void => {
    const l = logo(); if (!l?.look) return;
    const empty = !(input as HTMLTextAreaElement).value && !input.textContent;
    clearTimeout(timer);
    if (empty) { l.look(); return; }
    l.look(0, -1);
    timer = window.setTimeout(() => { logo()?.look?.(); }, 1200);
  };
  input.addEventListener('input', onInput);
  return () => { clearTimeout(timer); input.removeEventListener('input', onInput); };
}

/* ───────── the lines the thread says about itself (SystemLine) ───────── */
export function lineText(l: ThreadLine): string {
  if (l.kind === 'settings') return l.text;
  const files = l.files + (l.files === 1 ? ' file' : ' files');
  return l.action === 'undone' ? 'Rewind undone · ' + files : 'Files rewound to ' + l.to.label + ' · ' + files;
}
export function lineEl(l: ThreadLine, onUndo?: (shipId: string) => void): HTMLElement {
  const undo = l.kind === 'checkpoint' && l.undoShipId !== null && onUndo ? l.undoShipId : null;
  /* a changed setting says what it costs on the next reply at its end, in mono (board S33: "+$0.04"), and in full in its tip */
  const cost = l.kind === 'settings' ? l.cost : null;
  const n = kit.systemLine({ variant: 'info', text: lineText(l), ...(cost ? { meta: cost } : {}), icon: l.kind === 'settings' ? 'sliders' : 'back', ...(undo ? { action: 'Undo' } : {}), attrs: { 'data-line-id': l.id, ...(l.kind === 'settings' && l.costWhy ? { 'data-tip': l.costWhy, tabindex: '0' } : {}) } });
  if (undo && onUndo) n.querySelector('[data-line]')?.addEventListener('click', () => { onUndo(undo); });
  const w = document.createElement('div');
  w.className = 'ss-s0-line';
  w.setAttribute('data-line-id', l.id);
  if (l.kind === 'settings' && l.what) w.setAttribute('data-line-what', l.what);
  w.append(n);
  return asV7(w);
}

/* ───────── the rewind's sheet (Dialog, form) ───────── */
export const REWIND_BASE = 'Rewind to before this session';
/* the rewind itself is the turn's foot ("Checkpoint N", Undo: conversation.ts `footCan`, `undoTurn`; board S23); this file keeps its sheet */

const ACTION_WORD = { restore: 'put back', delete: 'removed', recreate: 'brought back' } as const;
const MAX_FILES = 12;
/** why the rewind cannot run here (a shared checkout), said in the disabled Rewind's Tooltip */
export const refusedWhy = (r: RewindResult): string => r.why ?? 'The rewind was refused.';
/** the sheet's body: what the rewind would do, file by file (the kit's FilesCard: each path in mono and what happens to it in words), and
    the guard's verdict; where it cannot run, why, in the words the guard gave (the Rewind button says it again in its Tooltip) */
export function rewindBody(r: RewindResult): string {
  if (r.status === 'nothing_to_do') return '<p class="k7-type-s">Nothing to rewind: the files are already as they were then.</p>';
  const rows = r.files.slice(0, MAX_FILES).map((f) => ({ path: f.path, word: ACTION_WORD[f.action] }));
  const card = rows.length ? kit.html.filesCard({ files: rows, title: r.files.length + (r.files.length === 1 ? ' file' : ' files') }) : '';
  const more = r.files.length > MAX_FILES ? '<p class="k7-type-s ss-s0-more">And ' + (r.files.length - MAX_FILES) + ' more files.</p>' : '';
  if (r.status === 'refused') return card + more + '<p class="k7-type-s ss-s0-why">' + kit.html.statusWord({ text: 'cannot run', tone: 'red' }) + ' ' + esc(refusedWhy(r)) + '</p>';
  const verdict = r.isolation === 'own_worktree' ? 'This folder is this session\'s own worktree.' : 'Nothing else changed in this folder since this session\'s last change.';
  return card + more + '<p class="k7-type-s ss-s0-why">' + esc(verdict) + ' The rewind is recorded and can be undone.</p>';
}
export interface RewindSheet { el: HTMLElement; close(): void }
/** the dry-run sheet (the kit's Dialog in its form shape): the files, the guard's verdict, Rewind and Cancel. Where it cannot run, Rewind
    stays, disabled, and its Tooltip says why; with nothing to rewind, Close alone */
export function rewindSheet(r: RewindResult, title: string, on: { onConfirm(): void; closed?(): void }): RewindSheet {
  const actions = r.status === 'nothing_to_do' ? [{ label: 'Close', variant: 'ghost' as const }]
    : [{ label: 'Cancel', variant: 'ghost' as const }, { label: 'Rewind', variant: 'primary' as const, ...(r.status === 'refused' ? { disabled: true, tip: refusedWhy(r) } : {}) }];
  const node = kit.dialog({ title, body: rewindBody(r), actions, attrs: v7Attrs() });
  asV7(node);
  const prev = document.activeElement as HTMLElement | null;
  const close = (): void => { const wrap = node.parentElement?.classList.contains('ss-s0-sheet') ? node.parentElement : null; node.remove(); wrap?.remove(); document.removeEventListener('keydown', key, true); on.closed?.(); prev?.focus?.(); };
  const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  node.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t === node || t.closest('[data-dialog-close]')) { close(); return; }
    const b = t.closest<HTMLButtonElement>('.k7-dialog__foot .k7-btn');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const label = b.textContent?.trim();
    if (label === 'Rewind') { b.disabled = true; on.onConfirm(); } else close();
  });
  document.addEventListener('keydown', key, true);
  return { el: node, close };
}
export function showSheet(s: RewindSheet): void {
  /* the kit's scrim and dialog, over the whole window (the sheet is modal: Esc, its ×, Cancel or a press on the scrim closes it) */
  const over = document.createElement('div');
  over.className = 'ss-s0-sheet';
  over.append(s.el);
  (document.getElementById('hx-app') ?? document.body).append(over);
  requestAnimationFrame(() => { s.el.querySelector<HTMLElement>('.k7-dialog__foot .k7-btn:last-child:not([aria-disabled="true"])')?.focus() ?? s.el.querySelector<HTMLElement>('.k7-dialog__foot .k7-btn')?.focus(); });
}

/* ───────── a word to the person (the v7 Notice, floating: section 21 merged the toast into it) ───────── */
const SAY_MS = 5000;
let said: HTMLElement | null = null;
/** why a choice was refused, or what happened: one floating Notice at a time, dismissed by its × or after a few seconds */
export function say(text: string): void {
  said?.remove();
  const n = kit.notice({ text, place: 'floating', tone: 'neutral', dismiss: true, attrs: { ...v7Attrs(), 'aria-live': 'polite' } });
  asV7(n);
  n.classList.add('ss-s0-said');
  n.querySelector('[aria-label="Dismiss"]')?.addEventListener('click', () => { n.remove(); });
  (document.getElementById('hx-app') ?? document.body).append(n);
  said = n;
  window.setTimeout(() => { if (said === n) { n.remove(); said = null; } }, SAY_MS);
}
