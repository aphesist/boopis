/* A group's room: the header (its members as stacked orbs, its name, rename, members, archive), the one thread the user and the
   members write in (each message by the one who wrote it: its orb and name in the entry's origin slot), who is replying now,
   and the library's composer with a chip for each member to address with `@name`. Everything that changes comes from the
   provider's events; everything the user does is a provider command. What a group is in this build (who answers, what the
   members see of each other) is the provider's `nature`, said in the room and never made up here. */
import { emit } from '../../core/bus';
import { $, el, esc, frag, reduced } from '../../core/dom';
import { setState, state } from '../../core/state';
import { ui } from '@boopis/ui';
import type { BotLike } from '@boopis/ui';
import { data } from '../../data';
import type { Group, GroupMember, GroupMessage, GroupsEvent } from '../../data';
import { lookFor } from '../../data/looks';
import { namesText, originVisual } from '../cards/parts';
import { bot, group, groupThread, initGroups, S } from './model';
import { livenIn, orbHTML } from './orbs';
import { markSelected, drawGroups } from './list';
import { checkClips } from './clips';
import { closeSettings } from './settings';
import { openNewGroup } from './new-group';

const groups = () => data().groups;
const toast = (t: string, o?: Parameters<typeof ui.toast>[1]): void => { ui.toast(t, o); };
const NODE = new Map<string, HTMLElement>();
const sentence = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** a member as an orb draws it: the bot it is when the user has it, else the look its name gives */
export const memberBot = (m: GroupMember): BotLike => bot(m.profile) ?? { id: m.profile, name: m.name, ...lookFor(m.name), state: 'idle' };
/** stacked orbs for several, the one orb for one (the origin slot, FORMS.md section 4a) */
export function stackOf(members: readonly GroupMember[], size: number, still?: boolean): string {
  const ids = members.map((m) => m.profile).filter((id) => bot(id));
  return ids.length ? originVisual({ kind: 'teammate', ids, via: null }, size, 4, still) : '';
}
export const namesOf = (members: readonly GroupMember[]): string => namesText(members.map((m) => m.name));
const quietName = (g: Group, id: string): GroupMember | undefined => g.members.find((m) => m.id === id);

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
  zone.append(working);
  pane.append(scroll, zone);
  root.append(pane);
  S.groupPane = pane;
  G.scroll = scroll; G.head = head; G.log = log; G.zone = zone; G.working = working;
  const c = ui.composer({ placeholder: 'Message the group', label: 'Message the group', attach: false });
  c.classList.add('bt-composer');
  zone.append(c);
  c.input.setAttribute('data-hx-focus', 'composer');
  c.addEventListener('ui:send', (e) => { send((e as CustomEvent<{ text: string }>).detail.text); });
  c.addEventListener('ui:stop', () => { stopTalk(); });
  G.composer = c;
  const measure = (): void => { S.viewRoot?.style.setProperty('--bt-composer-h', zone.offsetHeight + 'px'); };
  new ResizeObserver(measure).observe(zone);
  return pane;
}
const G = { scroll: null as HTMLElement | null, head: null as HTMLElement | null, log: null as HTMLElement | null, zone: null as HTMLElement | null, working: null as HTMLElement | null, composer: null as import('../../components').ComposerEl | null, renaming: false };

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
  paintWorking(g);
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
  h.append(el('div', { class: 'bt-p-orb', html: stackOf(g.members, 32) }), el('div', { class: 'bt-p-text' }, [name, line]), acts);
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

