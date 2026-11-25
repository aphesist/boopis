/* The Session tab's wave S0 on the v7 kit (DESIGN-SYSTEM.md v7 20.1 and 21; SESSION-TAB.md 1, 2, 6, 12; the owner's picks
   S01 B, S02 B, S41 A): the new session's canvas with its launch row, the "How careful" menu of four rows, the lines the
   thread says about itself (a setting changed, a rewind), the rewind on a finished turn and its dry-run sheet. Every piece
   is a kit component (`kit.*` from `@boopis/ui`) on a v7 root; this file only composes them and wires them to what the
   session view hands it. The canvas is the kit's documented pattern (21.2, "the new session's canvas"). */
import { on } from '../../core/bus';
import { kit } from '@boopis/ui';
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

/* ───────── the new session's canvas (S41 A) ───────── */
export interface LaunchView {
  /** the folder's name, null when none is chosen (the canvas then asks for one) */
  folder: string | null;
  /** the model's readable name, or null when no model is signed in ("+ Choose a model") */
  model: string | null;
  /** "Default", or the effort's name; null when the engine cannot set it */
  effort: string | null;
  careful: CarefulStep;
  /** the person's pick fell back (no trusted gate): the row says so */
  fellBack: boolean;
  /** the sessions waiting on the person, one line each */
  waiting: readonly { title: string; sub: string; count?: string }[];
}
export interface LaunchActions {
  folder(anchor: HTMLElement): void;
  model(anchor: HTMLElement): void;
  effort(anchor: HTMLElement): void;
  careful(anchor: HTMLElement): void;
  /** a session waiting on you: open it */
  open?(index: number): void;
}
const GREETING = 'What\'s next for boopis?';
const NO_FOLDER = 'Add a folder to start';
export function launchCanvas(v: LaunchView, act: LaunchActions): HTMLElement {
  const c = document.createElement('div');
  c.className = 'ss-s0-canvas';
  c.setAttribute('data-kit-part', 'NewSession');
  const mark = kit.avatar({ variant: 'logomark', ...(v.model === null ? { state: 'sleeping', label: 'boopis, asleep' } : { label: 'boopis' }) });
  const hello = document.createElement('p');
  hello.className = 'ss-s0-hello';
  hello.textContent = v.folder === null ? NO_FOLDER : GREETING;
  const row = document.createElement('div');
  row.className = 'ss-s0-launch';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'How the session starts');
  if (v.folder === null) {
    const add = kit.button({ label: 'Add a project', variant: 'secondary', size: 32, icon: 'folder' });
    add.addEventListener('click', () => { act.folder(add); });
    row.append(add);
  } else {
    const item = (o: Parameters<typeof kit.selectorItem>[0], fn: (a: HTMLElement) => void): HTMLElement => { const n = kit.selectorItem({ variant: 'launch', ...o }); n.addEventListener('click', () => { fn(n); }); return n; };
    row.append(item({ label: 'Folder', value: v.folder, icon: 'folder' }, act.folder));
    row.append(v.model === null
      ? item({ label: 'Model', value: '+ Choose a model', need: true, chevron: false }, act.model)
      : item({ label: 'Model', value: v.model }, act.model));
    if (v.effort !== null) row.append(item({ label: 'Effort', value: v.effort }, act.effort));
    const careful = item({ label: 'How careful', value: CAREFUL[v.careful].name, ticks: ticksOf(v.careful), ...(v.fellBack ? { attrs: { 'data-tip': 'This project has no trusted gate, so new sessions here start Supervised.' } } : {}) }, act.careful);
    careful.setAttribute('data-step', v.careful);
    row.append(careful);
  }
  c.append(mark, hello, row);
  if (v.waiting.length) {
    const list = kit.list({ label: 'Waiting on you', rows: v.waiting.map((w) => ({ variant: 'compact' as const, title: w.title, sub: w.sub, needs: true, ...(w.count ? { count: w.count } : {}) })) });
    list.addEventListener('click', (e) => { const r = (e.target as Element).closest('[data-kit~="ListRow"]'); if (r) act.open?.([...list.children].indexOf(r)); });
    c.append(kit.sectionHead({ title: 'Waiting on you', count: String(v.waiting.length) }), list);
  }
  return asV7(c);
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
  if (l.kind === 'settings') return l.text + (l.cost ? ' · ' + l.cost : '');
  const files = l.files + (l.files === 1 ? ' file' : ' files');
  return l.action === 'undone' ? 'Rewind undone · ' + files : 'Files rewound to ' + l.to.label + ' · ' + files;
}
export function lineEl(l: ThreadLine, onUndo?: (shipId: string) => void): HTMLElement {
  const undo = l.kind === 'checkpoint' && l.undoShipId !== null && onUndo ? l.undoShipId : null;
  const n = kit.systemLine({ variant: 'info', text: lineText(l), icon: l.kind === 'settings' ? 'sliders' : 'back', ...(undo ? { action: 'Undo' } : {}), attrs: { 'data-line-id': l.id } });
  if (undo && onUndo) n.querySelector('[data-line]')?.addEventListener('click', () => { onUndo(undo); });
  const w = document.createElement('div');
  w.className = 'ss-s0-line';
  w.setAttribute('data-line-id', l.id);
  w.append(n);
  return asV7(w);
}

