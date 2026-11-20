/* What the keys, the palette and the menus do. */
import { emit } from '../../core/bus';
import { KEYS, readText, writeText } from '../../core/settings';
import { callProvided } from '../../core/registry';
import { getDockApi } from '../../core/registry';
import { setState, state, toggle } from '../../core/state';
import { themeApi } from '../../styles/theme';
import { ui } from '@boopis/ui';
import type { Tab } from '../../core/types';
import { sh } from './ctx';

export const toast = (m: string, o?: Parameters<typeof ui.toast>[1]): void => { ui.toast(m, o); };

export function newThing(tab?: Tab): void {
  const t = tab ?? state.tab;
  if (t !== state.tab) setState({ tab: t });
  emit('hx:new', { tab: t });
  if (t === 'bots') emit('hx:new-bot', { from: 'shell' }); else emit('hx:new-session', { from: 'shell' });
}
export function openPanel(panel: string): void {
  setState({ right: 'open' });
  emit('hx:open-panel', { panel, from: 'shell' });
}
export async function toggleFullscreen(): Promise<void> {
  if (await (await import('./window')).toggleWindowFullscreen()) return;   /* the desktop app's own window */
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { toast('Full screen is not available in this view'); }
}
/** mod+I: the session's details panel, or the open bot's settings (the bots tab provides that) */
export function togglePanel(): void {
  if (state.tab === 'session') { toggle('right'); return; }
  callProvided('bot-settings', { toggle: true, from: 'keyboard' });
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
