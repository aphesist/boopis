/* Settings › General › Local API (ADR-0045, docs/LOCAL-API.md), in the desktop app only: the one switch that lets other apps on this
   computer (a shell's island, a script) see the bots, answer approvals and send messages. Off until the owner turns it on. On, the
   section shows the address and the path of the token file (never the token), each with Copy, and Rotate token, which ends every open
   stream and makes the old token stop working. No board draws it: the kit's Card of rows, a Switch, mono values and Buttons (derived). */
import { kit } from '@boopis/ui';
import type { LocalApiBridge, LocalApiStatus } from '../../host/local-api';
import { describeStatus } from '../../host/local-api';
import { localApiHost } from './host';
import { fill } from './page';
import { actionsHTML, buttonHTML, esc, said, section, switchHTML } from './rows';

const copy = async (text: string): Promise<void> => {
  try { await navigator.clipboard.writeText(text); kit.notify('Copied'); } catch { kit.notify('Copy is blocked here'); }
};
const mono = (text: string, id: string): string => '<span class="k7-row__value k7-mono hx-set__mono" id="' + id + '" data-tip="' + esc(text) + '">' + esc(text) + '</span>';

/** the section's markup for a status */
export function localApiHTML(s: LocalApiStatus): string {
  const on = s.running;
  return section('Local API', [
    { label: 'Let other apps on this computer connect', sub: describeStatus(s), control: switchHTML('local-api', 'Let other apps on this computer connect', s.enabled && (on || !!s.problem)) },
    ...(on && s.url ? [{ label: 'Address', sub: 'Only this computer can reach it.', control: mono(s.url, 'hx-local-api-url') + actionsHTML(buttonHTML('Copy', { variant: 'ghost', attrs: { 'data-copy': 'url', 'aria-label': 'Copy the address' } })) }] : []),
    ...(on && s.token_file ? [
      { label: 'Token file', sub: 'Readable by you alone. A new token is made every time boopis starts.', control: mono(s.token_file, 'hx-local-api-file') + actionsHTML(buttonHTML('Copy path', { variant: 'ghost', attrs: { 'data-copy': 'file', 'aria-label': 'Copy the token file\'s path' } })) },
      { label: 'Rotate token', sub: 'Makes a new token. Apps that are connected are disconnected and read the file again.', control: buttonHTML('Rotate token', { attrs: { 'data-rotate': '' } }) }
    ] : [])
  ], { 'data-part': 'local-api' });
}

/** draw the section into `sec` and wire it to `bridge`; a refused change says why and puts the switch back */
export function renderLocalApi(sec: HTMLElement, s: LocalApiStatus, bridge: LocalApiBridge | null): void {
  fill(sec, localApiHTML(s));
  if (!bridge) return;
  const redraw = (next: LocalApiStatus): void => { renderLocalApi(sec, next, bridge); };
  const fail = (e: unknown): void => { kit.notify(said(e)); void bridge.status().then(redraw, () => undefined); };
  sec.querySelector('[data-set="local-api"]')?.addEventListener('ui:change', (e) => { void bridge.setEnabled(!!(e as CustomEvent<{ value: boolean }>).detail.value).then(redraw, fail); });
  sec.querySelector('[data-copy="url"]')?.addEventListener('click', () => { if (s.url) void copy(s.url); });
  sec.querySelector('[data-copy="file"]')?.addEventListener('click', () => { if (s.token_file) void copy(s.token_file); });
  sec.querySelector('[data-rotate]')?.addEventListener('click', () => { void bridge.rotate().then((next) => { kit.notify('Token rotated. Connected apps were disconnected.'); redraw(next); }, fail); });
}

/** draw the section into `host` in the desktop app (the page build has no host to ask: nothing is drawn) */
export async function mountLocalApi(host: HTMLElement): Promise<void> {
  const bridge = await localApiHost();
  if (!bridge) return;
  try { renderLocalApi(host, await bridge.status(), bridge); } catch (e) { host.replaceChildren(); kit.notify(e instanceof Error ? e.message : 'Local API settings could not be read'); }
}