/* ───────── the rewind on a finished turn (TurnFoot, session) and its sheet (Dialog, form) ───────── */
export const REWIND_HERE = 'Rewind files to here';
export const REWIND_BASE = 'Rewind to before this session';
export function rewindFoot(o: { first: boolean; avail: Avail; onRewind(to: 'here' | 'base'): void }): HTMLElement {
  /* every turn that kept a change goes back to after it; the first one also to before the session (checkpoint-rewind.md 8): one
     action per foot, so a narrow column never pushes the second out of the turn */
  const tip = o.avail.ok ? {} : { disabled: true, tip: o.avail.why };
  const w = document.createElement('div');
  w.className = 'ss-s0-foot';
  const list: readonly (readonly [string, 'here' | 'base'])[] = [[REWIND_HERE, 'here'], ...(o.first ? [[REWIND_BASE, 'base'] as const] : [])];
  for (const [label, value] of list) {
    const f = kit.turnFoot({ kind: 'session', actions: [{ label, value, ...tip }] });
    f.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('.k7-foot__btn');
      if (b && !b.disabled && o.avail.ok) o.onRewind(value);
    });
    w.append(f);
  }
  return asV7(w);
}

const ACTION_WORD = { restore: 'put back', delete: 'removed', recreate: 'brought back' } as const;
const MAX_FILES = 12;
/** the sheet's body: what the rewind would do, file by file, and the guard's verdict (or why it will not run) */
export function rewindBody(r: RewindResult): string {
  if (r.status === 'refused') return '<p class="k7-type-s ss-s0-why">' + kit.html.statusWord({ text: 'Refused', tone: 'red' }) + ' ' + esc(r.why ?? 'The rewind was refused.') + '</p>';
  if (r.status === 'nothing_to_do') return '<p class="k7-type-s">Nothing to rewind: the files are already as they were then.</p>';
  /* the path in mono, as the kit's file rows draw it (FilesCard); what happens to it in words */
  const rows = r.files.slice(0, MAX_FILES).map((f) => ({ label: f.path, labelHTML: '<span class="k7-mono k7-ell">' + esc(f.path) + '</span>', value: ACTION_WORD[f.action] }));
  const more = r.files.length > MAX_FILES ? '<p class="k7-type-s ss-s0-more">And ' + (r.files.length - MAX_FILES) + ' more files.</p>' : '';
  const verdict = r.isolation === 'own_worktree' ? 'This folder is this session\'s own worktree.' : 'Nothing else changed in this folder since this session\'s last change.';
  return kit.html.card({ variant: 'pane', rows }) + more +
    '<p class="k7-type-s ss-s0-why">' + esc(verdict) + ' The rewind is recorded and can be undone.</p>';
}
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c] as string));
export interface RewindSheet { el: HTMLElement; close(): void }
/** the dry-run sheet: the files, the guard's verdict, Rewind or Cancel; a refusal shows why and Close only */
export function rewindSheet(r: RewindResult, title: string, on: { onConfirm(): void; closed?(): void }): RewindSheet {
  const can = r.status === 'planned';
  const node = kit.dialog({ title, body: rewindBody(r), actions: can ? [{ label: 'Cancel', variant: 'ghost' }, { label: 'Rewind', variant: 'primary' }] : [{ label: 'Close', variant: 'ghost' }], attrs: v7Attrs() });
  asV7(node);
  const prev = document.activeElement as HTMLElement | null;
  const close = (): void => { const wrap = node.parentElement?.classList.contains('ss-s0-sheet') ? node.parentElement : null; node.remove(); wrap?.remove(); document.removeEventListener('keydown', key, true); on.closed?.(); prev?.focus?.(); };
  const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  node.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t === node || t.closest('[data-dialog-close]')) { close(); return; }
    const b = t.closest<HTMLButtonElement>('.k7-dialog__foot .k7-btn');
    if (!b) return;
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
  requestAnimationFrame(() => { s.el.querySelector<HTMLElement>('.k7-dialog__foot .k7-btn:last-child')?.focus(); });
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
