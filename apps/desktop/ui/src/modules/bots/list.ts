/* The Bots sidebar as board K02 draws it (docs/design/v7/boards/src-k02: screens.js sidebarOpen, the owner's 23 November picks) and
   the rail as board 11 does (screens.js rail). The open sidebar, under the shell's Sessions / Bots switch and "+": the boopis bot at
   44 over its name (the kit's ListRow, head), a row for each bot (ListRow, bot, 54: its 28 orb at rest, its name, one line: "Needs
   you: ..." in amber with the amber dot at the row's end when it waits on you, else what it is doing, else its last words, else what
   it is for), "Groups" and a row for each room (its members' stack at 24, its name, who spoke last and what they said), and, only
   when something is archived, the Archived group (a folding SectionHead over ListRow items, each with Restore). New bot and New
   group are the "+" menu's (the shell's, actions.ts `openNewMenu`). One tab stop per list, the arrows (and j k) move, Enter or a
   click opens and focus stays in the list (KEYMAP 4). The rail: the kit's Rail, the bots' tiles (54 on 88; 44 on 64 under 1200 px
   of window, Automatic), the rooms as clusters under a hairline, New bot, Store and Settings at its foot. A live update never
   draws an orb again: rows and tiles are written in place. */
import { railSizeNow } from '../../core/settings';
import { emit, on } from '../../core/bus';
import { $, el, frag, reduced } from '../../core/dom';
import { setState, state } from '../../core/state';
import { kit, ui } from '@boopis/ui';
import { BOOPIS_ID, data } from '../../data';
import { lookOf, oc, paintLook, restReact } from '@boopis/ui';
import { DRAFT_COLOR, paintOrb } from './paint';
import { livenIn } from './orbs';
import { bot, group, initGroups, initModel, railOn, S, thread } from './model';
import type { ArchivedBot, ArchivedGroup, Bot, Group } from '../../data';
import { loadBots, saveBots } from '../../core/settings';
import { archivedWhen, restoreBot, restoredWords } from '../../data/restore';
import { focusConversation, openBot } from './room';
import { openGroup, namesOf } from './group-room';
import { checkClips, watchClips } from './clips';
import { OUTSIDE_SHORT, outsideDescription, outsideRowMark } from './outside';

const LIST_DESC = 'bt-outside-list';
const ROW = '[data-kit~="ListRow"]';

