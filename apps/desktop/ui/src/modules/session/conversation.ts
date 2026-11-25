/* the session view: the conversation column and its composer. Turns come from the provider's conversation feed
   (a snapshot, then events: a turn added, a step added, a turn finished, the blank answered). A turn is the library's
   entry, marked for the keyboard (KEYMAP section 3.2): data-hx-turn, roving tabindex, an accessible name. */
import { followZone } from '../chat/follow-zone';
import { emit, on } from '../../core/bus';
import { $, el, frag, isMac, reduced } from '../../core/dom';
import { provide } from '../../core/registry';
import { fileChip, ui } from '@boopis/ui';
import type { ComposerEl } from '@boopis/ui';
import { data } from '../../data';
import type { AgentTurn, Attached, ConversationEvent, FormSpec, Ship, Step, Turn } from '../../data';
import { renderDiff } from './diff';
import { sessionComposer } from './composer';
import type { SessionComposer } from './composer';
import { copyText, mdOf, randomId } from './shared';
import { openPanel } from './right';
import { childrenBlock, resetChildren, upsertChild } from './children';
import type { ChildHost } from './children';
import { councilBlock, drawCouncil } from './council';
import { setAttention, changed } from './state';
import { surface } from '../mods/surfaces';
import { UNKNOWN_MODEL, markAnswered, stampUngoverned, syncDividers } from './attribution';
import { resolvePaths, wireRefs } from '../chat/refs';
import { REWIND_BASE, launchCanvas, lineEl, rewindFoot, rewindSheet, showSheet, watchTyping } from './s0';
import type { RewindSheet } from './s0';
import { openCarefulFor, openEffort, openFolder, launchView } from './launch';
import type { ThreadLine } from '../../data';

/** per-turn data the keyboard and the clipboard need */
interface TurnInfo { md(): string; kind: 'user' | 'agent'; text?: string | undefined }
const TURN = new WeakMap<HTMLElement, TurnInfo>();

export const VIEW = {
  root: null as HTMLElement | null, scroll: null as HTMLElement | null, col: null as HTMLElement | null, composer: null as SessionComposer | null,
  findAnchor: null as HTMLElement | null, current: 's1', blank: null as string | null, diffOpen: false,
  reveal: null as HTMLElement | null, ship: null as HTMLElement | null, shipData: null as Ship | null, blankCard: null as HTMLElement | null
};
/** whether a session has a turn running now: read from its own conversation, never from the view (switching never stops a
    turn: every bound session keeps streaming into its conversation, session-launch.md 2.2) */
export const isRunning = (id: string): boolean => sessions().conversation(id).snapshot().turns.some((t) => t.role === 'assistant' && t.status === 'running');
const sessions = () => data().sessions;
/** what the cards of handed-off tasks ask of the session: its column, and the provider's stop and read (absent where it has none) */
const childHost = (): ChildHost => ({ col: () => VIEW.col, now: Date.now, stop: sessions().stopChild ? (id) => sessions().stopChild?.(VIEW.current, id) : undefined, transcript: sessions().childTranscript ? (id) => sessions().childTranscript?.(VIEW.current, id) ?? Promise.reject(new Error('unavailable')) : undefined });
const turnsEls = (): HTMLElement[] => (VIEW.col ? [...VIEW.col.querySelectorAll<HTMLElement>('[data-hx-turn]')] : []);
const lastTurn = (): HTMLElement | undefined => turnsEls().slice(-1)[0];
export function rove(t: HTMLElement | undefined, focus?: boolean): void {
  turnsEls().forEach((x) => { x.tabIndex = x === t ? 0 : -1; x.toggleAttribute('data-hx-focus', false); });
  if (!t) return;
  t.setAttribute('data-hx-focus', 'messages');
  if (focus) { t.focus({ preventScroll: true }); t.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); }
}

/* a turn: the library's entry, marked for the keyboard */
interface TurnOpts { kind: 'user' | 'agent'; callno: string[]; steps?: { count: number; id: string; open?: boolean } | undefined; label: string; body: Node[]; copy?: boolean; md: () => string; text?: string }
function turn(o: TurnOpts): HTMLElement {
  const art = ui.entry({ kind: o.kind, callno: o.callno, steps: o.steps, label: o.label });
  art.setAttribute('data-hx-turn', ''); art.tabIndex = -1;
  const body = $('.ui-entry__body', art), callno = $('.ui-callno', art);
  o.body.forEach((n) => body.append(n));
  if (o.copy) callno.append(el('span', { class: 'ss-acts' }, ui.iconButton({ icon: 'copy', label: o.kind === 'user' ? 'Copy message' : 'Copy answer', size: 's', keys: 'C' })));
  const info: TurnInfo = { md: o.md, kind: o.kind, text: o.text };
  TURN.set(art, info);
  const cp = callno.querySelector('.ss-acts button'); if (cp) cp.addEventListener('click', () => { void copyText(info.md()); });
  return art;
}
function userTurn(text: string, at: string, attachments: readonly Attached[] = []): HTMLElement {
  const chips = attachments.length ? [el('div', { class: 'ss-attached', role: 'list', 'aria-label': 'Attached' }, attachments.map((a) => { const f = fileChip(a.name, { kind: a.kind, ...(a.path ? { title: a.path } : {}) }); f.setAttribute('role', 'listitem'); return f; }))] : [];
  return turn({ kind: 'user', callno: ['You', at], label: 'You, ' + at, body: [ui.request(text), ...chips], copy: true, md: () => '> ' + text, text });
}
/* the models of a turn as call-number lines: a family the kit knows is drawn with its mark and readable name by the entry; one it
   does not know is written by its readable name here, never as the engine's id */
