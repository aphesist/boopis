/* Settings › Bots (named in S39's nav; no board draws its page: derived, the lead's design at the 7a follow-ups). The page manages the
   bots; what one bot may spend and do is set in its own sheet. In order:
   - "Defaults": the one default there is, "Run limit for bots without their own" (the turns `boopis run --bot` lets a task take, the
     host's `default_max_turns`). boopis keeps it and nothing here can change it (the owner: "10 is fine as a default, but it should be
     editable" per bot and per group, which their own menus are), so it is a value. There is no default cap and no default rules: a new
     bot has no cap and follows your rules (the owner: "no limit as a default would be better");
   - "Your bots": each bot's orb at the rail's size, at rest as the rail draws it, its name, and a line of its role and only what differs
     from every bot ("Follows your rules", "2 rules of its own", "$5 cap"); Open goes to its sheet; its menu (the kit's Menu) holds
     Archive (then S33's line with Undo, the archive's own way back) and Delete (the sheet's flow: what goes, Archive instead, a second
     press; `delete-flow.ts`), Delete only where the provider can delete; "New bot" opens the new-bot form;
   - "Archived": each archived bot with Restore and Delete; hidden when none. */
import { kit } from '@boopis/ui';
import { emit } from '../../core/bus';
import { railSizeNow } from '../../core/settings';
import { data, BOOPIS_ID } from '../../data';
import type { ArchivedBot, Bot, BotsAdmin, Rule } from '../../data';
import { later } from '../chat/compose';
import { botStatus } from '../bots/own-rules';
import { deleteFlow } from '../bots/delete-flow';
import { closeDialog, fill, pageEl } from './page';
import type { Page } from './page';
import { actionsHTML, buttonHTML, said, section, sectionOf, valueHTML } from './rows';
import { openBotSheet } from './open-bot';

/** a bot's line under its name: its role, then what differs from every bot's */
export const botLine = (b: Bot, rules: readonly Rule[] | null): string => [b.role, botStatus(b, data().bots.catalog().approvals, rules)].filter(Boolean).join(' · ');

type Change = { what: string; undo: () => Promise<unknown> };

