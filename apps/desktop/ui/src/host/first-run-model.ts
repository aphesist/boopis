/* What first run shows, as data: the steps and where the person is among them, which labs are connected and what the host's choice
   for each is, and the summary of what the host set up (ADR-0040). Pure: no DOM, no host. */
import { ways } from '../data/providers';
import type { ModelsView, ProviderState } from './bindings';
import type { SetupStatus } from './setup-bridge';
import { choiceFor } from './first-run-ways';

/** the steps the progress shows, in order: where you are, and how many are left. The engine and the consent are the welcome's;
    the summary is the models'; the end is after the last (every step past). */
export const PHASES = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'models', label: 'Models' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'store', label: 'Store' }
] as const;
export type PhaseId = (typeof PHASES)[number]['id'] | 'ready';

/** the phase a status is in: the engine, the consent and the checklist are the welcome's; the models question and what follows are
    the models'. A blocked step stays where it is. */
export function phaseOf(status: SetupStatus | null): PhaseId {
  if (!status) return 'welcome';
  const form = status.form?.form_id ?? '';
  if (form === 'setup.config') return 'welcome';
  if (form.startsWith('setup.')) return 'models';
  if (status.done) return 'models';
  const open = status.steps.find((s) => s.state !== 'done' && s.state !== 'skipped' && s.state !== 'declined');
  if (!open) return 'models';
  return open.id === 'models' || open.id === 'restart' ? 'models' : 'welcome';
}

/** each step of the line as `past`, `now` or `next` */
export const stepStates = (id: PhaseId): ReadonlyArray<{ id: string; label: string; s: 'past' | 'now' | 'next' }> => {
  const at = id === 'ready' ? PHASES.length : PHASES.findIndex((p) => p.id === id);
  return PHASES.map((p, i) => ({ id: p.id, label: p.label, s: i < at ? 'past' : i === at ? 'now' : 'next' }));
};

/** "Step 2 of 4", the progress's words; the end says so */
export function progressText(id: PhaseId): string {
  if (id === 'ready') return 'All steps done';
  const i = PHASES.findIndex((p) => p.id === id);
  return `Step ${String(i + 1)} of ${String(PHASES.length)}`;
}

/** one connected way, as the hub and the summary say it */
export interface Connected {
  way: string;
  /** the lab (`OpenAI`) */
  lab: string;
  /** how it connects (`ChatGPT subscription`) */
  label: string;
  plan: string | null;
  /** the host's choice for it in `setup.ladder`, or null when the host sets up no route for it (it is still connected and in the
      model menu; no governed ladder is written from it) */
  choice: string | null;
}

/** what is connected now, from the host's states. A runtime that merely answered is not connected until it is used; an endpoint
    the person added is, when its check passed. */
export function connectedList(states: ReadonlyMap<string, ProviderState>, offered: readonly string[]): Connected[] {
  const out: Connected[] = [];
  const known = ways();
  for (const s of states.values()) {
    /* `custom.endpoint` is the catalogue's add-one row, not an endpoint the person made */
    if (s.status !== 'connected' || s.way === 'custom.endpoint') continue;
    const hit = known.find((w) => w.way.id === s.way);
    if (hit) out.push({ way: s.way, lab: hit.entry.label, label: hit.way.label, plan: s.plan ?? null, choice: choiceFor(hit.way, offered) });
    else if (s.way.startsWith('custom.')) out.push({ way: s.way, lab: 'Your own endpoint', label: s.way.slice('custom.'.length), plan: null, choice: null });
  }
  return out;
}

/** the labs the person may start with: connected, with a route the host can set up, one per choice */
export function startChoices(list: readonly Connected[]): Connected[] {
  const seen = new Set<string>();
  return list.filter((c) => c.choice !== null && !seen.has(c.choice) && !!seen.add(c.choice));
}

/** what the primary button of the hub says */
export function continueLabel(connected: number): string {
  return connected === 0 ? 'Continue' : connected === 1 ? 'Continue with 1 connected' : `Continue with ${String(connected)} connected`;
}

export interface Summary {
  /** how the person starts: "the free models", or the first tier's model */
  startsWith: { free: boolean; model: string | null; tier: string | null };
  /** the governed ladder in order, with what it runs; empty when none */
  ladder: ReadonlyArray<{ name: string; model: string }>;
  governed: { available: boolean; why: string | null };
  connected: readonly Connected[];
  /** true when the person skipped connecting, or nothing was */
  later: boolean;
}

/** The summary from the host's view of what it wrote. A ladder whose first tier is the free tier (`nous/...`) is the free models. */
export function summaryOf(view: ModelsView | null, connected: readonly Connected[], later: boolean): Summary {
  const tiers = view?.state === 'set' ? view.tiers : [];
  const first = tiers[0];
  const free = !first || first.model.startsWith('nous/');
  return {
    startsWith: { free, model: first && !free ? first.model : null, tier: first && !free ? first.name : null },
    ladder: free ? [] : tiers,
    governed: { available: view?.governed.available ?? false, why: view?.governed.why ?? null },
    connected,
    later: later || connected.length === 0
  };
}

/** the one line under "Do it later" and in the summary of someone who connected nothing */
export const LATER_LINE = 'You can connect any lab at any time in Settings, Models.';

/** the order the host starts from what is connected (`setup::providers::connected_choice`): the first connected lab with a route is
    where a new session begins. Kept in step with the host by the setup test that names the same order. */
export const START_ORDER = ['anthropic', 'claude-subscription', 'chatgpt-subscription', 'openai-key', 'gemini', 'xai-subscription', 'xai'] as const;

/** the lab the host starts on, from what is connected, or null when none of it has a route (the free models) */
export function startsOn(list: readonly Connected[]): Connected | null {
  for (const c of START_ORDER) { const hit = list.find((x) => x.choice === c); if (hit) return hit; }
  return null;
}

/** the footer's one line of what boopis will do */
export function startSentence(list: readonly Connected[]): string {
  if (list.length === 0) return 'Nothing connected yet';
  const first = startsOn(list);
  const n = `${String(list.length)} connected.`;
  if (first) return `${n} Starts on ${first.lab}${first.plan ? ` (${first.plan})` : ''}.`;
  const labs = list.map((c) => c.lab).filter((v, i, a) => a.indexOf(v) === i);
  return `${n} Starts on the free models; ${labs.join(', ')} ${labs.length === 1 ? 'stays' : 'stay'} in the model menu.`;
}