const known = (m: string): boolean => ui.modelMark.family(m).id !== 'generic';
const modelLines = (model: string): string[] => !ui.modelMark.parse(model).length ? [UNKNOWN_MODEL] : ui.modelMark.parse(model).map((m, i) => (i ? '→ ' : '') + (known(m) ? m : ui.modelMark.called(m) || m));
const modelSay = (model: string): string => ui.modelMark.parse(model).map((m) => ui.modelMark.called(m) || m).join(' then ') || 'unknown model';
/** what a turn's meta says of its model: the models, then why Smart picked them */
const metaLines = (model: string, why?: string): string[] => [...modelLines(model), ...(why ? [why] : [])];
/** the time of a turn is the last plain line of its call number; the lines before it are its models (and why) */
function timeLine(t: HTMLElement): HTMLElement { const l = [...$('.ui-callno', t).children].filter((c) => c.tagName === 'SPAN' && !c.classList.contains('ui-callno__who') && !c.classList.contains('ss-acts')); return l[l.length - 1] as HTMLElement; }
/** draw the models (and the reason) of a turn again, leaving the time where it is */
function setModelLines(t: HTMLElement, model: string, why?: string): void {
  const callno = $('.ui-callno', t), time = timeLine(t);
  const tmp = ui.entry({ kind: 'agent', callno: [...metaLines(model, why), '0s'], label: '' });
  const fresh = [...tmp.querySelectorAll('.ui-callno > :is(span, b)')].slice(0, -1);
  for (const c of [...callno.children]) { if (c === time) break; if (!c.classList.contains('ui-callno__who')) c.remove(); }
  fresh.forEach((n) => callno.insertBefore(n, time));
}
/* an answer is markdown, drawn by the kit (one renderer for every conversation); its paths open in the session's folder */
const proseText = (paras: readonly string[], bullets?: readonly string[]): string => [...paras, ...(bullets?.length ? [bullets.map((b) => '- ' + b).join('\n')] : [])].join('\n\n');
const roots = (): string[] => { const c = data().details.environment.get().cwd; return c ? [c] : []; };
function prose(paras: readonly string[], bullets?: readonly string[]): HTMLElement {
  const p = ui.markdown(proseText(paras, bullets));
  void resolvePaths(p, roots());
  return p;
}

/* the blank: the card layer's inline blank, set in the sentence; answering rewrites the sentence around it */
const FREE_ANSWER: readonly [string, string] = ['Your answer:', '. I will follow it before the PR.'];
function blankSentence(t: AgentTurn): HTMLElement {
  const q = t.blank as NonNullable<AgentTurn['blank']>;
  const p = el('p', { class: 'ss-q' });
  const card = ui.card('blank', { question: q.question, short: q.short, options: q.options, ...(VIEW.blank ? { answer: VIEW.blank, state: 'answered' } : {}) }, { size: 'inline' });
  const lead = el('span'), tail = el('span');
  VIEW.blankCard = card;
  function fill(): void {
    const a = VIEW.blank, rw = a ? q.rewrites?.[a] : null;
    const s: readonly [string, string] | null = a ? (rw ? [rw.lead, rw.tail] : (q.free ?? FREE_ANSWER)) : null;
    lead.innerHTML = s ? ui.html.inline(s[0]) + ' ' : ui.esc(q.question) + ' ';
    tail.innerHTML = s ? (/^[.,;]/.test(s[1]) ? '' : ' ') + ui.html.inline(s[1]) : '';
    requestAnimationFrame(() => { const b = card.querySelector('button'); if (b) b.toggleAttribute('data-hx-attention', !a); });
  }
  card.addEventListener('hx:card-state', (e) => {
    const d = e.detail;
    if (d.card !== card || d.state !== 'answered') return;
    const answer = d.data.answer;
    if (!answer || answer === VIEW.blank) return;
    sessions().answerBlank(VIEW.current, answer);   /* the provider answers back with 'blank-answered' */
  });
  fill();
  p.append(lead, card, tail);
  (p as HTMLElement & { fill?: () => void }).fill = fill;
  return p;
}

