/* boopis bots tab. Built on the shared library (keyboard per KEYMAP sections 3, 4, 5, 7 and 9). Bots keeps only
   what is its own: the presence header, the new-bot form (stage, name, pickers, suggestions), the cron preview, its
   layout, and the orbs' liveliness and play (owner, v7).
   Registers: bots-list -> #hx-list-bots, bots -> #hx-view-bots
   Listens: hx:bot-select {id}, hx:new-bot, hx:bot-settings {open}, hx:nav {action}, hx:state, hx:tab, hx:theme
   Emits: hx:attention {source:'bots', tab:'bots', count, ids}, hx:bot-select {id, from}, hx:view-inset, hx:title
   Provides: bot-settings, stop. The provider owns the bots, their threads, their runs and their approvals. */
import { on } from '../../core/bus';
import { provide, register } from '../../core/registry';
import { state } from '../../core/state';
import { data } from '../../data';
import { announceAttention, bot, group, initGroups, initModel, S } from './model';
import { leadOrb, repaintOrbs } from './orbs';
import { drawGroups, makeRow, mountList, syncListVisibility, syncRail, syncRoving } from './list';
import { allTurns, focusTurn, mountView, onBotsEvent, openBot, stopRun } from './room';
import { openNew } from './new-bot';
import { onGroupsEvent, openGroup, repaintRoom, stopTalk } from './group-room';
import { openNewGroup } from './new-group';
import { closeSettings, openSettings, toggleSettings } from './settings';
import { ui as uiLib } from '@boopis/ui';
/* drawn corners (DESIGN-SYSTEM.md section 8): the bots' own surfaces take the library's continuous corner */
uiLib.squircle.auto('.bt-sugg, .bt-opt');

let wired = false;
/** the provider the module listens to: a different one (tests; a provider swapped at boot) is listened to instead */
let listening: { source: unknown; off: () => void } | null = null;
let listeningGroups: { source: unknown; off: () => void } | null = null;
function wire(): void {
  initModel();
  const source = data().bots;
  if (listening?.source !== source) { listening?.off(); listening = { source, off: subscribeBots() }; }
  initGroups();
  const gsource = data().groups;
  if (listeningGroups?.source !== gsource) { listeningGroups?.off(); listeningGroups = { source: gsource, off: subscribeGroups() }; }
  if (wired) return;
  wired = true;
  wireBus();
}
function subscribeBots(): () => void {
  return data().bots.subscribe((ev) => {
    if (ev.type === 'bot-created') {
      S.bots.push({ ...ev.bot });
      S.threads[ev.bot.id] ??= [];
      if (S.rowsEl) { S.rowsEl.append(makeRow(bot(ev.bot.id) as NonNullable<ReturnType<typeof bot>>)); syncRoving(); }
      return;
    }
    if (ev.type === 'bot-archived') {
      const i = S.bots.findIndex((b) => b.id === ev.id); if (i < 0) return;
      const [gone] = S.bots.splice(i, 1);
      const r = S.rows.get(ev.id); if (r) r.li.remove(); S.rows.delete(ev.id);
      if (gone?.attention) announceAttention();
      /* the open bot went (archived or deleted here, or from Hermes's own command line): open the next, or the new-bot form */
      if (S.sel === ev.id) { if (S.sheetFor === ev.id) closeSettings(true); S.sel = S.bots[0]?.id ?? null; if (S.view === 'bot' && S.room) { if (S.sel) openBot(S.sel); else openNew(); } }
      syncRoving();
      return;
    }
    onBotsEvent(ev, { announce: announceAttention });
    repaintRoom();
  });
}
function subscribeGroups(): () => void {
  return data().groups.subscribe((ev) => {
    if (ev.type === 'group-created') {
      if (!group(ev.group.id)) { S.groups.push({ ...ev.group }); S.groupThreads[ev.group.id] ??= []; }
      drawGroups();
      return;
    }
    if (ev.type === 'group-archived') {
      const i = S.groups.findIndex((g) => g.id === ev.id); if (i < 0) return;
      S.groups.splice(i, 1);
      drawGroups();
      /* the open group went: open the next, or the bots */
      if (S.groupSel === ev.id) { S.groupSel = S.groups[0]?.id ?? null; if (S.view === 'group') { if (S.groupSel) openGroup(S.groupSel); else if (S.sel) openBot(S.sel); else openNew(); } }
      return;
    }
    onGroupsEvent(ev);
  });
}
function wireBus(): void {
  on('hx:new-group', () => openNewGroup());
  on('hx:bot-select', (d) => { if (d.from && String(d.from).startsWith('bots')) return; if (d.id && bot(d.id)) openBot(d.id); });
  on('hx:new-bot', () => openNew());
  /* a caller may name the bot and the section (Settings › Bots' Open, a receipt's Open for a bot's own rule: its Approvals) */
  on('hx:bot-settings', (d) => { if (!d.open) return; const id = d.id && bot(d.id) ? d.id : S.sel; if (d.section || !S.sheetOpen || S.sheetFor !== id) openSettings(id, d.section ?? null); });
  on('hx:nav', (d) => {
    if (state.tab !== 'bots' || S.view !== 'bot') return;
    if (d.region && d.region !== 'messages') return;
    const t = allTurns(); if (!t.length) return;
    focusTurn(d.action === 'last' ? t[t.length - 1] : t[0]);
  });
  const onState = (): void => { syncListVisibility(); syncRail(); };
  on('hx:state', onState); on('hx:tab', onState);
  on('hx:theme', () => requestAnimationFrame(repaintOrbs));
  /* mod+I on the Bots tab always answers: from the new-bot form it returns to the open bot's settings, as in v6 */
  provide('bot-settings', (d) => { if (state.tab !== 'bots') return false; if (d.toggle) return toggleSettings(); openSettings(S.sel); return true; });
  provide('stop', (d) => (d.tab === 'bots' ? (S.view === 'group' ? stopTalk() : stopRun()) : false));
  setTimeout(announceAttention, 0);
}

leadOrb();
register('bots-list', { mount(root) { wire(); mountList(root); } });
register('bots', { mount(root) { wire(); mountView(root); } });

/** HX.bots of the mock-up: open a bot, make one, its settings */
export const bots = {
  list: () => S.bots.map(({ id, name, role, shape, color, state: st, attention }) => ({ id, name, role, shape, color, state: st, attention: attention ?? null })),
  get: bot, open: openBot, newBot: openNew, newGroup: openNewGroup, openGroup, settings: openSettings, toggleSettings, close: closeSettings
};
