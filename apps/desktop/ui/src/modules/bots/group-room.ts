/* A group's room, as board 12 draws it (docs/design/v7/boards: botscreens.js room12): no header of its own (the chrome's title pill
   wears the members' stack and the room's name, and opens the details pane, where the room's name, members, run limit, board and
   archive are: group-details.ts), the one thread on the 640 column, and the kit's one-row Composer with its line.
     the thread     a time separator; your message in ink with its mentions as the members' chips; a member's run under its name in
                    its colour, its 20 orb in the gutter; a line the room says (the kit's SystemLine: a routine made, a member
                    that could not reply, a discussion paused, with Let them continue); a message to you with the "you" capsule
                    and the amber wash; a member's approval that waits on you, as the AskCard under what it last said (the
                    bot's own approval: deciding it here decides it everywhere); and at the tail who is replying (the kit's
                    StatusLine with the members' stack)
     the composer   "Message <room>", "+" (files as chips), the mic, send (Stop while members reply and nothing is typed); "@"
                    opens the members and the room as the kit's Menu and a finished mention is its chip in the text; the line
                    under it says how many members ("@" opens that list) and, when the room says it, what the talk has cost
     above it       a message written while members reply is held (the provider's "when done") and shown in the kit's Queue,
                    held variant, with Send now (it stops the running turns) and Edit (it comes back into the composer); a
                    draft that names a bot that is not here, or "@kai." that names nobody, says so in the kit's Notice
   Everything that changes comes from the provider's events; everything the user does is a provider command. What a group is in
   this build (who answers, what the members see of each other) is the provider's `nature`, said in the empty room. */
import { emit } from '../../core/bus';
import { el, reduced } from '../../core/dom';
import { setState, state } from '../../core/state';
import { EVERYONE_HANDLES, kit, ui } from '@boopis/ui';
import type { BotLike, MarkdownCtx, MdBot, NotifyOpts } from '@boopis/ui';
import { data } from '../../data';
import type { ApprovalMessage, Bot, Group, GroupMember, GroupMessage, GroupText, GroupsEvent, MemberActivity } from '../../data';
import { namesText } from '../cards/parts';
import { bot, group, groupThread, initGroups, S, thread } from './model';
import { livenIn } from './orbs';
import { markSelected, drawGroups } from './list';
import { bubbleOf, placeActs, turnActs, turnBody, turnEntry } from './turn';
import { checkClips } from './clips';
import { closeSettings } from './settings';
import { openLimitMenu } from './run-limit';
import { mountBoard } from './group-board';
import type { BoardView } from './group-board';
import { atEnd, followZone } from '../chat/follow-zone';
import { mentionCtx, resolvePaths, wireRefs } from '../chat/refs';
import { composeTools, mentionChips, micNeedsSetup, voiceNeedsSetup } from '../chat/compose';
import { followEngine } from '../chat/engine';
import { approvalCard } from './room';
import { paintDetails } from './details';
import { forgetLimit } from './group-details';

const groups = () => data().groups;
const toast = (t: string, o?: NotifyOpts): void => { kit.notify(t, o); };
const NODE = new Map<string, HTMLElement>();
const sentence = (e: unknown): string => (e instanceof Error ? e.message : String(e));
export const listWords = (n: readonly string[]): string => (n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + (n[n.length - 1] ?? ''));

/** a member as an orb draws it: the bot it is when the user has it, else the look its name gives (the kit's one resolver) */
export const memberBot = (m: GroupMember): BotLike => bot(m.profile) ?? { id: m.profile, name: m.name, state: 'idle' };
export const namesOf = (members: readonly GroupMember[]): string => namesText(members.map((m) => m.name));
const memberOf = (g: Group, idOrProfile: string): GroupMember | undefined => g.members.find((m) => m.id === idOrProfile || m.profile === idOrProfile);