export function mountList(root: HTMLElement): void {
  initModel(); initGroups();
  if (S.listWrap && S.listWrap.parentNode) S.listWrap.remove();
  S.listRoot = root; S.rows.clear(); S.draftRow = null; S.groupRows.clear();
  S.offArchived?.(); S.offArchived = null; S.archivedEl = null;
  S.offGroupsArchived?.(); S.offGroupsArchived = null;
  if (root) root.dataset['rail'] = 'ok';
  const wrap = el('nav', { class: 'bt-list', 'aria-label': 'Bots' });
  const ul = el('div', { class: 'k7-list bt-rows', role: 'listbox', 'aria-label': 'Bots' });
  if (data().info.preview.has('bots')) wrap.append(el('p', { class: 'bt-preview', role: 'note', text: 'Preview: sample bots' }));
  for (const b of S.bots) ul.append(makeRow(b));
  /* the boopis bot heads the list, whatever the roster's order */
  const head = S.rows.get(BOOPIS_ID); if (head) ul.prepend(head.li);
  const groupsHost = el('div', { class: 'bt-groups' });
  const archived = el('div', { class: 'bt-archived' });
  wrap.append(ul, groupsHost, archived, outsideDescription(LIST_DESC));
  S.groupsEl = groupsHost;
  (root || document.body).append(wrap);
  wireList(ul, (id) => {
    if (id === '__draft') { S.newPane?.querySelector<HTMLElement>('.bt-name')?.focus(); return; }
    if (id && bot(id)) { openBot(id); emit('hx:bot-select', { id, from: 'bots-list' }); }
  });
  S.listWrap = wrap; S.rowsEl = ul;
  S.archivedEl = archived; archivedOpen = loadBots().archivedOpen === true;
  mountArchived(archived);
  mountGroups(groupsHost);
  mountRail();
  watchClips(wrap); checkClips();
  syncListVisibility();
  syncRail();
  markSelected();
}
/** a list of the kit's ListRows: one tab stop, ↑ ↓ (and j k), Home, End move; Enter, Space or a click chooses; Esc goes to the conversation */
function wireList(list: HTMLElement, choose: (value: string) => void): void {
  const rows = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>(ROW)].filter((r) => !r.closest('[hidden]'));
  list.addEventListener('click', (e) => {
    const r = (e.target as Element).closest<HTMLElement>(ROW);
    if (!r || !list.contains(r) || (e.target as Element).closest('button')) return;
    choose(r.dataset['value'] ?? '');
  });
  list.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const all = rows(), at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const k = e.key === 'j' ? 'ArrowDown' : e.key === 'k' ? 'ArrowUp' : e.key;
    const n = ({ ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 } as Record<string, number>)[k];
    if (n != null) { e.preventDefault(); const t = all[Math.max(0, Math.min(all.length - 1, n))]; if (t) { for (const r of all) r.tabIndex = r === t ? 0 : -1; t.focus(); } return; }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(all[at]?.dataset['value'] ?? ''); return; }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); focusConversation(); }
  });
}
const oneLine = (t: string): string => t.replace(/\s+/g, ' ').trim();
/** the row's one line: what it waits on you for (in its own words, else the ask's), what it is doing, its last words, or what it is for */
function lineOf(b: Bot): { sub: string; needs: string | null } {
  const s = ui.botState(b);
  if (s.attention) {
    const ask = [...thread(b.id)].reverse().find((m) => m.kind === 'approval' && !m.resolved);
    const title = ask && ask.kind === 'approval' ? ask.data.title : '';
    const what = b.activity || (title ? title.charAt(0).toLowerCase() + title.slice(1) : '');
    return { sub: '', needs: 'Needs you' + (what ? ': ' + what : '') };
  }
  if (s.busy) return { sub: b.activity || s.word.charAt(0).toUpperCase() + s.word.slice(1), needs: null };
  if (s.key !== 'idle') return { sub: s.word.charAt(0).toUpperCase() + s.word.slice(1), needs: null };
  const said = [...thread(b.id)].reverse().find((m) => m.kind === 'text' && m.who !== 'you');
  return { sub: oneLine(said && said.kind === 'text' ? said.text : b.last?.text ?? '') || b.role, needs: null };
}
function rowHTML(b: Bot): string {
  const s = ui.botState(b), outside = !!b.madeOutside, line = lineOf(b);
  return kit.html.listRow({
    variant: b.id === BOOPIS_ID ? 'head' : 'bot', ink: b.id === BOOPIS_ID, title: b.name, sub: line.sub, bot: b, needs: line.needs ?? false, working: s.busy, current: S.view === 'bot' && b.id === S.sel,
    ...(outside ? { endHTML: outsideRowMark() } : {}),
    attrs: { 'data-value': b.id, 'aria-label': rowLabel(b, line, outside), 'aria-describedby': outside ? LIST_DESC : null }
  });
}
/** the row's name holds its visible words in order (WCAG 2.5.3): the name, its line, "outside"; then the state when the line does not say it */
function rowLabel(b: Bot, line: { sub: string; needs: string | null }, outside: boolean): string {
  const s = ui.botState(b), words = line.needs ?? line.sub;
  const state = s.key !== 'idle' && !words.toLowerCase().includes(s.word.toLowerCase()) ? s.word : '';
  return [b.name, words, outside ? OUTSIDE_SHORT : '', state].filter(Boolean).join(', ');
}
export function makeRow(b: Bot): HTMLElement {
  const row = frag(rowHTML(b));
  kit.wire(row);
  S.rows.set(b.id, { li: row, btn: row });
  row.addEventListener('pointerenter', () => { if (!reduced()) oc(row.querySelector('orb-avatar'), 'blink'); });
  checkClips();
  return row;
}
/** copy an attribute from `from` onto `to`: written only when it differs, removed when `from` has none */
function mirror(to: Element, from: Element, names: readonly string[]): void {
  for (const n of names) {
    const v = from.getAttribute(n);
    if (v === null) { if (to.hasAttribute(n)) to.removeAttribute(n); } else if (to.getAttribute(n) !== v) to.setAttribute(n, v);
  }
}
const ROW_ATTRS = ['aria-label', 'aria-describedby', 'data-needs', 'data-working', 'data-tip'] as const;
/** a row's text follows `next`'s, and its attributes; its lead (the orb or the stack) is not touched */
function patchRow(row: HTMLElement, next: HTMLElement): void {
  mirror(row, next, ROW_ATTRS);
  const text = row.querySelector('.k7-lrow__text'), nextText = next.querySelector('.k7-lrow__text');
  if (text && nextText && text.innerHTML !== nextText.innerHTML) text.innerHTML = nextText.innerHTML;
  /* the end slot (the "outside" mark, the amber dot of a bot that waits on you), after the text */
  const ends = (n: Element): Element[] => { const out: Element[] = []; let x = (n.querySelector('.k7-lrow__text') ?? n.querySelector('.k7-lrow__title'))?.nextElementSibling; while (x) { out.push(x); x = x.nextElementSibling; } return out; };
  const had = ends(row), want = ends(next);
  if (had.map((x) => x.outerHTML).join() !== want.map((x) => x.outerHTML).join()) { for (const x of had) x.remove(); row.append(...want); }
}
/** a row follows its bot in place: the row and its live orb stay the same nodes (a canvas detached and attached again is painted
    empty until its worker draws once more); only the text, the attributes and the orb's look and reaction are written */