export function botsPage(): Page {
  const { el, body } = pageEl('bots', 'Bots');
  let rules: readonly Rule[] | null = null, fallback: number | null = null, last: Change | null = null, deleting: string | null = null, busy = false;
  const bots = (): Bot[] => data().bots.snapshot().bots.filter((b) => b.id !== BOOPIS_ID);
  const archived = (): readonly ArchivedBot[] => data().bots.archived.get();
  const admin = (): BotsAdmin | undefined => data().bots.admin;

  const read = async (): Promise<void> => {
    const src = data().rules && later('rules-settings') ? data().rules : undefined;
    rules = src ? await src.get().then((v) => v.rules, () => null) : null;
    const first = bots()[0];
    fallback = first ? await data().bots.runLimit(first.id).then((l) => l.fallback, () => null) : null;
  };
  const orb = (b: Bot): string => kit.html.avatar({ bot: b, size: railSizeNow() === 'b' ? 28 : 36, rest: true });
  function draw(): void {
    const list = bots(), gone = archived(), canDelete = !!admin();
    const defaults = list.length && fallback !== null
      ? section('Defaults', [{ label: 'Default run limit', sub: 'Each bot can set its own.', control: valueHTML(fallback + ' turns', { 'data-fallback': '' }) }], { 'data-part': 'defaults' }) : '';
    const yours = list.length
      ? section('Your bots', list.map((b) => ({ label: b.name, sub: botLine(b, rules), leadHTML: orb(b),
        control: actionsHTML(buttonHTML('Open', { attrs: { 'data-bot-open': b.id, 'aria-label': 'Open ' + b.name + '’s settings' } }),
          kit.html.iconButton({ icon: 'more', label: 'More for ' + b.name, variant: 'ghost', attrs: { 'data-bot-menu': b.id, 'aria-haspopup': 'menu' } })),
        attrs: { 'data-bot': b.id } })), { 'data-part': 'bots' })
      : sectionOf('Your bots', kit.html.emptyState({ text: 'No bots yet.' }), { 'data-part': 'bots' });
    const change = last ? kit.html.systemLine({ icon: 'archive', text: last.what, action: 'Undo', attrs: { 'data-last': '' } }) : '';
    const arch = gone.length
      ? section('Archived', gone.map((a) => ({ label: a.was, sub: 'Archived' + (a.when ? ' ' + a.when : ''),
        control: actionsHTML(buttonHTML('Restore', { attrs: { 'data-bot-restore': a.id, 'aria-label': 'Restore ' + a.was } }), canDelete ? buttonHTML('Delete', { variant: 'ghost', attrs: { 'data-bot-delete': a.id, 'aria-label': 'Delete ' + a.was } }) : ''),
        attrs: { 'data-archived': a.id } })), { 'data-part': 'archived' }) : '';
    fill(body, defaults + yours + change + '<div data-part="delete"' + (deleting ? '' : ' hidden') + '></div>' +
      '<div class="hx-set__acts hx-set__more">' + buttonHTML('New bot', { attrs: { 'data-new-bot': '' } }) + '</div>' + arch);
    if (deleting) startDelete(deleting);
  }
  const host = (): HTMLElement => body.querySelector<HTMLElement>('[data-part="delete"]') as HTMLElement;
  const nameOf = (id: string): string => bots().find((b) => b.id === id)?.name ?? archived().find((a) => a.id === id)?.was ?? id;
  function startDelete(id: string): void {
    const a = admin(); if (!a) return;
    void deleteFlow(host(), { id, name: nameOf(id), admin: a, live: () => deleting === id && body.isConnected,
      onCancel: () => { deleting = null; body.querySelector<HTMLElement>('[data-bot-menu="' + CSS.escape(id) + '"], [data-bot-delete="' + CSS.escape(id) + '"]')?.focus(); },
      onArchive: () => { deleting = null; archive(id); },
      onDone: (name) => { deleting = null; kit.notify('Deleted ' + name); void read().then(draw); } });
  }
  function archive(id: string): void {
    if (busy) return;
    const a = admin(), name = nameOf(id);
    busy = true;
    const done: Promise<() => Promise<void>> = a
      ? a.archive(id).then((r) => () => r.undo())
      : Promise.resolve().then(() => { data().bots.archive(id); return () => { const back = archived().find((x) => x.was === id); return back ? data().bots.restore(back.id) : Promise.reject(new Error(name + ' is no longer archived')); }; });
    done.then((undo) => { last = { what: 'Archived ' + name, undo }; }, (e: unknown) => { kit.notify(name + ' was not archived: ' + said(e)); })
      .finally(() => { busy = false; void read().then(() => { draw(); body.querySelector('[data-last]')?.scrollIntoView?.({ block: 'center' }); }); });   /* the line with Undo is where the eye is */
  }
  body.addEventListener('click', (e) => {
    const t = e.target as Element;
    const open = t.closest<HTMLElement>('[data-bot-open]')?.dataset['botOpen'];
    if (open) { openBotSheet(body, open); return; }
    if (t.closest('[data-new-bot]')) { closeDialog(body.closest('dialog')); emit('hx:new-bot', { from: 'settings' }); return; }
    const m = t.closest<HTMLElement>('[data-bot-menu]');
    if (m) {
      const id = m.dataset['botMenu'] ?? '', name = nameOf(id);
      kit.openMenu(m, { label: name, place: 'below', align: 'end',
        entries: [{ label: 'Archive', icon: 'archive', value: 'archive' }, ...(admin() ? [{ label: 'Delete…', icon: 'close', value: 'delete', danger: true }] : [])],
        onSelect: (v) => { if (v === 'archive') archive(id); else if (v === 'delete') { deleting = id; draw(); } } });
      return;
    }
    const restore = t.closest<HTMLElement>('[data-bot-restore]')?.dataset['botRestore'];
    if (restore && !busy) {
      busy = true;
      const was = archived().find((a) => a.id === restore)?.was ?? restore;
      data().bots.restore(restore).then(() => { kit.notify('Restored ' + was); if (last?.what === 'Archived ' + was) last = null; }, (e: unknown) => { kit.notify('Could not restore ' + was + ': ' + said(e)); })
        .finally(() => { busy = false; void read().then(draw); });
      return;
    }
    const del = t.closest<HTMLElement>('[data-bot-delete]')?.dataset['botDelete'];
    if (del) { deleting = del; draw(); return; }
    if (t.closest('[data-last] [data-line]') && last) {
      const l = last; last = null;
      l.undo().then(() => { kit.notify('Restored ' + l.what.replace(/^Archived /, '')); }, (err: unknown) => { kit.notify('Could not restore: ' + said(err)); }).finally(() => { void read().then(draw); });
    }
  });
  draw();
  void read().then(draw);
  const offBots = data().bots.subscribe(() => { if (!body.contains(document.activeElement) && !deleting) draw(); });
  const offArch = data().bots.archived.subscribe(() => { if (!body.contains(document.activeElement) && !deleting) draw(); });
  return { el, refresh: async () => { await read(); draw(); }, destroy: () => { offBots(); offArch(); } };
}
