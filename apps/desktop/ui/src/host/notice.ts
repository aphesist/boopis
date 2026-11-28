/* What the person sees when the app cannot start: a plain, readable notice with the stable error code and a Retry. It covers the
   whole window, title bar included, so like first run it carries the window's own title bar (its controls and a drag area: the
   window is undecorated, and without them a failed start left no way to move, shrink or close it). 2b: the kit's Notice in a page,
   red (the kit's spec: one line about the app with its action), its action Retry, and the code as the kit's InlineChip code under it;
   `notice.css` places it. No board draws this screen; the owner may design one. */
import { kit } from '@boopis/ui';
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
  /* one sentence and its action (the copy rules): what failed leads, the engine's own words follow, Retry; the code for a report */
  body.innerHTML = kit.html.notice({ place: 'page', tone: 'red', title: 'boopis could not reach its engine', text: message ? ': ' + message : '', actions: [{ label: 'Retry', primary: true, value: 'retry' }] }) +
    (code ? kit.html.inlineChip({ kind: 'code', text: code }) : '');
  kit.wire(body);
  const retry = body.querySelector<HTMLButtonElement>('[data-value="retry"]') as HTMLButtonElement;
  retry.addEventListener('click', () => { (opts.retry ?? (() => { location.reload(); }))(); });
  root.append(bar.node, body);
  (opts.mount ?? document.body).append(root);
  retry.focus();
  return root;
}
