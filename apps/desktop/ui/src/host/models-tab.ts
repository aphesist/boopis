/* Settings > Models: the plan (`mountPlan`), governed mode and its heavy switches, the ladder the plugin runs governed work on
   (which model at which tier), the Providers section (ADR-0039: every lab's sign-in, key, runtime on this computer and
   endpoint of your own, drawn from the catalogue by `providers-view.ts`), and "Change models", which asks setup's models question again through the same first-run view and
   forms. Everything shown is read now, from the host; what could not be read is said so, never filled in. The rows are the kit's
   settings Cards (board 14), each tier of the ladder a row. */
import { kit, ui } from '@boopis/ui';
import type { RowOpts } from '@boopis/ui';
import { changeModels } from './change-models';
import { currentPlan } from './free-tier';
import type { PlanView } from './free-tier';
import { mountPlan } from './plan-view';
import { loadModelsView, setHeavy } from './setup-bridge';
import type { ModelsView } from './setup-bridge';
import { tauriChatgptBridge } from './chatgpt-signin';
import { mountProviders } from './providers-view';
import type { ProvidersView } from './providers-view';
import './signin-cards'; /* registers SuperGrok's and Copilot's cards, the shared sign-in card with a lab's words */
import { tauriProvidersBridge } from './providers-bridge';
import type { ProvidersBridge } from './providers-bridge';
import type { ChatgptBridge } from './chatgpt-signin';
import type { ConnectorLogin } from './bindings';

export interface ModelsDeps {
  /** Hermes's report of the plan; null when Hermes is not connected */
  plan: () => Promise<PlanView | null>;
  /** the configured ladder; rejects when Hermes cannot be asked */
  ladder: () => Promise<ModelsView>;
  /** ask the models question again: resolves once it is on screen */
  change: () => Promise<unknown>;
  /** the settings dialog is modal and would cover the question, so it steps aside first */
  closeSettings: () => void;
  toast: (text: string) => void;
  /** boopis's own ChatGPT sign-in; without it the section shows the state and offers nothing */
  chatgpt?: ChatgptBridge;
  /** turn a heavy model (`fable`, `grok`) on or off for the saved ladder; rejects with the host's sentence */
  setHeavy?: (id: string, on: boolean) => Promise<unknown>;
  /** the host's sign-in for a provider id in its table (Claude Code's own login); without it, only "Check again" */
  login?: (provider: string) => Promise<ConnectorLogin>;
  /** the provider commands (the Providers section); without them the section says it could not be read */
  providers?: ProvidersBridge;
}
export const realModelsDeps = (closeSettings: () => void): ModelsDeps => ({
  plan: currentPlan, ladder: loadModelsView, change: () => changeModels(), closeSettings, toast: (t) => { kit.notify(t); },
  chatgpt: tauriChatgptBridge(), setHeavy, providers: tauriProvidersBridge(),
  login: async (provider) => (await import('./connectors-bridge')).tauriConnectorsBridge().login(provider)
});

const SCOPE = 'A task moves up only when its gate fails.';

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** a tier's second line: its name, and when governed mode will not run it, that, or that it is a heavy model the user chose (ADR-0037) */
const tierRule = (view: ModelsView, t: { name: string; model: string }): string => {
  const g = view.governed.tiers.find((c) => c.name === t.name && c.model === t.model);
  if (g?.frontier === false) return `${t.name}, not used in governed mode`;
  return g?.heavy ? `${t.name}, heavy, your choice` : t.name;
};

/** The heavy models' switches (ADR-0037), one for each heavy model the saved ladder can take: Fable on either Claude choice, Grok on an
    xAI key. Each says in the user's terms why it is off by default; turning it on makes it the ladder's top tier, off takes it away.
    What the host says cannot be turned on (an old Claude Code) is shown under the switch and the switch stays off. */
export function heavyRows(view: ModelsView): RowOpts[] {
  return view.heavy.filter((c) => c.applies).map((c) => ({
    label: c.label,
    sub: c.blocked && !c.on ? c.blocked : c.reason,
    control: kit.html.switch({ id: `hx-heavy-${c.id}`, checked: c.on, disabled: !c.on && c.blocked !== null, label: c.label })
  }));
}

const value = (text: string): string => '<span class="k7-row__value">' + esc(text) + '</span>';
const button = (label: string, id: string): string => kit.html.button({ label, size: 28, variant: 'tint', attrs: { id } });   /* tinted: a card is raised */

/** Governed mode's section (ADR-0037): the models it allows, each also in any later version, and whether the saved ladder lets it run.
    When it cannot, the row says why in one sentence and offers the way to get a model (Change models, the same question as setup's).
    The heavy models (Fable, Carbon, Grok) are on a ladder only when their switch, right under the status, is on. The allowed list and the
    heavy mark are the plugin's data file as the host reads it, never typed here. */
