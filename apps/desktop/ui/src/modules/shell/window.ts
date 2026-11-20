/* The title bar's window controls. In the desktop app they drive the real window through the host; on the page they
   keep the browser's stand-ins (full screen for maximise, a note for the two that need a window). Which of them show
   follows the desktop: a tiling window manager has no use for minimise and maximise, so only close shows there
   (`host/window.ts` decides; Settings > General can correct it). The layout is data on the group (`data-layout`). */
import { on } from '../../core/bus';
import { loadWindowPref, saveWindowPref } from '../../core/settings';
import type { WindowControlsPref } from '../../core/settings';
import { logger } from '../../core/log';
import { ui } from '@boopis/ui';
import { inTauri } from '../../host/bridge';
import { resolveControls, tauriWindowHost } from '../../host/window';
import type { ControlsLayout, WindowHost, WindowInfo } from '../../host/window';
import { els } from './ctx';
import { toast, toggleFullscreen } from './actions';

const log = logger('window');

let pref: WindowControlsPref = 'auto';
let info: WindowInfo | null = null;
let host: WindowHost | null = null;
const listeners = new Set<() => void>();

export const windowPref = (): WindowControlsPref => pref;
export const windowInfo = (): WindowInfo | null => info;
/** be told when the preference or what the host found changes (the settings row) */
export function onWindowChange(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** draw a layout: the buttons that show, and their order */
export function applyLayout(layout: ControlsLayout): void {
  const { btnMin, btnMax, btnClose } = els();
  const group = btnClose.parentElement;
  if (!group) return;
  group.dataset['layout'] = layout;
  btnMin.hidden = btnMax.hidden = layout === 'close';
  const order = layout === 'mac' ? [btnClose, btnMin, btnMax] : [btnMin, btnMax, btnClose];
  group.append(...order);
}
const refresh = (): void => { applyLayout(resolveControls(pref, info)); for (const fn of listeners) fn(); };

export function setWindowPref(next: WindowControlsPref): void {
  pref = next;
  saveWindowPref(next);
  refresh();
}

/** the maximise button follows the window: a square to maximise, two to restore (full screen counts as maximised) */
export function syncMaxIcon(state: { maximized: boolean; fullscreen: boolean } | null): void {
  const b = els().btnMax;
  const full = state ? state.fullscreen : !!document.fullscreenElement;
  const on = state ? state.maximized || state.fullscreen : full;
  const mac = b.parentElement?.dataset['layout'] === 'mac';
  const label = full ? 'Exit full screen' : on ? 'Restore' : mac ? 'Full screen' : 'Maximize';
  b.innerHTML = ui.icon(on ? 'restore' : 'maximize');
  b.dataset['tip'] = label;
  b.setAttribute('aria-label', label);
}

export function wireWindowControls(): void {
  const { btnMin, btnMax, btnClose } = els();
  pref = loadWindowPref();
  on('hx:window-controls', (d) => { applyLayout(d.layout); });
  if (!inTauri()) {
    applyLayout(resolveControls(pref, null));
    btnMin.addEventListener('click', () => toast('Minimize works in the desktop app'));
    btnClose.addEventListener('click', () => toast('Close works in the desktop app'));
    btnMax.addEventListener('click', () => { void toggleFullscreen(); });
    document.addEventListener('fullscreenchange', () => { syncMaxIcon(null); });
    syncMaxIcon(null);
    return;
  }
  host = tauriWindowHost();
  const h = host;
  const fail = (what: string) => (e: unknown): void => { log.warn(what, e); toast(e instanceof Error ? e.message : what); };
  applyLayout(resolveControls(pref, null));
  syncMaxIcon({ maximized: false, fullscreen: false });
  btnMin.addEventListener('click', () => { h.control('minimize').catch(fail('The window did not minimize')); });
  btnMax.addEventListener('click', () => { h.control('toggle_maximize').catch(fail('The window did not change size')); });
  btnClose.addEventListener('click', () => { h.control('close').catch(fail('The window did not close')); });
  h.info().then((i) => { info = i; refresh(); syncMaxIcon(i); }).catch((e: unknown) => { log.warn('the desktop was not detected; all three buttons show', e); });
  h.onState((s) => { syncMaxIcon(s); }).catch((e: unknown) => { log.warn('the window state is not followed', e); });
}

/** full screen from the keyboard or the palette: the window's, in the desktop app */
export async function toggleWindowFullscreen(): Promise<boolean> {
  if (!host) return false;
  try { await host.control('toggle_fullscreen'); return true; } catch (e) { log.warn('full screen failed', e); return false; }
}
