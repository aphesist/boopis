/* sidebar list (KEYMAP section 4). ui.row in a [data-ui="rows"] list (↑ ↓, Home, End from the library; j k and Esc
   here). Enter or a click opens the bot and focus stays in the list. A draft row sits on top, current, while a bot
   is being made. */
import { emit } from '../../core/bus';
import { $, el, frag, reduced } from '../../core/dom';
import { state } from '../../core/state';
import { ui } from '@boopis/ui';
import { data } from '../../data';
import { lookOf, oc, paintLook } from '@boopis/ui';
import { DRAFT_COLOR, paintOrb } from './paint';
import { livenIn, orbHTML, setReact } from './orbs';
import { bot, group, initGroups, initModel, railOn, S } from './model';
import type { ArchivedBot, ArchivedGroup, Bot, Group } from '../../data';
import { loadBots, saveBots } from '../../core/settings';
import { archivedWhen, restoreBot, restoredWords } from '../../data/restore';
import { focusConversation, openBot } from './room';
import { openGroup, stackOf, namesOf } from './group-room';
import { openNewGroup } from './new-group';
import { checkClips, watchClips } from './clips';
import { OUTSIDE_SHORT, outsideDescription, outsideRowMark } from './outside';

const LIST_DESC = 'bt-outside-list';

