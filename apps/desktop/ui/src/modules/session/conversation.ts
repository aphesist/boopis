/* The session view: a started session's conversation and its composer, on the v7 kit as the approved boards draw them (boards S20
   and S23; docs/design/v7/boards: sessiontab.js `s2`, `s4`).

   The thread is one column: the time, your messages as ink Bubbles at the end, and each of the agent's turns in the 30 gutter under
   the answering model's mark: what it said (a Bubble), the work line (a Disclosure over its steps), the changes and commands that
   wait on their tool rows (ToolRow with its answers), the changed files (FilesCard), the turn's foot (TurnFoot: its checkpoint and
   Undo, the model, the time, the cost), what it asks you (AskCard), and while it runs the status line. Turns come
   from the provider's conversation feed (a snapshot, then events); a turn is one stop for the keyboard (KEYMAP section 3.2:
   data-hx-turn, roving tabindex, an accessible name). This file composes kit components and wires them; `turn.ts` says what each
   one holds. */
import { followZone, atEnd } from '../chat/follow-zone';
import { emit, on } from '../../core/bus';
import { el, isMac, reduced } from '../../core/dom';
import { provide } from '../../core/registry';
import { kit, ui } from '@boopis/ui';
import { data } from '../../data';
import type { AgentTurn, GateFail, ConversationEvent, FormSpec, FormStatus, SessionSummary, ThreadLine, Turn, UserTurn } from '../../data';
import { clock } from '../../host/map';
import { sessionComposer } from './composer';
import type { SessionComposer } from './composer';
import { copyText, mdOf } from './shared';
import { openPanel } from './right';
import { childrenBlock, resetChildren, upsertChild } from './children';
import type { ChildHost } from './children';
import { councilBlock, drawCouncil } from './council';
import { setAttention, changed } from './state';
import { surface } from '../mods/surfaces';
import { answeredModel, syncDividers } from './attribution';
import { resolvePaths, wireRefs } from '../chat/refs';
import { REWIND_BASE, lineEl, rewindSheet, say, showSheet, v7Attrs, watchTyping } from './s0';
import { later } from '../chat/compose';
import type { RewindSheet } from './s0';
import { mountNew } from './new';
import type { NewScreen } from './new';
import { openModel, openCarefulFor, openEffort, openFolder, launchView } from './launch';
import { followEngine } from '../chat/engine';
import { approvalCard, askShape, footOf, isOpen, lapsedCard, sayTurn, statusOf, stepRows, toolRow, workLine } from './turn';
import type { AskState } from './turn';

export const VIEW = {
  root: null as HTMLElement | null, scroll: null as HTMLElement | null, col: null as HTMLElement | null, composer: null as SessionComposer | null,
  findAnchor: null as HTMLElement | null, current: 's1', /** the session you were in when a new one was opened: its row keeps its mark while the new session's canvas shows (board S17) */ from: null as string | null,
  /** the open session's blank, answered with this (null: not yet) */ blank: null as string | null
};
const sessions = () => data().sessions;
const controls = () => data().sessionControls;
const conv = () => sessions().conversation(VIEW.current);
/** whether a session has a turn running now: read from its own conversation, never from the view (switching never stops a
    turn: every bound session keeps streaming into its conversation, session-launch.md 2.2) */
export const isRunning = (id: string): boolean => sessions().conversation(id).snapshot().turns.some((t) => t.role === 'assistant' && t.status === 'running');
const childHost = (): ChildHost => ({ col: () => VIEW.col, now: Date.now, stop: sessions().stopChild ? (id) => sessions().stopChild?.(VIEW.current, id) : undefined, transcript: sessions().childTranscript ? (id) => sessions().childTranscript?.(VIEW.current, id) ?? Promise.reject(new Error('unavailable')) : undefined });

/* ───────── turns: what is drawn, by id ─────────
   The view keeps its own copy of each agent turn it drew and applies the feed's events to it (a provider may tell a step or a
   line of text before its snapshot holds it); a redraw reads the snapshot again. */
const TURNS = new Map<string, AgentTurn>();
const USERS = new Map<string, UserTurn>();
/** what became of each form answered here (its receipt on the tool row) */
const ASKS = new Map<string, AskState>();
const CLOCKS = new Map<string, number>();
const turnsEls = (): HTMLElement[] => (VIEW.col ? [...VIEW.col.querySelectorAll<HTMLElement>('[data-hx-turn]')] : []);
const lastTurn = (): HTMLElement | undefined => turnsEls().slice(-1)[0];
const turnNode = (id: string): HTMLElement | null => VIEW.col?.querySelector<HTMLElement>('[data-turn-id="' + CSS.escape(id) + '"]') ?? null;
export function rove(t: HTMLElement | undefined, focus?: boolean): void {
  turnsEls().forEach((x) => { x.tabIndex = x === t ? 0 : -1; x.removeAttribute('data-hx-focus'); });
  if (!t) return;
  t.setAttribute('data-hx-focus', 'messages');
  if (focus) { t.focus({ preventScroll: true }); t.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); }
}
const follow = (was: boolean): void => { if (was && VIEW.scroll) VIEW.scroll.scrollTop = VIEW.scroll.scrollHeight; };
const sticks = (): boolean => !VIEW.scroll || atEnd(VIEW.scroll, 80);