function buildShip(): HTMLElement {
  const holder = el('div', { class: 'ss-ship' });
  const card = ui.card('ship', { ...(VIEW.shipData ?? {}), files: data().details.changes.get().map((c) => [c[0], c[1], c[2]] as const) }, { size: 'inline' });
  card.addEventListener('hx:card-action', (e) => {
    const a = e.detail.action;
    if (a === 'view-diff') { e.preventDefault(); toggleDiff((e.composedPath()[0] as Element).closest('button')); }
    if (a === 'open-pr') sessions().openPullRequest(VIEW.current);
  });
  holder.append(card, el('div', { class: 'ss-diff-slot' }));
  VIEW.ship = holder;
  return holder;
}
function toggleDiff(btn: HTMLElement | null, force?: boolean): void {
  VIEW.diffOpen = force != null ? force : !VIEW.diffOpen;
  const b = btn ?? (VIEW.ship ? VIEW.ship.querySelector<HTMLElement>('[data-action="view-diff"]') : null);
  if (b) { b.setAttribute('aria-expanded', String(VIEW.diffOpen)); const l = b.querySelector('span') ?? b; l.textContent = VIEW.diffOpen ? 'Hide diff' : 'View diff'; }
  refreshDiff();
  if (VIEW.diffOpen) setTimeout(() => scrollToEl(VIEW.ship?.querySelector<HTMLElement>('.ss-diff-slot') ?? null, 96), 60);
}
function refreshDiff(): void {
  const slot = VIEW.ship ? VIEW.ship.querySelector('.ss-diff-slot') : null;
  if (slot) slot.replaceChildren(VIEW.diffOpen ? renderDiff(sessions().diff(VIEW.current, { blank: VIEW.blank }), true) : '');
}
function scrollToEl(node: HTMLElement | null, offset: number): void {
  if (!node || !VIEW.scroll) return;
  VIEW.scroll.scrollTo({ top: node.getBoundingClientRect().top - VIEW.scroll.getBoundingClientRect().top + VIEW.scroll.scrollTop - offset, behavior: reduced() ? 'auto' : 'smooth' });
}
function showShip(animate: boolean): void {
  const r = VIEW.reveal;
  if (!r || r.childElementCount) return;
  r.append(buildShip()); r.hidden = false;
  if (!animate || reduced()) r.classList.add('is-in');
  else requestAnimationFrame(() => requestAnimationFrame(() => r.classList.add('is-in')));
}

/* forms the agent opened in a turn, drawn where it raised them: one card per form, answered here or in the dock */
const FORM_STATE = { submitted: 'done', cancelled: 'cancelled', expired: 'expired' } as const;
function formCard(f: FormSpec): HTMLElement { const c = ui.card('form', f as unknown as Record<string, unknown>, { size: 'inline' }); c.dataset['formId'] = f.id; return c; }
/** the answer's prose goes above the forms the turn raised */
function placeProse(t: HTMLElement, p: HTMLElement): void { const box = t.querySelector('.ui-entry__body > :is(.ss-forms, .ss-children)'); if (box) box.before(p); else $('.ui-entry__body', t).append(p); }
function formsBlock(forms: readonly FormSpec[]): HTMLElement { return el('div', { class: 'ss-forms' }, forms.map(formCard)); }
/** a form opened (or lapsed) while the conversation is on screen */
function addForm(turnId: string, f: FormSpec): void {
  const t = VIEW.col?.querySelector<HTMLElement>('[data-turn-id="' + turnId + '"]');
  if (!t || t.querySelector('hx-card[data-form-id="' + f.id + '"]')) return;
  const body = $('.ui-entry__body', t);
  let box = body.querySelector<HTMLElement>('.ss-forms');
  if (!box) { box = el('div', { class: 'ss-forms' }); body.append(box); }
  const c = formCard(f);
  box.append(c);
  if (VIEW.scroll) VIEW.scroll.scrollTop = VIEW.scroll.scrollHeight;
}
function resolveForm(formId: string, status: keyof typeof FORM_STATE): void {
  for (const c of VIEW.col?.querySelectorAll<HTMLElement & { update(p: Record<string, unknown>): unknown; state: string }>('hx-card[data-kind="form"]') ?? []) {
    if ((c as unknown as { data: { id?: string } }).data.id === formId && c.state !== FORM_STATE[status]) c.update({ state: FORM_STATE[status] });
  }
}

function assistantTurn(a: AgentTurn): HTMLElement {
  const id = 'ss-steps-' + randomId('');
  const p = prose(a.paragraphs, a.bullets);
  VIEW.shipData = a.ship ?? null;
  if (a.blank) p.append(blankSentence(a));
  VIEW.reveal = el('div', { class: 'ss-reveal', hidden: true });
  const hasSteps = a.steps.length > 0;
  const t = turn({
    kind: 'agent', callno: metaLines(a.model, a.why).concat([a.time, a.cost], hasSteps ? [] : [a.stepCount + ' steps']), steps: hasSteps ? { count: a.stepCount, id } : undefined,
    label: modelSay(a.model) + ', ' + a.time + ', ' + a.cost, body: [hasSteps ? ui.steps({ items: a.steps as Step[], id, hidden: true }) : null, p, a.ship ? VIEW.reveal : null].filter((n): n is HTMLElement => !!n),
    copy: true, md: () => mdOf(p)
  });
  t.dataset['turnId'] = a.id;
  markAnswered(t, a.model); stampUngoverned(t, !!a.ungoverned);
  if (a.forms?.length) $('.ui-entry__body', t).append(formsBlock(a.forms));
  if (a.children?.length) $('.ui-entry__body', t).append(childrenBlock(a.children, childHost()));
  if (a.council) p.before(councilBlock(a.council));
  if (VIEW.blank) showShip(false);
  if (VIEW.diffOpen) refreshDiff();
  placeFoot(t, a);
  return t;
}

