/* Mods on the live provider (docs/MODS.md, docs/PROTOCOL.md section 3): the plugin's `mod.*` events folded into one
   `ModSession` per session (`data/mods-model.ts`), and the user's answers sent back with the plugin RPC. The UI never runs
   mod code: a press, an input or a select goes back as the id of the handler of the element used (`mod.press`, `mod.input`,
   `mod.select`), and a site is told where it is with `mod.props`. A handler id that is gone (the tree was replaced) answers
   `handled: false`: nothing happens, and that is said in the debug log. A mod `$` namespace boopis refuses (docs/MODS.md
   section 9) never reaches this file as an event, so nothing here pretends to serve it. */
import { logger } from '../../core/log';
import { createModsModel } from '../../data/mods-model';
import type { ModsSource } from '../../data/provider';
import type { GatewayClient, GatewayEvent } from '../gateway';

const log = logger('mods');
const PREFIX = 'plugin.boopis.';

export interface ModsHostOptions {
  client: GatewayClient;
  /** the UI's id of a session, from the gateway's */
  uiOf(gwSession: string): string | undefined;
  /** the gateway's id of a session, once it is live there */
  gwOf(uiSession: string): string | null;
  now?: () => number;
}
export interface ModsHost {
  source: ModsSource;
  /** an event of a session; true when it was a mod's */
  handle(uiSession: string, ev: GatewayEvent): boolean;
  /** reads who is loaded in a session (`mod.list`): the mods load at the first prompt, so this is asked again after a turn */
  attach(uiSession: string): Promise<void>;
  /** the session has mods loaded as far as the UI knows */
  known(uiSession: string): boolean;
}

export function createModsHost(opts: ModsHostOptions): ModsHost {
  const { client } = opts;
  const model = createModsModel(opts.now);
  const send = (what: string, method: string, uiSession: string, params: Record<string, unknown>): void => {
    const gw = opts.gwOf(uiSession);
    if (!gw) return;
    client.requestRaw(PREFIX + method, { session_id: gw, ...params })
      .then((res) => { if ((res as { handled?: boolean } | null)?.handled === false) log.debug(what + ': the handler is gone (the tree was replaced)'); })
      .catch((e: unknown) => { log.warn(what + ' was not delivered', e); });
  };
  const source: ModsSource = {
    ...model.source,
    press: (id, handler) => { send('a press', 'mod.press', id, { handler }); },
    input: (id, handler, value) => { send('an input', 'mod.input', id, { handler, value }); },
    select: (id, handler, value) => { send('a select', 'mod.select', id, { handler, value }); },
    props: (id, component, site, props) => { send('the props of ' + component, 'mod.props', id, { component, ...(site ? { id: site } : {}), props }); }
  };
  async function attach(uiSession: string): Promise<void> {
    const gw = opts.gwOf(uiSession);
    if (!gw) return;
    let res: unknown;
    try { res = await client.requestRaw(PREFIX + 'mod.list', { session_id: gw }); } catch (e) { log.debug('mod.list was not answered (a plugin without mods)', e); return; }
    const sessions = (res as { sessions?: unknown } | null)?.sessions;
    const entry = Array.isArray(sessions) ? sessions.find((x) => (x as { session_id?: unknown } | null)?.session_id === gw) : undefined;
    model.list(uiSession, entry);
  }
  return {
    source, attach,
    known: (id) => model.state(id).active,
    handle(uiSession, ev) {
      if (!ev.type.startsWith(PREFIX + 'mod.')) return false;
      const type = ev.type.slice(PREFIX.length);
      const r = model.handle(uiSession, type, ev.payload ?? {});
      if (r.ignored) log.debug('mods: ' + r.ignored);
      /* boopis speaking about the mods (one stopped, one was refused): read who is still loaded */
      if (type === 'mod.log' && (ev.payload ?? {})['plugin'] === '') void attach(uiSession);
      return true;
    }
  };
}