/** a turn's wrapper: its parts are the kit's, laid out by the kit's session thread */
function turnEl(kind: 'user' | 'agent', id: string, label: string): HTMLElement {
  return el('div', { class: 'ss-turn k7-thread', 'data-kind': 'session', 'data-turn': kind, 'data-turn-id': id, 'data-hx-turn': '', role: 'article', tabindex: '-1', 'aria-label': label });
}
/* an answer is markdown, drawn by the kit (one renderer for every conversation); its paths open in the session's folder */
const proseText = (paras: readonly string[], bullets?: readonly string[]): string => [...paras, ...(bullets?.length ? [bullets.map((b) => '- ' + b).join('\n')] : [])].join('\n\n');
const roots = (): string[] => { const c = data().details.environment.get().cwd; return c ? [c] : []; };
function prose(text: string): HTMLElement {
  const p = ui.markdown(text, { kit: true });
  void resolvePaths(p, roots());
  return p;
}
/** your message: an ink Bubble at the thread's end; what you attached is named under your words, each a reference chip */
function userTurn(u: UserTurn): HTMLElement {
  USERS.set(u.id, u);
  const t = turnEl('user', u.id, 'You, ' + u.at);
  const b = kit.bubble({ kind: 'user', text: u.text });
  if (u.attachments?.length) b.append(el('p', { class: 'ss-attached', role: 'list', 'aria-label': 'Attached' }, u.attachments.map((a) => { const c = kit.inlineChip({ kind: 'reference', text: a.name, ...(a.path ? { attrs: { 'data-tip': a.path, role: 'listitem' } } : { attrs: { role: 'listitem' } }) }); return c; })));
  t.append(b);
  return t;
}

/* ───────── an agent turn's parts ─────────
   Each part is one kit component, kept by its key and drawn again only when what it shows changed (`sig`), so an open step list,
   the focus and a stream in progress stay where they are while the turn changes around them. */
type Part = readonly [key: string, sig: string, build: () => HTMLElement];
function place(t: HTMLElement, parts: readonly Part[]): void {
  const have = new Map<string, HTMLElement>();
  for (const c of [...t.children]) have.set((c as HTMLElement).dataset['part'] ?? '', c as HTMLElement);
  let prev: Element | null = null;
  for (const [key, sig, build] of parts) {
    let n = have.get(key);
    have.delete(key);
    if (!n || n.dataset['sig'] !== sig) { const fresh = build(); fresh.dataset['part'] = key; fresh.dataset['sig'] = sig; if (n) n.replaceWith(fresh); n = fresh; }
    const at: Element | null = prev ? prev.nextElementSibling : t.firstElementChild;
    if (at !== n) { if (prev) prev.after(n); else t.prepend(n); }
    prev = n;
  }
  for (const n of have.values()) n.remove();
}
const forms = () => data().forms;
const formState = (f: FormSpec): AskState => ASKS.get(f.id) ?? {};
const waitsOn = (a: AgentTurn): FormSpec[] => (a.forms ?? []).filter((f) => askShape(f) !== 'card' && isOpen(f, formState(f)));
/** the change or command that waits for an answer in the open session, newest first (typing declines it with feedback, S09) */
export const waitingAsk = (): FormSpec | null => { for (const a of [...TURNS.values()].reverse()) { const f = waitsOn(a).filter((x) => askShape(x) === 'tool').pop(); if (f) return f; } return null; };
function answered(f: FormSpec, st: AskState): void {
  ASKS.set(f.id, { ...formState(f), at: clock(new Date()), ...st });
  redrawOf(f.id);
  VIEW.composer?.sync();
}
/** answer a form drawn on the kit: the provider delivers it; a refusal is said and the form stays open */
function answer(f: FormSpec, choice: string | null, note?: string): void {
  const names = f.schema.properties?.['choice']?.enum?.map(String) ?? [];
  const deny = choice === 'deny' || choice === null;
  const send = deny && !names.includes('deny') ? forms().cancel(f.id) : forms().submit(f.id, { values: askShape(f) === 'tool' ? { choice: deny ? 'deny' : choice } : {}, secrets: {} });
  send.then(() => { answered(f, { status: deny ? 'cancelled' : 'submitted', ...(choice ? { choice } : {}), ...(note ? { note } : {}) }); ui.announce(deny ? 'Declined' : 'Allowed'); })
    .catch((e: unknown) => { say(e instanceof Error ? e.message : 'The answer was not delivered.'); });
}
/** decline the waiting change with the words typed in the composer (S09: "Send feedback to decline this request") */
export function declineWith(text: string): boolean {
  const f = waitingAsk();
  if (!f) return false;
  answer(f, 'deny', text);
  return true;
}
function wireAsk(node: HTMLElement, f: FormSpec): HTMLElement {
  node.addEventListener('ui:commit', () => { answer(f, askShape(f) === 'tool' ? 'once' : 'approve'); });
  node.addEventListener('click', (e) => {
    const c = (e.target as Element).closest<HTMLElement>('[data-value]');
    if (!c || c.hasAttribute('data-hold') || c.getAttribute('aria-disabled') === 'true') return;
    answer(f, c.dataset['value'] ?? null);
  });
  /* KEYMAP section 6: on a card, x denies (and Esc, the Deny answer's key) */
  node.addEventListener('keydown', (e) => { if ((e.key === 'Escape' || e.key === 'x') && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); answer(f, 'deny'); } });
  return node;
}
/* the forms the kit has no drawing for yet (fields, sign-ins, plans): the form card, answered here or in the dock */
const FORM_STATE = { submitted: 'done', cancelled: 'cancelled', expired: 'expired' } as const;
function formCard(f: FormSpec): HTMLElement { const c = ui.card('form', f as unknown as Record<string, unknown>, { size: 'inline' }); c.dataset['formId'] = f.id; return c; }

/** the blank's sentence at the end of the answer: the question until it is answered; then the sentence written around your answer (a
    Mark, filled), or around the agent's guess once the blank lapsed ("(my guess)", board S23) */
