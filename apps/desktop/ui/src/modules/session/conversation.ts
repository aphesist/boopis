/* the session view: the conversation column and its composer. Turns come from the provider's conversation feed
   (a snapshot, then events: a turn added, a step added, a turn finished, the blank answered). A turn is the library's
   entry, marked for the keyboard (KEYMAP section 3.2): data-hx-turn, roving tabindex, an accessible name. */
import { emit, on } from '../../core/bus';
import { $, el, frag, isMac, reduced } from '../../core/dom';
import { provide } from '../../core/registry';
import { ui } from '../../components';
import type { ComposerEl } from '../../components';
import { data } from '../../data';
import type { AgentTurn, ConversationEvent, Ship, Step, Turn } from '../../data';
import { renderDiff } from './diff';
import { sessionComposer } from './composer';
import type { SessionComposer } from './composer';
import { copyText, mdOf, randomId } from './shared';
import { openPanel } from './right';
import { setAttention, changed } from './state';

/** per-turn data the keyboard and the clipboard need */
interface TurnInfo { md(): string; kind: 'user' | 'agent'; text?: string | undefined }
const TURN = new WeakMap<HTMLElement, TurnInfo>();

export const VIEW = {
  root: null as HTMLElement | null, scroll: null as HTMLElement | null, col: null as HTMLElement | null, composer: null as SessionComposer | null,
  findAnchor: null as HTMLElement | null, current: 's1', blank: null as string | null, diffOpen: false,
  reveal: null as HTMLElement | null, ship: null as HTMLElement | null, shipData: null as Ship | null, blankCard: null as HTMLElement | null,
  running: false
};
const sessions = () => data().sessions;
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
function userTurn(text: string, at: string): HTMLElement {
  return turn({ kind: 'user', callno: ['You', at], label: 'You, ' + at, body: [ui.request(text)], copy: true, md: () => '> ' + text, text });
}
const modelLines = (model: string): string[] => String(model).split(/\s*→\s*/).map((m, i) => (i ? '→ ' : '') + m);
const modelSay = (model: string): string => String(model).split(/\s*→\s*/).join(' then ');
function prose(paras: readonly string[], bullets?: readonly string[]): HTMLElement {
  const p = el('div', { class: 'ui-prose' });
  paras.forEach((t) => p.append(el('p', { html: ui.html.inline(t) })));
  if (bullets && bullets.length) p.append(el('ul', {}, bullets.map((b) => el('li', { html: ui.html.inline(b) }))));
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
    const s: readonly [string, string] | null = a ? (rw ? [rw.lead, rw.tail] : FREE_ANSWER) : null;
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

function assistantTurn(a: AgentTurn): HTMLElement {
  const id = 'ss-steps-' + randomId('');
  const p = prose(a.paragraphs, a.bullets);
  VIEW.shipData = a.ship ?? null;
  if (a.blank) p.append(blankSentence(a));
  VIEW.reveal = el('div', { class: 'ss-reveal', hidden: true });
  const hasSteps = a.steps.length > 0;
  const t = turn({
    kind: 'agent', callno: modelLines(a.model).concat([a.time, a.cost], hasSteps ? [] : [a.stepCount + ' steps']), steps: hasSteps ? { count: a.stepCount, id } : undefined,
    label: modelSay(a.model) + ', ' + a.time + ', ' + a.cost, body: [hasSteps ? ui.steps({ items: a.steps as Step[], id, hidden: true }) : null, p, a.ship ? VIEW.reveal : null].filter((n): n is HTMLElement => !!n),
    copy: true, md: () => mdOf(p)
  });
  if (VIEW.blank) showShip(false);
  if (VIEW.diffOpen) refreshDiff();
  return t;
}

/* a turn that is still running: a live call number and steps, then the answer arrives on the feed */
interface Live { t: HTMLElement; ol: HTMLElement; disc: HTMLElement; timeEl: HTMLElement; tick: number; secs: number; model: string; count: number; startedAt: number; prose: HTMLElement | null }
const live = new Map<string, Live>();
function liveTurn(a: AgentTurn): void {
  const id = 'ss-steps-' + randomId('');
  const ol = ui.steps({ items: [], id });
  const t = turn({ kind: 'agent', callno: [a.model, '0s'], steps: { count: 0, id, open: true }, label: a.model + ', working', body: [ol], md: () => '' });
  t.setAttribute('aria-busy', 'true');
  const disc = $('.ui-disclosure', t), timeEl = $('.ui-callno span', t);
  $('span', disc).textContent = 'Working'; disc.prepend(frag(ui.html.dot('run')));
  const L: Live = { t, ol, disc, timeEl, tick: 0, secs: 0, model: a.model, count: 0, startedAt: Date.now(), prose: null };
  L.tick = window.setInterval(() => { L.secs++; timeEl.textContent = L.secs + 's'; }, 1000);
  live.set(a.id, L);
  (VIEW.col as HTMLElement).append(t);
  VIEW.composer?.setRunning(true); VIEW.running = true;
  if (VIEW.scroll) VIEW.scroll.scrollTop = VIEW.scroll.scrollHeight;
}
function finishLive(id: string, ev: Extract<ConversationEvent, { type: 'turn-finished' }>): void {
  const L = live.get(id); if (!L) return;
  live.delete(id); clearInterval(L.tick);
  const { t, ol, disc, timeEl } = L;
  timeEl.textContent = ev.time; timeEl.after(el('span', { text: ev.cost }));
  disc.replaceChildren(frag(ui.icon('chevron')), el('span', { text: (ev.stopped ? 'Stopped after ' : '') + ev.stepCount + ' steps' }));
  disc.setAttribute('aria-expanded', 'false'); ol.hidden = true;
  t.removeAttribute('aria-busy'); t.setAttribute('aria-label', L.model + ', ' + ev.time + ', ' + ev.cost);
  const p = prose(ev.paragraphs);
  if (L.prose) L.prose.replaceWith(p); else $('.ui-entry__body', t).append(p);
  TURN.set(t, { md: () => mdOf(p), kind: 'agent' });
  $('.ui-callno', t).append(el('span', { class: 'ss-acts' }, ui.iconButton({ icon: 'copy', label: 'Copy answer', size: 's', keys: 'C' })));
  $('.ss-acts button', t).addEventListener('click', () => { void copyText(mdOf(p)); });
  VIEW.composer?.setRunning(false); VIEW.running = false;
  rove(t);
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
  VIEW.reveal = null; VIEW.ship = null; VIEW.blankCard = null;
  unsubConv?.();
  const conv = sessions().conversation(VIEW.current);
  const snap = conv.snapshot().turns;
  const withBlank = snap.find((t): t is AgentTurn => t.role === 'assistant' && !!t.blank);
  VIEW.blank = withBlank?.blank?.answer ?? null;
  if (!snap.length) {
    const s = sessions().list.get().find((x) => x.id === VIEW.current);
    col.append(ui.empty({ title: 'What should change in ' + (s ? s.project : 'billing-api') + '?', text: 'Words I will act on get a dashed underline as you type. Click one, or press alt and down arrow on it, to change how I read it.' }));
  } else for (const t of snap) { if (t.role === 'user') col.append(userTurn(t.text, t.at)); else if (t.status === 'running') liveTurn(t); else col.append(assistantTurn(t)); }
  rove(lastTurn());
  setAttention(!VIEW.blank && openBlankOf(snap) ? 1 : 0);
  unsubConv = conv.subscribe(onConversationEvent);
}
function onConversationEvent(ev: ConversationEvent): void {
  const col = VIEW.col; if (!col) return;
  if (ev.type === 'turn-added') {
    col.querySelector('.ui-empty')?.remove();
    if (ev.turn.role === 'user') { col.append(userTurn(ev.turn.text, ev.turn.at)); if (VIEW.scroll) VIEW.scroll.scrollTop = VIEW.scroll.scrollHeight; }
    else liveTurn(ev.turn);
  } else if (ev.type === 'step-added') {
    const L = live.get(ev.turnId); if (!L) return;
    L.count++;
    L.ol.insertAdjacentHTML('beforeend', ui.html.steps([ev.step]).replace(/^<ol[^>]*>|<\/ol>$/g, ''));
  } else if (ev.type === 'turn-text') {
    const L = live.get(ev.turnId); if (!L) return;
    const stick = !VIEW.scroll || VIEW.scroll.scrollHeight - VIEW.scroll.scrollTop - VIEW.scroll.clientHeight < 80;
    const p = prose(ev.paragraphs);
    if (L.prose) L.prose.replaceWith(p); else $('.ui-entry__body', L.t).append(p);
    L.prose = p;
    if (stick && VIEW.scroll) VIEW.scroll.scrollTop = VIEW.scroll.scrollHeight;
  } else if (ev.type === 'reset') renderConversation();
  else if (ev.type === 'turn-finished') finishLive(ev.turnId, ev);
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

export function selectSession(id: string, opts: { quiet?: boolean; focus?: boolean } = {}): void {
  if (VIEW.running) sessions().stop(VIEW.current);
  VIEW.current = id;
  if (VIEW.col) { renderConversation(); if (VIEW.scroll) VIEW.scroll.scrollTop = 0; }
  const s = sessions().list.get().find((x) => x.id === id);
  if (!opts.quiet) emit('hx:session-select', { id, from: 'list', title: s ? s.title : '', project: s ? s.project : '' });
  emit('hx:title', { title: s ? s.title : '', project: s ? s.project : '', tab: 'session' });
  changed();
  if (opts.focus && VIEW.composer) VIEW.composer.focus();
}
export function newSession(project?: string): void {
  const cur = sessions().list.get().find((s) => s.id === VIEW.current);
  const s = sessions().create(project || (cur ? cur.project : '') || 'billing-api');
  selectSession(s.id, { focus: true });
}
export function toConversation(): void { const t = turnsEls().find((x) => x.tabIndex === 0) ?? lastTurn(); if (t) rove(t, true); }

export function mountView(root: HTMLElement): void {
  VIEW.root = root;
  root.classList.add('ss-view');
  VIEW.scroll = el('div', { class: 'ss-scroll' });
  VIEW.findAnchor = el('span', { class: 'ss-find-anchor', 'aria-hidden': 'true' });
  VIEW.col = el('div', { class: 'ss-col', role: 'feed', 'aria-label': 'Conversation' });
  VIEW.scroll.append(VIEW.col);
  root.replaceChildren(VIEW.findAnchor, VIEW.scroll);
  VIEW.col.addEventListener('keydown', onTurnKey);
  VIEW.col.addEventListener('focusin', (e) => { const t = (e.target as Element).closest<HTMLElement>('[data-hx-turn]'); if (t && e.target === t) rove(t); });
  const first = sessions().list.get()[0];
  if (first) VIEW.current = first.id;
  renderConversation();
  const c = VIEW.composer = sessionComposer({ draft: sessions().draft() });
  const host = el('div', { class: 'ss-composer' }, c);
  root.append(host);
  c.addEventListener('ui:send', (e) => {
    const text = (e as CustomEvent<{ text: string }>).detail.text, assume = c.lastAssume();
    setTimeout(() => { const g = data().details.governance.get(); sessions().send(VIEW.current, text, { governed: g.governed, smart: g.smart, model: g.model, assume }); }, 0);
  });
  c.addEventListener('ui:stop', () => { sessions().stop(VIEW.current); });
  c.addEventListener('ui:edit-last', (e) => {
    const users = turnsEls().filter((t) => TURN.get(t)?.kind === 'user'), u = users.pop();
    if (u) { e.preventDefault(); c.setValue(TURN.get(u)?.text ?? ''); c.focus(); }
  });
  new ResizeObserver(() => root.style.setProperty('--ss-comp-h', host.offsetHeight + 'px')).observe(host);
  requestAnimationFrame(() => c.focus());
  provide('stop', (d) => { if (d.tab !== 'session' || !VIEW.running) return false; sessions().stop(VIEW.current); return true; });
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