/* ───────── S0: the lines about the thread, the rewind on a finished turn and its sheet (ADR-0058) ───────── */
const controls = () => data().sessionControls;
/** the first agent turn that kept a ship offers "Rewind to before this session" too */
function firstKept(): string | null {
  const t = sessions().conversation(VIEW.current).snapshot().turns.find((x): x is AgentTurn => x.role === 'assistant' && !!x.kept?.length);
  return t?.id ?? null;
}
function placeFoot(t: HTMLElement, a: AgentTurn): void {
  t.querySelectorAll(':scope .ss-s0-foot').forEach((n) => n.remove());
  const c = controls();
  if (!c || !a.kept?.length || a.status === 'running') return;
  const avail = c.capabilities.get().session.rewind;
  const list = sessions().conversation(VIEW.current).snapshot().turns.filter((x): x is AgentTurn => x.role === 'assistant');
  const n = list.findIndex((x) => x.id === a.id) + 1;
  const last = a.kept[a.kept.length - 1] as string;
  const body = $('.ui-entry__body', t);
  body.append(rewindFoot({ first: firstKept() === a.id, avail, onRewind: (to) => { if (to === 'base') void openRewind(null, REWIND_BASE); else void openRewind(last, 'Rewind files to after turn ' + n); } }));
}
function syncFoot(col: HTMLElement, turnId: string): void {
  const t = col.querySelector<HTMLElement>('[data-turn-id="' + turnId + '"]');
  const a = sessions().conversation(VIEW.current).snapshot().turns.find((x): x is AgentTurn => x.role === 'assistant' && x.id === turnId);
  if (t && a) placeFoot(t, a);
}
function syncFeet(): void {
  const col = VIEW.col; if (!col) return;
  for (const t of sessions().conversation(VIEW.current).snapshot().turns) if (t.role === 'assistant' && t.status !== 'running') syncFoot(col, t.id);
}
function placeLine(col: HTMLElement, l: ThreadLine): void {
  col.querySelector('.ss-s0-line[data-line-id="' + l.id + '"]')?.remove();
  const node = lineEl(l, (ship) => { void undoRewind(ship); });
  const after = l.afterTurn ? col.querySelector<HTMLElement>('[data-turn-id="' + l.afterTurn + '"]') : null;
  if (!after) { if (l.afterTurn) col.append(node); else col.prepend(node); return; }
  let at: Element = after;
  while (at.nextElementSibling?.classList.contains('ss-s0-line')) at = at.nextElementSibling;
  at.after(node);
}
let sheet: RewindSheet | null = null;
async function openRewind(shipId: string | null, title: string): Promise<void> {
  const c = controls(), id = VIEW.current;
  if (!c) return;
  sheet?.close();
  const head = c.head(id) ?? undefined;
  const plan = await c.rewind(id, shipId, { dryRun: true, ...(head ? { expectHead: head } : {}) });
  sheet = rewindSheet(plan, title, {
    onConfirm: () => {
      void c.rewind(id, shipId, head ? { expectHead: head } : {}).then((r) => {
        sheet?.close();
        if (r.status === 'refused') { sheet = rewindSheet(r, title, { onConfirm: () => undefined }); showSheet(sheet); }
        else { ui.announce('Files rewound'); syncFeet(); }
      });
    },
    closed: () => { sheet = null; }
  });
  showSheet(sheet);
}
async function undoRewind(shipId: string): Promise<void> {
  const c = controls(), id = VIEW.current;
  if (!c) return;
  const head = c.head(id) ?? undefined;
  const r = await c.rewind(id, shipId, { undo: true, ...(head ? { expectHead: head } : {}) });
  if (r.status === 'refused') { sheet?.close(); sheet = rewindSheet(r, 'Undo the rewind', { onConfirm: () => undefined }); showSheet(sheet); }
  else { ui.announce('Rewind undone'); syncFeet(); }
}

/* ───────── S0: the new session's canvas (S41 A): the launch row until the first message ───────── */
let stopWatch: (() => void) | null = null;
function canvas(): HTMLElement | null {
  const c = controls();
  if (!c) return null;
  const n = launchCanvas(launchView(), {
    folder: () => { void openFolder(); },
    model: (a) => { VIEW.composer?.openModelMenu?.(a); },
    effort: (a) => { openEffort(a); },
    careful: (a) => { openCarefulFor(a, 'below'); }
  });
  n.classList.add('ss-s0-canvas--view');
  stopWatch?.();
  if (VIEW.composer) stopWatch = watchTyping(n, VIEW.composer.input);
  return n;
}
/** the canvas again, after a launch setting changed (only while the session has not started) */
export function redrawCanvas(): void {
  const col = VIEW.col, old = col?.querySelector('.ss-s0-canvas--view');
  if (!col || !old) return;
  const fresh = canvas();
  if (fresh) old.replaceWith(fresh);
}