function blankLine(a: AgentTurn): string {
  const q = a.blank; if (!q) return '';
  const ans = VIEW.blank, word = ans ?? q.guess ?? null, rw = word ? q.rewrites?.[word] : null;
  if (!word) return ui.esc(q.question);
  const s: readonly [string, string] = rw ? [rw.lead, rw.tail] : (q.free ?? ['Your answer:', '. I will follow it before the PR.']);
  const mark = ans ? kit.html.mark({ kind: 'blank', blank: 'filled', text: ans }) : kit.html.mark({ text: word, state: 'shown', attrs: { 'data-guess': '' } });
  return ui.html.inline(s[0]) + ' ' + mark + (/^[.,;]/.test(s[1]) ? '' : ' ') + ui.html.inline(s[1]) + (ans ? '' : ' (my guess).');
}
/** the blank as the kit's AskCard (question): its options as answers, "Something else" for your own words; answering again changes it */
function blankCard(a: AgentTurn): HTMLElement {
  const q = a.blank as NonNullable<AgentTurn['blank']>;
  const last = answeredModel(a.model), chosen = VIEW.blank ?? q.guess ?? null;
  const card = kit.askCard({ variant: 'question', state: chosen ? 'asked' : 'needs', ...(last ? { model: last } : {}), who: 'asked during the turn', ask: q.short || q.question, answers: q.options.map((o) => ({ label: o, value: o, primary: o === chosen })), attrs: { 'data-blank': '' } });
  card.addEventListener('click', (e) => {
    const c = (e.target as Element).closest<HTMLElement>('[data-kit~="Chip"]'); if (!c) return;
    const v = c.dataset['value'];
    if (v && v !== 'else') { if (v !== VIEW.blank) sessions().answerBlank(VIEW.current, v); return; }
    /* your own words: a field in place of the answers; Enter answers, Escape brings the answers back */
    const row = card.querySelector<HTMLElement>('.k7-ask__answers'); if (!row) return;
    const field = kit.field({ id: 'ss-blank-own', label: 'Your answer', placeholder: 'Your answer' });
    const input = field.querySelector<HTMLInputElement>('input, textarea');
    row.hidden = true; row.after(field); input?.focus();
    input?.addEventListener('keydown', (k) => {
      if (k.key === 'Enter' && input.value.trim()) { k.preventDefault(); sessions().answerBlank(VIEW.current, input.value.trim()); }
      if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); field.remove(); row.hidden = false; c.focus(); }
    });
  });
  return card;
}