export function updateRow(id: string): void {
  const b = bot(id), r = S.rows.get(id); if (!b || !r) return;
  const next = frag(rowHTML(b));
  patchRow(r.btn, next);
  const orb = r.btn.querySelector<HTMLElement>('orb-avatar');
  if (orb) { paintLook(orb, lookOf(b)); restReact(orb, ui.botState(b).reaction); }
  patchTile(id);
  checkClips();
}
export function showDraftRow(on: boolean): void {
  if (!S.rowsEl) return;
  if (!on) { if (S.draftRow) { S.draftRow.li.remove(); S.draftRow = null; syncRoving(); } return; }
  const d = S.draft ?? { color: DRAFT_COLOR, shape: 'circle', name: '', role: '', tab: 'colour' };
  if (!S.draftRow) {
    const row = frag(kit.html.listRow({ variant: 'bot', title: 'New bot', sub: 'Draft', bot: { ...d, id: '__draft', name: 'New bot' }, current: true, attrs: { 'data-value': '__draft' } }));
    row.classList.add('bt-row--draft');
    livenIn(row);
    S.rowsEl.prepend(row);
    S.draftRow = { li: row, o: $('orb-avatar', row), name: $('.k7-lrow__title', row), btn: row };
  }
  paintDraftRow(); syncRoving();
}
export function paintDraftRow(): void {
  const r = S.draftRow, d = S.draft; if (!r || !d) return;
  paintOrb(r.o, d);
  const n = d.name.trim() || 'New bot';
  r.name.textContent = n;
  r.btn.setAttribute('aria-label', n + ', draft');
  checkClips();
}
export function markSelected(): void {
  for (const [id, r] of S.rows) setCurrent(r.btn, S.view === 'bot' && id === S.sel);
  for (const [id, r] of S.groupRows) setCurrent(r.btn, S.view === 'group' && id === S.groupSel);
  for (const t of RAIL.host?.querySelectorAll<HTMLElement>('.k7-tile') ?? []) {
    const on = (t.dataset['bot'] && S.view === 'bot' && t.dataset['bot'] === S.sel) || (t.dataset['gid'] && S.view === 'group' && t.dataset['gid'] === S.groupSel);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  }
  /* a tile's flag follows the selection too: the open bot's tile carries none (board 11), and the bot you just left takes its own back
     at once (it used to wait for the rail's next redraw, so the same screen could show it or not) */
  if (RAIL.host?.firstElementChild) for (const b of S.bots) patchTile(b.id);
  showDraftRow(S.view === 'new');
  syncRoving();
}
function setCurrent(row: HTMLElement, on: boolean): void {
  row.toggleAttribute('data-current', on);
  row.setAttribute('aria-selected', String(on));
  if (on) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
}
/** one tab stop per list: the current row */
export function syncRoving(): void {
  for (const list of [S.rowsEl, S.groupsEl?.querySelector<HTMLElement>('.bt-group-rows')]) {
    if (!list) continue;
    const rows = [...list.querySelectorAll<HTMLElement>(ROW)];
    const cur = rows.find((r) => r.getAttribute('aria-current')) ?? rows[0];
    /* KEYMAP section 3: the list region's default target is the current row */
    if (list === S.rowsEl) rows.forEach((r) => { if (r === cur) r.setAttribute('data-hx-focus', 'list'); else r.removeAttribute('data-hx-focus'); });
    if (rows.some((r) => r === document.activeElement)) continue;
    rows.forEach((r) => { r.tabIndex = r === cur ? 0 : -1; });
  }
}
export function syncListVisibility(): void {
  if (!S.listWrap || !S.listRoot || S.listRoot.id === 'hx-list-bots') return;
  S.listWrap.hidden = !!(state.tab && state.tab !== 'bots');
}