/* ───────── view ───────── */
interface RoomComposer { readonly value: string; setValue(t: string): void; insert(t: string): void; focus(): void; paint(g: Group): void }
const G = {
  scroll: null as HTMLElement | null, log: null as HTMLElement | null, zone: null as HTMLElement | null, hint: null as HTMLElement | null, queue: null as HTMLElement | null,
  composer: null as RoomComposer | null, jump: null as HTMLButtonElement | null, status: null as HTMLElement | null,
  boardEl: null as HTMLElement | null, board: null as BoardView | null, boardOpen: false
};
export function mountGroupPane(root: HTMLElement): HTMLElement {
  const pane = el('section', { class: 'bt-room bt-group', 'aria-label': 'Group conversation', hidden: true });
  const scroll = el('div', { class: 'bt-scroll ' + ui.scrollClass({ ground: true }) });
  const col = el('div', { class: 'bt-col' });
  const log = el('div', { class: 'bt-log', role: 'log', 'aria-label': 'Group messages' });
  const boardEl = el('section', { class: 'bt-board', 'aria-label': 'Kanban board', hidden: true });
  col.append(log, boardEl);
  followEngine(() => col);   /* derived from board S36, as in a bot's chat */
  scroll.append(col);
  const zone = el('div', { class: 'bt-composer-zone' });
  const hint = el('div', { class: 'bt-zone-slot', hidden: true }), queue = el('div', { class: 'bt-zone-slot', hidden: true }), slot = el('div', { class: 'bt-composer' });
  /* "N new messages" over the composer: the kit's Button, it goes to the end of the thread */
  const jump = kit.button({ label: 'New messages', variant: 'secondary', size: 28, icon: 'chevron-down', attrs: { 'data-jump': '' } }) as HTMLButtonElement;
  jump.classList.add('bt-jump'); jump.hidden = true;
  jump.addEventListener('click', () => { jumpToLatest(); });
  zone.append(jump, hint, queue, slot);
  scroll.addEventListener('scroll', () => { const g = group(S.groupSel); if (g && !pane.hidden) markSeen(g); }, { passive: true });
  wireRefs(log, {
    bot: (id) => { const b = bot(id); const g = group(S.groupSel); const m = g ? memberOf(g, id) : undefined; if (!b && !m) return null; return { bot: b ? { ...b, id: b.id, name: b.name } : mdBot(m as GroupMember), state: b?.state ?? 'idle', model: b?.info?.model ?? null, where: g?.name ?? null }; },
    ask: (id) => { const g = group(S.groupSel); if (g) { const m = memberOf(g, id); if (m) replyTo(g, m.id); } }
  });
  /* a paused discussion's line carries "Let them continue" (the SystemLine's action) */
  log.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-kit~="SystemLine"] [data-line]'), g = group(S.groupSel);
    const more = b?.closest<HTMLElement>('[data-more]')?.dataset['more'];
    if (!b || !g || !more || b.disabled) return;
    b.disabled = true;
    groups().continueTalk(g.id, more).catch((err: unknown) => { b.disabled = false; toast('It could not go on: ' + sentence(err)); });
  });
  pane.append(scroll, zone);
  root.append(pane);
  S.groupPane = pane;
  G.boardEl = boardEl; G.board = mountBoard(boardEl, { source: () => data().kanban });
  G.scroll = scroll; G.log = log; G.zone = zone; G.hint = hint; G.queue = queue; G.jump = jump;
  buildComposer(slot);
  wireZone(hint, queue);
  followZone(zone, () => G.scroll, () => S.viewRoot, '--bt-composer-h');
  return pane;
}

export function openGroup(id: string | null): void {
  initGroups();
  const g = group(id) ?? S.groups[0]; if (!g) return;
  S.groupSel = g.id; S.view = 'group';
  if (state.tab !== 'bots') setState({ tab: 'bots' });
  closeSettings(true);
  if (S.room) S.room.hidden = true;
  if (S.newPane) S.newPane.hidden = true;
  if (S.newGroupPane) S.newGroupPane.hidden = true;
  if (S.groupPane) S.groupPane.hidden = false;
  markSelected();
  showBoard(false);
  renderLog(g);
  paintComposer(g);
  paintDetails();
  emit('hx:title', { tab: 'bots', title: g.name, members: g.members.map((m) => m.profile) });
  /* the room's messages are read as it opens; a thread that arrives is drawn in place */
  void groups().open(g.id).catch((e: unknown) => { toast('This group could not be read: ' + sentence(e)); });
}

/* ───────── what the details pane does to the open room (group-details.ts draws the controls) ───────── */
export function renameGroup(g: Group, name: string): void {
  const next = name.trim();
  if (!next || next === g.name) return;
  groups().rename(g.id, next).catch((e: unknown) => { toast('It was not renamed: ' + sentence(e)); paintDetails(); });
}
/** The most rounds `boopis run --group` lets one discussion take in this group. The engine pauses a discussion at its own limit and has
 *  none per room, so this is boopis's cap, kept by the host and read by the command line; the app's own Continue button is unchanged. */
