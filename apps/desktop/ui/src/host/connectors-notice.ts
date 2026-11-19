/* A restart of Hermes that waited for every session to be idle (an install that gave a key, with "restart when idle") ends on its own,
   long after the form: the host says so with an event, and this shows it as a notice wherever the user is. */
import { events } from './bindings';
import { ui } from '@boopis/ui';

export interface RestartNotice { names: readonly string[]; ok: boolean; message: string }
export function noticeText(n: RestartNotice): string { return n.message || (n.ok ? 'boopis restarted to read the key.' : 'boopis did not restart. The key is saved; restart boopis to use it.'); }

/** listen for the host's notices; returns the function that stops listening */
export async function listenConnectorRestarts(toast: (text: string) => void = (t) => { ui.toast(t); }, listen: (cb: (n: RestartNotice) => void) => Promise<() => void> = (cb) => events.connectorRestartEvent.listen((e) => { cb(e.payload); })): Promise<() => void> {
  return listen((n) => { toast(noticeText(n)); });
}
