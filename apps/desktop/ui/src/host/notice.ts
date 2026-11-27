/* What the person sees when the app cannot start: a plain, readable notice with the stable error code and a Retry. It covers the
   whole window, title bar included, so like first run it carries the window's own title bar (its controls and a drag area: the
   window is undecorated, and without them a failed start left no way to move, shrink or close it). Built from the kit and the
   tokens (`notice.css`); the v6 mock-up has no screen for this, and the owner may design one. */
import { ui } from '@boopis/ui';
import { windowBar } from './window-controls';
import type { WindowControls } from './window-controls';

export interface NoticeOptions {
  /** where the layer goes; the page's body when absent */
  mount?: HTMLElement;
  /** the window's controls for the layer's title bar; the page's own controller when absent */
  windowControls?: WindowControls;
  /** what Retry does; reloading the page (the start runs again) when absent */
  retry?: () => void;
}

export function showStartupFailure(err: unknown, opts: NoticeOptions = {}): HTMLElement {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  const root = document.createElement('div');
  root.className = 'hx-notice';
  const bar = windowBar(opts.windowControls);
  const body = document.createElement('div');
  body.className = 'hx-notice__body';
  body.setAttribute('role', 'alert');
  const h = document.createElement('p');
  h.className = 'hx-notice__title';
  h.textContent = 'boopis could not reach its engine';
  const m = document.createElement('p');
  m.className = 'hx-notice__msg';
  m.textContent = message;
  const retry = ui.button({ label: 'Retry', variant: 'primary' });
  retry.addEventListener('click', () => { (opts.retry ?? (() => { location.reload(); }))(); });
  body.append(h, m, ...(code ? [ui.code(code)] : []), retry);
  root.append(bar.node, body);
  (opts.mount ?? document.body).append(root);
  retry.focus();
  return root;
}