export function openRoundLimit(g: Group, anchor: HTMLElement): void {
  groups().roundLimit(g.id).then((cur) => {
    openLimitMenu(anchor, {
      title: 'Most rounds a run may take', label: 'Rounds a run may take in ' + g.name, kept: cur.rounds, fallback: cur.fallback,
      onPick: (v) => { groups().setRoundLimit(g.id, v).then((now) => { forgetLimit(g.id); toast(now.rounds === null ? g.name + ' runs for up to ' + now.fallback + ' rounds.' : g.name + ' runs for up to ' + now.rounds + ' rounds.'); paintDetails(); }).catch((e: unknown) => { toast('The limit was not saved: ' + sentence(e)); }); }
    });
  }).catch((e: unknown) => { toast('The limit could not be read: ' + sentence(e)); });
}
export const boardShown = (): boolean => G.boardOpen;
/** the group's kanban board takes the thread's place in the column (and the composer's), or gives it back */
export function showBoard(open: boolean, g?: Group): void {
  if (open === G.boardOpen && !(open && g)) return;
  G.boardOpen = open;
  if (G.log) G.log.hidden = open;
  if (G.zone) G.zone.hidden = open;
  if (G.boardEl) G.boardEl.hidden = !open;
  if (open && g) G.board?.show({ id: g.id, name: g.name });
  else G.board?.stop();
}
export function archiveGroup(g: Group): void {
  groups().archive(g.id).then((done) => {
    toast('Archived ' + g.name, { action: { label: 'Undo', onClick: () => { done.undo().then(() => { toast('Restored ' + g.name); }).catch((e: unknown) => { toast('Could not restore ' + g.name + ': ' + sentence(e)); }); } } });
  }).catch((e: unknown) => { toast('It was not archived: ' + sentence(e)); });
}

/* ───────── the thread ───────── */
const ENTRY = new WeakMap<HTMLElement, { msgs: GroupText[]; who: string }>();
/** the last message the user has seen in each group (this run), and how many arrived below the fold since */
const SEEN = new Map<string, string>();
/* `you`: how many of the unread messages address the person: the jump button says so */
const U = { unread: 0, you: 0, divider: null as HTMLElement | null };

const mdBot = (m: GroupMember): MdBot => { const b = bot(m.profile); return { ...memberBot(m), id: m.profile || m.id, name: m.name, handle: m.handle, ...(b?.role ? { role: b.role } : {}) }; };
/** the bots that exist and are not in the room: a mention of one is a muted chip, and the composer says so before sending */
const outsiders = (g: Group): Array<MdBot & { handle: string }> => S.bots.filter((b) => !g.members.some((m) => m.profile === b.id)).map((b) => ({ ...b, id: b.id, name: b.name, handle: b.id }));
/* `you`: in what a member writes, `@user` is the person (the engine's handle for them in a room): their own capsule, and the message
   marked for them. What the person writes (their messages, their draft) addresses nobody by it */
const ctxOf = (g: Group, you = true): MarkdownCtx => ({ ...mentionCtx(g.members.map(mdBot), { everyone: true, outside: outsiders(g) }), ...(you ? { you } : {}), kit: true });
/** a member's message that addresses the person by the engine's handle for them (`@user`, markdown.ts) */
const toYou = (g: Group) => (m: GroupMessage): boolean => m.kind === 'text' && m.who !== 'you' && ui.markdown.toYou(m.text, ctxOf(g));
/** the hint over a draft that names a bot that is not here: "nimbus isn't in this room: send it to their chat, or send without them" */
export function outsideHint(g: Group, text: string): string {
  const out = ui.markdown.outsiders(text, g.members, outsiders(g));
  return out.length ? listWords(out.map((b) => b.name)) + (out.length === 1 ? " isn't" : " aren't") + ' in this room: send it to ' + (out.length === 1 ? 'their' : 'their own') + ' chat, or send without them' : '';
}
/** "@kai." names nobody: the engine reads a full stop (or a colon, a hyphen, an underscore) right after a handle as part of it. The
    hint says so for a draft whose handle would name a member or the room without that mark (the composer leaves it as text) */
export function nearMissHint(g: Group, text: string): string {
  const handles = new Set([...g.members.map((m) => m.handle.toLowerCase()), ...EVERYONE_HANDLES]);
  const said: string[] = [];
  for (const h of ui.markdown.handles(text)) {
    if (handles.has(h)) continue;
    const bare = h.replace(/[._:-]+$/, ''), mark = h.slice(bare.length);
    if (bare && mark && handles.has(bare) && !said.some((x) => x.startsWith('“@' + h))) said.push('“@' + h + '” names nobody: the “' + mark + '” right after the name counts as part of it.');
  }
  return said.slice(0, 2).join(' ');
}
/** a message of this room opened in a bot's own chat, as a draft the owner sends (nothing is forwarded by itself; rosters are frozen, so the bot cannot join) */
export function sendToBot(b: { id: string }, text: string): void {
  emit('hx:bot-select', { id: b.id, from: 'group' });
  const c = S.composer; if (!c) return;
  c.setValue(text); c.focus();
}
/** under a member's message that names a bot that is not in the room: the kit's Notice says so, and offers the message in that bot's own chat */
function outsideNote(g: Group, m: GroupText): HTMLElement | null {
  const out = ui.markdown.outsiders(m.text, g.members, outsiders(g));
  if (!out.length) return null;
  const note = kit.notice({ place: 'page', text: listWords(out.map((b) => b.name)) + (out.length === 1 ? " isn't" : " aren't") + ' in this room', actions: out.slice(0, 2).map((b) => ({ label: 'Send to ' + b.name, ghost: true, value: b.id })) });
  note.classList.add('bt-outside');
  note.addEventListener('click', (e) => {
    const id = (e.target as Element).closest<HTMLElement>('[data-value]')?.dataset['value'], b = out.find((x) => x.id === id);
    if (b) sendToBot(b, 'From ' + (memberOf(g, m.who)?.name ?? m.who) + ' in ' + g.name + ':\n' + m.text.split('\n').map((l) => '> ' + l).join('\n') + '\n\n');
  });
  return note;
}
/** other parts of the room's composer can hold a message back (a running turn it would cancel): a guard returns false to stop the send */
const GUARDS: Array<(g: Group, text: string) => boolean> = [];
export const addSendGuard = (fn: (g: Group, text: string) => boolean): void => { GUARDS.push(fn); };
/** the folders a member's paths resolve in: the folder the engine said its bot works in (none known: absolute paths only) */
const rootsOf = (g: Group, who: string): string[] => { const m = memberOf(g, who); const ws = m ? data().bots.workspace?.(m.profile) : null; return ws ? [ws] : []; };
/** whom a message is for, in words (its turn's accessible name says it; board 12 draws the name alone): round 0 answers the user; a
    later round goes to the members the room names, or its mentions name, and to the person when it addresses them (`@user`) */
