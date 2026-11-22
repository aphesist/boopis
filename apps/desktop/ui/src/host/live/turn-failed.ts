/* A bot's turn that failed, in boopis's words (ADR-0031): a room's `turn.failed` and a one-to-one chat's `message.complete` with
   `status: error` carry the engine's own sentence ("Unknown provider '...'. Check 'hermes model'..."), which the app never shows.
   The words name the bot, say what happened in a stable code of the catalog (`crates/hx-proto/errors.json`) and the next step;
   the engine's text is kept for Settings, General, Diagnostics (`keepDetail`). The engine's own failure vocabulary
   (`tools/bot_failure_reasons.py`, a room's `reason_code`) decides when it is there; the text is read only when it is not. */
import { keepDetail, sentenceFor } from '../errors';

/** the engine's reason codes, by what the person can do about them */
const REACHING: ReadonlySet<string> = new Set(['provider_auth_or_access', 'missing_config', 'model_unavailable']);
const LIMITED: ReadonlySet<string> = new Set(['provider_quota_limit', 'provider_rate_limit']);
/** the same, read from the text when no code came: a provider the bot's home does not know, no key, not signed in, refused */
const REACHING_TEXT = /unknown provider|no (?:api )?key|api key|not (?:signed|logged) in|unauthori[sz]ed|\b40[13]\b|credential|authenticat|forbidden|no such model|model .*not (?:found|available)/i;
const LIMITED_TEXT = /rate.?limit|\b429\b|too many requests|usage limit|quota/i;

/** the catalog code for a failed turn: its reason code when the engine gave one, else what its text says */
export function turnFailedCode(raw: string, given?: string | null): string {
  const reason = given && /^[a-z][a-z_]*$/.test(given) ? given : null;   /* a code of the vocabulary, never a sentence */
  if (reason && REACHING.has(reason)) return 'hx.bots.model_unreachable';
  if (reason && LIMITED.has(reason)) return 'hx.provider.rate_limited';
  if (reason && reason !== 'unknown') return 'hx.bots.turn_failed';
  if (REACHING_TEXT.test(raw)) return 'hx.bots.model_unreachable';
  if (LIMITED_TEXT.test(raw)) return 'hx.provider.rate_limited';
  return 'hx.bots.turn_failed';
}

/** what to say for `name`'s failed turn; the engine's words go to Diagnostics */
export function turnFailedWords(name: string, raw: string, reason?: string | null): string {
  const code = turnFailedCode(raw, reason);
  if (raw.trim()) keepDetail(code, raw.trim());
  switch (code) {
    case 'hx.bots.model_unreachable': return name + ' can’t reach its model. ' + sentenceFor(code);
    case 'hx.provider.rate_limited': return name + '’s model is asking it to slow down. ' + sentenceFor(code);
    default: return name + ' could not reply. ' + sentenceFor(code);
  }
}
