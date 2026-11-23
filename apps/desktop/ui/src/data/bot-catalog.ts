/* What boopis offers around bots that is its own, not Hermes's and not a test's: the starters of the new-bot form, the
   things a bot can be told to ask about first, and what a new bot's own settings start as. */
import type { ApprovalTier, BotConfig, BotSuggestion, Choice } from './types';

export const SUGGESTIONS: readonly BotSuggestion[] = [
  { name: 'night shift', desc: 'Works overnight and preps your morning digest', shape: 'hexagon', color: '#f5a337' },
  { name: 'inbox triage', desc: 'Sorts your email and drafts replies in your voice', shape: 'cloud', color: '#f472b6' },
  { name: 'chief of staff', desc: 'Manages your calendar and pulls your notes together', shape: 'squircle', color: '#ef4444' },
  { name: 'flaky test hunter', desc: 'Reruns failing tests and opens a fix when it finds one', shape: 'squircle', color: '#2fd26a' }
];
/** the kinds of action a bot's rules cover, by the plugin's category ids (`policy/bot_tiers.json`). Spending past the cap offers Ask and
    Block only: a cap is never passed without a person (ADR-0050) */
export const APPROVALS: readonly Choice[] = [
  { id: 'deploys', name: 'Deploying anywhere' }, { id: 'push', name: 'Pushing to protected branches' }, { id: 'network', name: 'Reaching the network' },
  { id: 'spend', name: 'Spending past the run cap', tiers: ['ask', 'block'] }, { id: 'people', name: 'Messaging people' }, { id: 'outside', name: 'Writing outside its workspace' },
  { id: 'delete', name: 'Deleting files' }, { id: 'commands', name: 'Running commands' }
];
/** a new teammate's own settings: ungoverned until the owner turns Governed on (ADR-0042) and a worktree. It has no cap: a bot has no limit
    unless the owner sets one; its tiers are not written either, so the plugin's defaults apply until the owner chooses one (ADR-0050) */
export const OWN_SETTINGS: Pick<BotConfig, 'gov' | 'cap' | 'workspace'> = { gov: 'ungoverned', cap: '', workspace: 'worktree' };
/** a tier word as the plugin stores it, and an old switch as it reads it (on: Ask, off: Allow); anything else asks */
export function tierOf(v: unknown): ApprovalTier {
  return v === false || v === 'allow' ? 'allow' : v === 'block' ? 'block' : 'ask';
}
