/* The tasks a turn handed to other models, on the v7 kit (REPASS.md step 6e; the lead's design, no board draws it): a ToolRow each,
   where the turn raised them: the model's mark and short name, the task's title, and its StatusWord (queued, running with its clock,
   done with the time it took, error in red with why in its Tooltip, stopped). What it reported when it ended is quoted under it. A
   Disclosure, "Transcript", opens what it did in a Well, as a compact thread, read only (it is read when first opened). Stop is a ghost
   Button at the row's end, shown only while it runs. A row is drawn again whole when the engine sends a frame (an open transcript stays
   open), and a running clock ticks between frames. Nothing here talks to the engine: it reads `ChildTask`s and calls the provider's
   `stopChild` and `childTranscript`, which are absent where there is nothing to stop or read (the page build). */
import { el } from '../../core/dom';
import { announce, esc, inlineCodeHTML, kit, modelMark } from '@boopis/ui';
import type { ToolRowOpts } from '@boopis/ui';
import type { ChildTask, Turn } from '../../data';
import { childTime, isLive } from '../../host/live/children';

export interface ChildHost {
  /** the conversation's column, where the turns are */
  col(): HTMLElement | null;
  stop?: ((childId: string) => void) | undefined;
  transcript?: ((childId: string) => Promise<readonly Turn[]>) | undefined;
  now(): number;
}

const SEEN = new Map<string, ChildTask>();   /* the latest state of every row on screen: what the clock reads */
const OPEN = new Set<string>();              /* the children whose transcript is open */
const READ = new Map<string, string>();      /* a transcript once read, as the Well's markup (a redraw keeps it) */
let clock = 0;

/** a resumed report that was longer than the turn book keeps (ADR-0036): said, never passed off as the whole report */
export const CUT_NOTE = ' (Shortened when it was saved: the rest is not kept.)';
export const LOADING = 'Reading what it did…';

/** the StatusWord of a task, with its clock where it has one */
export function childWord(c: Pick<ChildTask, 'status' | 'startedAt' | 'seconds'>, now: number): { text: string; tone: 'neutral' | 'red' | 'ok' } {
  const t = childTime(c, now);
  if (c.status === 'running') return { text: 'running' + (t ? ' ' + t : ''), tone: 'neutral' };
  if (c.status === 'done') return { text: 'done' + (t ? ' ' + t : ''), tone: 'neutral' };
  if (c.status === 'failed') return { text: 'error', tone: 'red' };
  return { text: c.status, tone: 'neutral' };   /* queued, stopped */
}
const shortModel = (m: string): string => (m ? modelMark.short(m) || modelMark.called(m) || m : 'a model');

/** what a task's row shows, as the kit's ToolRow */
export function childRow(c: ChildTask, h: Pick<ChildHost, 'now' | 'stop' | 'transcript'>): ToolRowOpts {
  const w = childWord(c, h.now()), live = isLive(c);
  const canOpen = !!h.transcript && !!c.childSession, canStop = !!h.stop && !!c.subagentId && live;
  const summary = c.summary ? c.summary + (c.cut ? CUT_NOTE : '') : '';
  const open = OPEN.has(c.id);
  return {
    kind: 'command', icon: '', text: true, tool: shortModel(c.model), target: c.goal || 'a task', ...(c.model ? { model: c.model } : {}),
    state: c.status === 'running' ? 'running' : c.status === 'failed' ? 'failed' : 'done', word: w.text, wordTone: w.tone,
    ...(c.status === 'failed' ? { wordTip: summary || 'It stopped with an error, and said nothing of why.' } : c.status === 'running' && c.now ? { wordTip: 'Now: ' + c.now } : {}),
    ...(c.status === 'done' && summary ? { note: summary } : {}),
    ...(canStop ? { end: kit.html.button({ label: 'Stop', variant: 'ghost', size: 28, attrs: { 'data-action': 'stop', 'aria-label': 'Stop: ' + (c.goal || 'this task') } }) } : {}),
    ...(canOpen ? { after: kit.html.disclosure({ summary: 'Transcript', open, after: kit.html.well({ kind: 'thread', text: '', html: READ.get(c.id) ?? '<p>' + esc(LOADING) + '</p>', label: 'What this task did, read only' }), attrs: { 'data-action': 'open' } }) } : {}),
    attrs: { 'data-child-id': c.id, 'data-status': c.status }
  };
}

function rowEl(c: ChildTask, h: ChildHost): HTMLElement {
  const node = kit.toolRow(childRow(c, h));
  if (OPEN.has(c.id) && !READ.has(c.id)) fill(node, c, h);
  return node;
}

