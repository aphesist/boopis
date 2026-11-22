/* The local API's switch (ADR-0045, docs/LOCAL-API.md) as a small interface, so Settings never touches Tauri and tests and the
   lab inject a fake. The endpoint is off until the owner turns it on; the token is never in any result, only the path of its
   file. Errors come back as `HostError` with the host's own sentence. */
import { commands } from './bindings';
import type { LocalApiStatus } from './bindings';
import { asHostError } from './bridge';

export type { LocalApiStatus };

export interface LocalApiBridge {
  status(): Promise<LocalApiStatus>;
  setEnabled(enabled: boolean): Promise<LocalApiStatus>;
  rotate(): Promise<LocalApiStatus>;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

export function tauriLocalApiBridge(): LocalApiBridge {
  return {
    status: () => call(commands.localApiStatus()),
    setEnabled: (enabled) => call(commands.localApiSetEnabled(enabled)),
    rotate: () => call(commands.localApiRotateToken())
  };
}

/** the words under the switch for a status: what is on, where, and what the owner must know */
export function describeStatus(s: LocalApiStatus): string {
  if (s.problem) return s.problem;
  if (!s.running) return 'Off. Other apps on this computer cannot see your bots, answer approvals or send them messages.';
  const clients = s.streams === 0 ? 'No app is following it now.' : s.streams === 1 ? 'One app is following it.' : s.streams + ' apps are following it.';
  return 'On, on this computer only. Apps read the token from the file below. ' + clients;
}