/* ───────── the rail (the kit's Rail, in the shell's #hx-rail) ───────── */
const RAIL = { host: null as HTMLElement | null, sig: '' };
/** Settings > General > Layout > Rail size (board 14): Standard, Compact, or Automatic (the default: compact under 1200 px of window,
    standard from 1200) */
const railSize = railSizeNow;
function mountRail(): void {
  RAIL.host = document.getElementById('hx-rail');
  RAIL.sig = '';
  if (!RAIL.host || RAIL.host.dataset['wired']) { drawRail(); return; }
  RAIL.host.dataset['wired'] = '';
  RAIL.host.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('.k7-tile, [data-rail-act]');
    if (!t) return;
    if (t.dataset['bot']) { openBot(t.dataset['bot']); emit('hx:bot-select', { id: t.dataset['bot'], from: 'bots-rail' }); return; }
    if (t.dataset['gid']) { openGroup(t.dataset['gid']); return; }
    const act = t.dataset['railAct'];
    if (act === 'new') { if (state.tab === 'session') emit('hx:new-session', {}); else emit('hx:new-bot', { from: 'rail' }); }
    else if (act === 'store') emit('hx:open-store', {});
    else if (act === 'settings') emit('hx:open-settings', { section: 'general', from: 'rail' });
  });
  /* the tab switch, upright (owner, 25 November): the open sidebar's own switch, on the same tab state */
  RAIL.host.addEventListener('ui:change', (e) => { if (!(e.target as Element).closest('[data-rail-tabs]')) return; e.preventDefault(); setState({ tab: (e as CustomEvent<{ value: string }>).detail.value as typeof state.tab }); });
  on('hx:tab', () => { drawRail(); });
  on('hx:chrome', () => { drawRail(); });
  window.addEventListener('resize', () => { if (RAIL.sig && !RAIL.sig.startsWith(railSize())) drawRail(); });
  drawRail();
}
/** the rail is drawn again only when who is on it changes (or its size); a bot's state is written into its tile */
export function drawRail(): void {
  const host = RAIL.host; if (!host) return;
  const size = railSize();
  const sessions = state.tab === 'session';
  const sig = size + '|' + state.tab + '|' + S.bots.map((b) => b.id + b.color + b.shape).join() + '|' + S.groups.map((g) => g.id + ':' + g.members.map((m) => m.profile).join('.')).join();
  if (sig === RAIL.sig && host.firstElementChild) { for (const b of S.bots) patchTile(b.id); return; }
  RAIL.sig = sig;
  const tiles = S.bots.map((b) => { const s = ui.botState(b); const current = S.view === 'bot' && b.id === S.sel; return { ...b, current, ink: b.id === BOOPIS_ID, needs: !!s.attention && !current   /* the open bot's tile carries no flag (board 11): its ask is in front of you */, working: s.busy, attrs: { 'data-bot': b.id, 'aria-label': ui.botLabel(b) } }; });
  /* a room's cluster: its members that are bots, the rest in "+N"; its tooltip its name and who is in it (owner decision, 23 November) */
  const groups = S.groups.map((g) => {
    const members = g.members.map((m) => bot(m.profile)).filter((x): x is Bot => !!x);
    return { name: g.name, members, extra: g.members.length - members.length, current: S.view === 'group' && g.id === S.groupSel, attrs: { 'data-gid': g.id, 'aria-label': g.name + ', ' + namesOf(g.members), 'data-tip-state': namesOf(g.members) } };
  });
  /* on the Sessions tab the rail shows no bots (owner: "the Sessions tab shows no bots except the dock"): the switch, and at the foot New
     session, Store and Settings */
  const tabs = { value: state.tab, items: [{ value: 'session', label: 'Sessions', icon: 'session', keys: 'alt+1', controls: 'hx-list-session' }, { value: 'bots', label: 'Bots', icon: 'bots', keys: 'alt+2', controls: 'hx-list-bots' }] };
  const rail = kit.rail({ size, bots: sessions ? [] : tiles, groups: sessions ? [] : groups, tabs, newLabel: sessions ? 'New session' : 'New bot', foot: { newBot: { 'data-rail-act': 'new', 'data-kbd': 'mod+shift+O' }, store: { 'data-rail-act': 'store' }, settings: { 'data-rail-act': 'settings', 'data-kbd': 'mod+,' } } });
  host.replaceChildren(rail);
}
/** a bot's tile follows its state in place: its name and state in words, the flag, the orb's reaction */
function patchTile(id: string): void {
  const b = bot(id), t = RAIL.host?.querySelector<HTMLElement>('.k7-tile[data-bot="' + CSS.escape(id) + '"]');
  if (!b || !t) return;
  const s = ui.botState(b);
  t.setAttribute('aria-label', ui.botLabel(b));
  const needs = !!s.attention && !(S.view === 'bot' && b.id === S.sel);
  t.toggleAttribute('data-needs', needs);
  const flag = t.querySelector('.k7-flag');
  if (needs && !flag) t.append(frag('<span class="k7-flag" aria-hidden="true"></span>')); else if (!needs && flag) flag.remove();
  const orb = t.querySelector<HTMLElement>('orb-avatar');
  if (orb) { paintLook(orb, lookOf(b)); restReact(orb, s.reaction); }
}
/** the rail follows the sidebar's state: drawn while it shows, its current tile marked */
let lastRail: boolean | null = null;
export function syncRail(): void {
  if (!S.listWrap) return;
  const rail = railOn();
  if (rail === lastRail) return;
  lastRail = rail;
  if (rail) drawRail();
}