export function governedRows(view: ModelsView | { error: string }): RowOpts[] {
  if ('error' in view) return [{ label: 'Governed mode', sub: `Not read: ${view.error}` }];
  const g = view.governed;
  const status: RowOpts = g.available
    ? { label: 'Status', sub: view.state === 'set' ? 'Every tier is a frontier model.' : 'Uses the built-in ladder: Opus on your Anthropic key.', value: 'Available' }
    : {
      label: 'Status',
      sub: g.why ?? 'Needs one of the allowed models above.',
      control: value('Unavailable') + button('Change models', 'hx-governed-change')
    };
  return [
    { label: 'Allowed models', sub: 'Governed sessions run only on these.' },
    ...g.allowed.map((name): RowOpts => ({ label: name, ...(g.heavy.includes(name) ? { sub: 'Heavy: only when you turn it on.' } : {}), value: 'or later' })),
    status,
    ...heavyRows(view)
  ];
}

/** the ladder section's rows for what the host read, or for why it could not: each tier a row (its model, its name), cheapest first; the
    first is where a task starts */
export function ladderRows(view: ModelsView | { error: string }): RowOpts[] {
  if ('error' in view) return [{ label: 'Tiers', sub: `The ladder can’t be read: ${view.error}` }];
  if (view.state === 'set') {
    return [
      { label: 'Tiers', sub: `Cheapest first. ${SCOPE}` },
      ...view.tiers.map((t, i): RowOpts => ({ label: ui.modelMark.called(t.model) || t.model, value: tierRule(view, t), attrs: { 'data-tier': String(i), ...(i === 0 ? { 'aria-current': 'step' } : {}) } }))
    ];
  }
  if (view.state === 'default') return [{ label: 'Tiers', sub: 'The built-in ladder: Opus.' }];
  return [{ label: 'Tiers', sub: 'The saved ladder can’t be shown. Change models saves a new one.' }];
}

const section = (panel: HTMLElement, id: string): HTMLElement => {
  const el = document.createElement('div');
  el.className = 'hx-set__part';
  el.setAttribute('data-models-part', id);
  panel.append(el);
  return el;
};
const card = (title: string, rows: readonly RowOpts[], attrs: Record<string, string> = {}): string => kit.section(title, kit.html.card({ variant: 'settings', rows, attrs }));
const fill = (el: HTMLElement, html: string): void => { el.innerHTML = html; kit.wire(el); };

/** Put the tab into `panel`. `refresh` asks the host again; call it each time the tab is shown. */
export async function mountModels(panel: HTMLElement, deps: ModelsDeps): Promise<{ refresh: () => Promise<void> }> {
  const plan = await mountPlan(panel, deps.plan);
  const governed = section(panel, 'governed');
  const ladder = section(panel, 'ladder');
  const providersEl = document.createElement('section');
  providersEl.setAttribute('aria-labelledby', 'hx-set-providers-h');
  providersEl.className = 'hx-set__part';
  panel.append(providersEl);
  const change = section(panel, 'change');
  fill(change, card('Change', [{
    label: 'Models', sub: 'Nothing changes until you answer.',
    control: button('Change models', 'hx-models-change')
  }]));
  const askAgain = (): void => {
    void deps.change().then(() => { deps.closeSettings(); }).catch((e: unknown) => { deps.toast(e instanceof Error ? e.message : 'That did not work'); });
  };
  change.querySelector('#hx-models-change')?.addEventListener('click', askAgain);
  /* the Providers section reads the host when it is drawn, and asks the runtimes on this computer then: never in the background */
  let providers: ProvidersView | null = null;
  if (deps.providers) {
    providers = mountProviders(providersEl, {
      bridge: deps.providers, toast: deps.toast,
      ...(deps.login ? { login: deps.login } : {}), ...(deps.chatgpt ? { chatgpt: deps.chatgpt } : {})
    });
  } else {
    fill(providersEl, kit.section('Providers', kit.html.card({ variant: 'settings', rows: [{ label: 'Providers', sub: 'Not read: the host is not connected.' }] })).replace('<h3 ', '<h3 id="hx-set-providers-h" '));
  }
  /* one read of the host feeds governed mode and the ladder */
  const drawAll = async (): Promise<void> => {
    let view: ModelsView | { error: string };
    try { view = await deps.ladder(); } catch (e) { view = { error: e instanceof Error ? e.message : 'unknown error' }; }
    fill(governed, card('Governed mode', governedRows(view), { 'data-part': 'governed' }));
    fill(ladder, card('Model ladder', ladderRows(view), { 'data-part': 'ladder', 'aria-label': 'Model ladder' }));
    governed.querySelector('#hx-governed-change')?.addEventListener('click', askAgain);
    for (const sw of governed.querySelectorAll<HTMLButtonElement>('[id^="hx-heavy-"]')) {
      const id = sw.id.slice('hx-heavy-'.length);
      if (!deps.setHeavy) { sw.disabled = true; continue; }
      sw.addEventListener('ui:change', (e) => {
        const on = !!(e as CustomEvent<{ value: boolean }>).detail.value;
        deps.setHeavy?.(id, on).then(() => drawAll(), (err: unknown) => { deps.toast(err instanceof Error ? err.message : 'That did not work'); return drawAll(); });
      });
    }
  };
  await drawAll();
  /* shown again: the plan, governed mode and the ladder are read again, and the providers (a probe of this computer included) */
  return { refresh: async () => { await Promise.all([plan.refresh(), drawAll(), providers?.refresh({ probe: true })]); } };
}
