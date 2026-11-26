/* A bot's chat, as board 11 draws it (docs/design/v7/boards: botscreens.js bot11): no header of its own (the chrome's title pill
   names the bot and opens the details pane), the thread on the 640 column (the time separator, your bubbles in the bot's fill,
   the bot's bubbles, its tool rows and file cards, its approval as an AskCard, the status line while it works or waits for you),
   and the kit's one-row Composer with its line (Governed, the model, the spend) centred 24 px above the window's foot.
   Every entry is a turn (KEYMAP sections 3 and 5: data-hx-turn and a roving tabindex). Everything that changes comes from the
   provider's events; everything the user does is a provider command. */
import { emit } from '../../core/bus';
import { cap1, el, reduced } from '../../core/dom';
import { setState, state } from '../../core/state';
import { kit, lookOf, repaintLook, ui } from '@boopis/ui';
import { bubbleOf, placeActs, turnActs, turnBody, turnEntry } from './turn';
import type { AskAnswer, MarkdownCtx } from '@boopis/ui';
import { data } from '../../data';
import type { ApprovalMessage, Bot, BotsEvent, ThreadMessage } from '../../data';
import { bot, initModel, S, thread } from './model';
import { livenIn } from './orbs';
import { markSelected, updateRow } from './list';
import { openNew } from './new-bot';
import { mountGroupPane } from './group-room';
import { mountNewGroupPane } from './new-group';
import { openSettings } from './settings';
import { checkClips, watchClips } from './clips';
import { atEnd, followZone } from '../chat/follow-zone';
import { paintDetails } from './details';
import { composeTools, later, mentionChips, micUnavailable, voiceNeedsSetup } from '../chat/compose';
import { followEngine } from '../chat/engine';
import { outsideDescription, outsideRoomMark } from './outside';
import { mountHeld } from './held';
import { mentionCtx, resolvePaths, wireRefs } from '../chat/refs';

const bots = () => data().bots;
const NODE = new Map<string, HTMLElement>();
const ENTRY = new WeakMap<HTMLElement, { msgs: ThreadMessage[]; who: string }>();
const notify = (t: string): void => { kit.notify(t); };   /* what happened, in a word: the kit's floating Notice */
function newSession(): void {
  const b = bot(S.sel), sessions = bots().sessions; if (!b || !sessions) return;
  sessions.fresh(b.id);
  S.composer?.focus();
}
function paintNewSession(): void {
  paintDetails(newSession);
  const top = S.pActs, b = bot(S.sel); if (!top) return;
  const fresh = !!b && !!bots().sessions && thread(b.id).length > 0, outside = !!b?.madeOutside;
  const sig = (b?.id ?? '') + '|' + fresh + '|' + outside;
  if (top.dataset['sig'] === sig) return;
  top.dataset['sig'] = sig;
  top.replaceChildren();
  top.hidden = !fresh && !outside;
  if (outside) top.append(outsideRoomMark('bt-outside-room'), outsideDescription('bt-outside-room'));
  if (fresh && b) { const ns = kit.button({ label: 'New session', variant: 'ghost', size: 28, icon: 'plus', attrs: { 'data-action': 'new-session', 'aria-label': 'New session with ' + b.name } }); ns.addEventListener('click', newSession); top.append(el('span', { class: 'k7-grow' }), ns); }
}

/* ───────── view ───────── */
export function mountView(root: HTMLElement): void {
  initModel();
  S.viewRoot = root;
  root.textContent = '';
  root.classList.add('bt-view');
  const room = el('section', { class: 'bt-room', 'aria-label': 'Bot conversation' });
  const nb = el('section', { class: 'bt-new', 'aria-label': 'New bot', hidden: true });
  const sheet = el('aside', { class: 'ui-panel bt-sheet', 'data-hx-panel': '', 'aria-label': 'Bot settings', hidden: true });
  root.append(room, nb, sheet);
  S.room = room; S.newPane = nb; S.sheet = sheet;
  mountGroupPane(root); mountNewGroupPane(root);
  watchClips(root);
  buildRoom();
  if (S.view === 'new' || !S.bots.length) openNew(); else openBot(S.sel);
  /* the new-bot view is ours to close: Esc leaves it for the bot you came from */
  nb.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.bots.length && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); openBot(S.sel); focusConversation(); } });
}
function buildRoom(): void {
  const scroll = el('div', { class: 'bt-scroll ' + ui.scrollClass({ ground: true }) });
  const col = el('div', { class: 'bt-col' });
  const log = el('div', { class: 'bt-log', role: 'log', 'aria-label': 'Messages' });
  if (data().info.preview.has('bots')) col.append(el('p', { class: 'bt-preview', role: 'note', text: 'Preview. These bots are sample data and are not connected to boopis yet.' }));
  /* what a bot's chat must still offer and no board draws yet (owner questions): the "made outside boopis" mark (owner decision,
     19 November) and New session with a live bot. They sit on one quiet line over the thread, only when there is one to show */
  const top = el('div', { class: 'bt-topline', hidden: true });
  col.append(top, log);
  followEngine(() => col);   /* derived from board S36: the engine stopped: the line that says so, and starts it again, under the thread */
  S.pActs = top;
  scroll.append(col);
  const zone = el('div', { class: 'bt-composer-zone' });
  (S.room as HTMLElement).append(scroll, zone);
  S.scroll = scroll; S.log = log; S.zone = zone;
  log.addEventListener('keydown', turnKeys);
  wireRefs(log, { bot: (id) => { const x = bot(id); return x ? { bot: { ...x, id: x.id, name: x.name }, state: x.state, model: x.info?.model ?? null } : null; } });
  log.addEventListener('focusin', (e) => { const t = (e.target as Element).closest<HTMLElement>('[data-hx-turn]'); if (t) rove(t); });
  buildComposer(zone);
  /* a live bot cannot be messaged yet: no composer, rather than one that sends nowhere */
  zone.hidden = !!data().info.unavailable['bots.send'];
  followZone(zone, () => S.scroll, () => S.viewRoot, '--bt-composer-h')();
}