/* a turn that is still running: a live call number and steps, then the answer arrives on the feed */
interface Live { t: HTMLElement; ol: HTMLElement; disc: HTMLElement; timeEl: HTMLElement; tick: number; secs: number; model: string; why: string | undefined; count: number; startedAt: number; prose: HTMLElement | null; blankEl: HTMLElement | null }
const live = new Map<string, Live>();
function liveTurn(a: AgentTurn): void {
  const id = 'ss-steps-' + randomId('');
  /* a turn drawn again (its session switched back to) shows the steps and the text it has, and its clock goes on from its start */
  const ol = ui.steps({ items: a.steps as Step[], id });
  const startedAt = a.startedAt ?? Date.now(), secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const t = turn({ kind: 'agent', callno: [...metaLines(a.model, a.why), secs + 's'], steps: { count: a.steps.length, id, open: true }, label: modelSay(a.model) + ', working', body: [ol], md: () => '' });
  t.setAttribute('aria-busy', 'true');
  if (a.council) $('.ui-entry__body', t).append(councilBlock(a.council));
  const disc = $('.ui-disclosure', t), timeEl = timeLine(t);
  $('span', disc).textContent = 'Working'; disc.prepend(frag(ui.html.dot('run')));
  const L: Live = { t, ol, disc, timeEl, tick: 0, secs, model: a.model, why: a.why, count: a.steps.length, startedAt, prose: null, blankEl: null };
  L.tick = window.setInterval(() => { L.secs = Math.max(0, Math.floor((Date.now() - L.startedAt) / 1000)); timeEl.textContent = L.secs + 's'; }, 1000);
  if (a.paragraphs.length) { const p = prose(a.paragraphs); placeProse(t, p); L.prose = p; }
  live.set(a.id, L);
  if (a.blank) addLiveBlank(L, a);
  t.dataset['turnId'] = a.id;
  markAnswered(t, a.model); stampUngoverned(t, !!a.ungoverned);
  if (a.forms?.length) $('.ui-entry__body', t).append(formsBlock(a.forms));
  if (a.children?.length) $('.ui-entry__body', t).append(childrenBlock(a.children, childHost()));
  (VIEW.col as HTMLElement).append(t);
  syncDividers(VIEW.col as HTMLElement);
  VIEW.composer?.setRunning(true); surface.onWorking?.(true);
  if (VIEW.scroll) VIEW.scroll.scrollTop = VIEW.scroll.scrollHeight;
}
/* a blank opened while the turn runs: its sentence sits under the steps and stays there when the answer arrives */
function addLiveBlank(L: Live, a: AgentTurn): void {
  if (!a.blank || L.blankEl) return;
  VIEW.blank = a.blank.answer ?? null;
  L.blankEl = el('div', { class: 'ui-prose' }, blankSentence(a));
  $('.ui-entry__body', L.t).append(L.blankEl);
  setAttention(VIEW.blank ? 0 : 1);
}
function finishLive(id: string, ev: Extract<ConversationEvent, { type: 'turn-finished' }>): void {
  const L = live.get(id); if (!L) return;
  live.delete(id); clearInterval(L.tick);
  const { t, ol, disc, timeEl } = L;
  timeEl.textContent = ev.time; timeEl.after(el('span', { text: ev.cost }));
  disc.replaceChildren(frag(ui.icon('chevron')), el('span', { text: (ev.stopped ? 'Stopped after ' : '') + ev.stepCount + ' steps' }));
  disc.setAttribute('aria-expanded', 'false'); ol.hidden = true;
  t.removeAttribute('aria-busy'); if (ev.model) { L.model = ev.model; L.why = ev.why ?? L.why; setModelLines(t, ev.model, L.why); markAnswered(t, ev.model); stampUngoverned(t, t.hasAttribute('data-ungoverned')); if (VIEW.col) syncDividers(VIEW.col); }
  t.setAttribute('aria-label', modelSay(L.model) + ', ' + ev.time + ', ' + ev.cost);
  stampUngoverned(t, t.hasAttribute('data-ungoverned'));
  const p = prose(ev.paragraphs);
  if (L.prose) L.prose.replaceWith(p); else if (L.blankEl) L.blankEl.before(p); else placeProse(t, p);
  TURN.set(t, { md: () => mdOf(p), kind: 'agent' });
  $('.ui-callno', t).append(el('span', { class: 'ss-acts' }, ui.iconButton({ icon: 'copy', label: 'Copy answer', size: 's', keys: 'C' })));
  $('.ss-acts button', t).addEventListener('click', () => { void copyText(mdOf(p)); });
  VIEW.composer?.setRunning(false); surface.onWorking?.(false);
  rove(t);
  syncFoot(VIEW.col as HTMLElement, id);
  if (VIEW.scroll) VIEW.scroll.scrollTop = VIEW.scroll.scrollHeight;
  ui.announce(ev.stopped ? 'Stopped' : 'Answer ready');
}