/* ───────── the Archived group (owner decision, 19 November 2026) ─────────
   Under the rows, only while something is archived; folded until the user opens it and kept as they left it (`hx.v6.bots`). The
   kit's folding SectionHead with its count, over ListRow items: an archived bot (its name, when it was archived) or room (who was
   in it), each with Restore. Restore is the provider's: a name that is in use again is refused and the row stays. No board draws
   it (an owner question); the palette's "Restore bot…" reaches the same bots. */
let archivedOpen = false;
const pending = new Set<string>();
function archivedRow(a: ArchivedBot): string {
  const name = a.was || a.name, sub = archivedWhen(a.when);
  return kit.html.listRow({ variant: 'item', title: name, sub, action: 'Restore', actionAttrs: { 'data-act': 'restore', 'data-id': a.id, 'aria-label': 'Restore ' + name }, attrs: { 'data-id': a.id, 'data-archived-bot': '', 'aria-label': name + ', ' + sub.toLowerCase() } });
}
export function drawArchived(): void {
  const host = S.archivedEl; if (!host) return;
  const list = data().bots.archived.get(), glist = data().groups.archived.get();
  host.replaceChildren();
  host.hidden = !list.length && !glist.length;
  if (host.hidden) return;
  const total = list.length + glist.length;
  host.innerHTML = kit.html.sectionHead({ title: 'Archived', count: String(total), disclosure: true, collapsed: !archivedOpen, attrs: { id: 'bt-archived' } }) +
    '<div class="k7-list bt-archived-rows" role="list" aria-label="Archived"' + (archivedOpen ? '' : ' hidden') + '>' + list.map(archivedRow).join('') + glist.map(archivedGroupRow).join('') + '</div>';
  kit.wire(host);
  checkClips();
}
function mountArchived(host: HTMLElement): void {
  host.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.k7-shead__btn')) { archivedOpen = !archivedOpen; saveBots({ archivedOpen }); drawArchived(); host.querySelector<HTMLElement>('.k7-shead__btn')?.focus(); return; }
    const g = (e.target as Element).closest<HTMLElement>('[data-act="restore-group"]');
    if (g?.dataset['id']) { const gid = g.dataset['id']; data().groups.restore(gid).then(() => { notify('Restored a group'); openGroup(gid); }).catch((err: unknown) => { notify('Could not restore it: ' + (err instanceof Error ? err.message : String(err))); }); return; }
    const b = (e.target as Element).closest<HTMLElement>('[data-act="restore"]');
    const id = b?.dataset['id'];
    if (b && id) void restoreArchivedBot(id, b);
  });
  host.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); focusConversation(); }
  });
  S.offArchived = data().bots.archived.subscribe(drawArchived);
  drawArchived();
}
/** what a restore says: the floating Notice (the retired toast's place) */
const notify = (text: string): void => { kit.notify(text); };
/** asks the provider, says what happened, and puts focus on the bot that came back; a refusal leaves everything where it was */
async function restoreArchivedBot(id: string, button: HTMLElement): Promise<void> {
  if (pending.has(id)) return;
  pending.add(id);
  button.setAttribute('aria-disabled', 'true');
  try {
    const r = await restoreBot(data().bots, id);
    notify(restoredWords(r));
    if (r.ok) S.rows.get(r.name)?.btn.focus({ preventScroll: true });
  } finally { pending.delete(id); button.removeAttribute('aria-disabled'); }
}

