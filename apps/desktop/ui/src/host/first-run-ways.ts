/* First run's models question in two steps (ADR-0039, report section 9): first how to connect, then a short list of labs for
   that way. The host still asks one question (`setup.ladder`, an enum of choices it knows how to set up); this file only
   regroups that enum, from the catalogue, and sends the final answer under the host's own form id and choice value. The host
   decides what it offers: a lab it has no choice for is not listed here (it is in Settings > Models after setup), and a choice
   no catalogue way claims (a model already in the person's configuration) is listed under "A model you already set up".
   Free models stay first and already chosen (ADR-0027). Pure: no DOM, no host. */
import { entries } from '../data/providers';
import type { Way } from '../data/providers';

export type WayId = 'free' | 'signin' | 'key' | 'local' | 'configured';
export interface Lab { choice: string; label: string }
export interface Steps {
  /** the ways to offer, in order (skipping is the card's own button) */
  ways: ReadonlyArray<{ id: WayId; label: string }>;
  /** the labs under each way (not `local`: those are what the probe finds) */
  labs: Readonly<Record<'signin' | 'key' | 'configured', readonly Lab[]>>;
}

export const WAY_LABELS: Readonly<Record<WayId, string>> = {
  free: 'Free models (no account)', signin: 'Sign in to a subscription', key: 'Use an API key', local: 'Use a model on this computer',
  configured: 'A model you already set up'
};

/** the choice ids the host's `setup.ladder` already used before the catalogue, by the way each belongs to */
const LEGACY: Readonly<Record<string, string>> = {
  'anthropic.signin': 'claude-subscription', 'openai.signin': 'chatgpt-subscription', 'anthropic.key': 'anthropic',
  'google.key': 'gemini', 'xai.key': 'xai', 'openrouter.key': 'openrouter-free'
};

/** the host's choice for a way, if its enum has one: the way's id, its slug or engine, or the id it used before the catalogue */
export function choiceFor(way: Way, offered: readonly string[]): string | null {
  const candidates = [way.id, LEGACY[way.id], way.slug, way.engine].filter((x): x is string => !!x);
  return candidates.find((c) => offered.includes(c)) ?? null;
}

/** Regroup the host's enum. `canLocal` says this build can look for runtimes on this computer. Returns null when the enum
    has nothing to regroup (the question is drawn as the host sent it). */
export function stepsFor(offered: readonly string[], names: readonly string[], canLocal: boolean): Steps | null {
  if (!offered.length) return null;
  const nameOf = (c: string): string => names[offered.indexOf(c)] ?? c;
  const claimed = new Set<string>();
  const labs: Record<'signin' | 'key' | 'configured', Lab[]> = { signin: [], key: [], configured: [] };
  for (const e of entries()) {
    if (e.shown !== 'default') continue;
    for (const w of e.ways) {
      if (w.hidden || (w.kind !== 'signin' && w.kind !== 'key')) continue;
      const c = choiceFor(w, offered);
      if (c && !claimed.has(c)) { claimed.add(c); labs[w.kind].push({ choice: c, label: nameOf(c) }); }
    }
  }
  if (offered.includes('free')) claimed.add('free');
  for (const c of offered) if (!claimed.has(c)) labs.configured.push({ choice: c, label: nameOf(c) });
  const ways: Array<{ id: WayId; label: string }> = [];
  if (offered.includes('free')) ways.push({ id: 'free', label: WAY_LABELS.free });
  if (labs.signin.length) ways.push({ id: 'signin', label: WAY_LABELS.signin });
  if (labs.key.length) ways.push({ id: 'key', label: WAY_LABELS.key });
  if (canLocal) ways.push({ id: 'local', label: WAY_LABELS.local });
  if (labs.configured.length) ways.push({ id: 'configured', label: WAY_LABELS.configured });
  return { ways, labs };
}

type HostFormLike = { form_id: string; kind: string; title: string; body: string; schema: unknown; submit: unknown; cancel: unknown; sensitive: boolean; origin: string; diff: never[] };
const choiceForm = (id: string, title: string, field: string, body: string, ids: readonly string[], names: readonly string[], submit: string, cancel: string): HostFormLike => ({
  form_id: id, kind: 'choice', title, body, sensitive: false, origin: 'host', diff: [], submit: { label: submit }, cancel: { label: cancel },
  schema: { type: 'object', required: ['choice'], properties: { choice: { type: 'string', title: field, enum: ids, enumNames: names, default: ids[0] } } }
});

/** step 1: how to connect. `body` is the host's own text for the question (the free tier's terms among it); `skip` is the host's
    own cancel button's words, which leave the question unanswered. */
export function wayForm(steps: Steps, body: string, skip: string): HostFormLike {
  return choiceForm('setup.way', 'How do you want to connect?', 'Connection', body, steps.ways.map((w) => w.id), steps.ways.map((w) => w.label), 'Continue', skip);
}
/** step 2: the labs for a way */
export function labForm(way: 'signin' | 'key' | 'configured', steps: Steps): HostFormLike {
  const labs = steps.labs[way];
  const body = way === 'signin' ? 'Sign in with the account you already pay for. You sign in next.' : way === 'key' ? 'A key from the lab’s own site, kept in your OS keychain. You are asked for it next.' : 'Models already named in your configuration.';
  return choiceForm('setup.lab', WAY_LABELS[way], 'Provider', body, labs.map((l) => l.choice), labs.map((l) => l.label), 'Use this', 'Back');
}
/** step 2 for a runtime on this computer: what the probe found (value: the way's id) */
export function localForm(found: ReadonlyArray<{ way: string; label: string }>): HostFormLike {
  return choiceForm('setup.local', WAY_LABELS.local, 'Runtime', 'Found on this computer just now. boopis asked 127.0.0.1 only, and nothing else.', found.map((f) => f.way), found.map((f) => f.label), 'Use this', 'Back');
}