function openBlankOf(turns: readonly Turn[]): boolean { return turns.some((t) => t.role === 'assistant' && !!t.blank && !t.blank.answer); }
export const sessionNeedsYou = (id: string): boolean => openBlankOf(sessions().conversation(id).snapshot().turns);

let unsubConv: (() => void) | null = null;
export function renderConversation(): void {
  const col = VIEW.col as HTMLElement; col.replaceChildren();
  for (const L of live.values()) clearInterval(L.tick);
  live.clear();
  resetChildren();
  VIEW.reveal = null; VIEW.ship = null; VIEW.blankCard = null;
  unsubConv?.();
  const conv = sessions().conversation(VIEW.current);
  const snap = conv.snapshot().turns;
  const withBlank = snap.find((t): t is AgentTurn => t.role === 'assistant' && !!t.blank);
  VIEW.blank = withBlank?.blank?.answer ?? null;
  const launch = !snap.length && controls() ? canvas() : null;
  if (launch) col.append(launch);
  else if (!snap.length) {
    const s = sessions().list.get().find((x) => x.id === VIEW.current);
    col.append(ui.empty({ title: s?.project ? 'What should change in ' + s.project + '?' : data().info.live ? 'What should change?' : 'What should change in ' + (s ? s.project : 'billing-api') + '?', text: 'Words I will act on get a dashed underline as you type. Click one, or press alt and down arrow on it, to change how I read it.' }));
  } else for (const t of snap) { if (t.role === 'user') col.append(userTurn(t.text, t.at, t.attachments)); else if (t.status === 'running') liveTurn(t); else col.append(assistantTurn(t)); }
  for (const l of conv.snapshot().lines ?? []) placeLine(col, l);
  const running = snap.some((t) => t.role === 'assistant' && t.status === 'running');
  VIEW.composer?.setRunning(running); surface.onWorking?.(running);
  syncDividers(col);
  rove(lastTurn());
  setAttention(!VIEW.blank && openBlankOf(snap) ? 1 : 0);
  unsubConv = conv.subscribe(onConversationEvent);
  surface.onConversation?.(VIEW.current);   /* what a mod placed in this session goes back in */
}
function onConversationEvent(ev: ConversationEvent): void {
  const col = VIEW.col; if (!col) return;
  if (ev.type === 'turn-added') {
    col.querySelector('.ui-empty')?.remove();
    col.querySelector('.ss-s0-canvas--view')?.remove(); stopWatch?.(); stopWatch = null;
    if (ev.turn.role === 'user') { col.append(userTurn(ev.turn.text, ev.turn.at, ev.turn.attachments)); if (VIEW.scroll) VIEW.scroll.scrollTop = VIEW.scroll.scrollHeight; }
    else liveTurn(ev.turn);
  } else if (ev.type === 'step-added') {
    const L = live.get(ev.turnId); if (!L) return;
    L.count++;
    L.ol.insertAdjacentHTML('beforeend', ui.html.steps([ev.step]).replace(/^<ol[^>]*>|<\/ol>$/g, ''));
  } else if (ev.type === 'turn-text') {
    const L = live.get(ev.turnId); if (!L) return;
    const stick = !VIEW.scroll || VIEW.scroll.scrollHeight - VIEW.scroll.scrollTop - VIEW.scroll.clientHeight < 80;
    /* block by block: what is finished stays, the block being written is redrawn */
    if (L.prose) { for (const d of ui.markdown.stream(L.prose, proseText(ev.paragraphs)).slice(0, -1)) void resolvePaths(d, roots()); }
    else { const p = prose(ev.paragraphs); if (L.blankEl) L.blankEl.before(p); else placeProse(L.t, p); L.prose = p; }
    if (stick && VIEW.scroll) VIEW.scroll.scrollTop = VIEW.scroll.scrollHeight;
  } else if (ev.type === 'reset') renderConversation();
  else if (ev.type === 'blank-opened') {
    const L = live.get(ev.turnId), turn = sessions().conversation(VIEW.current).snapshot().turns.find((t) => t.id === ev.turnId);
    if (L && turn && turn.role === 'assistant') addLiveBlank(L, turn); else renderConversation();
  }
  else if (ev.type === 'form-opened') addForm(ev.turnId, ev.form);
  else if (ev.type === 'form-resolved') resolveForm(ev.formId, ev.status);
  else if (ev.type === 'child-updated') upsertChild(ev.turnId, ev.child, childHost());
  else if (ev.type === 'turn-model') { const L = live.get(ev.turnId); if (L) { L.model = ev.model; setModelLines(L.t, ev.model, L.why); markAnswered(L.t, ev.model); stampUngoverned(L.t, L.t.hasAttribute('data-ungoverned')); if (VIEW.col) syncDividers(VIEW.col); } }
  else if (ev.type === 'council') { const b = col.querySelector<HTMLElement>('[data-turn-id="' + ev.turnId + '"] .ss-council'); if (b) drawCouncil(b, ev.council); }
  else if (ev.type === 'turn-finished') finishLive(ev.turnId, ev);
  else if (ev.type === 'line') placeLine(col, ev.line);
  else if (ev.type === 'turn-kept') syncFoot(col, ev.turnId);
  else if (ev.type === 'blank-answered') {
    const first = !VIEW.blank;
    VIEW.blank = ev.answer;
    const bc = VIEW.blankCard as (HTMLElement & { update?: (p: Record<string, unknown>) => void; state?: string; data?: { answer?: string } }) | null;
    if (bc && bc.update && (bc.state !== 'answered' || bc.data?.answer !== ev.answer)) bc.update({ state: 'answered', answer: ev.answer });
    (bc?.closest('.ss-q') as (HTMLElement & { fill?: () => void }) | null)?.fill?.();
    setAttention(0); changed();
    if (first) showShip(true); else if (VIEW.diffOpen) refreshDiff();
  }
}

