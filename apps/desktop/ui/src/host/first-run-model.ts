/* What first run shows, as data: the steps and where the person is among them, which labs are connected and what the host's choice
   for each is, and the summary of what the host set up (ADR-0040). Pure: no DOM, no host. */
import { ways } from '../data/providers';
import type { ModelsView, ProviderState } from './bindings';
import type { SetupStatus } from './setup-bridge';
import { choiceFor } from './first-run-ways';

/** the steps the progress shows, in order: the person always sees where they are and how many are left */
export const PHASES = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'engine', label: 'Engine' },
  { id: 'settings', label: 'Settings' },
  { id: 'models', label: 'Models' },
  { id: 'extras', label: 'Extras' },
  { id: 'ready', label: 'Ready' }
] as const;
export type PhaseId = (typeof PHASES)[number]['id'];

/** the phase a status is in: the form that is open says it, else the first step that is not done */
export function phaseOf(status: SetupStatus | null): PhaseId {
  if (!status) return 'welcome';
  const form = status.form?.form_id ?? '';
  if (form === 'setup.config') return 'settings';
  if (form.startsWith('setup.')) return 'models';
  if (status.done) return 'models';
  const open = status.steps.find((s) => s.state !== 'done' && s.state !== 'skipped' && s.state !== 'declined');
  if (!open) return 'models';
  if (open.id === 'config') return 'settings';
  if (open.id === 'models' || open.id === 'restart') return 'models';
  return 'engine';
}

/** "Step 3 of 6: Models", the progress's words */
export function progressText(id: PhaseId): string {
  const i = PHASES.findIndex((p) => p.id === id);
  return `Step ${String(i + 1)} of ${String(PHASES.length)}: ${PHASES[i]?.label ?? ''}`;
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
    if (s.status !== 'connected') continue;
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