/* ───────── thread ───────── */
const paras = (t: string): string => '<div class="ui-prose">' + String(t || '').split(/\n{2,}/).map((p) => '<p>' + ui.html.inline(p) + '</p>').join('') + '</div>';
function renderLog(g: Group): void {
  const log = G.log as HTMLElement; log.textContent = '';
  NODE.clear();
  const msgs = groupThread(g.id);
  if (!msgs.length) {
    const e = ui.empty({ title: 'Nothing here yet', text: groups().nature });
    e.classList.add('bt-empty');
    log.append(e);
  } else {
    let prev: GroupMessage | null = null, entry: HTMLElement | null = null;
    for (const m of msgs) { entry = renderMsg(g, m, prev, entry); prev = m; }
  }
  requestAnimationFrame(() => { if (G.scroll) G.scroll.scrollTop = G.scroll.scrollHeight; });
}
function renderMsg(g: Group, m: GroupMessage, prev: GroupMessage | null, prevEntry: HTMLElement | null): HTMLElement | null {
  const log = G.log as HTMLElement;
  if (m.kind === 'note') {
    const p = el('p', { class: 'bt-note', role: 'status', text: m.text });
    if (m.more) { const more = m.more; const b = ui.button({ label: 'Let them continue', size: 's' }); b.addEventListener('click', () => { b.disabled = true; groups().continueTalk(g.id, more).catch((e: unknown) => { b.disabled = false; toast('It could not go on: ' + sentence(e)); }); }); p.append(' ', b); }
    NODE.set(m.id, p);
    log.append(p);
    return null;
  }
  const node = m.who === 'you' ? frag(ui.html.request(m.text)) : frag(paras(m.text));
  NODE.set(m.id, node);
  if (prev && prev.kind === 'text' && prev.who === m.who && prevEntry && prevEntry.isConnected) { $('.ui-entry__body', prevEntry).append(node); return prevEntry; }
  const you = m.who === 'you', member = you ? undefined : quietName(g, m.who);
  const who = member ? orbHTML(memberBot(member), 20, { state: 'idle' }) + '<span class="bt-who-name">' + esc(member.name) + '</span>' : esc(you ? 'You' : m.who);
  const entry = frag(ui.html.entry({ kind: you ? 'user' : 'bot', who: you ? esc('You') : who, callno: m.t ? [m.t] : [], label: (you ? 'You' : (member?.name ?? m.who)) + (m.t ? ', ' + m.t : '') }));
  $('.ui-entry__body', entry).append(node);
  entry.setAttribute('data-hx-turn', ''); entry.tabIndex = -1;
  livenIn(entry);
  log.append(entry);
  checkClips();
  return entry;
}
function appendMsg(g: Group, m: GroupMessage): void {
  const list = groupThread(g.id), prev = list[list.length - 1] ?? null;
  if (list.some((x) => x.id === m.id)) return;
  list.push(m);
  if (g.id !== S.groupSel || S.view !== 'group') return;
  const log = G.log as HTMLElement;
  log.querySelector('.bt-empty')?.remove();
  const last = log.lastElementChild && log.lastElementChild.matches('[data-hx-turn]') ? (log.lastElementChild as HTMLElement) : null;
  renderMsg(g, m, prev, last);
  const node = NODE.get(m.id);
  if (!reduced() && node) node.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  G.scroll?.scrollTo({ top: G.scroll.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
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
  c.setRunning(g.working.length > 0);
}
function paintWorking(g: Group): void {
  const w = G.working as HTMLElement;
  const why = groups().note();
  const busy = g.members.filter((m) => g.working.includes(m.id));
  w.textContent = '';
  if (why) { w.className = 'bt-working bt-working--note'; w.textContent = why; return; }
  w.className = 'bt-working';
  if (!busy.length) return;
  w.insertAdjacentHTML('beforeend', '<span class="bt-working-orbs" aria-hidden="true">' + stackOf(busy, 16, true) + '</span>');
  w.append(el('span', { text: namesOf(busy) + (busy.length === 1 ? ' is replying' : ' are replying') }));
  livenIn(w);
}
function send(text: string): void {
  const g = group(S.groupSel); if (!g || !text.trim()) return;
  groups().send(g.id, text.trim());
}
export function stopTalk(): boolean {
  const g = group(S.groupSel); if (!g) return false;
  const was = groups().stop(g.id);
  if (was) toast('Stopped ' + g.name);
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
        renderComposer(g); paintWorking(g);
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
