/* Making a group, and changing the members of one: a name, and the bots that are in it (two to six). A room's members are
   fixed when it is made (the engine's rule), so changing them makes a new room with the same name and archives the old one;
   the form says so before it does. The bots are chosen with checkbox buttons that show each bot's orb. */
import { emit } from '../../core/bus';
import { el } from '../../core/dom';
import { setState, state } from '../../core/state';
import { ui } from '@boopis/ui';
import { data } from '../../data';
import { bot, group, initGroups, S } from './model';
import { orbEl } from './orbs';
import { markSelected } from './list';
import { closeSettings } from './settings';
import { openGroup } from './group-room';
import { openBot } from './room';

const sentence = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function mountNewGroupPane(root: HTMLElement): HTMLElement {
  const pane = el('section', { class: 'bt-new', 'aria-label': 'New group', hidden: true });
  root.append(pane);
  S.newGroupPane = pane;
  return pane;
}

/** `edit`: the id of a group whose members are being changed */
export function openNewGroup(opts: { edit?: string } = {}): void {
  initGroups();
  S.view = 'new-group';
  if (state.tab !== 'bots') setState({ tab: 'bots' });
  if (!S.room || !S.newGroupPane) { markSelected(); return; }
  closeSettings(true);
  S.room.hidden = true;
  if (S.newPane) S.newPane.hidden = true;
  if (S.groupPane) S.groupPane.hidden = true;
  S.newGroupPane.hidden = false;
  const editing = opts.edit ? group(opts.edit) : undefined;
  build(editing?.id ?? null);
  markSelected();
  emit('hx:title', { tab: 'bots', title: editing ? 'Members of ' + editing.name : 'New group' });
}

function leave(editId: string | null): void {
  if (editId && group(editId)) { openGroup(editId); return; }
  if (S.groupSel && group(S.groupSel)) { openGroup(S.groupSel); return; }
  if (S.bots.length) openBot(S.sel);
}

function build(editId: string | null): void {
  const pane = S.newGroupPane as HTMLElement; pane.textContent = '';
  const src = data().groups;
  const old = editId ? group(editId) : undefined;
  const picked = new Set<string>(old ? old.members.map((m) => m.profile) : []);
  const { min, max } = src.limits;

  const title = el('h1', { class: 'bt-p-name', text: old ? 'Members of ' + old.name : 'New group' });
  const lead = el('p', { class: 'bt-confirm-line', text: old
    ? 'The members of a group are fixed when it is made, so this makes a new group called ' + old.name + ' with the bots you pick and archives this one. Its messages stay in Archived.'
    : 'A group is a conversation among ' + min + ' to ' + max + ' of your bots and you. ' + src.nature });
  const nameIn = el('input', { class: 'bt-name', type: 'text', maxlength: '200', placeholder: 'Name the group', 'aria-label': 'Group name', autocomplete: 'off', spellcheck: 'false', value: old?.name ?? '' });
  const nameRow = el('div', { class: 'bt-name-row' }, nameIn);
  if (old) nameIn.disabled = true;

  const list = el('div', { class: 'bt-members', role: 'group', 'aria-label': 'Members' });
  const count = el('p', { class: 'bt-name-note', role: 'status', 'aria-live': 'polite' });
  const err = el('p', { class: 'bt-confirm-err', role: 'alert' });
  const go = ui.button({ label: old ? 'Make the new group' : 'Create group', variant: 'primary', disabled: true });
  go.classList.add('bt-go');
  const why = src.note();
  const cancel = ui.iconButton({ icon: 'close', label: 'Close', keys: 'esc' });
  cancel.classList.add('bt-new-close');
  cancel.addEventListener('click', () => { leave(editId); });

  const paint = (): void => {
    const n = picked.size;
    count.textContent = n < min ? 'Pick ' + (min - n === 1 && n ? 'one more' : min + ' or more') + '. ' + n + ' of ' + max + '.' : n + ' of ' + max + (n === max ? ', the most a group holds.' : '.');
    go.disabled = n < min || n > max || !!why;
    for (const b of list.querySelectorAll<HTMLElement>('.bt-member')) {
      const on = picked.has(b.dataset['id'] ?? '');
      b.setAttribute('aria-checked', String(on));
      if (!on && picked.size >= max) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    }
  };
  for (const b of S.bots) {
    const btn = el('button', { class: 'bt-member', type: 'button', role: 'checkbox', 'aria-checked': 'false', 'data-id': b.id, 'aria-label': b.name }, [
      orbEl(b, 28), el('span', { class: 'bt-sugg-text' }, [el('span', { class: 'bt-sugg-name', text: b.name }), el('span', { class: 'bt-sugg-desc', text: b.role })])
    ]);
    btn.addEventListener('click', () => {
      if (picked.has(b.id)) picked.delete(b.id);
      else if (picked.size < max) picked.add(b.id);
      paint();
    });
    list.append(btn);
  }
  if (S.bots.length < min) list.replaceWith(ui.empty({ title: 'A group needs two bots', text: 'Make another bot first, then bring them together here.' }));

  go.addEventListener('click', () => {
    go.disabled = true; err.textContent = '';
    const bots = [...picked];
    const done = old ? src.setMembers(old.id, bots) : src.create({ name: nameIn.value, bots });
    done.then((g) => { openGroup(g.id); })
      .catch((e: unknown) => { err.textContent = 'It was not made: ' + sentence(e); paint(); });
  });
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); go.click(); } });
  pane.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); leave(editId); } });

  const col = el('div', { class: 'bt-new-col' }, [cancel, title, lead, nameRow, list, count, why ? el('p', { class: 'bt-confirm-line bt-confirm-note', role: 'note', text: why }) : null, err, el('div', { class: 'bt-go-row' }, go)]);
  pane.append(el('div', { class: 'bt-new-scroll ui-scroll' }, col));
  paint();
  if (!old) setTimeout(() => nameIn.focus({ preventScroll: true }), 60);
  void bot;
}
