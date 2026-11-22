/* the bot's room: the presence header, the thread (KEYMAP sections 3 and 5: every entry is a turn, with data-hx-turn
   and a roving tabindex), approval cards (the card layer only), and the library's composer (KEYMAP section 7).
   Everything that changes comes from the provider's events; everything the user does is a provider command. */
import { emit } from '../../core/bus';
import { $, el, esc, frag, reduced } from '../../core/dom';
import { setState, state } from '../../core/state';
import { lookOf, repaintLook, ui } from '@boopis/ui';
import type { MarkdownCtx, MenuItem } from '@boopis/ui';
import { data } from '../../data';
import type { ApprovalMessage, Bot, BotsEvent, ThreadMessage } from '../../data';
import { cronValid, cronWords, scheduleWords } from './cron';
import { bot, initModel, S, stateOf, thread } from './model';
import { gentleFollow, orbButton, orbHTML, livenIn, setReact } from './orbs';
import { markSelected, updateRow } from './list';
import { openNew } from './new-bot';
import { mountGroupPane } from './group-room';
import { mountNewGroupPane } from './new-group';
import { openSettings, toggleSettings } from './settings';
import { checkClips, watchClips } from './clips';
import { renderGlance } from './glance';
import { outsideDescription, outsideRoomMark } from './outside';
import { arrival, atEnd, dropPending, entryActs, pendingEntry, updatePending } from './ledger';
import { followZone } from '../chat/follow-zone';
import { mentionCtx, resolvePaths, wireRefs } from '../chat/refs';

const bots = () => data().bots;
const NODE = new Map<string, HTMLElement>();
const ENTRY = new WeakMap<HTMLElement, { msgs: ThreadMessage[]; who: string }>();
const toast = (t: string): void => { ui.toast(t); };
/** a recent session of the open bot is opened: its messages become the thread */
function openSession(sessionId: string): void {
  const b = bot(S.sel), sessions = bots().sessions; if (!b || !sessions) return;
  sessions.open(b.id, sessionId).catch((e: unknown) => { toast(e instanceof Error ? e.message : 'The session could not be opened.'); });
}
function newSession(): void {
  const b = bot(S.sel), sessions = bots().sessions; if (!b || !sessions) return;
  sessions.fresh(b.id);
  S.composer?.focus();
}
function paintNewSession(): void {
  const btn = S.pActs?.querySelector<HTMLElement>('[data-action="new-session"]'); if (!btn) return;
  btn.hidden = !(S.sel && thread(S.sel).length);
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
  const presence = el('header', { class: 'bt-presence' });
  const log = el('div', { class: 'bt-log', role: 'log', 'aria-label': 'Messages' });
  if (data().info.preview.has('bots')) col.append(el('p', { class: 'bt-preview', role: 'note', text: 'Preview. These bots are sample data and are not connected to boopis yet.' }));
  col.append(presence, log);
  scroll.append(col);
  const zone = el('div', { class: 'bt-composer-zone' });
  (S.room as HTMLElement).append(scroll, zone);
  S.scroll = scroll; S.presenceEl = presence; S.log = log; S.zone = zone;
  log.addEventListener('keydown', turnKeys);
  wireRefs(log, { bot: (id) => { const x = bot(id); return x ? { bot: { ...x, id: x.id, name: x.name }, state: x.state, model: x.info?.model ?? null } : null; } });
  log.addEventListener('focusin', (e) => { const t = (e.target as Element).closest<HTMLElement>('[data-hx-turn]'); if (t) rove(t); });
  buildComposer(zone);
  /* a live bot cannot be messaged yet: no composer, rather than one that sends nowhere */
  zone.hidden = !!data().info.unavailable['bots.send'];
  followZone(zone, () => S.scroll, () => S.viewRoot, '--bt-composer-h')();
  S.follow = gentleFollow(() => S.presence, 0.45);
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
  renderPresence(b);
  renderThread(b);
  paintComposer(b);
  S.composer?.setRunning(S.runs.has(b.id));
  emit('hx:title', { tab: 'bots', title: b.name });
  if (b.info) void data().bots.admin?.open(b.id).catch(() => undefined);   /* its model, routines and sessions are read as it opens */
  if (S.sheetOpen && S.sheetFor !== b.id) openSettings(b.id, null, { keepFocus: true });
}

