/* Smart: the automatic model choice for each message. Pure: no client, no DOM, no clock, so the rule is tested alone and
   the composer can preview it as the user types. Where it lives and why: docs/DECISIONS.md, ADR-0032 (the rule below is the one table).

   The rule (docs/SMART.md has the same table). A message is given a level, 0 (cheapest tier), 1 (middle) or 2 (strongest),
   and the level is spread over the tiers of the session's ladder (cheapest first). The cheapest tier answers by default;
   a level goes up only because of a signal below, and the highest signal wins. The reason is the signal's own words, so the
   turn's meta can say what Smart picked and why. A message no signal fires for is "a short, plain request" at level 0.

   signal                                                        level   reason
   asks for design, architecture, a migration, a redesign        2       "design work"
   a long request (over 1,500 characters)                        2       "a long request"
   a big paste of code (over 40 code lines)                      2       "a lot of code"
   4 or more attachments                                         2       "many attachments"
   two or more of the last 3 turns failed                        2       "it failed twice already"
   asks to debug, diagnose, find a cause, fix a flaky test       1       "debugging"
   asks to refactor, rewrite, restructure, rename across files   1       "refactoring"
   a diff or a code block                                        1       "code in the message"
   a medium request (over 400 characters)                        1       "a longer request"
   an attachment, a mentioned file or folder                     1       "an attachment"
   the last turn failed                                          1       "the last turn failed"

   Nothing is guessed silently: a signal is a word, a length or a count, and each is named in the reason.

   Smart never picks a heavy model (ADR-0037: Claude Fable, Grok 4.7 and later; the mark is data, `data/frontier.ts`). A heavy
   model on a ladder is there because the user put it there, as the tier a failed gate climbs to; the level is spread over the
   tiers that are not heavy (`automaticTiers`), so level 2 is the strongest of those. A model the user picks in the menu or
   mentions with "@" is theirs, not Smart's. */
import { isHeavy } from './frontier';

export interface SmartInput {
  text: string;
  /** files and folders attached to the message (the composer's); `@file:` and `@folder:` mentions in the text count too */
  attachments?: number;
  /** how many of the session's last 3 turns failed (a tool error, a stopped turn, a ship rolled back) */
  failures?: number;
}
export type SmartLevel = 0 | 1 | 2;
export interface SmartPick { level: SmartLevel; reason: string }

export const LONG_CHARS = 1500;
export const MEDIUM_CHARS = 400;
export const CODE_LINES = 40;
export const MANY_ATTACHMENTS = 4;

const DESIGN = /\b(design|architect(?:ure)?|re-?design|migrat(?:e|ion)|system design|data model|schema design|from scratch)\b/i;
const DEBUG = /\b(debug|diagnos(?:e|is)|root cause|why (?:does|is|did|are|do)|flaky|race condition|deadlock|stack ?trace|regression|intermittent|investigate|not working|crash(?:es|ing)?)\b/i;
const REFACTOR = /\b(refactor|re-?write|restructure|re-?organi[sz]e|rename (?:across|everywhere|all)|split (?:up|into)|extract (?:a |the )?(?:module|class|service)|clean ?up)\b/i;
const DIFF = /^(diff --git |@@ .* @@|\+\+\+ |--- [ab]\/)/m;
const MENTION = /@(?:file|folder):/;

/** the number of lines inside fenced code blocks */
export function codeLines(text: string): number {
  let n = 0, inside = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { inside = !inside; continue; }
    if (inside) n++;
  }
  return n;
}

export function smartLevel(i: SmartInput): SmartPick {
  const text = i.text ?? '';
  const files = (i.attachments ?? 0) + (text.match(/@(?:file|folder):/g)?.length ?? 0);
  const failures = i.failures ?? 0;
  /* highest level first; the first signal that fires at the highest level names the reason */
  if (DESIGN.test(text)) return { level: 2, reason: 'design work' };
  if (text.length > LONG_CHARS) return { level: 2, reason: 'a long request' };
  if (codeLines(text) > CODE_LINES) return { level: 2, reason: 'a lot of code' };
  if (files >= MANY_ATTACHMENTS) return { level: 2, reason: 'many attachments' };
  if (failures >= 2) return { level: 2, reason: 'it failed twice already' };
  if (DEBUG.test(text)) return { level: 1, reason: 'debugging' };
  if (REFACTOR.test(text)) return { level: 1, reason: 'refactoring' };
  if (DIFF.test(text) || text.includes('```')) return { level: 1, reason: 'code in the message' };
  if (text.length > MEDIUM_CHARS) return { level: 1, reason: 'a longer request' };
  if (files >= 1 || MENTION.test(text)) return { level: 1, reason: 'an attachment' };
  if (failures >= 1) return { level: 1, reason: 'the last turn failed' };
  return { level: 0, reason: 'a short, plain request' };
}

/** which tier of a ladder of `tiers` (cheapest first) a level lands on: 0 is the first, 2 the last, 1 the middle (the lower of two) */
export function tierFor(level: SmartLevel, tiers: number): number {
  if (tiers <= 1) return 0;
  return Math.min(tiers - 1, Math.floor((level * (tiers - 1)) / 2));
}

/** the tiers Smart may choose among: the ladder without its heavy ones, in order (`of` says which provider and model a tier is) */
export function automaticTiers<T>(tiers: readonly T[], of: (t: T) => { provider: string; model: string }): T[] {
  return tiers.filter((t) => { const m = of(t); return !isHeavy(m.provider, m.model); });
}

/** the choice for a message: the tier index and the reason, or null when the ladder is empty (Smart has nothing to choose from) */
export function smartPick(i: SmartInput, tiers: number): { index: number; level: SmartLevel; reason: string } | null {
  if (tiers < 1) return null;
  const p = smartLevel(i);
  return { index: tierFor(p.level, tiers), ...p };
}

/** failures among the last 3 turns, from newest to oldest flags (true = the turn failed) */
export const recentFailures = (turns: readonly boolean[]): number => turns.slice(-3).filter(Boolean).length;
