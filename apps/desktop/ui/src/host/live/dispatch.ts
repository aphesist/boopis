/* Telling the plugin which models a person can name, before a session is made: `delegate_task` of a session names its models
   (`target`) from the roster the plugin holds when the session's tools are built, and a session's tools are fixed then (prompt
   caching). So the roster is sent just before `session.create` and `session.resume`; a model signed in later is named by the next
   session, and the Models settings say so. The words are the plugin's (`plugins/boopis/governance/roster.py`, from the shared
   names table); the UI only hands over what the engine offers. A plugin without the method, or a refusal, costs the feature and
   nothing else: the session is made without it. */
import { logger } from '../../core/log';
import type { ModelChoice } from '../../data/types';
import type { GatewayClient } from '../gateway';

const log = logger('live');
export interface RosterWord { alias: string; provider: string; model: string }

/** what the plugin takes: the models in the order the person prefers them (the ladder's tiers first, as `choices` has them) */
export const rosterOf = (choices: readonly Pick<ModelChoice, 'provider' | 'model'>[]): { provider: string; model: string }[] =>
  choices.filter((c) => c.model).map((c) => ({ provider: c.provider, model: c.model }));

export async function sendRoster(client: Pick<GatewayClient, 'requestRaw'>, choices: readonly Pick<ModelChoice, 'provider' | 'model'>[]): Promise<readonly RosterWord[]> {
  const models = rosterOf(choices);
  if (!models.length) return [];
  try {
    const res = await client.requestRaw('plugin.boopis.dispatch.roster', { models }) as { aliases?: readonly RosterWord[] } | null;
    return res?.aliases ?? [];
  } catch (e) {
    log.info('the plugin did not take the models, so this session cannot send tasks to a named model', e);
    return [];
  }
}