/* header: orb 40 in the margin (lively, a quiet button), name 16/600, role 12 quiet, state; settings on the right */
function renderPresence(b: Bot): void {
  const p = S.presenceEl as HTMLElement; p.textContent = '';
  const ob = orbButton(b, 40, b.name, { motion: 'lively', state: b.state });
  S.presence = ob.orb;
  const name = el('h1', { class: 'bt-p-name', text: b.name });
  const line = el('p', { class: 'bt-p-line' });
  const acts = el('div', { class: 'bt-p-actions' });
  p.append(el('div', { class: 'bt-p-orb' }, ob), el('div', { class: 'bt-p-text' }, [name, line]), acts);
  S.pLine = line; S.pActs = acts;
  if (bots().sessions) { const ns = ui.iconButton({ icon: 'plus', label: 'New session with ' + b.name, tip: 'New session', action: 'new-session' }); ns.addEventListener('click', newSession); acts.append(ns); }
  acts.append(ui.iconButton({ icon: 'gear', label: 'Bot settings', keys: 'mod+I', action: 'settings' }));
  acts.querySelector('[data-action="settings"]')?.addEventListener('click', () => toggleSettings());
  refreshPresence();
  paintNewSession();
  checkClips();
}
export function refreshPresence(): void {
  const b = bot(S.sel); if (!b || !S.pLine) return;
  const s = stateOf(b, S.transient);
  if (S.presence) setReact(S.presence, s.reaction);
  const line = S.pLine; line.textContent = '';
  line.append(el('span', { class: 'bt-p-role', text: b.role }));
  if (b.madeOutside) line.append(outsideRoomMark('bt-outside-room'), outsideDescription('bt-outside-room'));
  if (s.key !== 'idle') {
    const st = el('span', { class: 'bt-p-state' });
    if (s.attention) st.insertAdjacentHTML('beforeend', ui.html.dot('attention'));
    else if (s.busy) st.insertAdjacentHTML('beforeend', ui.html.dot('run'));
    st.insertAdjacentHTML('beforeend', '<span class="ui-state"' + (s.tone !== 'none' ? ' data-tone="' + s.tone + '"' : '') + '>' + esc(s.busy && b.activity && !S.transient ? b.activity : s.word) + '</span>');
    line.append(st);
  }
  if (b.info) {
    if (b.info.model) line.append(el('button', { class: 'bt-p-sched ui-mono', type: 'button', 'data-tip': 'Model', onclick: () => openSettings(b.id, 'model'), html: ui.html.model(b.info.model, { size: 12, mono: false }) }));
    const next = b.info.jobs?.find((j) => j.enabled);
    if (next) line.append(el('button', { class: 'bt-p-sched ui-mono', type: 'button', 'data-tip': 'Schedule', onclick: () => openSettings(b.id, 'schedule') },
      [el('span', { html: ui.icon('clock') }), el('span', { text: scheduleWords(next.schedule) + (b.info.jobs && b.info.jobs.filter((j) => j.enabled).length > 1 ? ' and ' + (b.info.jobs.filter((j) => j.enabled).length - 1) + ' more' : '') })]));
  } else if (b.cfg.cron) line.append(el('button', { class: 'bt-p-sched ui-mono', type: 'button', 'data-tip': 'Schedule', onclick: () => openSettings(b.id, 'schedule') },
    [el('span', { html: ui.icon('clock') }), el('span', { text: cronValid(b.cfg.cron) ? cronWords(b.cfg.cron) : 'schedule incomplete' })]));
  paintToolbar(b);
}

