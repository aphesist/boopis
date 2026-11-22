/* A group's room: the header (its members as stacked orbs, its name, rename, members, archive), the one thread the user and the
   members write in (each message by the one who wrote it: its orb and name in the entry's origin slot), who is replying now,
   and the library's composer with a chip for each member to address with `@name`. Everything that changes comes from the
   provider's events; everything the user does is a provider command. What a group is in this build (who answers, what the
   members see of each other) is the provider's `nature`, said in the room and never made up here. */
import { emit } from '../../core/bus';
import { $, el, esc, frag, reduced } from '../../core/dom';
import { setState, state } from '../../core/state';
import { ui } from '@boopis/ui';
import type { BotLike, MarkdownCtx, MdBot } from '@boopis/ui';
import { data } from '../../data';
import type { Group, GroupMember, GroupMessage, GroupText, GroupsEvent, MemberActivity } from '../../data';
import { namesText } from '../cards/parts';
import { bot, group, groupThread, initGroups, S } from './model';
import { livenIn, orbHTML } from './orbs';
import { markSelected, drawGroups } from './list';
import { checkClips } from './clips';
import { closeSettings } from './settings';
import { openNewGroup } from './new-group';
import { arrival, atEnd, dropPending, entryActs, followZone, glanceAt, jumpButton, listWords, pendingEntry, placeToLine, setJump, toLine, unreadDivider, updatePending } from './ledger';
import { mentionCtx, resolvePaths, wireRefs } from '../chat/refs';
import { foldHuddles, huddleEntry, huddleRuns, isBetween, liveAt } from './huddle';
import type { HuddleDeps } from './huddle';
import { mountGroupQueue } from './group-queue';
import type { GroupQueue } from './group-queue';

