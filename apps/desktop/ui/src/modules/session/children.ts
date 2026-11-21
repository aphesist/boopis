/* The tasks a turn handed to other models, drawn where the turn raised them: one card per child (the kit's `ui.child`), each
   with its model's mark and name, the goal, what it does now, the clock, and how it ended. Two actions: open what the child did,
   read-only, under its card; stop it. A card is replaced whole when the engine sends a frame, and a running clock ticks between
   frames. Nothing here talks to the engine: it reads `ChildTask`s and calls the provider's
   `stopChild` and `childTranscript`, which are absent where there is nothing to stop or read (the page build). */
import { $, el } from '../../core/dom';
import { ui } from '@boopis/ui';
import type { ChildOpts } from '@boopis/ui';
import type { ChildTask, Turn } from '../../data';
import { childTime, isLive } from '../../host/live/children';

export interface ChildHost {
  /** the conversation's column, where the turns are */
  col(): HTMLElement | null;
  stop?: ((childId: string) => void) | undefined;
  transcript?: ((childId: string) => Promise<readonly Turn[]>) | undefined;
  now(): number;
}

const SEEN = new Map<string, ChildTask>();   /* the latest state of every card on screen: what the clock reads */
const OPEN = new Set<string>();              /* the children whose log is open */
let clock = 0;

/** a resumed report that was longer than the turn book keeps (ADR-0036): said, never passed off as the whole report */
export const CUT_NOTE = ' (Shortened when it was saved: the rest is not kept.)';

export const opts = (c: ChildTask, h: Pick<ChildHost, 'now' | 'stop' | 'transcript'>): ChildOpts => ({
  id: c.id, model: c.model || 'a model', goal: c.goal || 'a task', status: c.status, time: childTime(c, h.now()), now: c.now, tools: c.tools, summary: c.cut ? c.summary + CUT_NOTE : c.summary,
  canOpen: !!h.transcript && !!c.childSession, canStop: !!h.stop && !!c.subagentId
});

function card(c: ChildTask, h: ChildHost): HTMLElement {
  const node = ui.child(opts(c, h));
  const open = node.querySelector<HTMLElement>('[data-action="open"]');
  if (open) open.setAttribute('aria-expanded', String(OPEN.has(c.id)));
  return node;
}

/** the block of cards a turn carries (a turn drawn from a snapshot) */
export function childrenBlock(children: readonly ChildTask[], h: ChildHost): HTMLElement {
  const box = el('div', { class: 'ss-children' });
  for (const c of children) { SEEN.set(c.id, c); box.append(card(c, h)); if (OPEN.has(c.id)) box.append(logSlot(c, h)); }
  wire(box, h);
  tick(h);
  return box;
}

/** a child started, progressed or ended while its turn is on screen */
export function upsertChild(turnId: string, c: ChildTask, h: ChildHost): void {
  const t = h.col()?.querySelector<HTMLElement>('[data-turn-id="' + turnId + '"]');
  if (!t) return;
  const body = $('.ui-entry__body', t);
  let box = body.querySelector<HTMLElement>('.ss-children');
  if (!box) { box = el('div', { class: 'ss-children' }); body.append(box); wire(box, h); }
  const was = SEEN.get(c.id);
  SEEN.set(c.id, c);
  const at = box.querySelector<HTMLElement>('[data-child-id="' + CSS.escape(c.id) + '"]');
  if (!at) box.append(card(c, h));
  else if (!at.contains(document.activeElement)) at.replaceWith(card(c, h));
  else patchInPlace(at, c, h);   /* focus is inside it: change the words and leave the buttons alone, so focus stays */
  if (was && was.status !== c.status && !isLive(c)) ui.announce((c.goal || 'A task') + ': ' + (c.status === 'done' ? 'done' : c.status));
  tick(h);
}

function patchInPlace(node: HTMLElement, c: ChildTask, h: ChildHost): void {
  const fresh = card(c, h);
  for (const sel of ['.ui-child__state', '.ui-child__now', '.ui-child__summary', '.ui-child__goal']) {
    const a = node.querySelector(sel), b = fresh.querySelector(sel);
    if (a && b) a.replaceWith(b); else if (b && !a) node.append(b); else if (a && !b) a.remove();
  }
  node.dataset['status'] = c.status;
  if (c.status !== 'running' && c.status !== 'queued') node.querySelector('[data-action="stop"]')?.remove();
}

/** the clock of every running child, once a second, until none runs */
function tick(h: ChildHost): void {
  if (clock) return;
  clock = window.setInterval(() => {
    const live = [...SEEN.values()].filter((c) => isLive(c) && c.startedAt != null);
    if (!live.length) { clearInterval(clock); clock = 0; return; }
    for (const c of live) {
      const meta = h.col()?.querySelector('[data-child-id="' + CSS.escape(c.id) + '"] .ui-child__meta');
      const t = childTime(c, h.now());
      if (meta && t) meta.textContent = ['Working', t, c.tools ? c.tools + (c.tools === 1 ? ' tool' : ' tools') : ''].filter(Boolean).join(' · ');
    }
  }, 1000);
}
export const resetChildren = (): void => { SEEN.clear(); OPEN.clear(); if (clock) { clearInterval(clock); clock = 0; } };

function logSlot(c: ChildTask, h: ChildHost): HTMLElement {
  const slot = el('div', { class: 'ss-child-log', 'data-log-for': c.id, role: 'region', 'aria-label': 'What this task did, read only' });
  slot.append(el('p', { class: 'ss-child-log__note', text: 'Loading what it did…' }));
  void (h.transcript?.(c.id) ?? Promise.reject(new Error('This build cannot read it.'))).then((turns) => { slot.replaceChildren(...logRows(turns)); }, (e: unknown) => {
    slot.replaceChildren(el('p', { class: 'ss-child-log__note', text: 'Could not read it: ' + (e instanceof Error ? e.message : String(e)) }));
  });
  return slot;
}
function logRows(turns: readonly Turn[]): Node[] {
  if (!turns.length) return [el('p', { class: 'ss-child-log__note', text: 'It has not written anything yet.' })];
  return turns.map((t) => {
    const row = el('div', { class: 'ss-child-log__row', 'data-role': t.role });
    if (t.role === 'user') { row.append(ui.request(t.text)); return row; }
    if (t.steps.length) row.append(ui.steps({ items: [...t.steps] }));
    for (const p of t.paragraphs) { const q = el('p', { class: 'ui-prose' }); q.innerHTML = ui.html.inline(p); row.append(q); }
    return row;
  });
}

function wire(box: HTMLElement, h: ChildHost): void {
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    const cardEl = b?.closest<HTMLElement>('[data-child-id]');
    const id = cardEl?.dataset['childId'];
    if (!b || !cardEl || !id) return;
    if (b.dataset['action'] === 'stop') { h.stop?.(id); b.setAttribute('disabled', ''); return; }
    if (b.dataset['action'] !== 'open') return;
    const c = SEEN.get(id);
    if (!c) return;
    const slot = box.querySelector('[data-log-for="' + CSS.escape(id) + '"]');
    if (slot) { slot.remove(); OPEN.delete(id); b.setAttribute('aria-expanded', 'false'); return; }
    OPEN.add(id); b.setAttribute('aria-expanded', 'true');
    cardEl.after(logSlot(c, h));
  });
}
