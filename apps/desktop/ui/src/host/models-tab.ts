/* Settings > Models: the plan (`mountPlan`), governed mode and its heavy switches, the ladder the plugin runs governed work on
   (which model at which tier), the Providers section (ADR-0039: every lab's sign-in, key, runtime on this computer and
   endpoint of your own, drawn from the catalogue by `providers-view.ts`), and "Change models", which asks setup's models question again through the same first-run view and
   forms. Everything shown is read now, from the host; what could not be read is said so, never filled in. The rows are the
   design system's settings rows and ladder list. */
import { ui } from '@boopis/ui';
import { changeModels } from './change-models';
import { currentPlan } from './free-tier';
import type { PlanView } from './free-tier';
import { mountPlan } from './plan-view';
import { loadModelsView, setHeavy } from './setup-bridge';
import type { ModelsView } from './setup-bridge';
import { tauriChatgptBridge } from './chatgpt-signin';
import { mountProviders } from './providers-view';
import type { ProvidersView } from './providers-view';
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
  plan: currentPlan, ladder: loadModelsView, change: () => changeModels(), closeSettings, toast: (t) => { ui.toast(t); },
  chatgpt: tauriChatgptBridge(), setHeavy, providers: tauriProvidersBridge(),
  login: async (provider) => (await import('./connectors-bridge')).tauriConnectorsBridge().login(provider)
});

const SCOPE = 'A task starts at the first tier and moves to the next only when its gate fails.';

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** a tier's second line: its name, and when governed mode will not run it, that, or that it is a heavy model the user chose (ADR-0037) */
const tierRule = (view: ModelsView, t: { name: string; model: string }): string => {
  const g = view.governed.tiers.find((c) => c.name === t.name && c.model === t.model);
  if (g?.frontier === false) return `${t.name}, not used in governed mode`;
  return g?.heavy ? `${t.name}, heavy: on the ladder because you chose it` : t.name;
};

/** The heavy models' switches (ADR-0037), one for each heavy model the saved ladder can take: Fable on either Claude choice, Grok on an
    xAI key. Each says in the user's terms why it is off by default; turning it on makes it the ladder's top tier, off takes it away.
    What the host says cannot be turned on (an old Claude Code) is shown under the switch and the switch stays off. */
export function heavyRows(view: ModelsView): string[] {
  return view.heavy.filter((c) => c.applies).map((c) => ui.html.setRow({
    label: esc(c.label),
    hint: esc(c.reason) + (c.blocked && !c.on ? ' ' + esc(c.blocked) : '') + ' Applies to sessions you start after this.',
    control: ui.html.switch({ id: `hx-heavy-${c.id}`, checked: c.on, disabled: !c.on && c.blocked !== null, label: c.label })
  }));
}

/** Governed mode's section (ADR-0037): the models it allows, each also in any later version, and whether the saved ladder lets it run.
    When it cannot, the row says why in one sentence and offers the way to get a model (Change models, the same question as setup's).
    The heavy models (Fable, Carbon, Grok) are on a ladder only when their switch, right under the status, is on. The allowed list and the
    heavy mark are the plugin's data file as the host reads it, never typed here. */
export function governedRows(view: ModelsView | { error: string }): string[] {
  if ('error' in view) return [ui.html.setRow({ label: 'Governed mode', hint: `Not read: ${view.error}` })];
  const g = view.governed;
  const status = g.available
    ? ui.html.setRow({ label: 'Status', hint: view.state === 'set' ? 'Every tier of the saved ladder is a frontier model.' : 'No ladder is saved, so boopis uses its built-in one: Opus, on your Anthropic key.', control: '<span class="ui-set__value">Available</span>' })
    : ui.html.setRow({
      label: 'Status',
      hint: `${g.why ?? 'No frontier model is set up.'} To use governed mode, sign in with your Claude subscription (Opus), sign in with ChatGPT or add an OpenAI key, on a plan or key that includes GPT-6.1 Terra, Sol or Astra, add a Gemini key for Gemini 4 Hydrogen or Neon, or turn on Grok with an xAI key. Sessions that are not governed can use any model.`,
      control: '<span class="ui-set__value">Unavailable</span>' + ui.html.button({ label: 'Change models', size: 's', attrs: { id: 'hx-governed-change' } })
    });
  return [
    ui.html.setRow({ label: 'Allowed models', hint: 'Governed mode runs every tier and the session itself only on these, or a later version of them. Anything else stays available outside governed mode. A heavy model is token-heavy or costly: it is never on a ladder boopis writes, only when you turn it on below or name it yourself.' }),
    ...g.allowed.map((name) => ui.html.setRow({
      label: esc(name),
      hint: g.heavy.includes(name) ? 'Heavy: only when you turn it on.' : undefined,
      control: '<span class="ui-set__value">or later</span>'
    })),
    status,
    ...heavyRows(view)
  ];
}