/** the rows a turn carries (a turn drawn from a snapshot) */
export function childrenBlock(children: readonly ChildTask[], h: ChildHost): HTMLElement {
  const box = el('div', { class: 'ss-children' });
  for (const c of children) { SEEN.set(c.id, c); box.append(rowEl(c, h)); }
  wire(box, h);
  tick(h);
  return box;
}

/** a child started, progressed or ended while its turn is on screen */
export function upsertChild(turnId: string, c: ChildTask, h: ChildHost): void {
  const t = h.col()?.querySelector<HTMLElement>('[data-turn-id="' + turnId + '"]');
  if (!t) return;
  let box = t.querySelector<HTMLElement>('.ss-children');
  if (!box) { box = el('div', { class: 'ss-children' }); t.append(box); wire(box, h); }
  const was = SEEN.get(c.id);
  SEEN.set(c.id, c);
  const at = box.querySelector<HTMLElement>('[data-child-id="' + CSS.escape(c.id) + '"]');
  if (!at) box.append(rowEl(c, h));
  else {
    /* focus inside it stays where it was: the row is drawn again and the focus goes back to the same control */
    const had = at.contains(document.activeElement) ? (document.activeElement as HTMLElement).closest('[data-action]')?.getAttribute('data-action') ?? 'disc' : null;
    const fresh = rowEl(c, h);
    at.replaceWith(fresh);
    if (had) (fresh.querySelector<HTMLElement>('[data-action="' + had + '"] button, [data-action="' + had + '"]') ?? fresh.querySelector<HTMLElement>('.k7-disc__sum'))?.focus({ preventScroll: true });
  }
  if (was && was.status !== c.status && !isLive(c)) announce((c.goal || 'A task') + ': ' + (c.status === 'failed' ? 'error' : c.status));
  tick(h);
}

/** the clock of every running child, once a second, until none runs */
function tick(h: ChildHost): void {
  if (clock) return;
  clock = window.setInterval(() => {
    const live = [...SEEN.values()].filter((c) => c.status === 'running' && c.startedAt != null);
    if (!live.length) { clearInterval(clock); clock = 0; return; }
    for (const c of live) {
      const w = h.col()?.querySelector('[data-child-id="' + CSS.escape(c.id) + '"] > .k7-tool__head > [data-kit~="StatusWord"]');
      if (w) w.textContent = childWord(c, h.now()).text;
    }
  }, 1000);
}
export const resetChildren = (): void => { SEEN.clear(); OPEN.clear(); READ.clear(); if (clock) { clearInterval(clock); clock = 0; } };

/** what a task did, as a compact thread: what it was asked, the steps it took, what it said */
export function transcriptHTML(turns: readonly Turn[]): string {
  if (!turns.length) return '<p>' + esc('It has not written anything yet.') + '</p>';
  return turns.map((t) => {
    if (t.role === 'user') return '<p data-role="user">' + esc(t.text) + '</p>';
    return (t.steps.length ? kit.html.steps(t.steps.map((s) => ({ text: s.title + (s.meta?.length ? '  ' + s.meta.join('  ') : ''), state: s.kind === 'fail' ? 'failed' as const : 'done' as const, ...(s.time ? { time: s.time } : {}) }))) : '') +
      t.paragraphs.map((p) => '<p>' + inlineCodeHTML(p) + '</p>').join('');
  }).join('');
}
function fill(row: HTMLElement, c: ChildTask, h: ChildHost): void {
  const read = h.transcript?.(c.id) ?? Promise.reject(new Error('This build cannot read it.'));
  void read.then((turns) => transcriptHTML(turns), (e: unknown) => '<p>' + esc('Could not read it: ' + (e instanceof Error ? e.message : String(e))) + '</p>').then((html) => {
    READ.set(c.id, html);
    const at = h.col()?.querySelector('[data-child-id="' + CSS.escape(c.id) + '"] .k7-well__thread') ?? row.querySelector('.k7-well__thread');
    if (at) at.innerHTML = html;
  });
}

function wire(box: HTMLElement, h: ChildHost): void {
  box.addEventListener('ui:toggle', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-child-id]'), id = row?.dataset['childId'];
    if (!row || !id) return;
    const open = (e as CustomEvent<{ open: boolean }>).detail.open;
    if (open) OPEN.add(id); else OPEN.delete(id);
    const c = SEEN.get(id);
    if (open && c && !READ.has(id)) fill(row, c, h);
  });
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action="stop"]');
    const id = b?.closest<HTMLElement>('[data-child-id]')?.dataset['childId'];
    if (!b || !id || b.getAttribute('aria-disabled') === 'true') return;
    h.stop?.(id);
    b.setAttribute('aria-disabled', 'true');
    announce('Stopping');
  });
}
