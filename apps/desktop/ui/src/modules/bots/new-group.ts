/* Making a group, and changing the members of one: a name, and the bots that are in it (two to six). A room's members are
   fixed when it is made (the engine's rule), so changing them makes a new room with the same name and archives the old one;
   the form says so before it does. On the kit (the repass's step 2a): the kit's Dialog in its form shape, drawn in the view in place of
   the room, with the kit's Field for the name and the bots as the kit's OptionRows that check (each led by its orb at 20, its name and
   its role: O-B06's team plan, the nearest drawn state, rule 6), and Create as its Button. */
import { emit } from '../../core/bus';
import { el, esc, frag } from '../../core/dom';
import { setState, state } from '../../core/state';
import { kit } from '@boopis/ui';
import { data } from '../../data';
import { bot, group, initGroups, S } from './model';
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
  const why = src.note();
  const enough = S.bots.length >= min;

  const lead = old
    ? 'The members of a group are fixed when it is made, so this makes a new group called ' + old.name + ' with the bots you pick and archives this one. Its messages stay in Archived.'
    : 'A group is a conversation among ' + min + ' to ' + max + ' of your bots and you. ' + src.nature;
  const rows = S.bots.map((b) => kit.html.optionRow({ label: b.name, meaning: b.role || ' ', check: true, value: b.id, leadHTML: kit.html.avatar({ bot: b, size: 20, still: true }), attrs: { role: 'menuitemcheckbox', tabindex: '0', 'data-member': b.id, 'aria-label': b.name } }));
  const members = enough
    ? '<div class="bt-members" role="group" aria-label="Members">' + rows.join('') + '</div><p class="k7-pane__note bt-count" role="status" aria-live="polite"></p>'
    : kit.html.emptyState({ text: 'Make another bot first: a group needs two.' });
  const dlg = kit.wire(frag(kit.html.dialog({
    title: old ? 'Members of ' + old.name : 'New group', scrim: false, id: 'bt-new-group-dialog',
    body: '<p class="k7-pane__note">' + esc(lead) + '</p>' +
      kit.html.field({ id: 'bt-group-name', label: 'Name', placeholder: 'Name the group', value: old?.name ?? '', disabled: !!old, attrs: { maxlength: '200', autocomplete: 'off', spellcheck: 'false', 'data-group-name': '' } }) +
      members + (why ? '<p class="k7-pane__note" role="note">' + esc(why) + '</p>' : '') + '<p class="k7-pane__note bt-sheet__error" role="alert" data-group-error hidden></p>',
    actions: [{ label: old ? 'Make the new group' : 'Create group', variant: 'primary' }],
    attrs: { 'aria-modal': null, 'data-new-group': '' }
  })));
  const nameIn = dlg.querySelector<HTMLInputElement>('[data-group-name]') as HTMLInputElement;
  const count = dlg.querySelector<HTMLElement>('.bt-count');
  const err = dlg.querySelector<HTMLElement>('[data-group-error]') as HTMLElement;
  const go = dlg.querySelector<HTMLButtonElement>('.k7-dialog__foot .k7-btn') as HTMLButtonElement;
  go.setAttribute('data-go', '');
  dlg.querySelector('[data-dialog-close]')?.addEventListener('click', () => { leave(editId); });

  const paint = (): void => {
    const n = picked.size;
    if (count) count.textContent = n < min ? 'Pick ' + (min - n === 1 && n ? 'one more' : min + ' or more') + '. ' + n + ' of ' + max + '.' : n + ' of ' + max + (n === max ? ', the most a group holds.' : '.');
    go.disabled = n < min || n > max || !!why || !enough;
    for (const r of dlg.querySelectorAll<HTMLElement>('[data-member]')) {
      const on = picked.has(r.dataset['member'] ?? '');
      r.setAttribute('aria-checked', String(on));
      if (!on && picked.size >= max) r.setAttribute('aria-disabled', 'true'); else r.removeAttribute('aria-disabled');
    }
  };
  dlg.addEventListener('click', (e) => {
    const r = (e.target as Element).closest<HTMLElement>('[data-member]'); if (!r) return;
    const id = r.dataset['member'] ?? '';
    if (picked.has(id)) picked.delete(id);
    else if (picked.size < max) picked.add(id);
    paint();
  });
  /* the arrows move between the bots (each is its own tab stop too: several can be checked) */
  dlg.querySelector('.bt-members')?.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent, list = [...dlg.querySelectorAll<HTMLElement>('[data-member]')], i = list.indexOf(document.activeElement as HTMLElement);
    const n = ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 } as Record<string, number>)[ke.key];
    if (i < 0 || n == null) return;
    ke.preventDefault(); list[(n + list.length) % list.length]?.focus();
  });
  go.addEventListener('click', () => {
    go.disabled = true; err.hidden = true;
    const bots = [...picked];
    const done = old ? src.setMembers(old.id, bots) : src.create({ name: nameIn.value, bots });
    done.then((g) => { openGroup(g.id); })
      .catch((e: unknown) => { err.textContent = 'It was not made: ' + sentence(e); err.hidden = false; paint(); });
  });
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); go.click(); } });
  pane.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); leave(editId); } });

  pane.append(el('div', { class: 'bt-new-scroll ui-scroll' }, el('div', { class: 'bt-new-col' }, dlg)));
  paint();
  if (!old) setTimeout(() => nameIn.focus({ preventScroll: true }), 60);
  void bot;
}