/** the ladder section's rows for what the host read, or for why it could not */
export function ladderRows(view: ModelsView | { error: string }): string[] {
  if ('error' in view) return [ui.html.setRow({ label: 'Tiers', hint: `The ladder could not be read, so it is not shown: ${view.error}` })];
  if (view.state === 'set') {
    return [
      ui.html.setRow({ label: 'Tiers', hint: `Cheapest first. ${SCOPE}` }),
      '<div class="hx-ladder">' + ui.html.ladder({ variant: 'list', current: 0, label: 'Model ladder', stations: view.tiers.map((t) => [t.model, tierRule(view, t)] as const) }) + '</div>'
    ];
  }
  if (view.state === 'default') return [ui.html.setRow({ label: 'Tiers', hint: 'No ladder is saved here, so boopis uses its built-in Claude ladder: Opus. Change models saves one of your own.' })];
  return [ui.html.setRow({ label: 'Tiers', hint: 'A ladder is saved, but it does not read as a list of named tiers, so none is shown. Change models saves a new one.' })];
}

const section = (panel: HTMLElement, id: string): HTMLElement => {
  const el = document.createElement('section');
  el.className = 'ui-set';
  el.setAttribute('aria-labelledby', id);
  panel.append(el);
  return el;
};

/** Put the tab into `panel`. `refresh` asks the host again; call it each time the tab is shown. */
export async function mountModels(panel: HTMLElement, deps: ModelsDeps): Promise<{ refresh: () => Promise<void> }> {
  const plan = await mountPlan(panel, deps.plan);
  const governed = section(panel, 'hx-set-governed-h');
  const ladder = section(panel, 'hx-set-ladder-h');
  const providersEl = section(panel, 'hx-set-providers-h');
  const change = section(panel, 'hx-set-change-h');
  change.innerHTML = ui.html.setHead({ id: 'hx-set-change-h', label: 'Change' }) + ui.html.setRow({
    label: 'Models', hint: 'Ask the models question again: how to connect, then which provider. Nothing changes until you answer.',
    control: ui.html.button({ label: 'Change models', size: 's', attrs: { id: 'hx-models-change' } })
  });
  ui.hydrate(change);
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
    providersEl.innerHTML = ui.html.setHead({ id: 'hx-set-providers-h', label: 'Providers' }) + ui.html.setRow({ label: 'Providers', hint: 'Not read: the host is not connected.' });
  }
  /* one read of the host feeds governed mode and the ladder */
  const drawAll = async (): Promise<void> => {
    let view: ModelsView | { error: string };
    try { view = await deps.ladder(); } catch (e) { view = { error: e instanceof Error ? e.message : 'unknown error' }; }
    governed.innerHTML = ui.html.setHead({ id: 'hx-set-governed-h', label: 'Governed mode' }) + governedRows(view).join('');
    ladder.innerHTML = ui.html.setHead({ id: 'hx-set-ladder-h', label: 'Model ladder' }) + ladderRows(view).join('');
    for (const s of [governed, ladder]) ui.hydrate(s);
    governed.querySelector('#hx-governed-change')?.addEventListener('click', askAgain);
    for (const sw of governed.querySelectorAll<HTMLInputElement>('input[id^="hx-heavy-"]')) {
      const id = sw.id.slice('hx-heavy-'.length);
      if (!deps.setHeavy) { sw.setAttribute('disabled', ''); continue; }
      sw.addEventListener('change', () => {
        deps.setHeavy?.(id, sw.checked).then(() => drawAll(), (e: unknown) => { deps.toast(e instanceof Error ? e.message : 'That did not work'); return drawAll(); });
      });
    }
  };
  await drawAll();
  /* shown again: the plan, governed mode and the ladder are read again, and the providers (a probe of this computer included) */
  return { refresh: async () => { await Promise.all([plan.refresh(), drawAll(), providers?.refresh({ probe: true })]); } };
}