/* ───────── thread ───────── */
function renderThread(b: Bot): void {
  const log = S.log as HTMLElement; log.textContent = '';
  NODE.clear(); PEND.el = null; PEND.for = null;
  const msgs = thread(b.id);
  if (!msgs.length && b.info) log.append(renderGlance(b, openSession));
  else if (!msgs.length) {
    const e = ui.empty({ title: 'Nothing here yet', text: 'Ask ' + b.name + ' something, or give it a schedule so it works on its own.' });
    if (b.ideas.length) {
      const ideas = el('div', { class: 'bt-ideas' }, b.ideas.map((t) => { const btn = ui.button({ label: t }); btn.addEventListener('click', () => setDraft(t)); return btn; }));
      e.append(ideas);
    }
    e.classList.add('bt-empty');
    log.append(e);
  } else {
    let prev: ThreadMessage | null = null, entry: HTMLElement | null = null;
    for (const m of msgs) { entry = renderMsg(b, m, prev, entry); prev = m; }
  }
  syncTurns();
  paintPending(b.id);
  requestAnimationFrame(() => { if (S.scroll) S.scroll.scrollTop = S.scroll.scrollHeight; });
}
/* what the bot writes: the kit's markdown; its mentions of teammates open their chats, its paths open where the bot works */
const ctx = (): MarkdownCtx => mentionCtx(S.bots.map((x) => ({ ...x, id: x.id, name: x.name })));
const rootsOf = (id: string): string[] => { const w = data().bots.workspace?.(id); return w ? [w] : []; };
function msgContent(b: Bot, m: ThreadMessage): HTMLElement {
  if (m.kind === 'note') return el('p', { class: 'bt-note', role: 'status', text: m.text });
  if (m.kind === 'approval') return renderCard(b, m);
  if (m.who === 'you') { const r = frag(ui.html.request('')); r.innerHTML = ui.markdown.plain(m.text, ctx()); return r; }
  const md = ui.markdown(m.text, ctx());
  void resolvePaths(md, rootsOf(m.who === 'you' ? b.id : (bot(m.who)?.id ?? b.id)));
  return md;
}
function renderMsg(b: Bot, m: ThreadMessage, prev: ThreadMessage | null, prevEntry: HTMLElement | null): HTMLElement | null {
  const node = msgContent(b, m);
  NODE.set(m.id, node);
  if (m.kind === 'note') { (S.log as HTMLElement).append(node); return null; }
  if (prev && prev.who === m.who && prevEntry && prevEntry.isConnected) {
    $('.ui-entry__body', prevEntry).append(node);
    ENTRY.get(prevEntry)?.msgs.push(m);
    return prevEntry;
  }
  const you = m.who === 'you', who = you ? null : (bot(m.who) ?? b);
  const entry = frag(ui.html.entry({
    kind: you ? 'user' : 'bot',
    who: you ? esc('You') : orbHTML(who as Bot, 20, { state: 'idle' }) + '<span class="bt-who-name">' + esc((who as Bot).name) + '</span>',
    callno: m.t ? [m.t] : [],
    label: (you ? 'You' : (who as Bot).name) + (m.t ? ', ' + m.t : '')
  }));
  $('.ui-entry__body', entry).append(node);
  entry.setAttribute('data-hx-turn', ''); entry.tabIndex = -1;
  ENTRY.set(entry, { msgs: [m], who: m.who });
  if (!you) entryActs(entry, { name: (who as Bot).name, copy: () => turnText(entry) });
  livenIn(entry);
  (S.log as HTMLElement).append(entry);
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
  const pend = m.who !== 'you' && m.kind !== 'note' ? PEND.el : null;
  if (pend) { PEND.el = null; }
  const lastEntry = !pend && log.lastElementChild && log.lastElementChild.matches('[data-hx-turn]') ? (log.lastElementChild as HTMLElement) : null;
  const entry = renderMsg(bot(id) as Bot, m, pend ? null : prev, lastEntry);
  if (pend) { if (entry) pend.replaceWith(entry); else pend.remove(); }
  else if (PEND.el && PEND.el.isConnected) log.append(PEND.el);   /* the pending entry stays last */
  syncTurns();
  const node = NODE.get(m.id);
  if (streaming) log.setAttribute('aria-busy', 'true');
  if (node && S.follow && !S.typing) requestAnimationFrame(() => { const r = node.getBoundingClientRect(); S.follow?.glance(r.left + Math.min(r.width, 160) / 2, r.top + 12, 1200); });
  if (entry && m.kind === 'text') arrival(entry, m.who === 'you' ? null : node ?? null);
  else if (!reduced() && node) node.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  if (follow || m.who === 'you') S.scroll?.scrollTo({ top: S.scroll.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
}
/* ───────── the bot at work: a pending entry where its reply will land, until the reply's first words arrive ───────── */
const PEND = { el: null as HTMLElement | null, for: null as string | null, since: 0 };
function paintPending(id: string): void {
  const b = bot(id); const log = S.log;
  const list = thread(id), last = list[list.length - 1];
  const replying = !!last && last.who !== 'you' && last.kind === 'text' && log?.getAttribute('aria-busy') === 'true';
  const want = !!b && !!log && S.runs.has(id) && !replying;
  if (!want) { if (PEND.el) { const e = PEND.el; PEND.el = null; PEND.for = null; dropPending(e); } return; }
  if (PEND.for !== id || !PEND.el?.isConnected) { PEND.el?.remove(); PEND.el = null; PEND.since = Date.now(); }
  const s = stateOf(b, null);
  const o = { bot: b, status: 'running' as const, tool: s.key === 'compute' ? 'terminal' : s.key === 'working' ? 'work' : null, activity: b.activity || null, startedAt: PEND.since };
  if (PEND.el) { updatePending(PEND.el, o); return; }
  const e = pendingEntry(o);
  PEND.el = e; PEND.for = id;
  log.querySelector('.bt-empty')?.remove();
  log.append(e);
  if (!reduced()) e.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  if (S.scroll && atEnd(S.scroll)) S.scroll.scrollTo({ top: S.scroll.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
}

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
  else S.presenceEl?.querySelector<HTMLElement>('.bt-orb-btn')?.focus();
}
export const allTurns = turns;
function turnText(t: HTMLElement): string {
  return (ENTRY.get(t)?.msgs ?? []).map((m) => (m.kind === 'approval' ? '> ' + (m.data.title || 'approval') : m.kind === 'note' ? '' : m.text)).join('\n\n');
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
    toast('Copied');
    return;
  }
  if (k === 'e' && info?.who === 'you') {
    e.preventDefault();
    const last = info.msgs[info.msgs.length - 1];
    if (S.composer && last && last.kind === 'text') { S.composer.setValue(last.text); S.composer.focus(); }
  }
}

/* ───────── approval: the card layer only ───────── */
function renderCard(b: Bot, m: ApprovalMessage): HTMLElement {
  if (m.resolved) return resolvedLine(m);
  const card = ui.card('approval', { ...m.data, from: b.id, source: 'bots', bot: b.id }, { size: 'inline' });
  card.addEventListener('hx:card-action', (e) => { const a = e.detail.action; if (a) resolveCard(b.id, m, a); });
  return el('div', { class: 'bt-cardslot' }, card);
}
function resolvedLine(m: ApprovalMessage): HTMLElement {
  const ok = m.resolved === 'approved';
  return el('div', { class: 'bt-resolved' }, [
    el('span', { class: 'bt-resolved-ico' + (ok ? ' is-ok' : ''), html: ui.icon(ok ? 'check' : 'close') }),
    el('span', { text: (ok ? 'You approved: ' : 'You denied: ') + (m.data.title || 'the request') }),
    el('time', { class: 'ui-mono', text: m.resolvedAt ?? '' })
  ]);
}
/** an approval decided here: the provider decides it everywhere (the dock, the thread) */
function resolveCard(id: string, m: ApprovalMessage, action: string): void {
  if (m.resolved) return;
  const a = String(action).toLowerCase();
  const ok = /approv|allow|yes|confirm/.test(a);
  if (!ok && !/deny|reject|no|cancel/.test(a)) return;
  bots().decide(id, m.id, ok ? 'approved' : 'denied');
}

/* ───────── composer: the library's (KEYMAP section 7) ─────────
   The library's composer talks: the mic shows the open bot's orb listening, and while you talk the presence orb (and
   every .ui-orb[data-bot] of that bot) takes orb2's listening reaction. The bot's chips go in its chips slot:
   Governed (alt+G toggles governance), and its channels (opens settings). */
function buildComposer(host: HTMLElement): void {
  const c = ui.composer({ placeholder: 'Message', label: 'Message', attach: true, spend: { spent: '$0.00', cap: '$0.60' }, bot: bot(S.sel) ?? null, orbs: () => [S.presence] });
  c.classList.add('bt-composer');
  host.append(c);
  const input = c.input;
  input.setAttribute('data-hx-focus', 'composer');
  c.addEventListener('ui:send', (e) => { send((e as CustomEvent<{ text: string }>).detail.text); });
  c.addEventListener('ui:stop', () => stopRun());
  input.addEventListener('input', () => typingChanged(c.value));
  input.addEventListener('focus', () => typingChanged(c.value));
  input.addEventListener('blur', () => { S.typing = false; settleTransient(); });
  input.addEventListener('keydown', (e) => {
    const code = e.code;
    /* ↑ in an empty composer: edit your last message */
    if (e.key === 'ArrowUp' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && !c.value.trim()) {
      const last = [...thread(S.sel as string)].reverse().find((m) => m.who === 'you' && m.kind === 'text');
      if (last && last.kind === 'text') { e.preventDefault(); c.setValue(last.text); c.focus(); }
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (code === 'KeyG') { e.preventDefault(); const b = bot(S.sel); if (b) setGov(b, b.cfg.gov === 'governed' ? 'ungoverned' : 'governed'); return; }
      if (code === 'KeyM') { e.preventDefault(); openModelMenu(); return; }
      if (code === 'KeyA') { e.preventDefault(); c.attach?.click(); return; }
    }
  });
  S.composer = c;
}
/** the bot's governance, as the composer chip, alt+G and the settings sheet all change it */
export function setGov(b: Bot, gov: 'governed' | 'ungoverned'): void {
  b.cfg.gov = gov;
  bots().update(b.id, { cfg: { gov } });
  refreshPresence();
  if (S.sheetOpen) openSettings(b.id, null, { keepFocus: true });
}
function openModelMenu(): void {
  const b = bot(S.sel), c = S.composer; if (!b || !c) return;
  const anchor = c.chips.querySelector<HTMLElement>('[data-value="model"]') ?? c.input;
  const items: MenuItem[] = [{ label: 'Governed', desc: 'Starts cheap, climbs the ladder', value: 'governed', checked: b.cfg.gov === 'governed' },
    ...bots().catalog().models.map((m): MenuItem => ({ label: m, mono: true, value: m, model: m, checked: b.cfg.gov !== 'governed' && b.cfg.model === m }))];
  ui.menu.open(anchor, items, {
    label: 'Model', place: 'above',
    onClose: () => setTimeout(() => { const f = document.activeElement; if (!f || f === document.body || !f.isConnected || f.closest('.ui-menu')) c.focus(); }, 0),
    onSelect: (v) => {
      if (v === 'governed') { b.cfg.gov = 'governed'; bots().update(b.id, { cfg: { gov: 'governed' } }); } else { b.cfg.gov = 'ungoverned'; b.cfg.model = v; bots().update(b.id, { cfg: { gov: 'ungoverned', model: v } }); }
      refreshPresence(); if (S.sheetOpen) openSettings(b.id, null, { keepFocus: true });
      setTimeout(() => c.focus(), 0);
    }
  });
}
function setDraft(t: string): void { const c = S.composer; if (!c) return; c.setValue(t); c.focus(); typingChanged(t); }
function paintComposer(b: Bot): void {
  const c = S.composer as (NonNullable<typeof S.composer> & { _bot?: string }) | null; if (!c) return;
  if (c._bot !== b.id) { c.setBot(b); c._bot = b.id; }
  if (!c.listening) c.input.setAttribute('data-placeholder', 'Message ' + b.name);
  c.input.setAttribute('aria-label', 'Message ' + b.name);
  paintToolbar(b);
}
export function paintToolbar(b: Bot): void {
  const c = S.composer as (NonNullable<typeof S.composer> & { _chipSig?: string }) | null; if (!c) return;
  const gov = b.cfg.gov === 'governed';
  const chans = data().bots.catalog().channels.filter((ch) => b.cfg.channels[ch.id] && ch.id !== 'app').map((ch) => ch.name);
  /* rebuild the chips only when what they say changes (an open menu may be anchored to one) */
  const sig = [b.id, gov, b.cfg.model, chans.join(',')].join('|');
  if (gov) c.setSpend('$' + b.spent, '$' + b.cfg.cap);
  { const capEl = c.querySelector<HTMLElement>('.ui-capacity'); if (capEl) capEl.hidden = !gov; }
  if (c._chipSig === sig) return;
  c._chipSig = sig;
  /* Governed is a toggle (off reads struck through); an ungoverned bot also shows its one model, which opens the picker */
  const gchip = ui.chip({ label: 'Governed', icon: 'ladder', pressed: gov, value: gov ? 'model' : 'governed', tip: 'Governance', attrs: { 'data-kbd': 'alt+G' } });
  gchip.addEventListener('ui:change', (e) => { e.preventDefault(); setGov(b, gov ? 'ungoverned' : 'governed'); });
  const kids: HTMLElement[] = [gchip];
  if (!gov) { const mc = ui.chip({ model: b.cfg.model, haspopup: 'menu', value: 'model', tip: 'Model', attrs: { 'data-kbd': 'alt+M' } }); mc.addEventListener('click', openModelMenu); kids.push(mc); }
  if (chans.length) { const ch = ui.chip({ label: 'Also on ' + chans.join(', '), tip: 'Channels' }); ch.addEventListener('click', () => openSettings(b.id, 'channels')); kids.push(ch); }
  c.chips.replaceChildren(...kids);
}
function typingChanged(text: string): void {
  const has = !!(text && String(text).trim());
  S.typing = has;
  if (has) {
    if (S.transient !== 'listening' && !S.runs.has(S.sel as string)) { S.transient = 'listening'; refreshPresence(); }
    const inp = S.composer?.input;
    if (inp && S.follow) {
      let r: { left: number; top: number; width: number; height: number } = inp.getBoundingClientRect();
      const sel = getSelection(); if (sel && sel.rangeCount && sel.anchorNode && inp.contains(sel.anchorNode)) { const rr = sel.getRangeAt(0).getBoundingClientRect(); if (rr.width || rr.left) r = { left: rr.left, top: rr.top, width: 0, height: rr.height || r.height }; }
      S.follow.hold(r.left + r.width / 2, r.top + r.height / 2);
    }
  } else settleTransient();
}
function settleTransient(): void {
  if (S.transient === 'listening') { S.transient = null; refreshPresence(); }
  S.follow?.release();
}

/* ───────── a run: the bot thinking, replying and working on what you asked ─────────
   One run per bot, so bots keep working while you switch; mod+. or Esc in the composer stops the open bot's run.
   A message can come from this tab or from the dock: either way the provider owns the thread and the reply. */
function send(text: string): void {
  const b = bot(S.sel); if (!b) return;
  S.typing = false; S.follow?.release();
  bots().send(b.id, text, 'bots');
}
export function stopRun(quiet?: boolean, id?: string): boolean {
  const target = id ?? (S.sel as string);
  const was = bots().stop(target);
  if (was && !quiet) { const b = bot(target); toast('Stopped ' + (b ? b.name : 'the bot')); }
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
      if (b.id === S.sel) { refreshPresence(); if (S.view === 'bot') paintPending(b.id); if (b.info && S.view === 'bot' && !thread(b.id).length && S.log) S.log.replaceChildren(renderGlance(b, openSession)); }
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
      list[i] = { ...m, resolved: ev.resolved, resolvedAt: ev.resolvedAt };
      const card = NODE.get(ev.messageId)?.querySelector<HTMLElement & { update?: (p: Record<string, unknown>) => void; state?: string }>('hx-card');
      if (card && typeof card.update === 'function' && card.state !== ev.resolved) card.update({ state: ev.resolved });
      break;
    }
    case 'thread': {
      S.threads[ev.botId] = [...ev.messages];
      const b = bot(ev.botId);
      if (b && ev.botId === S.sel && S.view === 'bot' && S.log) { S.log.removeAttribute('aria-busy'); renderThread(b); paintNewSession(); }
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
