/* What boopis offers around bots that is its own, not Hermes's and not a test's: the starters of the new-bot form, the
   things a bot can be told to ask about first, and what a new bot's own settings start as. */
import type { BotConfig, BotSuggestion, Choice } from './types';

export const SUGGESTIONS: readonly BotSuggestion[] = [
  { name: 'night shift', desc: 'Works overnight and preps your morning digest', shape: 'hexagon', color: '#f5a337' },
  { name: 'inbox triage', desc: 'Sorts your email and drafts replies in your voice', shape: 'cloud', color: '#f472b6' },
  { name: 'chief of staff', desc: 'Manages your calendar and pulls your notes together', shape: 'squircle', color: '#ef4444' },
  { name: 'flaky test hunter', desc: 'Reruns failing tests and opens a fix when it finds one', shape: 'squircle', color: '#2fd26a' }
];
export const APPROVALS: readonly Choice[] = [
  { id: 'deploys', name: 'Deploying anywhere' }, { id: 'push', name: 'Pushing to protected branches' }, { id: 'network', name: 'Reaching the network' },
  { id: 'spend', name: 'Spending past the run cap' }, { id: 'people', name: 'Messaging people' }, { id: 'outside', name: 'Writing outside its workspace' }
];
/** a new teammate's own settings: ungoverned until the owner turns Governed on (ADR-0042), the plugin's usual cap, a worktree, and asking
    before every kind of thing */
export const OWN_SETTINGS: Pick<BotConfig, 'gov' | 'cap' | 'workspace'> & { approvals: Readonly<Record<string, boolean>> } = {
  gov: 'ungoverned', cap: '0.60', workspace: 'worktree', approvals: Object.fromEntries(APPROVALS.map((a) => [a.id, true]))
};
