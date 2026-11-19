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
import { announceAttention, bot, initModel, S } from './model';
import { leadOrb, repaintOrbs } from './orbs';
import { makeRow, mountList, syncListVisibility, syncRail, syncRoving } from './list';
import { allTurns, focusTurn, mountView, onBotsEvent, openBot, stopRun } from './room';
import { openNew } from './new-bot';
import { closeSettings, openSettings, toggleSettings } from './settings';
import { ui as uiLib } from '../../components';
/* drawn corners (DESIGN-SYSTEM.md section 8): the bots' own surfaces take the library's continuous corner */
uiLib.squircle.auto('.bt-sugg, .bt-opt');

let wired = false;
function wire(): void {
  if (wired) return;
  wired = true;
  initModel();
  data().bots.subscribe((ev) => {
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
      return;
    }
    onBotsEvent(ev, { announce: announceAttention });
  });
  on('hx:bot-select', (d) => { if (d.from && String(d.from).startsWith('bots')) return; if (d.id && bot(d.id)) openBot(d.id); });
  on('hx:new-bot', () => openNew());
  on('hx:bot-settings', (d) => { if (d.open && !S.sheetOpen) openSettings(S.sel); });
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
  provide('stop', (d) => (d.tab === 'bots' ? stopRun() : false));
  setTimeout(announceAttention, 0);
}

leadOrb();
register('bots-list', { mount(root) { wire(); mountList(root); } });
register('bots', { mount(root) { wire(); mountView(root); } });

/** HX.bots of the mock-up: open a bot, make one, its settings */
export const bots = {
  list: () => S.bots.map(({ id, name, role, shape, color, eyes, state: st, attention }) => ({ id, name, role, shape, color, eyes, state: st, attention: attention ?? null })),
  get: bot, open: openBot, newBot: openNew, settings: openSettings, toggleSettings, close: closeSettings
};