function recipients(g: Group, m: GroupText): string[] {
  if (m.who === 'you') return [];
  if (m.round === 0) return ['you'];
  const ids = m.to?.length ? m.to : ui.markdown.resolve(m.text, g.members).members.map((x) => x.id);
  const names = ids.filter((id) => id !== m.who).map((id) => memberOf(g, id)?.name ?? id);
  return toYou(g)(m) ? [...names, 'you'] : names;
}
function replyTo(g: Group, who: string): void {
  const m = memberOf(g, who), c = G.composer; if (!m || !c) return;
  const v = c.value; c.insert((v && !/\s$/.test(v) ? ' ' : '') + '@' + m.handle + ' '); c.focus();
}
/** a node goes before who is replying: a reply lands above the status line */
function placeInLog(n: Node): void { const log = G.log as HTMLElement; if (G.status && G.status.isConnected) G.status.before(n); else log.append(n); }
/** the "NEW" line before the first message the user has not seen (the kit's TimeSeparator, in the accent) */
const unreadDivider = (): HTMLElement => { const d = kit.timeSeparator({ text: 'NEW', unread: true }); d.setAttribute('aria-label', 'New messages since you last looked'); d.classList.add('bt-unread'); return d; };

function renderLog(g: Group): void {
  const log = G.log as HTMLElement; log.textContent = '';
  NODE.clear(); G.status = null; ASKS = '';
  U.divider = null; U.unread = 0; U.you = 0; setJump(0);
  const msgs = groupThread(g.id);
  if (!msgs.length) {
    const e = kit.emptyState({ text: groups().nature });
    e.classList.add('bt-empty');
    log.append(e);
  } else {
    const seen = SEEN.get(g.id);
    const at = seen ? msgs.findIndex((x) => x.id === seen) : -1;
    const firstNew = at >= 0 ? msgs.slice(at + 1).find((x) => !(x.kind === 'text' && x.who === 'you')) : undefined;
    /* a time separator heads the thread (12 --text-dim, centred); there is no other on a gap the data can tell */
    const first = msgs.find((m) => m.t);
    if (first) log.append(kit.timeSeparator({ text: first.t }));
    let prev: GroupMessage | null = null, entry: HTMLElement | null = null;
    for (const m of msgs) {
      if (firstNew && m.id === firstNew.id) { U.divider = unreadDivider(); log.append(U.divider); prev = null; entry = null; }
      entry = renderMsg(g, m, prev, entry); prev = m;
    }
  }
  paintAsks(g);
  paintStatus(g);
  requestAnimationFrame(() => {
    const sc = G.scroll; if (!sc) return;
    if (U.divider) U.divider.scrollIntoView({ block: 'center' }); else sc.scrollTop = sc.scrollHeight;
    markSeen(g);
  });
}
/** a message into the thread; returns the turn it is in (the previous one, when the same member wrote it) or null for a line */
function renderMsg(g: Group, m: GroupMessage, prev: GroupMessage | null, prevEntry: HTMLElement | null): HTMLElement | null {
  if (m.kind === 'note') {
    /* what the room says: a routine a member made leads with the clock; a discussion paused at its limit offers to let it run on */
    const line = kit.systemLine({ text: m.text, ...(m.about === 'routine' ? { icon: 'clock' } : {}), ...(m.more ? { action: 'Let them continue', attrs: { 'data-more': m.more } } : {}) });
    line.setAttribute('role', 'status');
    NODE.set(m.id, line);
    placeInLog(line);
    return null;
  }
  const you = m.who === 'you';
  let node: HTMLElement;
  if (you) { node = el('p', { class: 'bt-request' }); node.innerHTML = ui.markdown.plain(m.text, ctxOf(g, false)); }
  else node = ui.markdown(m.text, ctxOf(g));
  NODE.set(m.id, node);
  const away = you ? null : outsideNote(g, m);
  /* the kit's Bubble: yours in ink (a room is not one bot's chat, 18.1), a member's on --bubble-agent; a message to you gets the
     amber wash; the first of a member's run carries its name in its colour and its orb in the gutter (19) */
  const member = you ? undefined : memberOf(g, m.who);
  const wrap = (byline: boolean): HTMLElement => bubbleOf(node, you ? { kind: 'user' } : { kind: 'agent', toYou: toYou(g)(m), gutter: true, byline: byline && member ? { bot: memberBot(member), colour: memberBot(member).color || '' } : null });
  if (prev && prev.kind === 'text' && prev.who === m.who && prevEntry && prevEntry.isConnected && ENTRY.has(prevEntry)) {
    turnBody(prevEntry).append(wrap(false), ...(away ? [away] : []));
    ENTRY.get(prevEntry)?.msgs.push(m);
    placeActs(prevEntry);
    if (!you) void resolvePaths(node, rootsOf(g, m.who));
    return prevEntry;
  }
  const name = you ? 'You' : (member?.name ?? m.who), to = recipients(g, m);
  const entry = turnEntry({ kind: you ? 'user' : 'bot', label: name + (to.length ? ', to ' + listWords(to) : '') + (m.t ? ', ' + m.t : '') });
  entry.dataset['who'] = m.who;
  turnBody(entry).append(wrap(true), ...(away ? [away] : []));
  ENTRY.set(entry, { msgs: [m], who: m.who });
  if (!you) {
    turnActs(entry, {
      name, copy: () => (ENTRY.get(entry)?.msgs ?? []).map((x) => x.text).join('\n\n'),
      ...(member ? { reply: () => { replyTo(g, m.who); }, open: () => { emit('hx:bot-select', { id: member.profile, from: 'group' }); } } : {})
    });
    placeActs(entry);
  }
  livenIn(entry);
  placeInLog(entry);
  if (!you) void resolvePaths(node, rootsOf(g, m.who));
  checkClips();
  return entry;
}
function appendMsg(g: Group, m: GroupMessage): void {
  const list = groupThread(g.id);
  if (list.some((x) => x.id === m.id)) return;
  const prev = list[list.length - 1] ?? null;
  list.push(m);
  if (g.id !== S.groupSel || S.view !== 'group') return;
  const log = G.log as HTMLElement, sc = G.scroll as HTMLElement;
  const follow = atEnd(sc);
  log.querySelector('.bt-empty')?.remove();
  if (!log.querySelector('[data-kit~="TimeSeparator"]') && m.t) log.prepend(kit.timeSeparator({ text: m.t }));
  /* the turn this message can join: the last thing in the thread before who is replying, unless an approval or a line came between */
  const lastEl = G.status && G.status.isConnected ? G.status.previousElementSibling : log.lastElementChild;
  const lastEntry = lastEl && lastEl.matches('[data-hx-turn]') ? (lastEl as HTMLElement) : null;
  const entry = renderMsg(g, m, lastEntry ? prev : null, lastEntry);
  const node = NODE.get(m.id) ?? null;
  if (node && !reduced() && typeof node.animate === 'function') node.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  paintAsks(g);
  const forYou = toYou(g);
  if (follow || (m.kind === 'text' && m.who === 'you')) { sc.scrollTo({ top: sc.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); markSeen(g); }
  else if (m.kind === 'text' && m.who !== 'you') {
    if (!U.divider && entry) { U.divider = unreadDivider(); (ENTRY.get(entry)?.msgs.length === 1 ? entry : (node?.closest('.k7-gutter, .k7-bubble') ?? entry)).before(U.divider); }
    U.unread++; if (forYou(m)) U.you++;
    setJump(U.unread, U.you);
  }
}
/** how many messages arrived below the fold, and how many of them address the person (`@user`): the button says so */
function setJump(n: number, you = 0): void {
  const b = G.jump; if (!b) return;
  b.dataset['unread'] = String(Math.max(0, n));
  b.hidden = n <= 0;
  const label = b.querySelector('.k7-btn__label');
  if (label) label.textContent = (n === 1 ? '1 new message' : n + ' new messages') + (you > 0 && n > 0 ? (n === 1 ? ', for you' : ', ' + you + ' for you') : '');
  b.toggleAttribute('data-for-you', you > 0 && n > 0);
}
/** the user has seen the end of the thread: remember its last message, and the jump goes */
function markSeen(g: Group): void {
  const sc = G.scroll; if (!sc || !atEnd(sc)) return;
  const msgs = groupThread(g.id), last = msgs[msgs.length - 1];
  if (last) SEEN.set(g.id, last.id);
  U.unread = 0; U.you = 0; setJump(0);
}
function jumpToLatest(): void {
  const sc = G.scroll; if (!sc) return;
  sc.scrollTo({ top: sc.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
  const g = group(S.groupSel); if (g) { const msgs = groupThread(g.id), last = msgs[msgs.length - 1]; if (last) SEEN.set(g.id, last.id); }
  U.unread = 0; U.you = 0; setJump(0);
  G.composer?.focus();
}

/* ───────── a member's approval, in the room (board 12): the bot's own approval that waits on you, as the kit's AskCard in the gutter
   under what that member last said here (at the thread's tail when it has said nothing). It is the same approval the bot's chat and
   the dock show: deciding it anywhere takes it away here. Drawn again only when which approvals wait, or where, changes, so a hold
   under way is never interrupted ───────── */
let ASKS = '';
function pendingAsks(g: Group): Array<{ b: Bot; m: ApprovalMessage; after: HTMLElement | null }> {
  const log = G.log as HTMLElement, out: Array<{ b: Bot; m: ApprovalMessage; after: HTMLElement | null }> = [];
  for (const mem of g.members) {
    const b = bot(mem.profile); if (!b) continue;
    const turnsOf = [...log.querySelectorAll<HTMLElement>(':scope > [data-hx-turn]')].filter((t) => t.dataset['who'] === mem.id || t.dataset['who'] === mem.profile);
    for (const m of thread(b.id)) if (m.kind === 'approval' && !m.resolved) out.push({ b, m, after: turnsOf[turnsOf.length - 1] ?? null });
  }
  return out;
}
function paintAsks(g: Group): void {
  const log = G.log; if (!log) return;
  const asks = pendingAsks(g);
  const sig = asks.map((a) => a.m.id + '@' + (a.after ? [...log.children].indexOf(a.after) : -1)).join();
  if (sig === ASKS) return;
  ASKS = sig;
  for (const old of log.querySelectorAll(':scope > .bt-ask')) old.remove();
  for (const a of asks) {
    const slot = el('div', { class: 'bt-ask k7-gutter', 'data-ask': a.m.id }, approvalCard(a.b, a.m));
    if (a.after) a.after.after(slot); else placeInLog(slot);
  }
  livenIn(log);
}

/* ───────── who is replying: the kit's StatusLine at the thread's tail (board 12: the members' stack and "kai and moss are replying") ───────── */
function activityOf(g: Group): MemberActivity[] {
  if (g.activity?.length) return [...g.activity];
  return g.working.map((id) => ({ member: id, status: 'running' as const, round: null, startedAt: null, tool: null }));
}
/** who is at work, in one phrase: those replying; when all that is left is a member waiting its turn, who is next */
export function replyingWords(names: readonly string[], next: readonly string[]): string {
  if (names.length) return listWords(names) + (names.length === 1 ? ' is replying' : ' are replying');
  return next.length ? listWords(next) + (next.length === 1 ? ' is next' : ' are next') : '';
}
function paintStatus(g: Group): void {
  const log = G.log; if (!log) return;
  const acts = groups().note() ? [] : activityOf(g).flatMap((a) => { const m = memberOf(g, a.member); return m ? [{ a, m }] : []; });
  const at = acts.filter((x) => x.a.status !== 'queued'), shown = at.length ? at : acts;
  const phrase = replyingWords(at.map((x) => x.m.name), acts.filter((x) => x.a.status === 'queued').map((x) => x.m.name));
  const sig = phrase + '|' + shown.map((x) => x.m.id).join();
  if (!phrase) { G.status?.remove(); G.status = null; return; }
  if (G.status && G.status.isConnected && G.status.dataset['sig'] === sig) return;
  const follow = G.scroll ? atEnd(G.scroll) : false;
  /* written into the page as markup: an orb made in a template and moved in is not painted by its worker */
  G.status?.remove();
  log.querySelector('.bt-empty')?.remove();
  const members = shown.map((x) => ({ ...memberBot(x.m), name: x.m.name }));
  log.insertAdjacentHTML('beforeend', kit.html.statusLine({ kind: 'bot', phrase, working: true, ...(members.length > 1 ? { members } : { bot: members[0] as BotLike }), attrs: { 'data-sig': sig } }));
  G.status = log.lastElementChild as HTMLElement;
  if (follow && G.scroll) G.scroll.scrollTop = G.scroll.scrollHeight;
}

/* ───────── the composer: the kit's one-row pill and the line under it (board 12) ─────────
   "+", the text, the mic, then the voice button that becomes send once there is text (ink: a room is nobody's own chat). While
   members reply and nothing is typed the button is Stop; a message sent then is held by the provider. The line: "@" and how many
   members (it opens the list of them, as typing "@" does) and, at the end, what the talk has cost when the room says it. */
function buildComposer(slot: HTMLElement): void {
  let running = false, gid = '', sig = '';
  const text = (): HTMLElement => slot.querySelector<HTMLElement>('.k7-composer__text') as HTMLElement;
  const lineOf = (g: Group): NonNullable<Parameters<typeof kit.composer>[0]['line']> => [
    { label: 'Members', value: g.members.length + (g.members.length === 1 ? ' member' : ' members'), icon: 'at', plain: true, attrs: { 'data-line': 'members', 'aria-haspopup': 'menu' } },
    ...(g.spent ? [{ label: 'Spend', value: '$' + g.spent, mono: true, end: true }] : [])
  ];
  const draw = (g: Group): void => {
    const keep = slot.firstElementChild ? api.value : '';
    const line = lineOf(g);
    /* a room that routes through a lead says who answers first (the engine's rule; the "@" list's foot says what a name does) */
    const lead = g.lead ? g.members.find((m) => m.id === g.lead) : undefined;
    slot.replaceChildren(kit.composer({ kind: 'room', placeholder: 'Message ' + g.name, label: 'Message ' + g.name, running: g.busy, line, voiceSetup: voiceNeedsSetup(), micSetup: micNeedsSetup(), ...(lead ? { hint: lead.name + ' answers first' } : {}), ...(keep ? { text: keep } : {}) }));
    tools.drawn();
    gid = g.id; running = g.busy; sig = JSON.stringify(line) + (lead?.name ?? '');
    text().setAttribute('data-hx-focus', 'composer');
    if (keep) text().dispatchEvent(new Event('input', { bubbles: true }));
  };
  const api: RoomComposer = {
    get value() { return slot.firstElementChild ? (text().textContent ?? '') : ''; },
    setValue(t) { kit.composerSet(text(), t); },
    insert(t) { kit.composerInsert(text(), t); },
    focus() { text().focus(); },
    paint(g) { if (g.id !== gid || g.busy !== running || JSON.stringify(lineOf(g)) + ((g.lead ? g.members.find((m) => m.id === g.lead)?.name : '') ?? '') !== sig) draw(g); }
  };
  /* "@" names a member, or the room: the engine reads the handle; a finished mention is its chip in the text */
  const members = (): Array<MdBot & { handle: string }> => group(S.groupSel)?.members.map((m) => ({ ...mdBot(m), handle: m.handle })) ?? [];
  const tools = composeTools(slot, {
    botId: () => null,
    mentions: {
      label: 'Members',
      foot: () => (group(S.groupSel)?.lead ? 'An @name brings that bot in now.' : 'Only the bots you name answer. With no name, every member does.'),
      entries: () => { const g = group(S.groupSel); return [...members().map((b) => ({ value: b.handle, label: b.name, ...(b.role ? { desc: b.role } : {}), leadHTML: ui.html.orb({ ...b, state: 'idle', attention: null }, { size: 16, still: true })   })), ...(g ? [{ value: 'all', label: 'all', desc: 'Everyone in ' + g.name, icon: 'bots' }] : [])]; },
      chips: (t) => { const g = group(S.groupSel); return g ? mentionChips(t, ctxOf(g, false)) : []; }
    }
  });
  const sendText = (e: Event): void => { send((e as CustomEvent<{ text: string }>).detail.text); window.setTimeout(paintHint, 0); };
  slot.addEventListener('ui:send', sendText);
  slot.addEventListener('ui:steer', sendText);   /* ctrl Enter sends as Enter does until the keys get their own pass (owner, 25 November) */
  slot.addEventListener('ui:stop', () => { stopTalk(); });
  slot.addEventListener('input', paintHint);
  slot.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('[data-line="members"]')) return;
    const c = G.composer; if (!c) return;
    const v = c.value; c.focus(); c.insert((v && !/\s$/.test(v) ? ' ' : '') + '@');
  });
  G.composer = api;
}
function paintComposer(g: Group): void { G.composer?.paint(g); paintQueue(g); paintHint(); }

