/* boopis mods: what a session's Claude Code mods draw (docs/MODS.md sections 2 and 3, DESIGN-SYSTEM.md 14.29), in the owner's
   places (2b, the lead's decisions for conflict 32). Reads `data().mods` (the `mod.*` events of the plugin, folded into one `ModSession`
   per session) and draws it with the kit's ModView into: a tab of the session's tools after their fixed tabs, the band in the held or
   queued strip's slot over the composer (the kit's Queue), the composer's own line (a mod's status, nothing rises), its rows in the
   conversation (a log line is the kit's SystemLine, a placed row a ToolRow), its notices (the kit's Notice, one at a time with "+N"),
   and the theme card with its live preview. A mod's `$.ui.ask` is a form with the mod's origin and goes
   the way every form goes (the conversation, the dock's queue, answered in one place); nothing here draws it.
   What the user does to an element goes back to the mod by handler id (`mod.press`, `mod.input`, `mod.select`), and each
   site is told where it is (`mod.props`: a pane's placement, always `dock` now that a pane is a tab of the tools at every width, and
   the band's `isWorking` and `isCollapsed`).
   Refusals: a `$` namespace boopis does not serve never reaches this module as an event, so nothing here pretends to serve
   it (no commands list, no backdrop, no redraw of Claude Code's own parts). Listens: hx:theme (literal colours re-read),
   Every colour, family, radius and size is a token. */
import { setState, state } from '../../core/state';
import { logger } from '../../core/log';
import { data } from '../../data';
import type { ModSession } from '../../data';
import { NO_MODS } from '../../data/mods-model';
import { inTauri } from '../../host/bridge';
import type { HxCard } from '../cards';
import { ctl } from './ctl';
import { bringForward, panelTabs, drawBand, setOnChange, updateTrees } from './panes';
import { placeLog, placePlaced } from './rows';
import { setStatus, statusItems } from './status';
import { themeCard, placeThemeCard, withdraw } from './theme-card';
import { modNotice } from './notices';
import { surface } from './surfaces';

const log = logger('mods');

let unsub: (() => void) | null = null, unsubEvents: (() => void) | null = null;
let ready = false, working = false;
/** the props last sent for each site of the session, so a site is told only when something changed */
const sent = new Map<string, string>();
let themeEl: HxCard | null = null;

/** what changes the shape of the surfaces (a pane opened, closed, drawn for the first time, refused; the band appeared): a redraw, not an update in place */
const shape = (s: ModSession): string =>
  s.panes.map((p) => [p.id, p.plugin, p.title, p.opens, p.drawing?.kind ?? '-', p.drawing?.kind === 'skipped' ? p.drawing.reason : ''].join('|')).join('\n') + '#' +
  (s.band ? [s.band.plugin ?? '', s.band.drawing.kind].join('|') : '') + '#' + (s.band && !s.band.plugin && s.plugins.length === 1 ? s.plugins[0] : '');   /* the band is named by the one mod loaded, when the plugin did not say */

/* ───────── telling the mods where their sites are ───────── */
function tell(component: string, id: string | null, props: Record<string, unknown>): void {
  const sid = ctl.id;
  if (!sid) return;
  const key = sid + '|' + component + '|' + (id ?? ''), json = JSON.stringify(props);
  if (sent.get(key) === json) return;
  sent.set(key, json);
  data().mods.props(sid, component, id, props);
}
/** a pane's placement and focus, the band's working and collapsed state: what Claude Code gives a `ui.render` hook as props */
function syncProps(): void {
  if (!ctl.id || !ctl.s.active) return;
  for (const p of ctl.s.panes) tell('Pane', p.id, { title: p.title, placement: 'dock', isFocused: ctl.active === p.id });
  tell('AbovePrompt', null, { isWorking: working, isCollapsed: !ctl.bandOpen });
}