export function openBot(id: string | null): void {
  initModel();
  const b = bot(id) ?? S.bots[0]; if (!b) return;
  S.sel = b.id; S.view = 'bot'; S.transient = null;
  if (state.tab !== 'bots') setState({ tab: 'bots' });
  markSelected();
  if (!S.room) return;
  S.room.hidden = false; (S.newPane as HTMLElement).hidden = true;
  if (S.groupPane) S.groupPane.hidden = true;
  if (S.newGroupPane) S.newGroupPane.hidden = true;
  renderThread(b);
  paintComposer(b);
  paintNewSession();
  S.composer?.setRunning(S.runs.has(b.id));
  emit('hx:title', { tab: 'bots', title: b.name });
  if (b.info) void data().bots.admin?.open(b.id).catch(() => undefined);   /* its model, routines and sessions are read as it opens */
  if (S.sheetOpen && S.sheetFor !== b.id) openSettings(b.id, null, { keepFocus: true });
}

/** what the room says about the open bot outside the thread: the composer's line, the status line and the details pane */
export function refreshPresence(): void {
  const b = bot(S.sel); if (!b) return;
  paintToolbar(b);
  paintStatus(b.id);
  paintNewSession();
}

/* ───────── thread ───────── */
function renderThread(b: Bot): void {
  const log = S.log as HTMLElement; log.textContent = '';
  NODE.clear(); STATUS = null;
  const msgs = thread(b.id);
  if (!msgs.length) {
    /* EmptyState: one line where the conversation would be (why it cannot be messaged, when it cannot); the bot's own ideas as answer
       chips (the AskCard's) to start from. A live bot's earlier sessions are in its details, under Library (no board draws an empty
       chat: an owner question) */
    const e = kit.emptyState({ text: data().info.unavailable['bots.send'] ?? 'Nothing here yet. Ask ' + b.name + ' something.' });
    if (b.ideas.length) {
      const ideas = el('div', { class: 'bt-ideas' }, b.ideas.map((t) => { const btn = kit.chip({ label: t, variant: 'answer' }); btn.addEventListener('click', () => setDraft(t)); return btn; }));
      e.append(ideas);
    }
    e.classList.add('bt-empty');
    log.append(e);
  } else {
    let prev: ThreadMessage | null = null, entry: HTMLElement | null = null;
    /* a time separator heads the thread (12 --text-dim, centred); there is no other on a gap the data can tell */
    const first = msgs.find((m) => m.t);
    if (first) log.append(kit.timeSeparator({ text: first.t }));
    for (const m of msgs) { entry = renderMsg(b, m, prev, entry); prev = m; }
  }
  /* what the host holds for the owner in this bot's thread (6e): the team changes it proposed, its steps a rule paused */
  HELD = el('div', { class: 'bt-held', hidden: true });
  log.append(HELD);
  mountHeld(HELD, b, () => S.bots, notify);
  syncTurns();
  paintStatus(b.id);
  requestAnimationFrame(() => { if (S.scroll) S.scroll.scrollTop = S.scroll.scrollHeight; });
}
/* what the bot writes: the kit's markdown; its mentions of teammates open their chats, its paths open where the bot works */
const ctx = (): MarkdownCtx => ({ ...mentionCtx(S.bots.map((x) => ({ ...x, id: x.id, name: x.name }))), kit: true });
const rootsOf = (id: string): string[] => { const w = data().bots.workspace?.(id); return w ? [w] : []; };
function msgContent(b: Bot, m: ThreadMessage): HTMLElement {
  if (m.kind === 'note') { const line = kit.systemLine({ text: m.text }); line.setAttribute('role', 'status'); line.classList.add('bt-note'); return line; }   /* what the app says in the thread: the kit's SystemLine */
  if (m.kind === 'approval') return renderCard(b, m);
  /* what the bot did, one row each: a tool call (its name, what it was called on) and a file it wrote or handed over */
  if (m.kind === 'tool') return kit.toolRow({ variant: 'bot', tool: m.tool, target: m.target, ...(m.shell ? { icon: 'terminal' } : {}), ...(m.steps ? { steps: m.steps, open: m.steps.some((x) => x.state === 'now') } : {}) });
  /* a file opens on this computer when the host can open paths (the desktop app): found in the bot's workspace, opened with its default app */
  if (m.kind === 'file') {
    const paths = data().files.paths;
    const card = kit.fileCard({ name: m.name, meta: m.meta, opens: !!paths });
    if (paths) card.addEventListener('click', () => { void paths.resolve([m.name], rootsOf(b.id)).then(([hit]) => (hit ? paths.open(hit.abs) : Promise.reject(new Error(m.name + ' was not found in ' + b.name + '’s workspace.')))).catch((e: unknown) => { notify(e instanceof Error ? e.message : m.name + ' could not be opened.'); }); });
    return card;
  }
  if (m.who === 'you') { const r = el('p', { class: 'bt-request' }); r.innerHTML = ui.markdown.plain(m.text, ctx()); return r; }
  const md = ui.markdown(m.text, ctx());
  void resolvePaths(md, rootsOf(m.who === 'you' ? b.id : (bot(m.who)?.id ?? b.id)));
  return md;
}
/** a text message in the kit's Bubble: yours in this bot's derived fill (its own chat, 18.1), the bot's on --bubble-agent */
function wrapMsg(b: Bot, m: ThreadMessage, node: HTMLElement): HTMLElement {
  if (m.kind !== 'text') return node;
  return m.who === 'you' ? bubbleOf(node, { kind: 'user', fill: b.color ? kit.botFill(b.color) : null }) : bubbleOf(node, { kind: 'agent' });
}
function renderMsg(b: Bot, m: ThreadMessage, prev: ThreadMessage | null, prevEntry: HTMLElement | null, put?: (n: HTMLElement) => void): HTMLElement | null {
  const node = msgContent(b, m);
  NODE.set(m.id, node);
  const place = (n: HTMLElement): void => { if (put) put(n); else placeInLog(n); };
  if (m.kind === 'note') { place(node); return null; }
  if (prev && prev.who === m.who && prevEntry && prevEntry.isConnected) {
    turnBody(prevEntry).append(wrapMsg(b, m, node));
    ENTRY.get(prevEntry)?.msgs.push(m);
    placeActs(prevEntry);
    return prevEntry;
  }
  const you = m.who === 'you', who = you ? null : (bot(m.who) ?? b);
  /* no avatar per message in a 1:1 (19): the turn is its bubbles; its name and time are in its accessible name */
  const entry = turnEntry({ kind: you ? 'user' : 'bot', label: (you ? 'You' : (who as Bot).name) + (m.t ? ', ' + m.t : '') });
  turnBody(entry).append(wrapMsg(b, m, node));
  ENTRY.set(entry, { msgs: [m], who: m.who });
  if (!you) {
    const name = (who as Bot).name;
    /* board 11 draws two hover actions, copy and "more": more holds the other thing a turn can do today, the copy as Markdown (KEYMAP 5's C) */
    turnActs(entry, { name, copy: () => turnText(entry), more: (a) => { kit.openMenu(a, { label: 'More', place: 'below', align: 'start', entries: [{ label: 'Copy as Markdown', icon: 'copy', value: 'md' }], onSelect: () => { void ui.copyText('**' + name + '**\n\n' + turnText(entry)); notify('Copied'); } }); } });
    placeActs(entry);
  }
  livenIn(entry);
  place(entry);
  checkClips();
  return entry;
}
function appendMsg(id: string, m: ThreadMessage, streaming: boolean): void {
  const list = thread(id), prev = list[list.length - 1] ?? null;
  list.push(m);
  if (id !== S.sel || S.view !== 'bot') return;
  paintNewSession();
  const log = S.log as HTMLElement;
  log.querySelector('.bt-empty')?.remove();
  const follow = S.scroll ? atEnd(S.scroll) : true;
  const lastEl = STATUS && STATUS.isConnected ? STATUS.previousElementSibling : log.lastElementChild;
  const lastEntry = lastEl && lastEl.matches('[data-hx-turn]') ? (lastEl as HTMLElement) : null;
  renderMsg(bot(id) as Bot, m, prev, lastEntry);
  syncTurns();
  const node = NODE.get(m.id);
  if (streaming) log.setAttribute('aria-busy', 'true');
  if (!reduced() && node) node.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  paintStatus(id);
  if (follow || m.who === 'you') S.scroll?.scrollTo({ top: S.scroll.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
}
/* ───────── the status line (board 11 "Waiting for you", board 17 "Running the tests"): the kit's StatusLine at the thread's tail,
   the bot's 16 px orb and one phrase, while it works on a reply (the sweep) or waits for your answer (at rest) ───────── */
let STATUS: HTMLElement | null = null;
/** a node goes before the status line: replies land above it */
function placeInLog(n: Node): void { const log = S.log as HTMLElement; if (HELD && HELD.isConnected) HELD.before(n); else if (STATUS && STATUS.isConnected) STATUS.before(n); else log.append(n); }
/** the host's held asks for the open bot (held.ts), kept after the messages */
let HELD: HTMLElement | null = null;
function paintStatus(id: string): void {
  if (id !== S.sel || S.view !== 'bot') return;
  const b = bot(id), log = S.log; if (!log) return;
  const list = thread(id), last = list[list.length - 1];
  const waits = !!b && list.some((m) => m.kind === 'approval' && !m.resolved);
  const replying = !!last && last.who !== 'you' && last.kind === 'text' && log.getAttribute('aria-busy') === 'true';
  const works = !!b && (S.runs.has(id) || ui.botState(b).busy) && !replying;
  const phrase = waits ? 'Waiting for you' : works ? cap1((b as Bot).activity || ui.botState(b as Bot).word || 'Working') : '';
  const sig = phrase + '|' + (waits ? 'w' : 'r');
  if (!phrase || !b) { STATUS?.remove(); STATUS = null; return; }
  if (STATUS && STATUS.isConnected && STATUS.dataset['sig'] === sig) return;
  /* written into the page as markup: an orb made in a template and moved in is not painted by its worker */
  STATUS?.remove();
  log.insertAdjacentHTML('beforeend', kit.html.statusLine({ kind: 'bot', bot: waits ? { ...b, state: 'needs' } : b, phrase, working: !waits, attrs: { 'data-sig': sig } }));
  STATUS = log.lastElementChild as HTMLElement;
}
const paintPending = paintStatus;

/* roving tabindex across turns: the focused (or latest) turn is the one tab stop */
const turns = (): HTMLElement[] => (S.log ? [...S.log.querySelectorAll<HTMLElement>('[data-hx-turn]')] : []);
function syncTurns(): void {
  const t = turns(); if (!t.length) return;
  if (t.some((x) => x === document.activeElement)) return;
  t.forEach((x, i) => { x.tabIndex = i === t.length - 1 ? 0 : -1; });
}
const rove = (t: HTMLElement): void => { turns().forEach((x) => { x.tabIndex = x === t ? 0 : -1; }); };
export function focusTurn(t: HTMLElement | undefined): void { if (!t) return; rove(t); t.focus({ preventScroll: true }); t.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); }
export function focusConversation(): void {
  const t = turns();
  if (t.length) focusTurn(t[t.length - 1]);
  else S.composer?.focus();
}
export const allTurns = turns;
function turnText(t: HTMLElement): string {
  return (ENTRY.get(t)?.msgs ?? []).map((m) => (m.kind === 'approval' ? '> ' + (m.data.title || 'approval') : m.kind === 'tool' ? m.tool + ' ' + m.target : m.kind === 'file' ? m.name : m.kind === 'note' ? '' : m.text)).join('\n\n');
}
function turnKeys(e: KeyboardEvent): void {
  const t = (e.target as Element).closest<HTMLElement>('[data-hx-turn]');
  if (!t || e.target !== t || e.altKey || e.ctrlKey || e.metaKey) return;
  const list = turns(), i = list.indexOf(t), k = e.key;
  const go = (n: number): void => { e.preventDefault(); focusTurn(list[Math.max(0, Math.min(list.length - 1, n))]); };
  if (k === 'ArrowDown' || k === 'j') return go(i + 1);
  if (k === 'ArrowUp' || k === 'k') return go(i - 1);
  if (k === 'Home') return go(0);
  if (k === 'End' || (k === 'G' && e.shiftKey)) return go(list.length - 1);
  const info = ENTRY.get(t);
  if (k === 'c') {
    e.preventDefault();
    const who = info?.who === 'you' ? 'You' : info?.who, md = '**' + who + '**\n\n' + turnText(t);
    try { navigator.clipboard.writeText(md).catch(() => { /* blocked */ }); } catch { /* clipboard blocked */ }
    notify('Copied');
    return;
  }
  if (k === 'e' && info?.who === 'you') {
    e.preventDefault();
    const last = info.msgs[info.msgs.length - 1];
    if (S.composer && last && last.kind === 'text') { S.composer.setValue(last.text); S.composer.focus(); }
  }
}

/* ───────── approval: the card layer only ───────── */
/* A bot's approval is the kit's AskCard, approval variant, as board 11 draws it: the bot's 16 px orb and "kai asks" with the amber
   "needs you", the ask, the rule that made it ask ("Rule: ..." in the accent, when the provider names one), what it would run in a
   Well, and the four answers: Hold to allow once (the 1 s hold; the inverted chip), Allow all this turn, Always allow, and Deny
   (esc). The provider can carry out once and deny; "Allow all this turn" and "Always allow" need the rules engine, so they are
   not shown until it exists (`later('approval-rules')`). It never expires. Decided, it collapses to its one-row receipt. */
/** a bot's approval as its AskCard, wired to the provider: the bot's own chat draws it in the thread, a room under what that member said */
export const approvalCard = (b: Bot, m: ApprovalMessage): HTMLElement => renderCard(b, m);
/** the answers of a bot's approval: the hold, the standing answers once rules exist, Edit once an edited request can be taken (6e,
    `approval-edit`: the engine cannot take one yet, approval-surfaces.md 7), Deny with esc */
export function approvalAnswers(editing = false): AskAnswer[] {
  if (editing) return [{ label: 'Hold to approve edited', primary: true, hold: true, value: 'edited' }, { label: 'Cancel', value: 'unedit', keys: 'esc', outline: true }];
  return [{ label: 'Hold to allow once', primary: true, hold: true }, ...(later('approval-rules') ? [{ label: 'Allow all this turn', value: 'turn' }, { label: 'Always allow', value: 'always' }] : []),
    ...(later('approval-edit') ? [{ label: 'Edit', value: 'edit', ghost: true }] : []), { label: 'Deny', value: 'deny', keys: 'esc', outline: true }];
}
function renderCard(b: Bot, m: ApprovalMessage): HTMLElement {
  if (m.resolved) return resolvedLine(b, m);
  const asker = bot(m.data.from ?? m.who) ?? b;
  const text = m.data.item?.join('\n') ?? '';
  const slot = el('div', { class: 'bt-cardslot' });
  /* editing (6e): the request's text in a mono multi-line Field where its Well stood, and the hold approves what was written */
  const draw = (editing: boolean, value = text): void => {
    const card = kit.askCard({
      variant: editing ? 'form' : 'standalone', state: 'needs', bot: { ...asker, state: 'needs' }, who: asker.name + ' asks', ask: m.data.title || 'Approve this step',
      ...(m.data.rule ? { rule: m.data.rule } : m.data.quote ? { sub: m.data.quote } : {}), ...(!editing && text ? { command: text } : {}),
      ...(editing ? { fields: kit.html.field({ id: 'bt-edit-' + m.id, kind: 'multiline', mono: true, rows: Math.min(8, Math.max(2, value.split('\n').length)), value, ariaLabel: 'The request, edited', attrs: { 'data-edited': '' } }) } : {}),
      answers: approvalAnswers(editing)
    });
    card.addEventListener('ui:commit', () => {
      if (!editing) { resolveCard(b.id, m, 'approve'); return; }
      const v = card.querySelector<HTMLTextAreaElement>('[data-edited]')?.value ?? value;
      if (bots().decideEdited) bots().decideEdited?.(b.id, m.id, v); else notify('An edited request cannot be sent in this build.');
    });
    card.addEventListener('click', (e) => {
      const c = (e.target as Element).closest<HTMLElement>('[data-kit~="Chip"][data-value]'); if (!c || c.hasAttribute('data-hold')) return;
      const v = c.dataset['value'];
      if (v === 'deny') resolveCard(b.id, m, 'deny');
      else if (v === 'turn' || v === 'always') { if (!m.resolved) bots().decide(b.id, m.id, v); }
      else if (v === 'edit') { draw(true); slot.querySelector<HTMLTextAreaElement>('[data-edited]')?.focus(); }
      else if (v === 'unedit') { draw(false); slot.querySelector<HTMLElement>('[data-value="edit"]')?.focus(); }
    });
    /* KEYMAP section 6: on a card, x denies (and Esc, the Deny chip's key); while editing, Esc puts the request back as it was */
    card.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (editing && e.key === 'Escape') { e.preventDefault(); draw(false); slot.querySelector<HTMLElement>('[data-value="edit"]')?.focus(); return; }
      if (!editing && (e.key === 'Escape' || e.key === 'x')) { e.preventDefault(); resolveCard(b.id, m, 'deny'); }
    });
    slot.replaceChildren(card);
  };
  draw(false);
  return slot;
}
/** what an answered approval says, in 6d's words: what you did, and its quiet word */
export function approvalReceipt(m: Pick<ApprovalMessage, 'resolved' | 'how' | 'drafted' | 'resolvedAt'>): { text: string; word: string } {
  if (m.resolved !== 'approved') return { text: 'You denied it', word: 'denied' };
  const text = m.how === 'edited' ? 'You approved it, edited' : m.how === 'always' ? 'You allowed it always' + (m.drafted ? ' · exception drafted' : '') : m.how === 'turn' ? 'You allowed it for this turn' : 'You allowed it once';
  return { text, word: 'done' + (m.resolvedAt ? ' ' + m.resolvedAt : '') };
}
function resolvedLine(b: Bot, m: ApprovalMessage): HTMLElement {
  const asker = bot(m.data.from ?? m.who) ?? b, r = approvalReceipt(m);
  /* "Always allow" kept a draft: Open goes to where it is finished, Settings › Approvals, once that screen exists (`rules-settings`) */
  const open = m.drafted && later('rules-settings') ? kit.html.button({ label: 'Open', variant: 'ghost', size: 28, attrs: { 'data-open-draft': '' } }) : '';
  const line = kit.askCard({ variant: 'form', state: 'answered', bot: asker, ask: r.text, word: { text: r.word }, rowAction: open, attrs: { 'aria-label': (m.data.title || 'The request') + ': ' + r.text } });
  line.querySelector('[data-open-draft]')?.addEventListener('click', () => { emit('hx:open-settings', { section: 'approvals' }); });
  return el('div', { class: 'bt-cardslot bt-resolved' }, line);
}
/** an approval decided here: the provider decides it everywhere (the dock, the thread) */
function resolveCard(id: string, m: ApprovalMessage, action: string): void {
  if (m.resolved) return;
  const a = String(action).toLowerCase();
  const ok = /approv|allow|yes|confirm/.test(a);
  if (!ok && !/deny|reject|no|cancel/.test(a)) return;
  bots().decide(id, m.id, ok ? 'approved' : 'denied');
}