/* ───────── above the composer: the hint about a draft, and the messages held back ───────── */
function wireZone(hint: HTMLElement, queue: HTMLElement): void {
  hint.addEventListener('click', (e) => {
    const id = (e.target as Element).closest<HTMLElement>('[data-kit~="Notice"] [data-value]')?.dataset['value'], c = G.composer;
    const b = S.bots.find((x) => x.id === id); if (!b || !c) return;
    const draft = c.value.trim(); c.setValue(''); paintHint(); sendToBot(b, draft);
  });
  queue.addEventListener('click', (e) => {
    const g = group(S.groupSel), act = (e.target as Element).closest<HTMLElement>('[data-queue]')?.dataset['queue'], c = G.composer;
    if (!g || !act || !g.queued.length || !c) return;
    if (act === 'now') { const first = g.queued[0]; if (first) groups().sendNow(g.id, first.id).catch((err: unknown) => { toast('It was not sent: ' + sentence(err)); }); return; }
    /* Edit: the newest held message comes back into the composer, and is held no longer */
    const last = g.queued[g.queued.length - 1]; if (!last) return;
    const t = groups().unqueue(g.id, last.id);
    if (t) { c.setValue(c.value ? t + '\n' + c.value : t); c.focus(); }
  });
}
/** The one line over the composer (the kit's Notice): why group chat cannot run; else what is wrong with the draft (it names a bot
    that is not here, or a handle the engine will not read), with the way out; else that a member is also running a kanban card
    (two sessions of one bot at once: the engine does not tie them together, so the room says it) */
