/* What the keys, the palette and the menus do. */
import { emit } from '../../core/bus';
import { KEYS, readText, writeText } from '../../core/settings';
import { getDockApi } from '../../core/registry';
import { setState, state, toggle } from '../../core/state';
import { themeApi } from '../../styles/theme';
import { kit } from '@boopis/ui';
import type { NotifyOpts } from '@boopis/ui';
import type { Tab } from '../../core/types';
import { data } from '../../data';
import { sh } from './ctx';

export const toast = (m: string, o?: NotifyOpts): void => { kit.notify(m, o); };

export function newThing(tab?: Tab): void {
  const t = tab ?? state.tab;
  if (t !== state.tab) setState({ tab: t });
  emit('hx:new', { tab: t });
  if (t === 'bots') emit('hx:new-bot', { from: 'shell' }); else emit('hx:new-session', { from: 'shell' });
}
/** the sidebar's "+": a new session on the Sessions tab; on the Bots tab the kit's Menu of what can be made there, a bot or a group
    of them (board 12 draws the "+" and no other way to a new group: an owner question). A group where group chat cannot run says
    why and cannot be chosen. mod+shift+O still makes the tab's own new thing at once. */
export function openNewMenu(anchor: HTMLElement): void {
  if (state.tab !== 'bots') { newThing(); return; }
  const why = data().groups.note();
  kit.openMenu(anchor, {
    label: 'New', place: 'below', align: 'end',
    entries: [{ label: 'New bot', value: 'bot', icon: 'plus', keys: 'mod+shift+O' }, { label: 'New group', value: 'group', icon: 'bots', ...(why ? { desc: why, disabled: true } : {}) }],
    onSelect: (v) => { if (v === 'group') emit('hx:new-group', { from: 'shell' }); else newThing('bots'); }
  });
}
export function openPanel(panel: string): void {
  setState({ right: 'open' });
  emit('hx:open-panel', { panel, from: 'shell' });
}
/** mod+I: the session's details panel, or the open bot's settings (the bots tab provides that) */
export function togglePanel(): void {
  /* the details pane is the window's (board 11, S40): the session's details, or the open bot's */
  toggle('right');
}
export const dockMode = (): string | null => { const r = sh.app.querySelector<HTMLElement>('#hx-dock [data-mode]'); return r ? r.dataset['mode'] ?? null : null; };
export function toggleDockExpand(): void {
  if (state.dock !== 'on') setState({ dock: 'on' });
  const api = getDockApi();
  if (api) api.setMode(dockMode() === 'expanded' ? 'normal' : 'expanded');
  else emit('hx:dock-expand', { toggle: true, from: 'keyboard' });
}
/** mod+shift+L: Bone, and back to the user's last dark theme with its overrides */
export function toggleLightDark(): void {
  const T = themeApi;
  if (T.scheme() === 'light') {
    const back = readText(KEYS.lastDark);
    if (back) { try { T.importJSON(back); } catch { T.preset('catalog'); } } else T.preset('catalog');
  } else {
    writeText(KEYS.lastDark, T.exportJSON());
    T.preset('bone');
  }
  toast(T.scheme() === 'light' ? 'Light theme' : 'Dark theme');
}
export function toggleOrbGrow(): void {
  setState({ orbGrow: !state.orbGrow });
  toast(state.orbGrow ? 'Bots grow on hover' : 'Bots keep their size on hover');
}