export function mountList(root: HTMLElement): void {
  initModel(); initGroups();
  if (S.listWrap && S.listWrap.parentNode) S.listWrap.remove();
  S.listRoot = root; S.rows.clear(); S.draftRow = null; S.groupRows.clear();
  S.offArchived?.(); S.offArchived = null; S.archivedEl = null;
  S.offGroupsArchived?.(); S.offGroupsArchived = null;
  if (root) root.dataset['rail'] = 'ok';
  const wrap = el('nav', { class: 'bt-list', 'aria-label': 'Bots' });
  const ul = el('ul', { class: 'ui-rows bt-rows', 'data-ui': 'rows' });
  if (data().info.preview.has('bots')) wrap.append(el('p', { class: 'bt-preview', role: 'note', text: 'Preview: sample bots' }));
  for (const b of S.bots) ul.append(makeRow(b));
  const groupsHost = el('div', { class: 'bt-groups' });
  const archived = el('div', { class: 'bt-archived' });
  wrap.append(ul, groupsHost, archived, outsideDescription(LIST_DESC));
  S.groupsEl = groupsHost;
  (root || document.body).append(wrap);
  ui.hydrate(ul);
  ul.addEventListener('keydown', listKeys);
  ul.addEventListener('ui:select', (e) => {
    const id = (e as CustomEvent<{ value?: string }>).detail.value;
    if (id === '__draft') { e.preventDefault(); S.newPane?.querySelector<HTMLElement>('.bt-name')?.focus(); return; }
    if (id && bot(id)) { e.preventDefault(); openBot(id); emit('hx:bot-select', { id, from: 'bots-list' }); }
  });
  S.listWrap = wrap; S.rowsEl = ul;
  S.archivedEl = archived; archivedOpen = loadBots().archivedOpen === true;
  mountArchived(archived);
  mountGroups(groupsHost);
  watchClips(wrap); checkClips();
  syncListVisibility();
  syncRail();
  markSelected();
}
function listKeys(e: KeyboardEvent): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const k = e.key;
  if (k === 'j' || k === 'k') {
    e.preventDefault();
    (e.target as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k === 'j' ? 'ArrowDown' : 'ArrowUp', bubbles: true }));
  } else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); focusConversation(); }
}
function rowHTML(b: Bot): string {
  const s = ui.botState(b), rail = railOn(), outside = !!b.madeOutside;
  return ui.html.row({
    title: b.name, sub: b.role, value: b.id,
    end: (outside ? outsideRowMark() + ' ' : '') + ui.html.stateWord(b), endTone: s.attention ? 'attention' : null,
    lead: orbHTML(b, rail ? 24 : 20, { flag: true, state: b.state }),
    current: S.view === 'bot' && b.id === S.sel,
    attrs: { 'aria-label': ui.botLabel(b, outside ? OUTSIDE_SHORT : undefined), 'aria-describedby': outside ? LIST_DESC : null, 'data-tip': rail ? b.name : null, 'data-tip-pos': 'right', 'data-tip-state': rail && s.key !== 'idle' ? s.word : null, 'data-tip-tone': rail && s.attention ? 'attention' : null }
  });
}
export function makeRow(b: Bot): HTMLElement {
  const li = frag(rowHTML(b));
  livenIn(li);
  const btn = $('.ui-row', li);
  btn.addEventListener('pointerenter', () => { if (!reduced()) oc(btn.querySelector('orb-avatar'), 'blink'); });
  S.rows.set(b.id, { li, btn });
  checkClips();
  return li;
}
/** copy an attribute from `from` onto `to`: written only when it differs, removed when `from` has none */
function mirror(to: Element, from: Element, names: readonly string[]): void {
  for (const n of names) {
    const v = from.getAttribute(n);
    if (v === null) { if (to.hasAttribute(n)) to.removeAttribute(n); } else if (to.getAttribute(n) !== v) to.setAttribute(n, v);
  }
}
const ROW_ATTRS = ['aria-label', 'aria-describedby', 'data-tip', 'data-tip-pos', 'data-tip-state', 'data-tip-tone'] as const;
/** a row's text and state word follow `next`'s, and its attributes; its lead (the orb) is not touched */
function patchRow(btn: HTMLElement, nextBtn: HTMLElement): void {
  mirror(btn, nextBtn, ROW_ATTRS);
  /* the title, the role and the state word are written into the nodes they are in: no element is swapped, so nothing moves */
  for (const sel of ['.ui-row__title', '.ui-row__sub']) {
    const at = btn.querySelector(sel), to = nextBtn.querySelector(sel);
    if (at && to) { if (at.innerHTML !== to.innerHTML) at.innerHTML = to.innerHTML; } else if (at) at.remove(); else if (to) btn.querySelector('.ui-row__text')?.append(' ', to);
  }
  const end = btn.querySelector('.ui-row__end'), nextEnd = nextBtn.querySelector('.ui-row__end');
  if (end && nextEnd) { if (end.innerHTML !== nextEnd.innerHTML) end.innerHTML = nextEnd.innerHTML; mirror(end, nextEnd, ['data-tone']); }
  else if (end) end.remove();
  else if (nextEnd) btn.append(' ', nextEnd);
}
/** a row follows its bot in place. The `<li>`, the button and the live orb stay the same nodes, so the orb is never taken out of
    the page and put back (a canvas that is detached and attached again is painted empty until its worker draws once more:
    the sidebar's orbs blinked whenever a bot changed state). Only the text, the state word and the attributes are written. */