function paintHint(): void {
  const host = G.hint, g = group(S.groupSel), c = G.composer; if (!host) return;
  const value = c?.value ?? '', why = groups().note();
  const draft = g && !why ? [nearMissHint(g, value), outsideHint(g, value)].filter(Boolean).join(' ') : '';
  const out = g && draft ? ui.markdown.outsiders(value, g.members, outsiders(g)) : [];
  const onBoard = g ? g.members.filter((m) => !!bot(m.profile)?.info?.worker) : [];
  const t = why || draft || (onBoard.length ? namesOf(onBoard) + (onBoard.length === 1 ? ' is also running a kanban task' : ' are also running kanban tasks') : '');
  if (host.dataset['sig'] === t) return;
  host.dataset['sig'] = t;
  host.hidden = !t;
  host.replaceChildren(...(t ? [kit.notice({ place: 'composer', text: t, actions: out.slice(0, 2).map((b) => ({ label: 'Send to ' + b.name, ghost: true, value: b.id })) })] : []));
}
/** who the held messages wait for, in the words Send now's tip says before it is pressed */
export function waitingFor(names: readonly string[]): string {
  const who = names.length === 0 ? 'the conversation' : listWords(names);
  const stops = names.length === 0 ? 'it' : names.length === 1 ? 'that turn' : 'those turns';
  return 'Waiting for ' + who + ' to finish. Send now stops ' + stops + '.';
}
/** the messages held back while members reply (`Group.queued`): the kit's Queue, held (board K02), over the composer */
function paintQueue(g: Group): void {
  const host = G.queue; if (!host) return;
  const n = g.queued.length;
  const names = g.members.filter((m) => g.working.includes(m.id)).map((m) => m.name);
  const sig = g.id + '|' + g.queued.map((q) => q.id).join() + '|' + names.join();
  if (host.dataset['sig'] === sig) return;
  host.dataset['sig'] = sig;
  host.hidden = !n;
  if (!n) { host.replaceChildren(); return; }
  const last = g.queued[n - 1];
  host.replaceChildren(kit.queue({ variant: 'held', held: (n === 1 ? '1 message waits' : n + ' messages wait') + ' until the discussion ends', edit: 'Take back: ' + (last?.text ?? ''), sendTip: waitingFor(names) }));
}