function partsOf(a: AgentTurn): Part[] {
  const out: Part[] = [];
  const running = a.status === 'running', last = answeredModel(a.model), isLast = lastAgent() === a.id;
  const text = proseText(a.paragraphs, a.bullets);
  const said = (): void => {
    if (!text && !a.blank) return;
    /* a stream keeps its Bubble: the text in it is drawn block by block as it arrives (streamText) */
    out.push(['text', (running ? 'live' : 'done:' + text.length) + '|' + (VIEW.blank ?? '') + '|' + last, () => {
      const outer = kit.bubble({ kind: 'agent', text: '', ...(last ? { brand: last } : { gutter: true }) });
      const b = outer.matches('[data-kit~="Bubble"]') ? outer : outer.querySelector<HTMLElement>('[data-kit~="Bubble"]') as HTMLElement;
      const md = text ? prose(text) : null, q = blankLine(a);
      b.replaceChildren(...(md ? [md] : []));
      if (q) {
        /* the sentence ends the answer's last paragraph (board S23); after a list or code it is a paragraph of its own */
        const tail = md?.lastElementChild?.tagName === 'P' ? md.lastElementChild : null;
        /* the sentence a blank writes into the answer carries its mark (board S23: the guess, dashed): `data-mark-context` says so */
        if (tail) tail.insertAdjacentHTML('beforeend', ' <span class="ss-q" data-mark-context>' + q + '</span>'); else { const p = el('p', { class: 'ss-q', 'data-mark-context': '' }); p.innerHTML = q; b.append(p); }
      }
      if (b !== outer) kit.hoverBeside(answerActs(a.id), b);
      return outer;
    }]);
  };
  const log = (): void => {
    if (!a.steps.length) return;
    const line = workLine(a);
    /* the list under it is drawn again as steps arrive; whether it is open is the reader's (kept across a redraw) */
    out.push(['log', line + '|' + a.steps.length + '|' + a.status, () => {
      const open = turnNode(a.id)?.querySelector('[data-part="log"]')?.hasAttribute('data-open') ?? false;
      /* a change says its lines where the session's changed files know them (the last turn's: board S10, "Changed dock.css, +12 −3") */
      const changes = isLast ? data().details.changes.get() : [];
      const counts = (path: string): readonly [number, number] | null => { const c = changes.find((x) => x[0] === path || x[0].endsWith('/' + path) || path.endsWith('/' + x[0])); return c ? [c[1], c[2]] : null; };
      return kit.disclosure({ variant: 'worklog', summary: line, steps: stepRows(a, counts), open });
    }]);
  };
  if (a.council) out.push(['council', 'council', () => councilBlock(a.council as NonNullable<AgentTurn['council']>)]);
  /* while it works or waits: what it said, then what it did (board S20); once it ended: the work, then the answer (board S23) */
  if (running) { said(); log(); } else { log(); said(); }
  for (const f of a.forms ?? []) {
    if (askShape(f) !== 'tool') continue;
    const st = formState(f), status = st.status ?? f.resolved;
    /* a change whose approval lapsed becomes the ask card (S09) */
    if (status === 'expired') out.push(['ask:' + f.id, 'lapsed', () => kit.askCard(lapsedCard(f, last))]);
    else out.push(['tool:' + f.id, JSON.stringify([status ?? 'open', st.choice, st.at, st.note]), () => wireAsk(kit.toolRow(toolRow(f, last, st)), f)]);
  }
  if (a.children?.length) out.push(['children', 'children', () => childrenBlock(a.children ?? [], childHost())]);
  /* a ship that did not pass its gate (board S38): the check and its verdict, what it printed, what became of the change, and the one
     way on, which asks the agent to fix what the gate found and ship again (on the last turn, once it ended) */
  if (a.gate && !running) out.push(['gate', JSON.stringify([a.gate, isLast]), () => gateCard(a.gate as GateFail, isLast)]);
  /* the last finished turn that changed files lists them (board S23); their diff opens in the Changes panel */
  const files = isLast && !running && (a.ship || a.kept?.length) ? data().details.changes.get() : [];
  if (files.length) out.push(['files', JSON.stringify(files), () => filesCard(files.map((c) => ({ path: c[0], add: c[1], del: c[2] })))]);
  const foot = footOf(a, footCan(a));
  if (foot) out.push(['foot', JSON.stringify(foot), () => {
    const f = kit.turnFoot(foot);
    f.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('.k7-foot__btn');
      if (!b || b.disabled) return;
      if (b.dataset['value'] === 'undo') undoTurn(a.id);
      if (b.dataset['value'] === 'edit') editFrom(a.id);
      if (b.dataset['value'] === 'fork') say('Forking from a turn is not in this build yet.');
    });
    return f;
  }]);
  for (const f of (a.forms ?? []).filter((x) => askShape(x) === 'approval')) {
    const st = formState(f);
    out.push(['ask:' + f.id, JSON.stringify([st.status ?? f.resolved ?? 'open', st.at]), () => wireAsk(kit.askCard(approvalCard(f, last, st)), f)]);
  }
  if (a.blank) out.push(['blank', VIEW.blank ?? '', () => blankCard(a)]);
  const cards = (a.forms ?? []).filter((f) => askShape(f) === 'card');
  if (cards.length) out.push(['cards', cards.map((f) => f.id).join(), () => el('div', { class: 'ss-forms' }, cards.map(formCard))]);
  const st = statusOf(a, waitsOn(a).length > 0);
  if (st) out.push(['status', st.phrase + '|' + st.working + '|' + last, () => kit.statusLine({ kind: 'session', ...(last ? { model: last } : {}), phrase: st.phrase, working: st.working, ...(st.working ? { count: elapsed(a) } : {}) })]);
  return out;
}
const lastAgent = (): string | null => [...TURNS.keys()].pop() ?? null;
const elapsed = (a: AgentTurn): string => Math.max(0, Math.floor((Date.now() - (a.startedAt ?? Date.now())) / 1000)) + 's';
function filesCard(files: Array<{ path: string; add: number; del: number }>): HTMLElement {
  const c = kit.filesCard({ files, action: 'Open diff', actionAttrs: { 'data-action': 'view-diff' }, ...(files.length > 8 ? { fold: true, open: false } : {}) });
  c.querySelector('[data-files]')?.addEventListener('click', () => { openPanel('changes'); });
  return c;
}
/** what "Fix and retry" sends as your next message: the agent reads the failing check in its own context */
export const FIX_AND_RETRY = 'The gate failed. Fix what it found and ship the change again.';
/** board S38: the gate failed. The kit's FilesCard in its check form: "Gate", "failed" in red, what the failing check printed, what
    became of the change. "Fix and retry" is on the session's last turn only (an earlier failure is history) and sends the ask above */
function gateCard(g: GateFail, last: boolean): HTMLElement {
  const c = kit.filesCard({ files: g.files.map((path) => ({ path })), check: { title: 'Gate', word: 'failed', tone: 'red', ...(g.output.length ? { output: g.output.join('\n') } : {}), note: g.note }, ...(last ? { action: 'Fix and retry', actionAttrs: { 'data-action': 'fix-retry' } } : {}), attrs: { 'data-checks': g.checks.join(' ') || null } });
  c.querySelector('[data-files]')?.addEventListener('click', () => {
    if (isRunning(VIEW.current)) return;
    const gv = data().details.governance.get();
    sessions().send(VIEW.current, FIX_AND_RETRY, { governed: gv.governed, smart: gv.smart, model: gv.model, assume: [], attachments: [] });
  });
  return c;
}
const turnText = (id: string): string => { const b = turnNode(id)?.querySelector<HTMLElement>('[data-part="text"] [data-kit~="Bubble"], [data-part="text"][data-kit~="Bubble"]'); return b ? mdOf(b) : ''; };

/** the answer's hover actions, the ones a bot's message has (owner; board 11's `.hoverbar`: copy, more): the kit's HoverBar beside the
    answer's bubble. Copy takes the answer as it reads (what C on the turn copies); "more" holds the copy as Markdown, the words as
    the model wrote them */
