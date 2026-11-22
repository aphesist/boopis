/* Settings > General > Local API (ADR-0045, docs/LOCAL-API.md): the one switch that lets other apps on this computer (a shell's
   island, a script) see the bots, answer approvals and send messages. Off until the owner turns it on. The section shows the
   address, the path of the token file (never the token) and Rotate token, which ends every open stream and makes the old token
   stop working. Drawn from `LocalApiStatus` by `renderLocalApi`, which the lab draws too. */
import { $ } from '../../core/dom';
import { ui } from '@boopis/ui';
import type { LocalApiBridge, LocalApiStatus } from '../../host/local-api';
import { describeStatus } from '../../host/local-api';

const copy = async (text: string): Promise<void> => {
  try { await navigator.clipboard.writeText(text); ui.toast('Copied'); } catch { ui.toast('Copy is blocked here'); }
};

/** the section's rows for a status */
export function localApiHTML(s: LocalApiStatus): string {
  const on = s.running;
  const rows =
    ui.html.setRow({ for: 'hx-set-local-api', label: 'Let other apps on this computer connect', hint: describeStatus(s), control: ui.html.switch({ id: 'hx-set-local-api', checked: s.enabled && (on || !!s.problem) }) }) +
    (on && s.url
      ? ui.html.setRow({ for: 'hx-local-api-url', label: 'Address', hint: 'Only this computer can reach it.', control: '<div class="ui-set__actions">' + ui.html.input({ id: 'hx-local-api-url', label: 'Address', mono: true, value: s.url, attrs: { readonly: true } }) + ui.html.button({ label: 'Copy', size: 's', variant: 'ghost', attrs: { id: 'hx-local-api-copy-url' } }) + '</div>' })
      : '') +
    (on && s.token_file
      ? ui.html.setRow({ for: 'hx-local-api-file', label: 'Token file', hint: 'Readable by you alone. A new token is made every time boopis starts.', control: '<div class="ui-set__actions">' + ui.html.input({ id: 'hx-local-api-file', label: 'Token file', mono: true, value: s.token_file, attrs: { readonly: true } }) + ui.html.button({ label: 'Copy path', size: 's', variant: 'ghost', attrs: { id: 'hx-local-api-copy-file' } }) + '</div>' }) +
        ui.html.setRow({ label: 'Rotate token', hint: 'Makes a new token. Apps that are connected are disconnected and read the file again.', control: ui.html.button({ label: 'Rotate token', size: 's', attrs: { id: 'hx-local-api-rotate' } }) })
      : '');
  return ui.html.setHead({ id: 'hx-set-local-api-h', label: 'Local API' }) + rows;
}

/** draw the section into `sec` and wire it to `bridge`; a refused change says why and puts the switch back */
export function renderLocalApi(sec: HTMLElement, s: LocalApiStatus, bridge: LocalApiBridge | null): void {
  sec.innerHTML = localApiHTML(s);
  ui.hydrate(sec);
  if (!bridge) return;
  const redraw = (next: LocalApiStatus): void => { renderLocalApi(sec, next, bridge); };
  const fail = (e: unknown): void => { ui.toast(e instanceof Error ? e.message : 'That did not work'); void bridge.status().then(redraw, () => undefined); };
  $('#hx-set-local-api', sec).addEventListener('ui:change', (e) => {
    const enabled = !!(e as CustomEvent<{ value: boolean }>).detail.value;
    void bridge.setEnabled(enabled).then(redraw, fail);
  });
  sec.querySelector('#hx-local-api-copy-url')?.addEventListener('click', () => { if (s.url) void copy(s.url); });
  sec.querySelector('#hx-local-api-copy-file')?.addEventListener('click', () => { if (s.token_file) void copy(s.token_file); });
  sec.querySelector('#hx-local-api-rotate')?.addEventListener('click', () => {
    void bridge.rotate().then((next) => { ui.toast('Token rotated. Connected apps were disconnected.'); redraw(next); }, fail);
  });
}

/** mount the section under General, once, in the desktop app only (the page has no host to ask) */
let mounted = false;
export function mountLocalApi(panel: HTMLElement, bridge: LocalApiBridge): void {
  if (mounted) return;
  mounted = true;
  const sec = document.createElement('section');
  sec.className = 'ui-set'; sec.setAttribute('aria-labelledby', 'hx-set-local-api-h');
  panel.appendChild(sec);
  void bridge.status().then((s) => { renderLocalApi(sec, s, bridge); }, (e: unknown) => { mounted = false; sec.remove(); ui.toast(e instanceof Error ? e.message : 'Local API settings could not be read'); });
}
