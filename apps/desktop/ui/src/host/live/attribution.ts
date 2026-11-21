/* Who answered, per message, and the one-message "@" switch. The engine's transcript has no model column, so the plugin keeps a book
   of turns (`turns.bind` writes it when a turn completes, with the rows the engine stored for it; `turns.models` reads it back on a
   resume): a turn the book does not list is shown as unknown, never as the model the session has now (invariant 5).
   The one-message switch is the engine's `config.set ... --once` followed by `prompt.submit` on an idle session: the engine
   restores the session's model itself after that turn, so the session's default and the sticky pick stay as they were. In a
   governed session the plugin is told first (`mode.once`) to run the turn outside governed mode (ADR-0036). */
import { logger } from '../../core/log';
import type { GatewayClient } from '../gateway';
import { isUnknownMethod } from './wire';

const log = logger('live.attribution');
const PLUGIN = 'plugin.boopis.';

/** one recorded turn: the model that answered ('provider/model'), the tiers a governed turn ran on, and the engine's rows */
export interface TurnRecord { model: string; route: readonly string[]; ungoverned: boolean; rowIds: readonly number[] }
/** the recorded turns of a session by each stored row they own */
export type TurnBook = ReadonlyMap<number, TurnRecord>;
export const EMPTY_BOOK: TurnBook = new Map();

/** what a record says answered: the tiers in order for a governed turn, else the one model */
export const answeredBy = (r: TurnRecord): string => (r.route.length ? r.route.join(' → ') : r.model);

export function bookFrom(res: unknown): TurnBook {
  const list = (res as { turns?: unknown } | null)?.turns;
  const book = new Map<number, TurnRecord>();
  if (!Array.isArray(list)) return book;
  for (const t of list as Array<Record<string, unknown>>) {
    if (typeof t['model'] !== 'string' || !t['model'] || !Array.isArray(t['row_ids'])) continue;
    const rowIds = (t['row_ids'] as unknown[]).filter((n): n is number => typeof n === 'number');
    const rec: TurnRecord = { model: t['model'], route: Array.isArray(t['route']) ? (t['route'] as unknown[]).filter((x): x is string => typeof x === 'string') : [], ungoverned: t['ungoverned'] === true, rowIds };
    for (const id of rowIds) book.set(id, rec);
  }
  return book;
}

/** the session's recorded turns; an empty book (every turn unknown) when the plugin cannot say */
export async function loadTurnBook(client: GatewayClient, gw: string): Promise<TurnBook> {
  try { return bookFrom(await client.requestRaw(PLUGIN + 'turns.models', { session_id: gw })); }
  catch (e) {
    /* a plugin that is older than this UI has no such method: its turns are unknown, which is not a fault to report */
    if (!isUnknownMethod(e)) log.warn('the models of the past turns could not be read; they show as unknown', e);
    return EMPTY_BOOK;
  }
}

/** `message.complete.persisted_turn`: bind the turn that just ended to its stored rows (best effort: a turn not bound is unknown) */
export function bindTurn(client: GatewayClient, gw: string, persisted: unknown): void {
  const p = persisted as { row_ids?: unknown; user_row_id?: unknown } | null | undefined;
  if (!p || !Array.isArray(p.row_ids) || !p.row_ids.length) return;
  client.requestRaw(PLUGIN + 'turns.bind', { session_id: gw, row_ids: p.row_ids, ...(typeof p.user_row_id === 'number' ? { user_row_id: p.user_row_id } : {}) })
    .catch((e: unknown) => { if (!isUnknownMethod(e)) log.warn('the answering model of a turn was not recorded', e); });
}

/** `config.set` value for one turn only: the engine puts the session's model back after the turn */
export const onceValue = (c: { provider: string; model: string }): string => c.model + (c.provider ? ' --provider ' + c.provider : '') + ' --once';

export interface OnceDeps {
  client: GatewayClient;
  gw: string;
  /** the session is governed (the plugin's mode, fixed at its first prompt) */
  governed: boolean;
  pluginOk: boolean;
  /** no turn is running: a switch asked of a running turn would only be stashed for the next one */
  idle: boolean;
  target: { provider: string; model: string };
  /** the model the session answers with now, to put back if the message cannot be sent after the switch (null when not known) */
  previous: { provider: string; model: string } | null;
  /** the target's readable name, for the words of a refusal */
  say: string;
}
export interface OnceRun { /** the message could not be submitted after all: take the arming and the switch back */ abort(): Promise<void>; /** the turn runs outside governed mode */ ungoverned: boolean }

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** switch the next turn to `target` only. Rejects (nothing armed, nothing switched) when it cannot, so the message is not sent to a model nobody chose */
export async function prepareOnce(d: OnceDeps): Promise<OnceRun> {
  if (!d.idle) throw new Error('A message to ' + d.say + ' goes out when the session is idle, so it was not sent. Wait for the answer, or stop it.');
  let armed = false;
  const disarm = async (): Promise<void> => {
    if (!armed) return;
    armed = false;
    try { await d.client.requestRaw(PLUGIN + 'mode.once', { session_id: d.gw, armed: false }); }
    catch (e) { log.warn('the one-message exception could not be withdrawn; it lapses on its own', e); }
  };
  if (d.governed) {
    if (!d.pluginOk) throw new Error('boopis\'s own part is not loaded, so this message cannot run outside governed mode, and was not sent.');
    try {
      const r = (await d.client.requestRaw(PLUGIN + 'mode.once', { session_id: d.gw, armed: true })) as { armed?: boolean } | null;
      if (r?.armed !== true) throw new Error('the plugin did not arm it');
      armed = true;
    } catch (e) { throw new Error('This message could not be set to run outside governed mode (' + why(e) + '), so it was not sent.'); }
  }
  try {
    const r = (await d.client.requestRaw('config.set', { session_id: d.gw, key: 'model', value: onceValue(d.target), confirm_expensive_model: true })) as { confirm_required?: boolean; confirm_message?: string } | null;
    if (r?.confirm_required) throw new Error(r.confirm_message || 'the engine asked for a confirmation');
  } catch (e) {
    await disarm();
    throw new Error('The model could not be switched to ' + d.say + ' for this message (' + why(e) + '), so it was not sent.');
  }
  const abort = async (): Promise<void> => {
    await disarm();
    /* the engine switched its model at once and restores it when the next turn ends: a turn that never started would leave the
       session on the mentioned model, so the previous one is put back (as a session pick, which is what it answers with anyway) */
    if (!d.previous) { log.warn('the mentioned model stays until the next turn: the previous one is not known'); return; }
    try { await d.client.requestRaw('config.set', { session_id: d.gw, key: 'model', value: d.previous.model + (d.previous.provider ? ' --provider ' + d.previous.provider : '') + ' --session', confirm_expensive_model: true }); }
    catch (e) { log.warn('the session\'s model could not be put back', e); }
  };
  return { abort, ungoverned: d.governed };
}
