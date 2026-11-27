/* The first run's ledger (board O01, "The ledger": written as answers are given, only for resume, skip and returning users). The host
   keeps setup's own steps (it recomputes them from reality); this keeps what the app's parts need to know: whether the Sessions part
   and the Bots part are still to come, put off or done. It lives in the app's settings on this computer (core/settings.ts). */
import { KEYS, readJSON, writeJSON } from '../../core/settings';
import { emit } from '../../core/bus';

/** the Sessions part (boards O-S01 to O-S04): `careful` asks how careful sessions should be, `ready` says "You're set"; `done` and
    `skipped` ask nothing */
export type SessionsPart = 'careful' | 'ready' | 'done' | 'skipped';
/** the Bots part (boards O-H01, O-B01 to O-B10): `todo` until the hand-off, `later` when put off (the Bots tab's first open starts it,
    O-X04), `done` */
export type BotsPart = 'todo' | 'later' | 'done';
export interface Ledger { sessions: SessionsPart; bots: BotsPart }
const SESSIONS: readonly SessionsPart[] = ['careful', 'ready', 'done', 'skipped'];
const BOTS: readonly BotsPart[] = ['todo', 'later', 'done'];

/** no ledger is a computer set up before the first run had parts in the app: nothing is asked */
export function ledger(): Ledger {
  const o = readJSON<Record<string, unknown>>(KEYS.onboarding);
  const s = o?.['sessions'], b = o?.['bots'];
  return { sessions: SESSIONS.includes(s as SessionsPart) ? (s as SessionsPart) : 'done', bots: BOTS.includes(b as BotsPart) ? (b as BotsPart) : 'done' };
}
export function writeLedger(patch: Partial<Ledger>): void {
  const now = ledger();
  writeJSON(KEYS.onboarding, { version: 3, sessions: patch.sessions ?? now.sessions, bots: patch.bots ?? now.bots });
  emit('hx:onboarding', ledger());
}
/** setup has just run on a new computer: the Sessions part comes next (or not, when setup was skipped) and the Bots part after it */
export function startParts(skipped: boolean): void { writeLedger({ sessions: skipped ? 'skipped' : 'careful', bots: 'todo' }); }