/* KEYMAP section 5: the conversation's keys, on a focused turn */
function onTurnKey(e: KeyboardEvent): void {
  const target = e.target as HTMLElement;
  const t = target.closest<HTMLElement>('[data-hx-turn]');
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!t || mod || e.altKey) return;
  /* on the turn itself every key; on a control inside it only the letters (Enter and arrows stay the control's) */
  const self = target === t, key = e.key;
  if (!self && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || !/^[jkcedbo]$/.test(key))) return;
  const list = turnsEls(), i = list.indexOf(t);
  const go = (n: number): void => { e.preventDefault(); rove(list[Math.max(0, Math.min(list.length - 1, n))], true); };
  const info = TURN.get(t);
  if (key === 'ArrowDown' || key === 'j') return go(i + 1);
  if (key === 'ArrowUp' || key === 'k') return go(i - 1);
  if (key === 'Home') return go(0);
  if (key === 'End' || (key === 'G' && e.shiftKey)) return go(list.length - 1);
  if (key === 'Enter' || key === 'o') { const d = t.querySelector<HTMLElement>('.ui-disclosure'); if (d) { e.preventDefault(); d.click(); } return; }
  if (key === 'c') { e.preventDefault(); void copyText(info ? info.md() : t.innerText); return; }
  if (key === 'e' && info?.kind === 'user') { e.preventDefault(); VIEW.composer?.setValue(info.text ?? ''); VIEW.composer?.focus(); return; }
  if (key === 'd') {
    const ship = t.querySelector<HTMLElement>('.ss-ship');
    if (ship) { e.preventDefault(); toggleDiff(null, true); requestAnimationFrame(() => { ship.querySelector<HTMLElement>('.ss-diff-head')?.focus(); }); }
    else if (t.querySelector('.ui-entry__body')) { e.preventDefault(); openPanel('changes'); }
    return;
  }
  if (key === 'b') { const b = t.querySelector<HTMLElement>('hx-card[kind="blank"] button, .ss-q hx-card button'); if (b) { e.preventDefault(); b.click(); } }
}

/* find in this conversation (mod+F through the shell's provider) */
function openFind(): boolean {
  if (!VIEW.col || !VIEW.root || !VIEW.findAnchor) return false;
  const field = ui.field({ label: 'Find in this conversation', placeholder: 'Words in a message or an answer' });
  const input = $<HTMLInputElement>('input', field), hint = el('p', { class: 'ss-find-count', 'aria-live': 'polite' });
  const box = el('div', { class: 'ss-find' }, [field, hint]);
  let hits: HTMLElement[] = [], at = -1;
  const run = (dir: number): void => {
    const q = input.value.trim().toLowerCase();
    hits = q ? turnsEls().filter((t) => t.innerText.toLowerCase().includes(q)) : [];
    if (!hits.length) { hint.textContent = q ? 'No matches' : ''; return; }
    at = (at + dir + hits.length) % hits.length;
    hint.textContent = (at + 1) + ' of ' + hits.length;
    const h = hits[at] as HTMLElement;
    rove(h); h.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
  };
  input.addEventListener('input', () => { at = -1; run(1); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (e.altKey && hits[at]) { ui.popover.close(false); hits[at]?.focus(); } else run(e.shiftKey ? -1 : 1); } });
  const root = VIEW.root;
  ui.popover.open(VIEW.findAnchor, box, { label: 'Find in this conversation', align: 'end', onClose: () => { const t = turnsEls().find((x) => x.tabIndex === 0) ?? lastTurn(); if (t && !root.contains(document.activeElement)) t.focus({ preventScroll: true }); } });
  return true;
}

/** a mod's placed row (or a card it raised) goes at the end of the conversation; gone when the session changes or clears */
function placeRow(node: HTMLElement, o: { quiet: boolean }): void {
  if (!VIEW.col) return;
  VIEW.col.append(node);
  if (!o.quiet && VIEW.scroll) VIEW.scroll.scrollTop = VIEW.scroll.scrollHeight;
}