export function updateRow(id: string): void {
  const b = bot(id), r = S.rows.get(id); if (!b || !r) return;
  const next = frag(rowHTML(b)), nextBtn = $('.ui-row', next);
  const btn = r.btn;
  patchRow(btn, nextBtn);
  /* the orb: its wrapper's size and flag, its size and its state (a hovered orb takes the state when the pointer leaves) */
  const oldWrap = btn.querySelector<HTMLElement>('.ui-orb'), newWrap = nextBtn.querySelector<HTMLElement>('.ui-orb');
  const orb = btn.querySelector<HTMLElement>('orb-avatar'), nextOrb = nextBtn.querySelector<HTMLElement>('orb-avatar');
  if (oldWrap && newWrap && orb && nextOrb) {
    const style = newWrap.getAttribute('style') ?? '';
    if (oldWrap.getAttribute('style') !== style) oldWrap.setAttribute('style', style);
    mirror(oldWrap, newWrap, ['data-size']);
    const flag = oldWrap.querySelector('.ui-dot--flag'), nextFlag = newWrap.querySelector('.ui-dot--flag');
    if (nextFlag && !flag) oldWrap.append(nextFlag); else if (flag && !nextFlag) flag.remove();
    mirror(orb, nextOrb, ['size']);
    paintLook(orb, lookOf(b));   /* the live orb stays, but it wears the bot's look now, not the one it was drawn in */
    setReact(orb, ui.botState(b).reaction);
  }
  checkClips();
}
export function showDraftRow(on: boolean): void {
  if (!S.rowsEl) return;
  if (!on) { if (S.draftRow) { S.draftRow.li.remove(); S.draftRow = null; syncRoving(); } return; }
  const d = S.draft ?? { color: DRAFT_COLOR, shape: 'circle', name: '', role: '', tab: 'colour' };
  if (!S.draftRow) {
    const li = frag(ui.html.row({ title: 'New bot', sub: 'Draft', value: '__draft', current: true, class: 'bt-row--draft', lead: orbHTML({ ...d, name: 'New bot' }, railOn() ? 24 : 20), attrs: { 'data-tip-pos': 'right' } }));
    livenIn(li);
    S.rowsEl.prepend(li);
    S.draftRow = { li, o: $('orb-avatar', li), name: $('.ui-row__title', li), btn: $('.ui-row', li) };
  }
  paintDraftRow(); syncRoving();
}
export function paintDraftRow(): void {
  const r = S.draftRow, d = S.draft; if (!r || !d) return;
  paintOrb(r.o, d);
  const n = d.name.trim() || 'New bot';
  r.name.textContent = n;
  r.btn.setAttribute('aria-label', n + ', draft');
  if (railOn()) { r.btn.setAttribute('data-tip', n); r.btn.removeAttribute('data-tip-auto'); } else { r.btn.removeAttribute('data-tip'); r.btn.removeAttribute('data-tip-auto'); checkClips(); }
}
export function markSelected(): void {
  for (const [id, r] of S.rows) {
    const on = S.view === 'bot' && id === S.sel;
    if (on) r.btn.setAttribute('aria-current', 'true'); else r.btn.removeAttribute('aria-current');
  }
  for (const [id, r] of S.groupRows) {
    const on = S.view === 'group' && id === S.groupSel;
    if (on) r.btn.setAttribute('aria-current', 'true'); else r.btn.removeAttribute('aria-current');
  }
  S.groupsEl?.querySelector('[data-new-group]')?.toggleAttribute('aria-current', S.view === 'new-group');
  showDraftRow(S.view === 'new');
  syncRoving();
}
/** one tab stop per list: the current row */
export function syncRoving(): void {
  if (!S.rowsEl) return;
  const rows = [...S.rowsEl.querySelectorAll<HTMLElement>('.ui-row')];
  const cur = rows.find((r) => r.getAttribute('aria-current')) ?? rows[0];
  /* KEYMAP section 3: the list region's default target is the current row */
  rows.forEach((r) => { if (r === cur) r.setAttribute('data-hx-focus', 'list'); else r.removeAttribute('data-hx-focus'); });
  if (rows.some((r) => r === document.activeElement)) return;
  rows.forEach((r) => { r.tabIndex = r === cur ? 0 : -1; });
}
export function syncListVisibility(): void {
  if (!S.listWrap || !S.listRoot || S.listRoot.id === 'hx-list-bots') return;
  S.listWrap.hidden = !!(state.tab && state.tab !== 'bots');
}
/** rail: orbs 24 centred in 40px rows, names and states in tooltips */
let lastRail: boolean | null = null;
export function syncRail(): void {
  if (!S.listWrap) return;
  const rail = railOn();
  S.listWrap.classList.toggle('is-rail', rail);
  if (rail === lastRail) return;
  lastRail = rail;
  for (const id of S.rows.keys()) updateRow(id);
  drawGroups();   /* a group's stack has a size and a length of its own in the rail */
  if (S.draftRow) { S.draftRow.o.setAttribute('size', rail ? '24' : '20'); const w = S.draftRow.o.closest<HTMLElement>('.ui-orb'); w?.style.setProperty('--o', rail ? '24' : '20'); paintDraftRow(); }
}