/* ───────── the rooms under the bots (team chat) ─────────
   "Groups" (the kit's SectionHead), only while there is a room, then a row for each: the kit's ListRow with its members' stack at
   24, its name, and its last words after who said them (board K02: "nina: the deploy is ready"), or who is in it while nothing
   was said. The block follows the groups in place (`drawGroups`), so a live update never blanks a stack's orbs. In the rail a
   room is its cluster under a hairline (the Rail's). */
function lastWords(g: Group): string {
  const t = [...(S.groupThreads[g.id] ?? [])].reverse().find((m) => m.kind === 'text');
  if (!t || t.kind !== 'text') return '';
  const by = t.who === 'you' ? null : g.members.find((m) => m.id === t.who || m.profile === t.who);
  return (by ? by.name + ': ' : '') + oneLine(t.text);
}
/** a room's members as its row's lead: the kit's stack at 24, still, as board K02 draws it (four places, "+N" the last; members that are
    no longer bots count in it) */
function rowStack(g: Group): string {
  const members = g.members.map((m) => bot(m.profile)).filter((x): x is Bot => !!x);
  return kit.html.avatar({ variant: 'stack', members, size: 24, surface: '--bg-1', max: 4, extra: g.members.length - members.length, label: namesOf(g.members) });
}
function groupRow(g: Group): string {
  const busy = g.busy, line = lastWords(g) || namesOf(g.members), who = line + (busy ? ', replying' : '');
  return kit.html.listRow({
    variant: 'bot', title: g.name, sub: line, leadHTML: rowStack(g), working: !!busy,
    current: S.view === 'group' && g.id === S.groupSel,
    attrs: { 'data-value': g.id, 'data-gid': g.id, 'aria-label': g.name + ', ' + who }
  });
}
/** the stack a group row wears is drawn again only when who is in it changes */
const stackSig = (g: Group): string => g.members.map((m) => (bot(m.profile) ? '' : '?') + m.profile).join();
function groupsSkeleton(host: HTMLElement): HTMLElement {
  const list = el('div', { class: 'k7-list bt-group-rows', role: 'listbox', 'aria-label': 'Groups' });
  host.append(frag(kit.html.sectionHead({ title: 'Groups' })), list);
  wireList(list, (id) => { if (id && group(id)) openGroup(id); });
  return list;
}
/** the block follows the groups in place: a row whose members did not change keeps its orbs, a new group adds a row, an archived one removes its own */
export function drawGroups(): void {
  const host = S.groupsEl; if (!host) return;
  const list = host.querySelector<HTMLElement>('.bt-group-rows') ?? groupsSkeleton(host);
  const want: HTMLElement[] = [], keep = new Set<string>();
  for (const g of S.groups) {
    keep.add(g.id);
    const row = frag(groupRow(g)), sig = stackSig(g), had = S.groupRows.get(g.id);
    if (had && had.li.dataset['stack'] === sig && had.li.isConnected) { patchRow(had.btn, row); want.push(had.li); continue; }
    had?.li.remove();
    row.dataset['stack'] = sig;
    S.groupRows.set(g.id, { li: row, btn: row });
    want.push(row);
  }
  for (const id of [...S.groupRows.keys()]) if (!keep.has(id)) { S.groupRows.get(id)?.li.remove(); S.groupRows.delete(id); }
  /* put the rows in order, moving only a row that is out of place */
  want.forEach((r, i) => { if (list.children[i] !== r) list.insertBefore(r, list.children[i] ?? null); });
  drawRail();
  markSelected();
  checkClips();
}
function mountGroups(host: HTMLElement): void {
  void host;
  drawGroups();
  S.offGroupsArchived = data().groups.archived.subscribe(drawArchived);
}
function archivedGroupRow(a: ArchivedGroup): string {
  return kit.html.listRow({ variant: 'item', title: a.name, sub: 'Group of ' + namesOf(a.members), markHTML: ui.icon('bots'), action: 'Restore', actionAttrs: { 'data-act': 'restore-group', 'data-id': a.id, 'aria-label': 'Restore ' + a.name }, attrs: { 'data-id': a.id, 'data-archived-group': '', 'aria-label': a.name + ', archived group' } });
}