const groups = () => data().groups;
const toast = (t: string, o?: Parameters<typeof ui.toast>[1]): void => { ui.toast(t, o); };
const NODE = new Map<string, HTMLElement>();
const sentence = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** a member as an orb draws it: the bot it is when the user has it, else the look its name gives (the kit's one resolver) */
export const memberBot = (m: GroupMember): BotLike => bot(m.profile) ?? { id: m.profile, name: m.name, state: 'idle' };
/** how a group shows its members, wherever it does (the sidebar's row, the room's header, who is replying): the kit's stack,
    one overlap step, the members in the group's order (the first underneath), "+N" the last member. One orb size per place:
    STACK says which. The members that are bots of the user; `still` for an aria-hidden slot (a row's lead), where nothing takes
    focus. */
export const STACK = { row: { size: 16, max: 4 }, rail: { size: 16, max: 1 }, head: { size: 32, max: 4 }, working: { size: 16, max: 4 } } as const;
export function stackOf(members: readonly GroupMember[], place: keyof typeof STACK, still?: boolean): string {
  const ids = members.map((m) => m.profile).filter((id) => bot(id));
  if (!ids.length) return '';
  const { size, max } = STACK[place];
  /* the rail's 40px row holds one orb at equal insets (R-corner-3): the group is its first member there, and the row's tooltip names them all */
  const shown = place === 'rail' ? ids.slice(0, 1) : ids;
  return ui.html.stack({ members: shown.map((id) => bot(id) as BotLike), size, max, label: namesText(ids.map((id) => bot(id)?.name ?? id)), focusable: !still, still: !!still });
}
export const namesOf = (members: readonly GroupMember[]): string => namesText(members.map((m) => m.name));

/* ───────── view ───────── */
export function mountGroupPane(root: HTMLElement): HTMLElement {
  const pane = el('section', { class: 'bt-room bt-group', 'aria-label': 'Group conversation', hidden: true });
  const scroll = el('div', { class: 'bt-scroll ui-scroll' });
  const col = el('div', { class: 'bt-col' });
  const head = el('header', { class: 'bt-presence bt-ghead' });
  const log = el('div', { class: 'bt-log', role: 'log', 'aria-label': 'Group messages' });
  col.append(head, log);
  scroll.append(col);
  const zone = el('div', { class: 'bt-composer-zone' });
  const working = el('p', { class: 'bt-working', role: 'status', 'aria-live': 'polite' });
  const hint = el('p', { class: 'bt-hint', role: 'status', 'aria-live': 'polite', hidden: true });
  U.jump = jumpButton(() => { jumpToLatest(); });
  zone.append(U.jump, hint, working);
  scroll.addEventListener('scroll', () => { const g = group(S.groupSel); if (g && !pane.hidden) markSeen(g); }, { passive: true });
  wireRefs(log, {
    bot: (id) => { const b = bot(id); const g = group(S.groupSel); const m = g ? memberOf(g, id) : undefined; if (!b && !m) return null; return { bot: b ? { ...b, id: b.id, name: b.name } : mdBot(m as GroupMember), state: b?.state ?? 'idle', model: b?.info?.model ?? null, where: g?.name ?? null }; },
    ask: (id) => { const g = group(S.groupSel); if (g) { const m = memberOf(g, id); if (m) replyTo(g, m.id); } }
  });
  pane.append(scroll, zone);
  root.append(pane);
  S.groupPane = pane;
  G.scroll = scroll; G.head = head; G.log = log; G.zone = zone; G.working = working;
  const c = ui.composer({ placeholder: 'Message the group', label: 'Message the group', attach: false, queue: true });
  c.classList.add('bt-composer');
  zone.append(c);
  c.input.setAttribute('data-hx-focus', 'composer');
  c.addEventListener('ui:send', (e) => { send((e as CustomEvent<{ text: string }>).detail.text); });
  c.addEventListener('ui:stop', () => { stopTalk(); });
  const showHint = (): void => {
    const g = group(S.groupSel); const t = g ? outsideHint(g, c.value) : '';
    hint.textContent = t; hint.hidden = !t;
    if (!g || !t) return;
    for (const b of ui.markdown.outsiders(c.value, g.members, outsiders(g))) {
      const go = ui.button({ label: 'Send to ' + b.name, size: 's', variant: 'ghost' });
      go.addEventListener('click', () => { const draft = c.value.trim(); c.setValue(''); showHint(); sendToBot(b, draft); });
      hint.append(' ', go);
    }
  };
  c.input.addEventListener('input', showHint);
  c.addEventListener('ui:send', () => { window.setTimeout(showHint, 0); });
  G.composer = c;
  /* the messages held back while members work (`Group.queued`): the strip sits above the composer */
  G.queue = mountGroupQueue(zone, c, {
    sendNow: (gid, qid) => { groups().sendNow(gid, qid).catch((e: unknown) => { toast('It was not sent: ' + sentence(e)); }); },
    takeBack: (gid, qid) => { const t = groups().unqueue(gid, qid); if (t) { c.setValue(c.value ? t + '\n' + c.value : t); c.focus(); } }
  });
  followZone(zone, () => G.scroll, () => S.viewRoot);
  return pane;
}
const G = { scroll: null as HTMLElement | null, head: null as HTMLElement | null, log: null as HTMLElement | null, zone: null as HTMLElement | null, working: null as HTMLElement | null, composer: null as import('../../components').ComposerEl | null, queue: null as GroupQueue | null, renaming: false };

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
  G.renaming = false;
  renderHead(g);
  renderLog(g);
  renderComposer(g);
  emit('hx:title', { tab: 'bots', title: g.name });
  /* the room's messages are read as it opens; a thread that arrives is drawn in place */
  void groups().open(g.id).catch((e: unknown) => { toast('This group could not be read: ' + sentence(e)); });
}