/** the roster moved (a bot started or finished a kanban card, an approval came or went): the open room follows */
export function repaintRoom(): void { const g = group(S.groupSel); if (g && S.view === 'group') { paintAsks(g); paintHint(); paintDetails(); } }
/** a message while members are working is held and sent when they are done (it never stops them); "Send now" stops them */
function send(text: string): void {
  const g = group(S.groupSel); if (!g || !text.trim() || !GUARDS.every((f) => f(g, text))) return;
  void groups().send(g.id, text.trim(), 'when-done').then((how) => { if (how === 'queued') ui.announce('Message held until the group has finished'); });
}
export function stopTalk(): boolean {
  const g = group(S.groupSel); if (!g) return false;
  const held = g.queued.length;
  const was = groups().stop(g.id);
  if (was) toast('Stopped ' + g.name + (held ? '. The message waiting goes out now.' : ''));
  return was;
}

/* ───────── what the provider tells us ───────── */
export function onGroupsEvent(ev: GroupsEvent): void {
  switch (ev.type) {
    case 'group': {
      const g = group(ev.group.id); if (!g) return;
      const renamed = g.name !== ev.group.name, members = g.members.map((m) => m.id).join() !== ev.group.members.map((m) => m.id).join();
      Object.assign(g, ev.group);
      drawGroups();
      if (g.id === S.groupSel && S.view === 'group') {
        if (renamed || members) emit('hx:title', { tab: 'bots', title: g.name, members: g.members.map((m) => m.profile) });
        paintComposer(g); paintStatus(g); paintDetails();
      }
      break;
    }
    case 'message': {
      const g = group(ev.groupId); if (g) appendMsg(g, ev.message);
      break;
    }
    case 'thread': {
      S.groupThreads[ev.groupId] = [...ev.messages];
      const g = group(ev.groupId);
      if (g && ev.groupId === S.groupSel && S.view === 'group') renderLog(g);
      break;
    }
    default: break;
  }
}
