/* sidebar list (KEYMAP section 4). ui.row in a [data-ui="rows"] list (↑ ↓, Home, End from the library; j k and Esc
   here). Enter or a click opens the bot and focus stays in the list. A draft row sits on top, current, while a bot
   is being made. */
import { emit } from '../../core/bus';
import { $, el, frag, reduced } from '../../core/dom';
import { state } from '../../core/state';
import { ui } from '@boopis/ui';
import { data } from '../../data';
import { oc } from '@boopis/ui';
import { DRAFT_COLOR, paintOrb } from './paint';
import { livenIn, orbHTML } from './orbs';
import { bot, initModel, railOn, S } from './model';
import type { ArchivedBot, Bot } from '../../data';
import { loadBots, saveBots } from '../../core/settings';
import { archivedWhen, restoreBot, restoredWords } from '../../data/restore';
import { focusConversation, openBot } from './room';
import { checkClips, watchClips } from './clips';
import { OUTSIDE_SHORT, outsideDescription, outsideRowMark } from './outside';

const LIST_DESC = 'bt-outside-list';

export function mountList(root: HTMLElement): void {
  initModel();
  if (S.listWrap && S.listWrap.parentNode) S.listWrap.remove();
  S.listRoot = root; S.rows.clear(); S.draftRow = null;
  S.offArchived?.(); S.offArchived = null; S.archivedEl = null;
  if (root) root.dataset['rail'] = 'ok';
  const wrap = el('nav', { class: 'bt-list', 'aria-label': 'Bots' });
  const ul = el('ul', { class: 'ui-rows bt-rows', 'data-ui': 'rows' });
  if (data().info.preview.has('bots')) wrap.append(el('p', { class: 'bt-preview', role: 'note', text: 'Preview: sample bots' }));
  for (const b of S.bots) ul.append(makeRow(b));
  const archived = el('div', { class: 'bt-archived' });
  wrap.append(ul, archived, outsideDescription(LIST_DESC));
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
/** rows are re-rendered from the library on change; the live orb is carried over so it never restarts */
export function updateRow(id: string): void {
  const b = bot(id), r = S.rows.get(id); if (!b || !r) return;
  const oldOrb = r.li.querySelector<HTMLElement>('orb-avatar');
  const focused = r.li.contains(document.activeElement);
  const li = frag(rowHTML(b));
  const newWrap = li.querySelector<HTMLElement>('.ui-orb'), oldWrap = r.li.querySelector<HTMLElement>('.ui-orb');
  if (oldOrb && newWrap && oldWrap) {
    const flag = newWrap.querySelector('.ui-dot--flag');
    oldWrap.replaceChildren(oldOrb); if (flag) oldWrap.append(flag);
    oldWrap.setAttribute('style', newWrap.getAttribute('style') ?? '');
    newWrap.replaceWith(oldWrap);
    const orbReaction = ui.botState(b).reaction;
    oldOrb.dataset['base'] = orbReaction;
    if (!(oldOrb as HTMLElement & { _hover?: boolean })._hover && oldOrb.getAttribute('reaction') !== orbReaction) oldOrb.setAttribute('reaction', orbReaction);
    const size = newWrap.querySelector('orb-avatar')?.getAttribute('size') ?? ''; if (oldOrb.getAttribute('size') !== size) oldOrb.setAttribute('size', size);
  } else livenIn(li);
  const btn = $('.ui-row', li);
  btn.tabIndex = r.btn.tabIndex;
  btn.addEventListener('pointerenter', () => { if (!reduced()) oc(btn.querySelector('orb-avatar'), 'blink'); });
  r.li.replaceWith(li);
  S.rows.set(id, { li, btn });
  checkClips();
  if (focused) btn.focus({ preventScroll: true });
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
  const list = data().bots.archived.get();
  host.replaceChildren();
  host.hidden = !list.length;
  if (!list.length) return;
  const group = ui.group({ label: 'Archived (' + list.length + ')', collapsible: true, expanded: archivedOpen, id: 'bt-archived', rows: list.map(archivedRow).join('') });
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