/* ───────── the Archived group (owner decision, 19 November 2026) ─────────
   Under the roster, collapsed until the user opens it and kept as they left it (`hx.v6.bots`). Each archived bot shows its name,
   when it was archived and Restore, as an archived session does (DESIGN-SYSTEM 14.4: a quiet struck-through title, the action in
   place of the meta on hover and focus). Restore is the provider's: a name that is in use again is refused and the row stays. */
let archivedOpen = false;
const pending = new Set<string>();
function archivedRow(a: ArchivedBot): string {
  const name = a.was || a.name, sub = archivedWhen(a.when);
  return ui.html.row({
    title: name, sub, archived: true, value: a.id,
    acts: ui.html.iconButton({ icon: 'unarchive', label: 'Restore ' + name, size: 's', attrs: { 'data-act': 'restore', 'data-id': a.id } }),
    attrs: { 'data-id': a.id, 'data-archived-bot': '', 'aria-label': name + ', ' + sub.toLowerCase() }
  });
}
export function drawArchived(): void {
  const host = S.archivedEl; if (!host) return;
  const list = data().bots.archived.get(), glist = data().groups.archived.get();
  host.replaceChildren();
  host.hidden = !list.length && !glist.length;
  if (host.hidden) return;
  const total = list.length + glist.length;
  const group = ui.group({ label: 'Archived (' + total + ')', collapsible: true, expanded: archivedOpen, id: 'bt-archived', rows: list.map(archivedRow).join('') + glist.map(archivedGroupRow).join('') });
  host.append(group);
  checkClips();
}
function mountArchived(host: HTMLElement): void {
  host.addEventListener('ui:change', (e) => {
    if (!(e.target as Element).closest('.ui-group__head')) return;
    archivedOpen = !!(e as CustomEvent<{ value: boolean }>).detail.value;
    saveBots({ archivedOpen });
  });
  host.addEventListener('click', (e) => {
    const g = (e.target as Element).closest<HTMLElement>('[data-act="restore-group"]');
    if (g?.dataset['id']) { const gid = g.dataset['id']; data().groups.restore(gid).then(() => { ui.toast('Restored a group'); openGroup(gid); }).catch((err: unknown) => { ui.toast('Could not restore it: ' + (err instanceof Error ? err.message : String(err))); }); return; }
    const b = (e.target as Element).closest<HTMLElement>('[data-act="restore"]');
    const id = b?.dataset['id'];
    if (b && id) void restoreArchivedBot(id, b);
  });
  host.addEventListener('keydown', listKeys);
  S.offArchived = data().bots.archived.subscribe(drawArchived);
  drawArchived();
}
/** asks the provider, says what happened, and puts focus on the bot that came back; a refusal leaves everything where it was */
async function restoreArchivedBot(id: string, button: HTMLElement): Promise<void> {
  if (pending.has(id)) return;
  pending.add(id);
  button.setAttribute('aria-disabled', 'true');
  try {
    const r = await restoreBot(data().bots, id);
    ui.toast(restoredWords(r));
    if (r.ok) S.rows.get(r.name)?.btn.focus({ preventScroll: true });
  } finally { pending.delete(id); button.removeAttribute('aria-disabled'); }
}

/* ───────── the Groups under the roster (team chat) ─────────
   A row for each group (its members as stacked orbs, its name, who is in it) and, last, "New group" beside the roster's own
   "New bot". The block follows the groups in place (`drawGroups`), so a live update never blanks a stack's orbs. */