/* ───────── the composer: the kit's one-row pill and the line under it (board 11) ─────────
   "+", the text, the mic, then the voice button that becomes send once there is text, in the bot's derived fill (18.1). The line
   under it says how the bot runs: Governed (alt+G toggles governance), its model (alt+M opens the picker when it is not governed)
   and, at the end, what this run has spent against its cap. Enter sends; while the bot works the button is Stop. */
export interface RoomComposer { el: HTMLElement; input: HTMLElement; readonly value: string; setValue(t: string): void; focus(): void; setRunning(on: boolean): void }
function buildComposer(host: HTMLElement): void {
  const slot = el('div', { class: 'bt-composer' });
  host.append(slot);
  let running = false, botId = '', sig = '';
  const text = (): HTMLElement => slot.querySelector<HTMLElement>('.k7-composer__text') as HTMLElement;
  const lineOf = (b: Bot): { items: Parameters<typeof kit.composer>[0]['line']; sig: string } => {
    const gov = b.cfg.gov === 'governed';
    const run = S.spend[b.id], cap = run?.cap ?? (b.cfg.cap ? '$' + b.cfg.cap : null), spent = run?.spent ?? (b.spent ? '$' + b.spent : null);
    const model = b.info?.model ?? b.cfg.model;
    const items = [
      { label: 'Governance', value: gov ? 'Governed' : 'Not governed', icon: 'ladder', plain: true, attrs: { 'data-line': 'gov', 'data-kbd': 'alt+G', 'aria-pressed': String(gov) } },
      ...(model ? [{ label: 'Model', value: ui.modelMark.short(model) || model, model, plain: true, attrs: { 'data-line': 'model', 'data-kbd': 'alt+M' } }] : []),
      ...(cap && spent ? [{ label: 'Spend', value: spent + ' of ' + cap, mono: true, end: true }] : spent && run?.spent ? [{ label: 'Spend', value: spent, mono: true, end: true }] : [])
    ];
    return { items, sig: JSON.stringify(items) };
  };
  const draw = (b: Bot): void => {
    const keep = slot.firstElementChild ? api.value : '';
    const l = lineOf(b);
    const c = kit.composer({ kind: 'bot', placeholder: 'Message ' + b.name, label: 'Message ' + b.name, hears: b.name, running, line: l.items, voiceSetup: voiceNeedsSetup(), micOff: micUnavailable(), ...(b.color ? { fill: kit.botFill(b.color) } : {}), ...(keep ? { text: keep } : {}) });
    slot.replaceChildren(c);
    tools.drawn();
    botId = b.id; sig = l.sig;
    text().setAttribute('data-hx-focus', 'composer');
  };
  const api: RoomComposer & { paint(b: Bot): void } = {
    el: slot,
    get input() { return text(); },
    get value() { return text().textContent ?? ''; },
    setValue(t) { kit.composerSet(text(), t); },
    focus() { text().focus(); },
    setRunning(on) { if (running === on) return; running = on; const b = bot(S.sel); if (b) draw(b); },
    paint(b) { if (b.id !== botId || lineOf(b).sig !== sig) draw(b); }
  };
  /* "@" names a teammate: this bot reads the name; the bot named does not see this chat (the menu's foot says so) */
  const tools = composeTools(slot, {
    botId: () => S.sel,
    mentions: {
      label: 'Bots', foot: () => (bot(S.sel)?.name ?? 'This bot') + ' reads the name. The bot you name does not see this chat.',
      chips: (t) => mentionChips(t, mentionCtx(S.bots.filter((x) => x.id !== S.sel).map((x) => ({ ...x, id: x.id, name: x.name })))),
      entries: () => S.bots.filter((x) => x.id !== S.sel).map((x) => ({ value: x.id, label: x.name, ...(x.role ? { desc: x.role } : {}), leadHTML: ui.html.orb(x, { size: 16, still: true }) }))
    }
  });
  slot.addEventListener('ui:send', (e) => { send((e as CustomEvent<{ text: string }>).detail.text); });
  slot.addEventListener('ui:steer', (e) => { send((e as CustomEvent<{ text: string }>).detail.text); });   /* ctrl Enter sends as Enter does until the keys get their own pass (owner, 25 November); it never drops what was typed */
  slot.addEventListener('ui:stop', () => { stopRun(); });
  slot.addEventListener('click', (e) => {
    const t = e.target as Element;
    const item = t.closest<HTMLElement>('[data-line]'), b = bot(S.sel);
    if (!item || !b) return;
    if (item.dataset['line'] === 'gov') setGov(b, b.cfg.gov === 'governed' ? 'ungoverned' : 'governed');
    else if (item.dataset['line'] === 'model') openModelMenu(item);
  });
  slot.addEventListener('input', () => typingChanged(api.value));
  slot.addEventListener('focusin', () => typingChanged(api.value));
  slot.addEventListener('focusout', () => { S.typing = false; settleTransient(); });
  slot.addEventListener('keydown', (e) => {
    if (!(e.target as Element).closest('.k7-composer__text')) return;
    /* ↑ in an empty composer: edit your last message */
    if (e.key === 'ArrowUp' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && !api.value.trim()) {
      const last = [...thread(S.sel as string)].reverse().find((m) => m.who === 'you' && m.kind === 'text');
      if (last && last.kind === 'text') { e.preventDefault(); api.setValue(last.text); api.focus(); }
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.code === 'KeyG') { e.preventDefault(); const b = bot(S.sel); if (b) setGov(b, b.cfg.gov === 'governed' ? 'ungoverned' : 'governed'); return; }
      if (e.code === 'KeyM') { e.preventDefault(); openModelMenu(slot.querySelector<HTMLElement>('[data-line="model"]') ?? text()); }
    }
  });
  S.composer = api;
  PAINT = (b) => { api.paint(b); };
}
let PAINT: ((b: Bot) => void) | null = null;
/** the bot's governance, as the composer's line, alt+G and the settings sheet all change it */
export function setGov(b: Bot, gov: 'governed' | 'ungoverned'): void {
  b.cfg.gov = gov;
  bots().update(b.id, { cfg: { gov } });
  refreshPresence();
  if (S.sheetOpen) openSettings(b.id, null, { keepFocus: true });
}
/** the model picker (the kit's Menu): Governed, then each model the catalog offers */
function openModelMenu(anchor: HTMLElement): void {
  const b = bot(S.sel); if (!b) return;
  const gov = b.cfg.gov === 'governed';
  kit.openMenu(anchor, {
    label: 'Model', place: 'above', align: 'start',
    entries: [{ label: 'Governed', desc: 'Starts cheap, climbs the ladder', value: 'governed', ...(gov ? { icon: 'check' } : {}) },
      ...bots().catalog().models.map((m) => ({ label: ui.modelMark.called(m) || m, value: 'm:' + m, ...(!gov && b.cfg.model === m ? { icon: 'check' } : {}) }))],
    onSelect: (v) => {
      if (v === 'governed') { b.cfg.gov = 'governed'; bots().update(b.id, { cfg: { gov: 'governed' } }); } else { b.cfg.gov = 'ungoverned'; b.cfg.model = v.slice(2); bots().update(b.id, { cfg: { gov: 'ungoverned', model: v.slice(2) } }); }
      refreshPresence(); if (S.sheetOpen) openSettings(b.id, null, { keepFocus: true });
      setTimeout(() => S.composer?.focus(), 0);
    }
  });
}
function setDraft(t: string): void { const c = S.composer; if (!c) return; c.setValue(t); c.focus(); typingChanged(t); }
function paintComposer(b: Bot): void { PAINT?.(b); }
export function paintToolbar(b: Bot): void { if (b.id === S.sel) PAINT?.(b); }
function typingChanged(text: string): void {
  const has = !!(text && String(text).trim());
  S.typing = has;
  if (has) { if (S.transient !== 'listening' && !S.runs.has(S.sel as string)) S.transient = 'listening'; } else settleTransient();
}
function settleTransient(): void { if (S.transient === 'listening') S.transient = null; }