export function selectSession(id: string, opts: { quiet?: boolean; focus?: boolean } = {}): void {
  /* switching never stops a turn: the running session keeps streaming into its conversation (session-launch.md 2.2) */
  VIEW.current = id;
  data().details.follow(id);
  if (VIEW.col) { renderConversation(); if (VIEW.scroll) VIEW.scroll.scrollTop = 0; }
  const s = sessions().list.get().find((x) => x.id === id);
  if (!opts.quiet) emit('hx:session-select', { id, from: 'list', title: s ? s.title : '', project: s ? s.project : '' });
  emit('hx:title', { title: s ? s.title : '', project: s ? s.project : '', tab: 'session' });
  changed();
  if (opts.focus && VIEW.composer) VIEW.composer.focus();
}
export function newSession(project?: string): void {
  const cur = sessions().list.get().find((s) => s.id === VIEW.current);
  const s = sessions().create(project || (cur ? cur.project : '') || (data().info.live ? '' : 'billing-api'));
  selectSession(s.id, { focus: true });
}
export function toConversation(): void { const t = turnsEls().find((x) => x.tabIndex === 0) ?? lastTurn(); if (t) rove(t, true); }

export function mountView(root: HTMLElement): void {
  VIEW.root = root;
  root.classList.add('ss-view');
  VIEW.scroll = el('div', { class: 'ss-scroll ' + ui.scrollClass({ ground: true }) });
  VIEW.findAnchor = el('span', { class: 'ss-find-anchor', 'aria-hidden': 'true' });
  VIEW.col = el('div', { class: 'ss-col', role: 'feed', 'aria-label': 'Conversation' });
  VIEW.scroll.append(VIEW.col);
  root.replaceChildren(VIEW.findAnchor, VIEW.scroll);
  VIEW.col.addEventListener('keydown', onTurnKey);
  wireRefs(VIEW.col, { bot: () => null });
  VIEW.col.addEventListener('focusin', (e) => { const t = (e.target as Element).closest<HTMLElement>('[data-hx-turn]'); if (t && e.target === t) rove(t); });
  const first = sessions().list.get()[0];
  if (first) VIEW.current = first.id;
  data().details.follow(VIEW.current);
  renderConversation();
  const c = VIEW.composer = sessionComposer({ draft: sessions().draft(), sessionId: () => VIEW.current });
  const host = el('div', { class: 'ss-composer' }, c);
  /* the slots a mod draws into (MODS.md section 3): the band above the composer and the status line under it; empty slots take no room */
  const slots = { band: el('div', { class: 'ss-mods ss-mods--band' }), status: el('div', { class: 'ss-mods ss-mods--status' }) };
  host.prepend(slots.band); host.append(slots.status);
  surface.slots = slots; surface.place = placeRow;
  root.append(host);
  surface.onConversation?.(VIEW.current);
  c.addEventListener('ui:send', (e) => {
    const text = (e as CustomEvent<{ text: string }>).detail.text, assume = c.lastAssume(), attachments = c.takeAttachments();
    setTimeout(() => { const g = data().details.governance.get(); sessions().send(VIEW.current, text, { governed: g.governed, smart: g.smart, model: g.model, assume, attachments }); }, 0);
  });
  c.addEventListener('ui:stop', () => { sessions().stop(VIEW.current); });
  c.addEventListener('ui:edit-last', (e) => {
    const users = turnsEls().filter((t) => TURN.get(t)?.kind === 'user'), u = users.pop();
    if (u) { e.preventDefault(); c.setValue(TURN.get(u)?.text ?? ''); c.focus(); }
  });
  followZone(host, () => VIEW.scroll, () => root, '--ss-comp-h')();
  requestAnimationFrame(() => c.focus());
  const c0 = controls();
  if (c0) { c0.capabilities.subscribe(() => { syncFeet(); redrawCanvas(); }); c0.launch.subscribe(() => { redrawCanvas(); }); }
  provide('stop', (d) => { if (d.tab !== 'session' || !isRunning(VIEW.current)) return false; sessions().stop(VIEW.current); return true; });
  provide('find', (d) => (d.tab === 'session' ? openFind() : false));
  on('hx:nav', (d) => {
    if (d.region !== 'messages') return;
    const list = turnsEls(); const t = d.action === 'last' ? list[list.length - 1] : list[0];
    if (t) rove(t, true);
  });
  on('hx:new-session', (d) => newSession(d.project));
  on('hx:session-select', (d) => { if (d.id && d.from !== 'list' && d.id !== VIEW.current && sessions().list.get().some((x) => x.id === d.id)) selectSession(d.id, { quiet: true }); });
  const cur = sessions().list.get().find((s) => s.id === VIEW.current);
  emit('hx:title', { title: cur?.title ?? '', project: cur?.project ?? '', tab: 'session' });
}
export type { ComposerEl };
