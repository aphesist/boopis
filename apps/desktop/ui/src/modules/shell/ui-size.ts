/* The interface size (Settings > Appearance > Size): the whole window larger by one of three steps, 100%, 112% or 125%. It is
   the web view's own zoom, not CSS: the host lays the page out again at 1/factor of the window's width and draws everything
   factor times larger, text and orbs at the screen's own resolution, so nothing blurs (a CSS `zoom` or a `transform` scales a
   picture; WebKitGTK's page zoom scales the layout, and the orbs' canvases follow the devicePixelRatio it changes).
   Every size in the design system scales together, so none changes against another: a "larger bots" setting would break the
   sizes the tables of DESIGN-SYSTEM 13 fix for each place, and the zoom already makes the bots larger with the text.
   The step is kept in `hx.v6.size`; the page (a browser, the lab) has no host to zoom, and keeps the browser's own zoom. */
import { loadUiSize, saveUiSize, UI_ZOOM } from '../../core/settings';
import type { UiSize } from '../../core/settings';
import { kit } from '@boopis/ui';
import { logger } from '../../core/log';
import { inTauri } from '../../host/bridge';
import { setWebviewZoom } from '../../host/window';

const log = logger('ui-size');
let size: UiSize = 'default';
const listeners = new Set<() => void>();

export const uiSize = (): UiSize => size;
export const uiZoomPercent = (s: UiSize = size): number => Math.round(UI_ZOOM[s] * 100);
/** whether this build can zoom the window: only the desktop app has a web view to ask */
export const canZoom = (): boolean => inTauri();
export function onUiSizeChange(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

async function apply(): Promise<void> {
  if (!canZoom()) return;
  try { await setWebviewZoom(UI_ZOOM[size]); }
  catch (e) { log.warn('the interface size was not applied', e); kit.notify('The interface size did not change'); }
}
export function setUiSize(next: UiSize): void {
  if (next === size) return;
  size = next;
  saveUiSize(next);
  void apply();
  for (const fn of listeners) fn();
}
/** at boot: the step kept from last time is applied before the person sees the window larger or smaller than they chose */
export function wireUiSize(): void {
  size = loadUiSize();
  if (size !== 'default') void apply();
}
