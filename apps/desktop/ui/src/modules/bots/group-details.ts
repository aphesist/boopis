/* A room's details pane. No board draws one (an owner question): it follows a bot's (board 11: the kit's Pane, its head, sections of
   pane cards) and holds what the v6 room kept in its header, so nothing a room could do is lost: its members (each row opens that
   bot's chat), and under "Room" its name (a field: Enter or leaving it renames), who is in it (Change opens the members form:
   a different set is a new room), the most rounds a run may take, its kanban board in the thread's place, and Archive. */
import { emit } from '../../core/bus';
import { esc } from '../../core/dom';
import { kit, ui } from '@boopis/ui';
import type { BotLike } from '@boopis/ui';
import { data } from '../../data';
import type { Group } from '../../data';
import { bot, group, S } from './model';
import { archiveGroup, boardShown, memberBot, openRoundLimit, renameGroup, showBoard } from './group-room';
import { openNewGroup } from './new-group';
import { limitWords } from './run-limit';

/** the room's limit as last read (the provider keeps it; the pane asks once per room and after a change) */
const LIMIT = new Map<string, string>();
function readLimit(g: Group, then: () => void): void {
  if (LIMIT.has(g.id)) return;
  LIMIT.set(g.id, '');
  data().groups.roundLimit(g.id).then((cur) => { LIMIT.set(g.id, limitWords(cur.rounds, cur.fallback)); then(); }).catch(() => { LIMIT.delete(g.id); });
}
export const forgetLimit = (id: string): void => { LIMIT.delete(id); };

export function roomPaneHTML(g: Group, repaint: () => void): string {
  readLimit(g, repaint);
  const members = g.members.map((m): BotLike => memberBot(m));
  const rows = g.members.map((m) => {
    const b = bot(m.profile);
    return { label: m.name, labelHTML: ui.html.orb({ ...memberBot(m), state: 'idle', attention: null }, { size: 16, still: true }) + ' ' + esc(m.name), ...(b?.role ? { value: b.role } : {}), ...(b ? { action: 'opens its chat', attrs: { 'data-member': b.id } } : {}) };
  });
  const limit = LIMIT.get(g.id);
  const room = [
    { label: 'Name', control: kit.html.field({ id: 'bt-room-name', value: g.name, ariaLabel: 'Group name', attrs: { maxlength: '200', autocomplete: 'off', spellcheck: 'false', 'data-room': 'name' } }) },
    { label: 'Members', value: String(g.members.length), action: 'changes who is in it', attrs: { 'data-room': 'members' } },
    { label: 'Run limit', ...(limit ? { value: limit } : {}), action: 'sets the most rounds a run may take', attrs: { 'data-room': 'limit', 'aria-haspopup': 'menu' } },
    { label: 'Board', value: boardShown() ? 'Back to the thread' : 'Open', action: boardShown() ? 'gives the thread back' : 'shows its kanban board in the thread\'s place', attrs: { 'data-room': 'board', 'aria-pressed': String(boardShown()) } },
    { label: 'Archive', action: 'puts the room away', attrs: { 'data-room': 'archive' } }
  ];
  const body = '<h3 class="k7-pane__sec">Members</h3>' + kit.html.card({ variant: 'pane', rows }) + '<h3 class="k7-pane__sec">Room</h3>' + kit.html.card({ variant: 'pane', rows: room });
  return kit.html.pane({ variant: 'details', members, title: g.name, body, label: g.name + ', details' });
}
/** what the pane's key says of the room: drawn again when any of it changes */
export const roomPaneSig = (g: Group): string => ['room', g.id, g.name, g.members.map((m) => m.profile + (bot(m.profile)?.color ?? '') + (bot(m.profile)?.role ?? '')).join(), LIMIT.get(g.id) ?? '', boardShown()].join('\u0000');

export function onRoomPaneClick(e: Event, repaint: () => void): void {
  const g = group(S.groupSel), t = e.target as Element; if (!g) return;
  const member = t.closest<HTMLElement>('[data-member]');
  if (member) { emit('hx:bot-select', { id: member.dataset['member'] as string, from: 'group' }); return; }
  const row = t.closest<HTMLElement>('[data-room]'); if (!row) return;
  switch (row.dataset['room']) {
    case 'members': openNewGroup({ edit: g.id }); break;
    case 'limit': LIMIT.delete(g.id); openRoundLimit(g, row); break;
    case 'board': showBoard(!boardShown(), g); repaint(); break;
    case 'archive': archiveGroup(g); break;
    default: break;
  }
}
/** the name field: Enter or leaving it renames; Esc puts the name back */
export function onRoomPaneKey(e: KeyboardEvent): void {
  const input = (e.target as Element).closest<HTMLInputElement>('input[data-room="name"]'), g = group(S.groupSel);
  if (!input || !g) return;
  if (e.key === 'Enter') { e.preventDefault(); renameGroup(g, input.value); input.blur(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.value = g.name; input.blur(); }
}
export function onRoomPaneBlur(e: Event): void {
  const input = (e.target as Element).closest<HTMLInputElement>('input[data-room="name"]'), g = group(S.groupSel);
  if (input && g && input.value.trim() && input.value.trim() !== g.name) renameGroup(g, input.value);
}