function groupRow(g: Group): string {
  const busy = g.busy;
  return ui.html.row({
    title: g.name, sub: namesOf(g.members), value: g.id, lead: stackOf(g.members, railOn() ? 'rail' : 'row', true),
    end: busy ? ui.html.dot('run') : '', current: S.view === 'group' && g.id === S.groupSel,
    attrs: { 'aria-label': g.name + ', ' + namesOf(g.members) + (busy ? ', replying' : ''), 'data-gid': g.id, 'data-tip': railOn() ? g.name : null, 'data-tip-pos': 'right' }
  });
}
/** the stack of orbs a group row wears: it is drawn again only when who is in it (or its size) changes */
const stackSig = (g: Group): string => g.members.map((m) => m.profile).filter((id) => bot(id)).join() + '@' + (railOn() ? 20 : 16);
function groupsSkeleton(host: HTMLElement): HTMLElement {
  const ul = el('ul', { class: 'ui-rows bt-group-rows', 'data-ui': 'rows', 'aria-label': 'Groups' });
  host.append(el('h2', { class: 'ui-group__head bt-groups-h', text: 'Groups' }), ul);
  ui.hydrate(ul);
  ul.addEventListener('keydown', listKeys);
  ul.addEventListener('ui:select', (e) => {
    const id = (e as CustomEvent<{ value?: string }>).detail.value;
    e.preventDefault();
    if (id === '__new-group') { openNewGroup(); return; }
    if (id && group(id)) openGroup(id);
  });
  return ul;
}
const newGroupRow = (lead: string): string => ui.html.row({ title: 'New group', sub: 'Bots talking together', value: '__new-group', lead, attrs: { 'data-new-group': '', 'data-tip': railOn() ? 'New group' : null, 'data-tip-pos': 'right', 'aria-label': 'New group, bots talking together' } });
/** the block follows the groups in place: a row whose members did not change keeps its orbs (a group that starts or stops
    replying must not blank every group's orbs), a new group adds a row, an archived one removes its own */
export function drawGroups(): void {
  const host = S.groupsEl; if (!host) return;
  const active = document.activeElement as HTMLElement | null;
  const focusId = active?.closest<HTMLElement>('[data-gid],[data-new-group]')?.dataset['gid'] ?? (active?.closest('[data-new-group]') ? '__new' : null);
  const ul = host.querySelector<HTMLElement>('.bt-group-rows') ?? groupsSkeleton(host);
  const want: HTMLElement[] = [], keep = new Set<string>();
  for (const g of S.groups) {
    keep.add(g.id);
    const li = frag(groupRow(g)), btn = $('.ui-row', li), sig = stackSig(g), had = S.groupRows.get(g.id);
    if (had && had.li.dataset['stack'] === sig && had.li.isConnected) { patchRow(had.btn, btn); want.push(had.li); continue; }
    had?.li.remove();
    li.dataset['stack'] = sig;
    S.groupRows.set(g.id, { li, btn });
    want.push(li);
  }
  for (const id of [...S.groupRows.keys()]) if (!keep.has(id)) { S.groupRows.get(id)?.li.remove(); S.groupRows.delete(id); }
  const addBtn = ul.querySelector<HTMLElement>('[data-new-group]');
  if (addBtn) { mirror(addBtn, $('.ui-row', frag(newGroupRow(''))), ['data-tip', 'data-tip-pos']); want.push(addBtn.closest('li') as HTMLElement); }
  else {
    const nl = frag(newGroupRow('<span class="bt-group-add">' + ui.icon('plus') + '</span>'));
    nl.querySelector('.ui-row')?.setAttribute('data-new-group', '');
    want.push(nl);
  }
  /* put the rows in order, moving only a row that is out of place */
  want.forEach((li, i) => { if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] ?? null); });
  markSelected();
  checkClips();
  if (focusId) (focusId === '__new' ? host.querySelector<HTMLElement>('[data-new-group]') : host.querySelector<HTMLElement>('[data-gid="' + focusId + '"]'))?.focus({ preventScroll: true });
}
function mountGroups(host: HTMLElement): void {
  void host;
  drawGroups();
  S.offGroupsArchived = data().groups.archived.subscribe(drawArchived);
}
function archivedGroupRow(a: ArchivedGroup): string {
  return ui.html.row({
    title: a.name, sub: 'Group · ' + namesOf(a.members), archived: true, value: a.id,
    acts: ui.html.iconButton({ icon: 'unarchive', label: 'Restore ' + a.name, size: 's', attrs: { 'data-act': 'restore-group', 'data-id': a.id } }),
    attrs: { 'data-id': a.id, 'data-archived-group': '', 'aria-label': a.name + ', archived group' }
  });
}
