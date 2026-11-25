/* Settings > General > Local API (ADR-0045, docs/LOCAL-API.md): the one switch that lets other apps on this computer (a shell's
   island, a script) see the bots, answer approvals and send messages. Off until the owner turns it on. The section shows the
   address, the path of the token file (never the token) and Rotate token, which ends every open stream and makes the old token
   stop working. Drawn from `LocalApiStatus` by `renderLocalApi`, which the lab draws too. */
import { $ } from '../../core/dom';
import { kit } from '@boopis/ui';
import type { LocalApiBridge, LocalApiStatus } from '../../host/local-api';
import { describeStatus } from '../../host/local-api';

const say = (text: string): void => { kit.notify(text); };
const copy = async (text: string): Promise<void> => {
  try { await navigator.clipboard.writeText(text); say('Copied'); } catch { say('Copy is blocked here'); }
};

/** the section for a status, on the v7 kit: its SectionHead and a Card of Rows (the status behind the first label's mark) */
export function localApiHTML(s: LocalApiStatus): string {
  const on = s.running;
  const rows = [
    { label: 'Let other apps on this computer connect', explain: describeStatus(s), ...(s.problem ? { value: 'Not started' } : {}), control: kit.html.switch({ id: 'hx-set-local-api', checked: s.enabled && (on || !!s.problem), label: 'Let other apps on this computer connect' }) },
    ...(on && s.url ? [{ label: 'Address', value: s.url, mono: true, explain: 'Only this computer can reach it.', control: kit.html.button({ label: 'Copy', size: 28, variant: 'tint', attrs: { id: 'hx-local-api-copy-url', 'aria-label': 'Copy the address' } }) }] : []),
    ...(on && s.token_file ? [
      { label: 'Token file', value: s.token_file, mono: true, explain: 'Readable by you alone. A new token is made every time boopis starts. ' + s.token_file, control: kit.html.button({ label: 'Copy path', size: 28, variant: 'tint', attrs: { id: 'hx-local-api-copy-file' } }) },
      { label: 'Rotate token', explain: 'Makes a new token. Apps that are connected are disconnected and read the file again.', control: kit.html.button({ label: 'Rotate token', size: 28, variant: 'tint', attrs: { id: 'hx-local-api-rotate' } }) }
    ] : [])
  ];
  return kit.html.sectionHead({ title: 'Local API', attrs: { id: 'hx-set-local-api-h' } }) + kit.html.card({ rows });
}

/** draw the section into `sec` and wire it to `bridge`; a refused change says why and puts the switch back */
export function renderLocalApi(sec: HTMLElement, s: LocalApiStatus, bridge: LocalApiBridge | null): void {
  sec.innerHTML = localApiHTML(s);
  kit.wire(sec);
  if (!bridge) return;
  const redraw = (next: LocalApiStatus): void => { renderLocalApi(sec, next, bridge); };
  const fail = (e: unknown): void => { say(e instanceof Error ? e.message : 'That did not work'); void bridge.status().then(redraw, () => undefined); };
  $('#hx-set-local-api', sec).addEventListener('ui:change', (e) => {
    const enabled = !!(e as CustomEvent<{ value: boolean }>).detail.value;
    void bridge.setEnabled(enabled).then(redraw, fail);
  });
  sec.querySelector('#hx-local-api-copy-url')?.addEventListener('click', () => { if (s.url) void copy(s.url); });
  sec.querySelector('#hx-local-api-copy-file')?.addEventListener('click', () => { if (s.token_file) void copy(s.token_file); });
  sec.querySelector('#hx-local-api-rotate')?.addEventListener('click', () => {
    void bridge.rotate().then((next) => { say('Token rotated. Connected apps were disconnected.'); redraw(next); }, fail);
  });
}

/** mount the section under General, once, in the desktop app only (the page has no host to ask) */
let mounted = false;
export function mountLocalApi(panel: HTMLElement, bridge: LocalApiBridge): void {
  if (mounted) return;
  mounted = true;
  const sec = document.createElement('div');
  sec.className = 'k7-section'; sec.id = 'hx-set-local-api-sec';
  sec.setAttribute('role', 'group'); sec.setAttribute('aria-labelledby', 'hx-set-local-api-h');
  panel.appendChild(sec);
  void bridge.status().then((s) => { renderLocalApi(sec, s, bridge); }, (e: unknown) => { mounted = false; sec.remove(); say(e instanceof Error ? e.message : 'Local API settings could not be read'); });
}