/* ───────── what belongs in the conversation ───────── */
/** log lines, placed rows and the theme card are in the conversation, which is redrawn on a switch and a reset: they are placed again */
function placeConversationParts(): void {
  const sid = ctl.id;
  if (!sid) return;
  for (const l of ctl.s.log) placeLog(l, sid, true);
  for (const p of ctl.s.placed) placePlaced(p, sid, true);
  if (themeEl) { withdraw(themeEl); themeEl = null; }
  if (ctl.s.theme) { themeEl = themeCard(ctl.s.theme); if (themeEl) placeThemeCard(themeEl); }
}

/* ───────── drawing ───────── */
function drawAll(): void {
  if (ctl.active !== 'diff' && !ctl.s.panes.some((p) => p.id === ctl.active)) ctl.active = 'diff';
  drawBand();
  surface.redrawRight?.();
  setStatus(ctl.s.status);
}

function apply(next: ModSession): void {
  const prev = ctl.s;
  ctl.s = next;
  if (shape(prev) !== shape(next)) {
    for (const p of next.panes) {
      const was = prev.panes.find((x) => x.id === p.id);
      if (!was || was.opens !== p.opens) {
        /* a pane comes forward only when its mod asks (`focus`): its tab, and the tools open on it */
        if (p.focus) { bringForward(p.id); if (state.right !== 'open') setState({ right: 'open' }); }
      }
    }
    drawAll();
  } else if (prev !== next) updateTrees();
  if (prev.status !== next.status) setStatus(next.status);
  /* what the mods said into the conversation since the last state: new log lines and placed rows, and a new or withdrawn theme */
  const sid = ctl.id;
  if (sid) {
    const lastLog = prev.log[prev.log.length - 1]?.id ?? 0;
    for (const l of next.log) if (l.id > lastLog) placeLog(l, sid, true);
    for (const p of next.placed) if (!prev.placed.includes(p)) {
      document.querySelector('[data-mod-placed="' + CSS.escape(p.id) + '"]')?.remove();
      placePlaced(p, sid, true);
    }
    for (const p of prev.placed) if (!next.placed.some((x) => x.id === p.id)) document.querySelector('[data-mod-placed="' + CSS.escape(p.id) + '"]')?.remove();
    if (prev.theme !== next.theme) {
      if (themeEl) { withdraw(themeEl); themeEl = null; }
      if (next.theme) { themeEl = themeCard(next.theme); if (themeEl) placeThemeCard(themeEl); }
    }
  }
  syncProps();
}

/** the session whose conversation is on screen changed (or was redrawn) */
function follow(id: string): void {
  init();
  /* the same session drawn again (a re-render of the conversation): its slots are new and empty, so the band and the status line go back into them, with the status line's role and name, as well as the rows and log lines */
  if (id === ctl.id) { drawBand(); setStatus(ctl.s.status); placeConversationParts(); return; }
  unsub?.();
  ctl.id = id;
  const w = data().mods.session(id);
  ctl.s = w.get();
  ctl.active = 'diff';
  ctl.bandOpen = false;
  unsub = w.subscribe(apply);
  drawAll();
  placeConversationParts();
  syncProps();
}

/** a mod's desktop notification goes through the host, which follows the user's notification settings */
function notify(title: string, text: string): void {
  if (!inTauri()) { log.debug('a mod notification, and no desktop to show it on: ' + title); return; }
  void import('../../host/bindings').then(({ commands }) => commands.notify(title, text, null)).catch((e: unknown) => { log.warn('the notification was not shown', e); });
}

function init(): void {
  if (ready) return;
  ready = true;
  unsubEvents = data().mods.events.subscribe((e) => {
    if (e.type === 'notice') modNotice(e.plugin, e.text, e.timeoutMs);
    else notify(e.title || e.plugin, e.text);
  });
  setOnChange(() => { syncProps(); });
}

surface.onConversation = follow;
surface.onWorking = (on) => { working = on; syncProps(); };
surface.panelTabs = panelTabs;
surface.lineItems = statusItems;

/** for the tests: forget the session and every site's state */
export function resetMods(): void {
  unsub?.(); unsub = null; unsubEvents?.(); unsubEvents = null; ready = false; ctl.id = null; ctl.s = NO_MODS; ctl.active = 'diff'; ctl.roots.clear(); ctl.bandOpen = false;
  sent.clear(); themeEl = null; working = false; setStatus([]);
}
