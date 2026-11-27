/* A bot's own rules (7a follow-ups, the owner: "if our approvals only contain 'ask before spending over $50' then that's the only instance
   where a bot will ask something, unless I set a bot-specific approval for a specific bot"). What a bot does beyond the rules for every
   bot comes from two places, and this reads both as one list of rules, as its sheet and Settings show them:
   - the rules list's rules that name the bot (`Rule.bots`): an ask rule is an extra ask, an exception a let-through ("may restart the
     staging services"), a draft from "Always allow" waits to be finished;
   - its tier per kind of action (`BotConfig.approvals`, ADR-0050, enforced by the plugin's `policy/tiers.py`): Ask holds every call of
     that kind for an approval, whatever the rules say, so it is an extra ask ("asks before deploying anywhere"); Block refuses the kind
     ("may never deploy anywhere"); Allow adds nothing ("Allow never widens": the rules for every bot still ask), so it shows nothing.
     A kind that offers no Allow (spending past the cap, `never_allow`) asks always: that ask is one of the built-in protections, not
     the bot's own, and is not listed; its Block is.
   Pure: the sheet and Settings draw from what it returns. */
import type { ApprovalTier, Bot, Choice, Rule } from '../../data';
import { APPROVAL_TIERS } from '../../data/types';
import { isDraft, ofBot } from '../settings/rule-parts';

/** what a rule of a bot's own does: asks more, lets something through, or never lets it happen */
export type OwnSense = 'ask' | 'allow' | 'never';
export interface OwnRule {
  /** `tier:<kind>` or `rule:<id>`: the key its row's controls carry */
  key: string;
  from: 'tier' | 'rule';
  sense: OwnSense;
  text: string;
  enabled: boolean;
  draft: boolean;
  rule?: Rule;
  kind?: Choice;
}

/** a kind of action in a bot's words, by the plugin's category ids (`policy/bot_tiers.json`): what it asks before, and what it may never do */
const KIND_SAYS: Readonly<Record<string, { ask: string; never: string }>> = {
  deploys: { ask: 'deploying anywhere', never: 'deploy anywhere' },
  push: { ask: 'pushing to protected branches', never: 'push to protected branches' },
  network: { ask: 'reaching the network', never: 'reach the network' },
  spend: { ask: 'spending past the run cap', never: 'spend past the run cap' },
  people: { ask: 'messaging people', never: 'message people' },
  outside: { ask: 'writing outside its workspace', never: 'write outside its workspace' },
  delete: { ask: 'deleting files', never: 'delete files' },
  commands: { ask: 'running commands', never: 'run commands' }
};
const lower = (t: string): string => t.charAt(0).toLowerCase() + t.slice(1);
/** a kind's rule in words: "Asks before deploying anywhere", "May never deploy anywhere" */
export function tierWords(kind: Choice, sense: 'ask' | 'never'): string {
  const says = KIND_SAYS[kind.id];
  if (sense === 'ask') return 'Asks before ' + (says?.ask ?? lower(kind.name));
  return says ? 'May never ' + says.never : 'May never: ' + lower(kind.name);
}
/** whether a kind can stop asking (a kind whose tiers have no Allow asks always: a built-in protection) */
export const canAllow = (kind: Choice): boolean => (kind.tiers ?? APPROVAL_TIERS).includes('allow');
/** the tier a kind's row writes for a sense */
export const tierOfSense = (sense: 'ask' | 'never'): ApprovalTier => (sense === 'never' ? 'block' : 'ask');

/** A bot's own rules: its drafts first, then its extra asks, what it may never do, and its let-throughs. `off` keeps the rows of kinds
    switched off in the open sheet (their tier is Allow now; the row stays, off, until the sheet is drawn again) */
export function ownRules(b: Pick<Bot, 'id' | 'name' | 'cfg'>, kinds: readonly Choice[], rules: readonly Rule[] | null, off: ReadonlyMap<string, 'ask' | 'never'> = new Map()): OwnRule[] {
  const out: OwnRule[] = [];
  for (const r of rules ?? []) {
    if (!ofBot(r, b)) continue;
    out.push({ key: 'rule:' + r.id, from: 'rule', sense: r.type === 'exception' ? 'allow' : 'ask', text: r.text, enabled: r.enabled, draft: isDraft(r), rule: r });
  }
  const tiers = b.cfg.approvals ?? {};
  for (const k of kinds) {
    const key = 'tier:' + k.id, t = tiers[k.id];
    if (t === 'block') out.push({ key, from: 'tier', sense: 'never', text: tierWords(k, 'never'), enabled: true, draft: false, kind: k });
    else if (t === 'ask' && canAllow(k)) out.push({ key, from: 'tier', sense: 'ask', text: tierWords(k, 'ask'), enabled: true, draft: false, kind: k });
    else if (t === 'allow' && off.has(key)) { const s = off.get(key) as 'ask' | 'never'; out.push({ key, from: 'tier', sense: s, text: tierWords(k, s), enabled: false, draft: false, kind: k }); }
  }
  const rank: Record<OwnSense, number> = { ask: 0, never: 1, allow: 2 };
  return out.sort((x, y) => Number(y.draft) - Number(x.draft) || rank[x.sense] - rank[y.sense]);
}

/** how many rules of its own a bot has (drafts apart), and its drafts */
export function ownCount(b: Pick<Bot, 'id' | 'name' | 'cfg'>, kinds: readonly Choice[], rules: readonly Rule[] | null): { rules: number; drafts: number } {
  const list = ownRules(b, kinds, rules);
  return { rules: list.filter((r) => !r.draft).length, drafts: list.filter((r) => r.draft).length };
}

/** a bot's status as Settings › Bots says it: only what differs from every bot's ("Follows your rules", "2 rules of its own", "$5 cap") */
export function botStatus(b: Pick<Bot, 'id' | 'name' | 'cfg'>, kinds: readonly Choice[], rules: readonly Rule[] | null): string {
  const n = ownCount(b, kinds, rules);
  const own = n.rules ? n.rules + (n.rules === 1 ? ' rule of its own' : ' rules of its own') : 'Follows your rules';
  return [own, n.drafts ? n.drafts + (n.drafts === 1 ? ' draft' : ' drafts') + ' to finish' : '', b.cfg.cap ? '$' + b.cfg.cap + ' cap' : ''].filter(Boolean).join(' · ');
}