/* ───────── a run: the bot thinking, replying and working on what you asked ─────────
   One run per bot, so bots keep working while you switch; mod+. or Esc in the composer stops the open bot's run.
   A message can come from this tab or from the dock: either way the provider owns the thread and the reply. */
function send(text: string): void {
  const b = bot(S.sel); if (!b) return;
  S.typing = false;
  bots().send(b.id, text, 'bots');
}
export function stopRun(quiet?: boolean, id?: string): boolean {
  const target = id ?? (S.sel as string);
  const was = bots().stop(target);
  if (was && !quiet) { const b = bot(target); notify('Stopped ' + (b ? b.name : 'the bot')); }
  return was;
}

/* ───────── what the provider tells us ───────── */
export function onBotsEvent(ev: BotsEvent, handlers: { announce: () => void }): void {
  switch (ev.type) {
    case 'bot': {
      const b = bot(ev.bot.id); if (!b) return;
      const hadAttn = !!b.attention;
      if (!ev.bot.madeOutside) delete b.madeOutside;   /* a key that is absent from the event is gone, not unchanged: the store exists now */
      Object.assign(b, { ...ev.bot, cfg: b.cfg });
      Object.assign(b.cfg, ev.bot.cfg, { channels: { ...ev.bot.cfg.channels }, approvals: { ...ev.bot.cfg.approvals } });
      /* its look may have changed (the plugin's record read after the first roster, a look saved in the editor, a profile
         re-looked outside boopis): every orb of it already drawn, here, in the dock, a card or a group's stack, takes it
         now. Only what differs is written, so an unchanged look costs nothing and a new one morphs. */
      repaintLook(document, b.id, lookOf(b));
      updateRow(b.id);
      if (b.id === S.sel) { refreshPresence(); if (S.view === 'bot') paintPending(b.id); }
      if (hadAttn !== !!b.attention) handlers.announce();
      break;
    }
    case 'message': {
      const list = thread(ev.botId);
      if (list.some((x) => x.id === ev.message.id)) return;
      appendMsg(ev.botId, ev.message, ev.streaming);
      break;
    }
    case 'message-text': case 'message-end': {
      const list = thread(ev.botId), i = list.findIndex((x) => x.id === ev.messageId), m = list[i];
      if (!m || m.kind !== 'text') return;
      list[i] = { ...m, text: ev.text };
      const node = NODE.get(ev.messageId);
      if (node && node.isConnected) {
        /* block by block: finished blocks stay as they are, the open one is redrawn, a new one fades in */
        const follow = S.scroll ? atEnd(S.scroll) : false;
        const drawn = ui.markdown.stream(node, ev.text, ctx());
        const roots = rootsOf(m.who === 'you' ? ev.botId : (bot(m.who)?.id ?? ev.botId));
        if (ev.type === 'message-end') void resolvePaths(node, roots);
        else for (const d of drawn.slice(0, -1)) void resolvePaths(d, roots);
        if (follow) S.scroll?.scrollTo({ top: S.scroll.scrollHeight });
      }
      if (ev.type === 'message-end' && ev.botId === S.sel) S.log?.removeAttribute('aria-busy');
      break;
    }
    case 'message-resolved': {
      const list = thread(ev.botId), i = list.findIndex((x) => x.id === ev.messageId), m = list[i];
      if (!m || m.kind !== 'approval') return;
      list[i] = { ...m, resolved: ev.resolved, resolvedAt: ev.resolvedAt, ...(ev.how ? { how: ev.how } : {}), ...(ev.drafted ? { drafted: true } : {}) };
      /* the AskCard collapses to its one-row receipt, in place (everywhere it was decided: here, the dock, another client) */
      const node = NODE.get(ev.messageId), b = bot(ev.botId), now = list[i];
      if (node && node.isConnected && b && now && now.kind === 'approval') {
        const hadFocus = node.contains(document.activeElement);
        const line = resolvedLine(b, now);
        node.replaceWith(line); NODE.set(ev.messageId, line);
        if (hadFocus) { line.tabIndex = -1; line.focus({ preventScroll: true }); }
      }
      break;
    }
    case 'thread': {
      S.threads[ev.botId] = [...ev.messages];
      const b = bot(ev.botId);
      if (b && ev.botId === S.sel && S.view === 'bot' && S.log) { S.log.removeAttribute('aria-busy'); renderThread(b); paintNewSession(); }
      break;
    }
    case 'spend': {
      S.spend[ev.botId] = { spent: ev.spent, cap: ev.cap };
      const b = bot(ev.botId);
      if (b && ev.botId === S.sel && S.view === 'bot') paintToolbar(b);
      break;
    }
    case 'run': {
      if (ev.running) S.runs.add(ev.botId); else S.runs.delete(ev.botId);
      if (ev.botId === S.sel && S.composer) S.composer.setRunning(ev.running);
      if (ev.botId === S.sel && S.view === 'bot') paintPending(ev.botId);
      break;
    }
    default: break;
  }
}