function renderHead(g: Group): void {
  const h = G.head as HTMLElement; h.textContent = '';
  const name = el('h1', { class: 'bt-p-name', text: g.name });
  const line = el('p', { class: 'bt-p-line' }, el('span', { class: 'bt-p-role', text: namesOf(g.members) }));
  const acts = el('div', { class: 'bt-p-actions' });
  const rename = ui.iconButton({ icon: 'pen', label: 'Rename ' + g.name, tip: 'Rename' });
  rename.addEventListener('click', () => { startRename(g, name, rename); });
  const members = ui.iconButton({ icon: 'bots', label: 'Change the members of ' + g.name, tip: 'Members' });
  members.addEventListener('click', () => { openNewGroup({ edit: g.id }); });
  const archive = ui.iconButton({ icon: 'archive', label: 'Archive ' + g.name, tip: 'Archive' });
  archive.addEventListener('click', () => { archiveGroup(g); });
  acts.append(rename, members, archive);
  h.append(el('div', { class: 'bt-p-orb', html: stackOf(g.members, 'head') }), el('div', { class: 'bt-p-text' }, [name, line]), acts);
  livenIn(h);
  checkClips();
}
function startRename(g: Group, nameEl: HTMLElement, btn: HTMLElement): void {
  if (G.renaming) return;
  G.renaming = true;
  const input = el('input', { class: 'bt-name bt-gname', type: 'text', maxlength: '200', 'aria-label': 'Group name', value: g.name, autocomplete: 'off', spellcheck: 'false' });
  nameEl.replaceWith(input);
  btn.setAttribute('aria-disabled', 'true');
  input.focus(); input.select();
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true; G.renaming = false;
    const next = input.value.trim();
    if (save && next && next !== g.name) groups().rename(g.id, next).catch((e: unknown) => { toast('It was not renamed: ' + sentence(e)); const cur = group(g.id); if (cur && S.groupSel === g.id) renderHead(cur); });
    else { const cur = group(g.id); if (cur) renderHead(cur); }
    btn.removeAttribute('aria-disabled');
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); (G.composer as NonNullable<typeof G.composer>).focus(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => { finish(true); });
}
function archiveGroup(g: Group): void {
  groups().archive(g.id).then((done) => {
    toast('Archived ' + g.name, { action: { label: 'Undo', onClick: () => { done.undo().then(() => { toast('Restored ' + g.name); }).catch((e: unknown) => { toast('Could not restore ' + g.name + ': ' + sentence(e)); }); } } });
  }).catch((e: unknown) => { toast('It was not archived: ' + sentence(e)); });
}

/* ───────── thread ─────────
   Each message is a call-number entry (orb, name, "to" line, time in the margin) with what the member wrote drawn by the kit's
   markdown renderer; its mentions open the bot's chat, its paths open on this computer (refs.ts). While members work, each has a
   pending entry where its message will land (ledger.ts); the message takes that place when it arrives. */
const ENTRY = new WeakMap<HTMLElement, { msgs: GroupText[]; who: string; to: string }>();
const PENDING = new Map<string, HTMLElement>();
/** the last message the user has seen in each group (this run), and how many arrived below the fold since */
const SEEN = new Map<string, string>();
const U = { unread: 0, divider: null as HTMLElement | null, jump: null as HTMLButtonElement | null };

