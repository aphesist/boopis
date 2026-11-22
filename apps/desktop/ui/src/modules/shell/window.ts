/* The title bar's window controls. The shell's bar is one of the groups the page's window controller lays out and wires
   (`host/window-controls.ts`): in the desktop app they drive the real window through the host, on the page they keep the
   browser's stand-ins. Which of them show follows the desktop: a tiling window manager has no use for minimise and maximise,
   so only close shows there (`host/window.ts` decides; Settings > General can correct it). A layer that covers the whole
   window (first run, the startup notice) draws its own bar with the same controller, so both follow the same rule. */
import type { WindowControlsPref } from '../../core/settings';
import { windowControls } from '../../host/window-controls';
import type { WindowInfo } from '../../host/window';
import { els } from './ctx';

export const windowPref = (): WindowControlsPref => windowControls().pref();
export const windowInfo = (): WindowInfo | null => windowControls().info();
/** be told when the preference or what the host found changes (the settings row) */
export function onWindowChange(fn: () => void): () => void { return windowControls().onChange(fn); }

export function setWindowPref(next: WindowControlsPref): void { windowControls().setPref(next); }

export function wireWindowControls(): void {
  const group = els().btnClose.parentElement;
  if (group) windowControls().attach(group);
}
