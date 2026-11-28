/* Who can answer next, from what the engine and the plugin say: the ladder's tiers first (the user's own configuration, cheapest
   first), then the models of the other configured providers (`model.options`). Pure, so it is tested against recorded shapes.
   The engine names providers and lists model ids; it has no label for a model, so the readable names come from the kit's
   parser at the places that draw them (`modelMark.called`), and a provider's plan name from `modelMark.provider`. */
import { modelMark } from '@boopis/ui';
import type { ModelChoice } from '../../data/types';
import type { ModelOptionsWire } from './wire';

/** a tier of the ladder: its name and the model it runs */
export interface LadderTier { name: string; provider: string; id: string }
/** how many of a provider's models are offered when the engine does not say which are featured */
export const FEATURED_LIMIT = 6;

/** 'provider/id' (the first slash splits: an id may have slashes of its own) */
export function splitValue(value: string): { provider: string; model: string } {
  const i = value.indexOf('/');
  return i < 0 ? { provider: '', model: value } : { provider: value.slice(0, i), model: value.slice(i + 1) };
}
export const valueOf = (provider: string, model: string): string => (provider ? provider + '/' + model : model);

/** the host's saved ladder (`provider/id` per tier) as tiers */
export const tiersFromHost = (tiers: readonly { name: string; model: string }[]): LadderTier[] =>
  tiers.map((t) => { const s = splitValue(t.model); return { name: t.name, provider: s.provider, id: s.model }; });

export function choicesFrom(options: ModelOptionsWire | null, ladder: readonly LadderTier[]): ModelChoice[] {
  const out: ModelChoice[] = [];
  const engineName = new Map((options?.providers ?? []).map((p) => [p.slug, p.name]));
  ladder.forEach((t, i) => {
    out.push({ value: valueOf(t.provider, t.id), provider: t.provider, model: t.id, providerName: modelMark.provider(t.provider, engineName.get(t.provider)), tier: i, tierName: t.name });
  });
  for (const p of options?.providers ?? []) {
    if (p.authenticated === false) continue;
    const featured = p.featured_models?.length ? p.featured_models : (p.models ?? []).slice(0, FEATURED_LIMIT);
    for (const m of featured) {
      if (out.some((c) => c.provider === p.slug && modelMark.same(c.model, m))) continue;   /* the pinned id of a tier is the tier */
      out.push({ value: valueOf(p.slug, m), provider: p.slug, model: m, providerName: modelMark.provider(p.slug, p.name) });
    }
  }
  return out;
}