function answerActs(id: string): HTMLElement {
  const bar = kit.hoverBar({ label: 'Actions on this answer', actions: [{ value: 'copy', icon: 'copy', label: 'Copy this answer', tip: 'Copy' }, { value: 'more', icon: 'more', label: 'More for this answer', tip: 'More', menu: true }] });
  const bubble = (): HTMLElement | null => turnNode(id)?.querySelector<HTMLElement>('[data-part="text"] [data-kit~="Bubble"]') ?? null;
  bar.addEventListener('ui:act', (e) => {
    const d = (e as CustomEvent<{ value: string; el: HTMLElement }>).detail;
    if (d.value === 'copy') { const b = bubble(); void copyText((b?.innerText ?? b?.textContent ?? '').trim()); kit.notify('Copied'); return; }
    kit.openMenu(d.el, { label: 'More', place: 'below', align: 'start', attrs: v7Attrs(), entries: [{ label: 'Copy as Markdown', icon: 'copy', value: 'md' }], onSelect: () => { const t = TURNS.get(id); void copyText(t ? proseText(t.paragraphs, t.bullets) : ''); kit.notify('Copied'); } });
  });
  return bar;
}

/** draw an agent turn (again) from the view's copy of it */
function drawAgent(id: string): void {
  const a = TURNS.get(id); if (!a) return;
  let t = turnNode(id);
  if (!t) { t = turnEl('agent', id, sayTurn(a)); (VIEW.col as HTMLElement).append(t); }
  t.setAttribute('aria-label', sayTurn(a));
  t.toggleAttribute('aria-busy', a.status === 'running');
  t.dataset['answered'] = answeredModel(a.model);
  t.toggleAttribute('data-ungoverned', !!a.ungoverned);
  place(t, partsOf(a));
  ticking(a);
}
/** a running turn's clock: the status line counts its seconds while it works */
function ticking(a: AgentTurn): void {
  const on = a.status === 'running';
  if (on && !CLOCKS.has(a.id)) CLOCKS.set(a.id, window.setInterval(() => { const now = TURNS.get(a.id), c = turnNode(a.id)?.querySelector('.k7-status__count'); if (now && c) c.textContent = elapsed(now); }, 1000));
  if (!on && CLOCKS.has(a.id)) { clearInterval(CLOCKS.get(a.id)); CLOCKS.delete(a.id); }
}
/** the running turn's answer so far: what is finished stays, the block being written is drawn again */
function streamText(a: AgentTurn): void {
  const md = turnNode(a.id)?.querySelector<HTMLElement>('[data-part="text"] .ui-md, [data-part="text"] [data-kit~="Bubble"] > :first-child');
  if (!md || !md.classList.contains('ui-md')) { drawAgent(a.id); return; }
  for (const d of ui.markdown.stream(md, proseText(a.paragraphs), { kit: true }).slice(0, -1)) void resolvePaths(d, roots());
}
/** the turn that holds a form, drawn again */
function redrawOf(formId: string): void { for (const a of TURNS.values()) if (a.forms?.some((f) => f.id === formId)) drawAgent(a.id); }

/* ───────── S0: the lines about the thread, the rewind on a finished turn and its sheet (ADR-0058) ───────── */
/** what a finished turn's foot offers: the checkpoint it left (counted over the session), Undo where the session can rewind and the
    turn kept a change, Edit from here and Fork once they exist */