const mdBot = (m: GroupMember): MdBot => { const b = bot(m.profile); return { ...memberBot(m), id: m.profile || m.id, name: m.name, handle: m.handle, ...(b?.role ? { role: b.role } : {}) }; };
/** the bots that exist and are not in the room: a mention of one is a muted chip, and the composer says so before sending */
const outsiders = (g: Group): Array<MdBot & { handle: string }> => S.bots.filter((b) => !g.members.some((m) => m.profile === b.id)).map((b) => ({ ...b, id: b.id, name: b.name, handle: b.id }));
const ctxOf = (g: Group): MarkdownCtx => mentionCtx(g.members.map(mdBot), { everyone: true, outside: outsiders(g) });
/** the quiet hint under a draft that names a bot that is not here: "nimbus isn't in this room: send it to their chat, or send without them" */
export function outsideHint(g: Group, text: string): string {
  const out = ui.markdown.outsiders(text, g.members, outsiders(g));
  return out.length ? listWords(out.map((b) => b.name)) + (out.length === 1 ? " isn't" : " aren't") + ' in this room: send it to ' + (out.length === 1 ? 'their' : 'their own') + ' chat, or send without them' : '';
}
/** a message of this room opened in a bot's own chat, as a draft the owner sends (nothing is forwarded by itself; rosters are frozen, so the bot cannot join) */
export function sendToBot(bot: { id: string }, text: string): void {
  emit('hx:bot-select', { id: bot.id, from: 'group' });
  const c = S.composer; if (!c) return;
  c.setValue(text); c.focus();
}
/** under a member's message that names a bot that is not in the room: it says so, and offers the message in that bot's own chat */
function outsideNote(g: Group, m: GroupText): HTMLElement | null {
  const out = ui.markdown.outsiders(m.text, g.members, outsiders(g));
  if (!out.length) return null;
  const note = el('div', { class: 'bt-outside', role: 'status' });
  for (const b of out) {
    const row = el('p', { class: 'bt-outside__row' });
    row.append(el('span', { text: b.name + " isn't in this room" }));
    const go = ui.button({ label: 'Send to ' + b.name, size: 's', variant: 'ghost' });
    go.addEventListener('click', () => { sendToBot(b, 'From ' + (memberOf(g, m.who)?.name ?? m.who) + ' in ' + g.name + ':\n' + m.text.split('\n').map((l) => '> ' + l).join('\n') + '\n\n'); });
    row.append(go);
    note.append(row);
  }
  return note;
}
/** other parts of the room's composer can hold a message back (a running turn it would cancel): a guard returns false to stop the send */
const GUARDS: Array<(g: Group, text: string) => boolean> = [];
export const addSendGuard = (fn: (g: Group, text: string) => boolean): void => { GUARDS.push(fn); };
const memberOf = (g: Group, idOrProfile: string): GroupMember | undefined => g.members.find((m) => m.id === idOrProfile || m.profile === idOrProfile);
/** the folders a member's paths resolve in: the folder the engine said its bot works in (none known: absolute paths only) */
const rootsOf = (g: Group, who: string): string[] => { const m = memberOf(g, who); const ws = m ? data().bots.workspace?.(m.profile) : null; return ws ? [ws] : []; };
/** whom a message is for, in words: round 0 answers the user; a later round goes to the members the room names, or its mentions name */
function recipients(g: Group, m: GroupText): string[] {
  if (m.who === 'you') return [];
  if (m.round === 0) return ['you'];
  const ids = m.to?.length ? m.to : ui.markdown.resolve(m.text, g.members).members.map((x) => x.id);
  return ids.filter((id) => id !== m.who).map((id) => memberOf(g, id)?.name ?? id);
}
function replyTo(g: Group, who: string): void {
  const m = memberOf(g, who), c = G.composer; if (!m || !c) return;
  const v = c.value; c.insert((v && !/\s$/.test(v) ? ' ' : '') + '@' + m.handle + ' '); c.focus();
}
/** what a huddle needs of the room: its members, orbs and words */
function huddleDeps(g: Group): HuddleDeps {
  return {
    member: (id) => memberOf(g, id),
    orb: (m, size) => orbHTML(memberBot(m), size, { state: 'idle' }),
    to: (m) => recipients(g, m),
    ctx: ctxOf(g),
    drawn: (m, node) => { NODE.set(m.id, node); void resolvePaths(node, rootsOf(g, m.who)); }
  };
}
function renderLog(g: Group): void {
  const log = G.log as HTMLElement; log.textContent = '';
  NODE.clear(); PENDING.clear();
  U.divider = null; U.unread = 0; setJump(U.jump, 0);
  const msgs = groupThread(g.id);
  if (!msgs.length) {
    const e = ui.empty({ title: 'Nothing here yet', text: groups().nature });
    e.classList.add('bt-empty');
    log.append(e);
  } else {
    const seen = SEEN.get(g.id);
    const at = seen ? msgs.findIndex((x) => x.id === seen) : -1;
    const firstNew = at >= 0 ? msgs.slice(at + 1).find((x) => !(x.kind === 'text' && x.who === 'you')) : undefined;
    let prev: GroupMessage | null = null, entry: HTMLElement | null = null;
    const runs = huddleRuns(msgs);
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i] as GroupMessage;
      const run = runs.find((r) => r[0] === i);
      if (run) {
        const part = msgs.slice(run[0], run[1]) as GroupText[];
        const inside = firstNew && part.some((x) => x.id === firstNew.id);
        const h = huddleEntry(part, huddleDeps(g), { open: liveAt(msgs, run[1]), unreadBefore: inside ? firstNew.id : undefined });
        if (inside) U.divider = h.querySelector<HTMLElement>('.bt-unread');
        log.append(h); prev = null; entry = null; i = run[1] - 1; continue;
      }
      if (firstNew && m.id === firstNew.id) { U.divider = unreadDivider(); log.append(U.divider); prev = null; entry = null; }
      entry = renderMsg(g, m, prev, entry); prev = m;
    }
  }
  paintPending(g);
  requestAnimationFrame(() => {
    const sc = G.scroll; if (!sc) return;
    if (U.divider) U.divider.scrollIntoView({ block: 'center' }); else sc.scrollTop = sc.scrollHeight;
    markSeen(g);
  });
}
/** the entry a message joins: the previous one, when the same member wrote it to the same people */
function renderMsg(g: Group, m: GroupMessage, prev: GroupMessage | null, prevEntry: HTMLElement | null): HTMLElement | null {
  const log = G.log as HTMLElement;
  const before = log.querySelector<HTMLElement>(':scope > .bt-pending-entry');
  const place = (n: HTMLElement): void => { if (before) before.before(n); else log.append(n); };
  if (m.kind === 'note') {
    const p = el('p', { class: 'bt-note', role: 'status', text: m.text });
    if (m.more) { const more = m.more; const b = ui.button({ label: 'Let them continue', size: 's' }); b.addEventListener('click', () => { b.disabled = true; groups().continueTalk(g.id, more).catch((e: unknown) => { b.disabled = false; toast('It could not go on: ' + sentence(e)); }); }); p.append(' ', b); }
    NODE.set(m.id, p);
    place(p);
    return null;
  }
  const ctx = ctxOf(g);
  const you = m.who === 'you';
  const to = recipients(g, m), toKey = to.join(',');
  let node: HTMLElement;
  if (you) { node = frag(ui.html.request('')); node.innerHTML = ui.markdown.plain(m.text, ctx); }
  else node = ui.markdown(m.text, ctx);
  NODE.set(m.id, node);
  const away = you ? null : outsideNote(g, m);
  const info = prevEntry ? ENTRY.get(prevEntry) : undefined;
  if (prev && prev.kind === 'text' && prev.who === m.who && prevEntry && prevEntry.isConnected && info && info.to === toKey) {
    $('.ui-entry__body', prevEntry).append(node, ...(away ? [away] : []));
    info.msgs.push(m);
    if (!you) void resolvePaths(node, rootsOf(g, m.who));
    return prevEntry;
  }
  const member = you ? undefined : memberOf(g, m.who);
  const who = member ? orbHTML(memberBot(member), 20, { state: 'idle' }) + '<span class="bt-who-name">' + esc(member.name) + '</span>' : esc(you ? 'You' : m.who);
  const name = you ? 'You' : (member?.name ?? m.who);
  const entry = frag(ui.html.entry({ kind: you ? 'user' : 'bot', who, callno: m.t ? [m.t] : [], label: name + (to.length ? ', to ' + listWords(to) : '') + (m.t ? ', ' + m.t : '') }));
  $('.ui-entry__body', entry).append(node, ...(away ? [away] : []));
  placeToLine(entry, toLine(to));
  entry.setAttribute('data-hx-turn', ''); entry.tabIndex = -1;
  ENTRY.set(entry, { msgs: [m], who: m.who, to: toKey });
  entryActs(entry, {
    name,
    copy: () => (ENTRY.get(entry)?.msgs ?? []).map((x) => x.text).join('\n\n'),
    ...(member ? { reply: () => { replyTo(g, m.who); }, open: () => { emit('hx:bot-select', { id: member.profile, from: 'group' }); } } : {})
  });
  livenIn(entry);
  place(entry);
  if (!you) void resolvePaths(node, rootsOf(g, m.who));
  checkClips();
  return entry;
}
function appendMsg(g: Group, m: GroupMessage): void {
  const list = groupThread(g.id);
  if (list.some((x) => x.id === m.id)) return;
  const prev = [...list].reverse().find((x) => x.kind === 'text' || x.kind === 'note') ?? null;
  list.push(m);
  if (g.id !== S.groupSel || S.view !== 'group') return;
  const log = G.log as HTMLElement, sc = G.scroll as HTMLElement;
  const follow = atEnd(sc);
  log.querySelector('.bt-empty')?.remove();
  const turnsNow = [...log.querySelectorAll<HTMLElement>(':scope > [data-hx-turn]')];
  const last = turnsNow[turnsNow.length - 1] ?? null;
  const lastIsLast = !!last && !last.nextElementSibling?.matches('.bt-note, .bt-unread');
  if (m.kind === 'text' && m.who === 'you') foldHuddles(log);
  /* a member's message among the members: two or more in a row fold into one huddle, which stays open while the talk is live */
  if (isBetween(m)) {
    const run: GroupText[] = [];
    for (let i = list.length - 1; i >= 0; i--) { const x = list[i] as GroupMessage; if (isBetween(x)) run.unshift(x); else break; }
    if (run.length >= 2) { paintHuddle(g, run, m); if (follow) { sc.scrollTo({ top: sc.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); markSeen(g); } else { U.unread++; setJump(U.jump, U.unread); } return; }
  }
  const pend = m.kind === 'text' ? PENDING.get(m.who) : undefined;
  const entry = renderMsg(g, m, pend ? null : prev, pend || !lastIsLast ? null : last);
  const node = NODE.get(m.id) ?? null;
  if (pend && entry && entry !== pend) { pend.replaceWith(entry); PENDING.delete(m.kind === 'text' ? m.who : ''); }
  if (entry && m.kind === 'text') arrival(entry, m.who === 'you' ? null : node);
  else if (node && !reduced()) node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  if (follow || (m.kind === 'text' && m.who === 'you')) { sc.scrollTo({ top: sc.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); markSeen(g); }
  else if (m.kind === 'text' && m.who !== 'you') {
    if (!U.divider && node) { U.divider = unreadDivider(); (entry && entry.contains(node) && $('.ui-entry__body', entry).firstElementChild === node ? entry : node).before(U.divider); }
    U.unread++; setJump(U.jump, U.unread);
  }
}
/** the run's earlier messages leave the log (their entries, or the huddle they were in) and the whole run is drawn as one huddle, with the arriving message fading up */
function paintHuddle(g: Group, run: readonly GroupText[], arriving: GroupText): void {
  const log = G.log as HTMLElement;
  const gone = new Set<HTMLElement>();
  for (const x of run) if (x !== arriving) { const e = NODE.get(x.id)?.closest<HTMLElement>('[data-hx-turn]'); if (e) gone.add(e); }
  const old = [...gone][0];
  const kept = [...gone].find((e) => e.classList.contains('bt-huddle-entry'));
  const open = kept ? kept.querySelector('.ui-disclosure')?.getAttribute('aria-expanded') === 'true' : true;
  const h = huddleEntry(run, huddleDeps(g), { open });
  if (kept?.dataset['user']) h.dataset['user'] = kept.dataset['user'];
  const pend = PENDING.get(arriving.who);
  if (pend) { PENDING.delete(arriving.who); pend.remove(); }
  const tail = log.querySelector(':scope > .bt-pending-entry');
  if (old) old.before(h); else if (tail) tail.before(h); else log.append(h);
  for (const e of gone) e.remove();
  const node = NODE.get(arriving.id);
  if (node && open) ui.markdown.arrive(node);
}
/** the user has seen the end of the thread: remember its last message, and the jump goes */
function markSeen(g: Group): void {
  const sc = G.scroll; if (!sc || !atEnd(sc)) return;
  const msgs = groupThread(g.id), last = msgs[msgs.length - 1];
  if (last) SEEN.set(g.id, last.id);
  U.unread = 0; setJump(U.jump, 0);
}
function jumpToLatest(): void {
  const sc = G.scroll; if (!sc) return;
  sc.scrollTo({ top: sc.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
  const g = group(S.groupSel); if (g) { const msgs = groupThread(g.id), last = msgs[msgs.length - 1]; if (last) SEEN.set(g.id, last.id); }
  U.unread = 0; setJump(U.jump, 0);
  (G.composer as NonNullable<typeof G.composer>).focus();
}

/* ───────── who is at work: a pending entry each (the first three), the rest in one line above the composer ───────── */
const SHOWN = 3;
function activityOf(g: Group): MemberActivity[] {
  if (g.activity?.length) return [...g.activity];
  return g.working.map((id) => ({ member: id, status: 'running' as const, round: null, startedAt: null, tool: null }));
}
/** who asked a member: the author of the latest message that was for it (by the room's word or a mention) */
function askedBy(g: Group, member: GroupMember): string | null {
  const msgs = groupThread(g.id);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]; if (!m || m.kind !== 'text' || m.who === member.id) continue;
    const named = m.to?.length ? m.to.includes(member.id) : ui.markdown.resolve(m.text, [member]).members.length > 0;
    if (named) return m.who === 'you' ? 'you' : (memberOf(g, m.who)?.name ?? null);
  }
  return null;
}
function paintPending(g: Group): void {
  const log = G.log as HTMLElement;
  if (groups().note()) { for (const e of PENDING.values()) e.remove(); PENDING.clear(); return; }
  const acts = activityOf(g).filter((a) => memberOf(g, a.member));
  const shown = acts.slice(0, SHOWN), ids = new Set(shown.map((a) => a.member));
  for (const [id, e] of PENDING) if (!ids.has(id)) { PENDING.delete(id); dropPending(e); }
  const follow = G.scroll ? atEnd(G.scroll) : false;
  let added: HTMLElement | null = null;
  for (const a of shown) {
    const m = memberOf(g, a.member) as GroupMember;
    const o = { bot: { ...mdBot(m), id: m.id }, status: a.status, tool: a.tool, by: askedBy(g, m), startedAt: a.startedAt };
    const had = PENDING.get(a.member);
    if (had) { updatePending(had, o); continue; }
    const e = pendingEntry(o);
    PENDING.set(a.member, e);
    log.querySelector('.bt-empty')?.remove();
    log.append(e);
    if (!reduced()) e.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
    added ??= e;
  }
  if (added) {
    const turnsNow = [...log.querySelectorAll<HTMLElement>(':scope > [data-hx-turn]')];
    glanceAt(turnsNow[turnsNow.length - 1], added);
    if (follow && G.scroll) G.scroll.scrollTo({ top: G.scroll.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
  }
  paintWorking(g, acts.slice(SHOWN));
}

/* ───────── composer and who is replying ───────── */
function renderComposer(g: Group): void {
  const c = G.composer; if (!c) return;
  c.input.setAttribute('data-placeholder', 'Message ' + g.name + ', or @name for one');
  c.input.setAttribute('aria-label', 'Message ' + g.name);
  const chips = g.members.map((m) => {
    const chip = ui.chip({ label: '@' + m.handle, tip: 'Ask ' + m.name + ' only' });
    chip.addEventListener('click', () => { const v = c.value; c.insert((v && !/\s$/.test(v) ? ' ' : '') + '@' + m.handle + ' '); c.focus(); });
    return chip;
  });
  c.chips.replaceChildren(...chips);
  const why = groups().note();
  (G.working as HTMLElement).dataset['note'] = why ? '1' : '';
  c.setRunning(g.busy);
  G.queue?.paint(g, g.working);
}
/** the line above the composer: why group chat cannot run, or the members at work past the three drawn in the thread */
function paintWorking(g: Group, more: readonly MemberActivity[] = []): void {
  const w = G.working as HTMLElement;
  const why = groups().note();
  const busy = more.map((a) => memberOf(g, a.member)).filter((m): m is GroupMember => !!m);
  /* a member that is also running a kanban card is two sessions at once: the engine does not tie them together, so the room says it */
  const onBoard = g.members.filter((m) => !!bot(m.profile)?.info?.worker);
  w.textContent = '';
  if (why) { w.className = 'bt-working bt-working--note'; w.textContent = why; return; }
  w.className = 'bt-working';
  if (!busy.length && !onBoard.length) {
    /* a room that routes through a lead: who answers first, and that an @name brings a member in at once (the engine's rule) */
    const lead = g.lead ? g.members.find((m) => m.id === g.lead) : undefined;
    if (lead) { w.className = 'bt-working bt-working--note'; w.textContent = lead.name + ' answers first. An @name brings that bot in now.'; }
    return;
  }
  if (busy.length) {
    w.insertAdjacentHTML('beforeend', '<span class="bt-working-orbs" aria-hidden="true">' + stackOf(busy, 'working', true) + '</span>');
    w.append(el('span', { text: namesOf(busy) + (busy.length === 1 ? ' is next' : ' are next') }));
  }
  if (onBoard.length) w.append(el('span', { class: 'bt-working-board', text: (busy.length ? '. ' : '') + namesOf(onBoard) + (onBoard.length === 1 ? ' is also running a kanban task' : ' are also running kanban tasks') }));
  livenIn(w);
}
/** the roster moved (a bot started or finished a kanban card): the open group says it */
export function repaintWorking(): void { const g = group(S.groupSel); if (g && S.view === 'group') paintWorking(g, activityOf(g).filter((a) => memberOf(g, a.member)).slice(SHOWN)); }
/** a message while members are working is held and sent when they are done (it never stops them); "Send now" in the strip stops them */
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
        if ((renamed || members) && !G.renaming) { renderHead(g); emit('hx:title', { tab: 'bots', title: g.name }); }
        renderComposer(g); paintPending(g);
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
