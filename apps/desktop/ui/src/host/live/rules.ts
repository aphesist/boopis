/* The rules engine's seam in the live provider (ADR-0060; docs/specs/rules-engine.md sections 8 and 10). No screen here:
   the data an approval card already draws, and what its two standing answers do.

   - A card the plugin raised for a rule reads, in the engine's `description`:
       kai asks: Run a command · git push
       git push --force origin main
       Rule: “Ask before a git force-push …”
       (Asked for by @nina, …)
     `ruleCard` gives the card its `rule` (the rule's words, verbatim) and its `scope` (what a standing answer covers: the
     words after “·”), so the dock's second answer reads "Always for git push". A card that is not one gets neither.
   - `approval-rules` (and `rules-settings`, Settings › Approvals) is switched on only when the plugin says it has the rules
     engine (`rules-v1` in `describe`).
   - "Allow all this turn" is the engine's `session` answer (the plugin's key is scoped to the turn); "Always allow" is
     `once`, then the plugin drafts the narrowest exception (`rules.draft`, which writes nothing) and the host saves it as
     a **draft** (`rules_put`, `state: draft`): a draft is never applied, and Settings shows it for the owner to finish.
     Nothing standing becomes active without the owner's own edit in Settings. */
import type { LaterFeature, WaitOutcome } from '../../data/types';

const RULE_LINE = /^Rule: “(.*)”$/;
const HEAD_LINE = /^[A-Za-z0-9_.-]{1,64} asks: (.+)$/;

export interface RuleCard {
  /** the rule's words, verbatim; absent on a card the reviewer could not check */
  rule?: string;
  /** what a standing answer would cover (the program or the tool), from the card's first line */
  scope?: string;
}

/** The rule and the scope of a card the rules engine raised, or null for any other approval. */
export function ruleCard(description: string): RuleCard | null {
  const lines = description.split('\n').map((l) => l.trim()).filter(Boolean);
  const head = HEAD_LINE.exec(lines[0] ?? '');
  if (!head) return null;
  const rules = lines.map((l) => RULE_LINE.exec(l)?.[1]).filter((r): r is string => !!r);
  const held = lines.some((l) => l.startsWith('The reviewer could not check this'));
  if (!rules.length && !held) return null;
  const words = head[1] ?? '';
  const dot = words.indexOf(' · ');
  const out: RuleCard = {};
  if (rules.length) out.rule = rules.join(' · ');
  if (dot > 0) out.scope = words.slice(dot + 3).trim();
  return out;
}

/** The engine's answer for the UI's outcome: `turn` is the engine's `session`, `always` is `once` (the standing part is the
    draft), approved is `once`, anything else is a denial (fail closed). */
export function ruleChoice(outcome: WaitOutcome): 'once' | 'session' | 'deny' {
  if (outcome === 'turn') return 'session';
  if (outcome === 'approved' || outcome === 'always') return 'once';
  return 'deny';
}

export interface RulesDeps {
  /** a plugin RPC through the gateway (`plugin.boopis.<method>`) */
  plugin: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  /** the host's rules commands, null outside the app */
  host: { get: () => Promise<unknown>; put: (rule: unknown, expectedRevision: number) => Promise<unknown> } | null;
}

/** Switch `approval-rules` on in `later` once the plugin says it has the rules engine. Unknown is never yes. */
export async function enableRules(deps: RulesDeps, later: Set<LaterFeature>): Promise<boolean> {
  try {
    const d = await deps.plugin('describe', {}) as { capabilities?: unknown };
    const caps = Array.isArray(d?.capabilities) ? d.capabilities : [];
    /* the standing answers, and Settings › Approvals where a drafted exception is finished (step 7a: the page exists) */
    if (caps.includes('rules-v1') && deps.host) { later.add('approval-rules'); later.add('rules-settings'); return true; }
  } catch { /* the plugin's describe could not be read: the standing answers stay hidden */ }
  return false;
}

/** "Always allow": draft the narrowest exception for this card and keep it as a draft for the owner to finish. Returns the
    draft's id, or null when it could not be kept (the card was still answered `once`). */
export async function keepDraft(deps: RulesDeps, sessionId: string, description: string): Promise<string | null> {
  if (!deps.host || !sessionId || !description) return null;
  const draft = await deps.plugin('rules.draft', { session_id: sessionId, description }) as Record<string, unknown>;
  const excepts = Array.isArray(draft['excepts']) ? draft['excepts'] : [];
  if (!excepts.length || typeof draft['text'] !== 'string') return null;
  const got = await deps.host.get() as { rules?: { revision?: unknown } };
  const revision = typeof got?.rules?.revision === 'number' ? got.rules.revision : 0;
  const rule = { ...draft, type: 'exception', source: 'card', state: 'draft', enabled: true };
  const saved = await deps.host.put(rule, revision) as { id?: unknown };
  return typeof saved?.id === 'string' ? saved.id : null;
}
