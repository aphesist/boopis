/* How a model switch reaches the engine (Hermes's canonical owner gateway). Two ways, and no other:
   - the sticky pick (the model menu, or Smart's tier in an ungoverned session) is `session.mutate` operation `model`: revision-fenced,
     retry-idempotent (one request id per pick) and checked by the engine's selection guard (cost, data policy, large context), which
     may answer `confirmation_required` with a token. Nothing is written then: the person is asked, and only their yes resends the same
     pick with `confirm: <token>`. A pick asked of a running session is `deferred` by the engine to its next turn.
   - a one-turn switch (an "@" mention, a council) is `prompt.submit`'s `model_override`: that admission alone runs the other model;
     the session's own model is never touched, so there is nothing to put back.
   `config.set {key: "model"}` is refused by the canonical gateway (`use_session_mutation_model`, 4001), so it is never sent.
   Sources: gateway/session_mutation_model.py, gateway/session_controls.py (mutate), gateway/session_cli_turn.py (Hermes v0.23.2). */
import type { GatewayClient } from '../gateway';
import type { PendingPick } from './session-model';

/** what the engine takes for a one-turn switch (`prompt.submit`'s `model_override`) */
export interface ModelOverride { model: string; provider?: string }
export const overrideOf = (c: { provider: string; model: string }): ModelOverride => ({ model: c.model, ...(c.provider ? { provider: c.provider } : {}) });

/** the receipt of `session.mutate` operation `model`, as far as boopis reads it */
export interface MutateModelWire {
  status?: string; revision?: number; execution_generation?: number; model?: string;
  confirm?: string; confirm_message?: string; target_model?: string; target_provider?: string;
  warnings?: { kind?: string; title?: string; message?: string }[];
}
/** the fences of a session, as the model holds them */
export interface Fences { revision: number | null; generation: number | null }

/** the engine asked for the person's confirmation before switching (`confirmation_required`): nothing was switched. `message` is the
    engine's own warning (the cost or data-policy sentence), which names a model, never the engine */
export class ModelNeedsConfirmation extends Error {
  readonly warnings: readonly string[];
  constructor(message: string, warnings: readonly string[]) { super(message); this.name = 'ModelNeedsConfirmation'; this.warnings = warnings; }
}

const uuid = (): string => (globalThis.crypto?.randomUUID?.() ?? 'pick-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));

/** the pick in flight for `value`: the same request id while it is the same pick (retries, the confirmed resend), a new one otherwise */
export function pickFor(current: PendingPick | null, value: string): PendingPick {
  return current && current.value === value ? current : { value, requestId: uuid(), asked: null, confirmed: null };
}

/** the fresh fences a `revision_conflict` or `stale_generation` refusal carries (`error.data`), else null */
export function freshFences(e: unknown): { revision: number; generation: number } | null {
  const data = (e as { data?: unknown } | null)?.data as { reason?: unknown; revision?: unknown; execution_generation?: unknown } | undefined;
  if (!data || (data.reason !== 'revision_conflict' && data.reason !== 'stale_generation')) return null;
  return typeof data.revision === 'number' && typeof data.execution_generation === 'number' ? { revision: data.revision, generation: data.execution_generation } : null;
}

/** the fences a session handle carries (`session.create`/`session.resume`'s snapshot, a mutation's receipt); absent fields stay as they were */
export function fencesFrom(res: unknown, into: Fences): void {
  const r = res as { revision?: unknown; execution_generation?: unknown } | null;
  if (typeof r?.revision === 'number') into.revision = r.revision;
  if (typeof r?.execution_generation === 'number') into.generation = r.execution_generation;
}

export type SwitchOutcome = 'applied' | 'deferred' | 'noop';

/** apply the sticky pick `target` to session `gw` with `session.mutate`. Retries once with the fresh fences on a revision or generation
    conflict (the engine hands them over on the refusal). Throws `ModelNeedsConfirmation` when the engine's guard asks first (`pick.asked`
    then holds its token; the person's yes sets `pick.confirmed` and the next call sends it), and the engine's refusal otherwise. */
export async function mutateModel(client: GatewayClient, gw: string, fences: Fences, pick: PendingPick, target: { provider: string; model: string }): Promise<SwitchOutcome> {
  const confirm = pick.confirmed && pick.confirmed === pick.asked ? pick.confirmed : null;
  const payload = { model: target.model, ...(target.provider ? { provider: target.provider } : {}), ...(confirm ? { confirm } : {}) };
  let r: MutateModelWire | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      r = (await client.requestRaw('session.mutate', {
        session_id: gw, request_id: pick.requestId, expected_revision: fences.revision ?? 0, expected_generation: fences.generation ?? 0, operation: 'model', payload
      })) as MutateModelWire | null;
      break;
    } catch (e) {
      const fresh = attempt === 0 ? freshFences(e) : null;
      if (!fresh) throw e;
      fences.revision = fresh.revision; fences.generation = fresh.generation;
    }
  }
  fencesFrom(r, fences);
  if (r?.status === 'confirmation_required') {
    pick.asked = typeof r.confirm === 'string' ? r.confirm : null;
    pick.confirmed = null;
    const warnings = (r.warnings ?? []).map((w) => w.message ?? w.title ?? '').filter((x) => x);
    throw new ModelNeedsConfirmation(r.confirm_message || warnings.join(' ') || 'This model needs your confirmation first.', warnings);
  }
  return r?.status === 'deferred' ? 'deferred' : r?.status === 'noop' ? 'noop' : 'applied';
}

/** change the effort of session `gw` in place: `session.mutate` operation `reasoning` (session-launch.md 6.1; the engine's
    `hermes_state_mutations.py`), fenced and retried once with fresh fences as the model pick is. A pick asked of a running session is
    `deferred` by the engine to its next turn. Throws the engine's refusal */
export async function mutateEffort(client: GatewayClient, gw: string, fences: Fences, effort: string): Promise<SwitchOutcome> {
  const requestId = uuid();
  let r: MutateModelWire | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      r = (await client.requestRaw('session.mutate', {
        session_id: gw, request_id: requestId, expected_revision: fences.revision ?? 0, expected_generation: fences.generation ?? 0, operation: 'reasoning', payload: { effort }
      })) as MutateModelWire | null;
      break;
    } catch (e) {
      const fresh = attempt === 0 ? freshFences(e) : null;
      if (!fresh) throw e;
      fences.revision = fresh.revision; fences.generation = fresh.generation;
    }
  }
  fencesFrom(r, fences);
  return r?.status === 'deferred' ? 'deferred' : r?.status === 'noop' ? 'noop' : 'applied';
}