function footCan(a: AgentTurn): Parameters<typeof footOf>[1] {
  const c = controls();
  let n = 0;
  for (const t of TURNS.values()) { n += t.kept?.length ?? 0; if (t.id === a.id) break; }
  const avail = c?.capabilities.get().session.rewind;
  return { checkpoint: a.kept?.length ? n : 0, undo: c && avail && a.kept?.length ? (avail.ok ? { ok: true } : { ok: false, why: avail.why }) : null, edit: later('turn-edit'), fork: later('turn-fork') };
}
/** Undo on a turn: the files go back to before it, to the checkpoint the turn before it left (before the session, for the first) */
function undoTurn(id: string): void {
  let prev: string | null = null;
  for (const t of TURNS.values()) { if (t.id === id) break; if (t.kept?.length) prev = t.kept[t.kept.length - 1] as string; }
  void openRewind(prev, prev ? 'Rewind files to before this turn' : REWIND_BASE);
}
/** Edit from here: the message this turn answered goes back into the composer */
function editFrom(id: string): void {
  const before = turnNode(id)?.previousElementSibling as HTMLElement | null;
  const u = before ? USERS.get(before.dataset['turnId'] ?? '') : undefined;
  if (u) { VIEW.composer?.setValue(u.text); VIEW.composer?.focus(); }
}
const syncFeet = (): void => { for (const id of TURNS.keys()) drawAgent(id); };
function placeLine(col: HTMLElement, l: ThreadLine): void {
  col.querySelector('.ss-s0-line[data-line-id="' + l.id + '"]')?.remove();
  const node = lineEl(l, (ship) => { void undoRewind(ship); });
  const after = l.afterTurn ? col.querySelector<HTMLElement>('[data-turn-id="' + l.afterTurn + '"]') : null;
  if (!after) { if (l.afterTurn) col.append(node); else (col.querySelector('.k7-time') ?? col).after(node); if (!node.isConnected) col.prepend(node); return; }
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

/* ───────── the new session's screen (boards S17, S41 A): the canvas and its own composer until the first message ───────── */
let stopWatch: (() => void) | null = null;
let NEW: NewScreen | null = null;
/** a session that has not started: it has no turn yet and the provider can launch one (its place is the canvas, not a row of the list) */
export const isDraft = (id: string): boolean => !!controls() && !!sessions().list.get().find((s) => s.id === id)?.draft && !sessions().conversation(id).snapshot().turns.length;
function showNew(): boolean {
  if (!controls() || !NEW) return false;
  NEW.show(launchView());
  stopWatch?.();
  const input = NEW.input(), canvas = VIEW.root?.querySelector<HTMLElement>('.ss-new__canvas');
  if (input && canvas) stopWatch = watchTyping(canvas, input);
  return true;
}
function hideNew(): void { NEW?.hide(); stopWatch?.(); stopWatch = null; }
/** the canvas again, after a launch setting changed (only while the session has not started) */
export function redrawCanvas(): void { if (NEW?.shown) showNew(); }

/* ───────── the conversation ───────── */
const openBlankOf = (turns: readonly Turn[]): boolean => turns.some((t) => t.role === 'assistant' && !!t.blank && !t.blank.answer);
export const sessionNeedsYou = (id: string): boolean => openBlankOf(sessions().conversation(id).snapshot().turns);
/** the time that heads the thread (board 10: "Today 09:42"): a clock is today's */
const timeOf = (at: string): string => (/^\d{1,2}:\d{2}$/.test(at) ? 'Today ' + at : at);
const running = (): boolean => [...TURNS.values()].some((a) => a.status === 'running');
function working(): void { const r = running(); VIEW.composer?.setRunning(r); VIEW.composer?.sync(); surface.onWorking?.(r); }

let unsubConv: (() => void) | null = null;
export function renderConversation(): void {
  const col = VIEW.col as HTMLElement; col.replaceChildren();
  for (const t of CLOCKS.values()) clearInterval(t);
  CLOCKS.clear(); TURNS.clear(); USERS.clear();
  resetChildren();
  unsubConv?.();
  const c = conv(), snap = c.snapshot().turns;
  const withBlank = snap.find((t): t is AgentTurn => t.role === 'assistant' && !!t.blank);
  VIEW.blank = withBlank?.blank?.answer ?? null;
  const launch = !snap.length && showNew();
  if (!launch) hideNew();
  if (!launch && !snap.length) {
    const s = sessions().list.get().find((x) => x.id === VIEW.current);
    col.append(kit.emptyState({ text: s?.project ? 'What should change in ' + s.project + '?' : 'What should change?' }));
  }
  const first = snap.find((t): t is UserTurn => t.role === 'user');
  if (first?.at) col.append(kit.timeSeparator({ text: timeOf(first.at) }));
  for (const t of snap) {
    if (t.role === 'user') { col.append(userTurn(t)); continue; }
    TURNS.set(t.id, { ...t });
  }
  for (const id of TURNS.keys()) { const u = snap[snap.findIndex((x) => x.id === id) - 1]; drawAgent(id); const n = turnNode(id), before = u ? turnNode(u.id) : null; if (n && before && before.nextElementSibling !== n) before.after(n); }
  for (const l of c.snapshot().lines ?? []) placeLine(col, l);
  working();
  syncDividers(col);
  rove(lastTurn());
  setAttention(!VIEW.blank && openBlankOf(snap) ? 1 : 0);
  unsubConv = c.subscribe(onConversationEvent);
  surface.onConversation?.(VIEW.current);   /* what a mod placed in this session goes back in */
}
/** apply an event to the view's copy of its turn and draw the turn again */
function change(id: string, fn: (a: AgentTurn) => AgentTurn | void): void {
  const a = TURNS.get(id); if (!a) return;
  const was = sticks();
  TURNS.set(id, fn(a) ?? a);
  drawAgent(id);
  follow(was);
}
function onConversationEvent(ev: ConversationEvent): void {
  const col = VIEW.col; if (!col) return;
  if (ev.type === 'turn-added') {
    col.querySelector('.k7-empty')?.remove();
    if (!col.querySelector('.k7-time') && ev.turn.role === 'user') col.prepend(kit.timeSeparator({ text: timeOf(ev.turn.at) }));
    hideNew(); changed();   /* the session has started: it takes its row in the list */
    if (ev.turn.role === 'user') { col.append(userTurn(ev.turn)); follow(true); return; }
    const prev = lastAgent();
    TURNS.set(ev.turn.id, { ...ev.turn });
    if (prev) drawAgent(prev);   /* the status line and the diff belong to the last turn */
    drawAgent(ev.turn.id);
    working(); syncDividers(col); follow(true);
  } else if (ev.type === 'step-added') change(ev.turnId, (a) => (a.steps.includes(ev.step) ? a : { ...a, steps: [...a.steps, ev.step], stepCount: Math.max(a.stepCount, a.steps.length + 1) }));
  else if (ev.type === 'turn-text') {
    const a = TURNS.get(ev.turnId); if (!a) return;
    const was = sticks(), fresh = !a.paragraphs.length;
    TURNS.set(a.id, { ...a, paragraphs: ev.paragraphs });
    if (fresh) drawAgent(a.id); else streamText(TURNS.get(a.id) as AgentTurn);
    follow(was);
  } else if (ev.type === 'reset') renderConversation();
  else if (ev.type === 'blank-opened') { change(ev.turnId, (a) => ({ ...a, blank: ev.blank })); VIEW.blank = ev.blank.answer ?? null; setAttention(VIEW.blank ? 0 : 1); }
  else if (ev.type === 'form-opened') { change(ev.turnId, (a) => ({ ...a, forms: [...(a.forms ?? []).filter((f) => f.id !== ev.form.id), ev.form] })); VIEW.composer?.sync(); }
  else if (ev.type === 'form-resolved') resolveForm(ev.formId, ev.status);
  else if (ev.type === 'child-updated') { change(ev.turnId, (a) => ({ ...a, children: [...(a.children ?? []).filter((c) => c.id !== ev.child.id), ev.child] })); upsertChild(ev.turnId, ev.child, childHost()); }
  else if (ev.type === 'turn-model') { change(ev.turnId, (a) => ({ ...a, model: ev.model })); syncDividers(col); }
  else if (ev.type === 'council') { change(ev.turnId, (a) => ({ ...a, council: ev.council })); const b = turnNode(ev.turnId)?.querySelector<HTMLElement>('.ss-council'); if (b) drawCouncil(b, ev.council); }
  else if (ev.type === 'turn-finished') {
    change(ev.turnId, (a) => ({ ...a, status: ev.stopped ? 'stopped' : 'done', time: ev.time, cost: ev.cost, stepCount: ev.stepCount, paragraphs: ev.paragraphs, ...(ev.model ? { model: ev.model } : {}), ...(ev.why ? { why: ev.why } : {}) }));
    working(); syncDividers(col); rove(turnNode(ev.turnId) ?? undefined);
    ui.announce(ev.stopped ? 'Stopped' : 'Answer ready');
  } else if (ev.type === 'line') { placeLine(col, ev.line); syncDividers(col); }
  else if (ev.type === 'turn-kept') change(ev.turnId, (a) => ({ ...a, kept: ev.kept }));
  else if (ev.type === 'turn-gate') change(ev.turnId, (a) => ({ ...a, gate: ev.gate ?? undefined }));
  else if (ev.type === 'blank-answered') {
    VIEW.blank = ev.answer;
    setAttention(0); changed();
    change(ev.turnId, () => undefined);
  }
}
/** a form was answered, cancelled or lapsed (here, in the dock or by its clock) */
function resolveForm(formId: string, status: FormStatus): void {
  if (!ASKS.get(formId)?.status) ASKS.set(formId, { ...ASKS.get(formId), status, at: clock(new Date()) });
  redrawOf(formId);
  for (const c of VIEW.col?.querySelectorAll<HTMLElement & { update(p: Record<string, unknown>): unknown; state: string }>('hx-card[data-kind="form"]') ?? []) {
    if ((c as unknown as { data: { id?: string } }).data.id === formId && c.state !== FORM_STATE[status]) c.update({ state: FORM_STATE[status] });
  }
  VIEW.composer?.sync();
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
  const list = turnsEls(), i = list.indexOf(t), id = t.dataset['turnId'] ?? '';
  const go = (n: number): void => { e.preventDefault(); rove(list[Math.max(0, Math.min(list.length - 1, n))], true); };
  const user = USERS.get(id);
  if (key === 'ArrowDown' || key === 'j') return go(i + 1);
  if (key === 'ArrowUp' || key === 'k') return go(i - 1);
  if (key === 'Home') return go(0);
  if (key === 'End' || (key === 'G' && e.shiftKey)) return go(list.length - 1);
  if (key === 'Enter' || key === 'o') { const d = t.querySelector<HTMLElement>('.k7-disc__sum'); if (d) { e.preventDefault(); d.click(); } return; }
  if (key === 'c') { e.preventDefault(); void copyText(user ? '> ' + user.text : turnText(id) || t.innerText); kit.notify('Copied'); return; }
  if (key === 'e' && user) { e.preventDefault(); VIEW.composer?.setValue(user.text); VIEW.composer?.focus(); return; }
  if (key === 'd') { e.preventDefault(); openPanel('changes'); return; }
  if (key === 'b') { const b = t.querySelector<HTMLElement>('[data-blank] [data-kit~="Chip"]'); if (b) { e.preventDefault(); b.focus(); } }
}

/* find in this conversation (mod+F through the shell's provider) */
function openFind(): boolean {
  if (!VIEW.col || !VIEW.root || !VIEW.findAnchor) return false;
  const field = kit.field({ id: 'ss-find', kind: 'search', label: 'Find in this conversation', placeholder: 'Words in a message or an answer' });
  const input = field.querySelector('input') as HTMLInputElement, hint = el('p', { class: 'ss-find-count', 'aria-live': 'polite' });
  const box = el('div', { class: 'ss-find', ...v7Attrs() }, [field, hint]);
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

/** what the title pill says of a session: its name, and the branch it works on once it has started (board S20). With no folder to
    start one in, nothing is open yet and the pill names the tab, "Sessions" (board S41; a new session with a folder is S17's "New session") */
const NOTHING_OPEN = 'Sessions';
const noFolder = (s: SessionSummary | undefined): boolean => !!controls() && (!s || isDraft(s.id)) && launchView().folder === null;
const titleOf = (s: SessionSummary | undefined): { title: string; project: string; tab: 'session'; sub: string } => ({ title: noFolder(s) ? NOTHING_OPEN : s?.title ?? (controls() ? 'New session' : ''), project: s?.project ?? '', tab: 'session', sub: s && !isDraft(s.id) ? s.branch ?? '' : '' });
const openSession = (): SessionSummary | undefined => sessions().list.get().find((x) => x.id === VIEW.current);
export function selectSession(id: string, opts: { quiet?: boolean; focus?: boolean } = {}): void {
  /* switching never stops a turn: the running session keeps streaming into its conversation (session-launch.md 2.2) */
  VIEW.current = id;
  data().details.follow(id);
  if (VIEW.col) { renderConversation(); if (VIEW.scroll) VIEW.scroll.scrollTop = 0; }
  const s = sessions().list.get().find((x) => x.id === id);
  if (!opts.quiet) emit('hx:session-select', { id, from: 'list', title: s ? s.title : '', project: s ? s.project : '' });
  emit('hx:title', titleOf(s));
  changed();
  if (opts.focus) { if (NEW?.shown) NEW.focus(); else VIEW.composer?.focus(); }
}
export function newSession(project?: string): void {
  const cur = sessions().list.get().find((s) => s.id === VIEW.current);
  const s = sessions().create(project || (cur ? cur.project : '') || (data().info.live ? '' : 'billing-api'));
  if (cur && !isDraft(cur.id)) VIEW.from = cur.id;
  selectSession(s.id, { focus: true });
}
export function toConversation(): void { const t = turnsEls().find((x) => x.tabIndex === 0) ?? lastTurn(); if (t) rove(t, true); }

export function mountView(root: HTMLElement): void {
  VIEW.root = root;
  ASKS.clear();
  root.classList.add('ss-view');
  VIEW.scroll = el('div', { class: 'ss-scroll ' + ui.scrollClass({ ground: true }) });
  VIEW.findAnchor = el('span', { class: 'ss-find-anchor', 'aria-hidden': 'true' });
  VIEW.col = el('div', { class: 'ss-col', role: 'log', 'aria-label': 'Conversation' });
  VIEW.scroll.append(VIEW.col);
  root.replaceChildren(VIEW.findAnchor, VIEW.scroll);
  VIEW.col.addEventListener('keydown', onTurnKey);
  wireRefs(VIEW.col, { bot: () => null });
  VIEW.col.addEventListener('focusin', (e) => { const t = (e.target as Element).closest<HTMLElement>('[data-hx-turn]'); if (t && e.target === t) rove(t); });
  followEngine(() => VIEW.col);   /* board S36: the engine stopped mid-session: the thread ends with the line that says so and starts it again */
  const first = sessions().list.get()[0];
  if (first) VIEW.current = first.id;
  /* the app opens on a new session: the row of the session that was last worked in keeps its mark */
  if (first && isDraft(first.id)) VIEW.from = sessions().list.get().find((x) => !isDraft(x.id))?.id ?? null;
  changed();   /* the list was drawn before the view knew which session is open */
  data().details.follow(VIEW.current);
  NEW = mountNew(root, {
    actions: {
      folder: () => { void openFolder(); },
      /* with no model signed in there is nothing to choose from: the way is the sign-ins (Settings, Models) */
      model: (a) => { if (data().details.choices.get().length) openModel(a); else emit('hx:open-settings', { section: 'models', from: 'no-model' }); },
      signin: (lab) => { emit('hx:open-settings', { section: 'models', from: 'no-model', ...(lab ? { find: lab } : {}) }); },
      effort: (a) => { openEffort(a); },
      careful: (a) => { openCarefulFor(a, 'below'); },
      open: (id) => { selectSession(id, { focus: true }); }
    },
    /* ctrl Enter starts it in the background: the session starts and takes its row, and a new session's canvas stays in front */
    send: (text, background) => {
      const g = data().details.governance.get();
      sessions().send(VIEW.current, text, { governed: g.governed, smart: g.smart, model: g.model, assume: [], attachments: [] });
      if (background) newSession();
    }
  });
  data().details.governance.subscribe(() => { redrawCanvas(); });
  /* the composer: the kit's one-row pill with the session's line; its zone holds the slots a mod draws into (MODS.md section 3): the
     band above the composer and the status line under it; empty slots take no room */
  const host = el('div', { class: 'ss-composer' });
  const slots = { band: el('div', { class: 'ss-mods ss-mods--band' }), status: el('div', { class: 'ss-mods ss-mods--status' }) };
  const slot = el('div', { class: 'ss-composer__slot' });
  host.append(slots.band, slot, slots.status);
  root.append(host);
  const c = VIEW.composer = sessionComposer(slot, {
    draft: sessions().draft(), sessionId: () => VIEW.current,
    waits: () => !!waitingAsk(),
    /** what the placeholder says of the thread: a change waits for your answer, the last turn ended, or nothing yet */
    after: () => { const last = conv().snapshot().turns.at(-1); return !!last && last.role === 'assistant' && last.status !== 'running' && !last.gate; },   /* your own message with no answer yet is not an ended turn (S36: "Message"), nor is a change the gate did not pass (S38) */
    send: (text, meta) => {
      /* typing while a change waits declines it with these words (S09); the words are then the next message */
      declineWith(text);
      setTimeout(() => { const g = data().details.governance.get(); sessions().send(VIEW.current, text, { governed: g.governed, smart: g.smart, model: g.model, ...meta }); }, 0);
    },
    stop: () => { sessions().stop(VIEW.current); },
    lastMessage: () => [...USERS.values()].pop()?.text ?? null
  });
  renderConversation();
  surface.slots = slots; surface.place = placeRow;
  surface.onConversation?.(VIEW.current);
  followZone(host, () => VIEW.scroll, () => root, '--ss-comp-h')();
  requestAnimationFrame(() => c.focus());
  const c0 = controls();
  /* a folder chosen (or lost) changes what the pill says of a session that has not started */
  if (c0) { c0.capabilities.subscribe(() => { syncFeet(); redrawCanvas(); }); c0.launch.subscribe(() => { redrawCanvas(); if (NEW?.shown) emit('hx:title', titleOf(openSession())); }); }
  data().details.changes.subscribe(() => { const id = lastAgent(); if (id) drawAgent(id); });
  provide('stop', (d) => { if (d.tab !== 'session' || !isRunning(VIEW.current)) return false; sessions().stop(VIEW.current); return true; });
  provide('find', (d) => (d.tab === 'session' ? openFind() : false));
  on('hx:nav', (d) => {
    if (d.region !== 'messages') return;
    const list = turnsEls(); const t = d.action === 'last' ? list[list.length - 1] : list[0];
    if (t) rove(t, true);
  });
  on('hx:new-session', (d) => newSession(d.project));
  on('hx:session-select', (d) => { if (d.id && d.from !== 'list' && d.id !== VIEW.current && sessions().list.get().some((x) => x.id === d.id)) selectSession(d.id, { quiet: true }); });
  emit('hx:title', titleOf(openSession()));
}
