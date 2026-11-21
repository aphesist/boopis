/* Settings > Models: the plan (`mountPlan`), the ladder the plugin runs governed work on (which model at which tier), each
   provider's state with the same sign-in or key it offers in setup (the Claude subscription, the ChatGPT subscription,
   Gemini: ADR-0030), and "Change models", which asks setup's models question again through the same first-run view and
   forms. Everything shown is read now, from the host; what could not be read is said so, never filled in. The rows are the
   design system's settings rows and ladder list. */
import { ui } from '@boopis/ui';
import { changeModels } from './change-models';
import { currentPlan } from './free-tier';
import type { PlanView } from './free-tier';
import { mountPlan } from './plan-view';
import { loadModelsView, setHeavy } from './setup-bridge';
import type { ModelsView } from './setup-bridge';
import { mountChatgptSignin, tauriChatgptBridge } from './chatgpt-signin';
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
}
export const realModelsDeps = (closeSettings: () => void): ModelsDeps => ({
  plan: currentPlan, ladder: loadModelsView, change: () => changeModels(), closeSettings, toast: (t) => { ui.toast(t); },
  chatgpt: tauriChatgptBridge(), setHeavy,
  login: async (provider) => (await import('./connectors-bridge')).tauriConnectorsBridge().login(provider)
});

const SCOPE = 'A task starts at the first tier and moves to the next only when its gate fails.';

const CLAUDE_STATE: Readonly<Record<ModelsView['claude']['state'], string>> = {
  signed_in: 'Signed in', signed_out: 'Not signed in', not_installed: 'Not installed', metered: 'Signed in, but not to your subscription', old_version: 'Needs an update'
};
const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** The Claude subscription section's rows: whether the user's own Claude Code is signed in and its version, with "Sign in to
    Claude" (Claude Code's own `claude auth login`) while it is not, and whether this engine includes the subscription.
    Everything is what the host read from the CLI's own commands; a plan or version it did not report is not shown. */
export function claudeRows(view: ModelsView | { error: string }): string[] {
  if ('error' in view) return [ui.html.setRow({ label: 'Claude Code', hint: `Not read: ${view.error}` })];
  const c = view.claude;
  const word = c.state === 'signed_in' && c.plan ? `${CLAUDE_STATE[c.state]} (${c.plan})` : CLAUDE_STATE[c.state];
  const hint = c.state === 'signed_in' ? 'Runs on your own Claude Code login. boopis never sees your Claude login.' : c.detail;
  const signIn = c.state === 'signed_out' || c.state === 'metered';
  const rows = [
    ui.html.setRow({
      label: 'Claude Code', hint,
      control: '<span class="ui-set__value">' + esc(word) + '</span>' +
        (signIn ? ui.html.button({ label: 'Sign in to Claude', size: 's', attrs: { id: 'hx-claude-signin' } }) : '') +
        (c.state === 'signed_in' ? '' : ui.html.button({ label: 'Check again', size: 's', attrs: { id: 'hx-claude-check' } }))
    }),
    ui.html.setRow({ label: 'Version', control: '<span class="ui-set__value">' + esc(c.version ?? 'Not reported') + '</span>' })
  ];
  if (!view.claude_plugin) {
    rows.push(ui.html.setRow({ label: 'Availability', hint: 'The Claude subscription comes with boopis\u2019s own engine. With your own engine (Settings, General, Advanced) it is not available.', control: '<span class="ui-set__value">Not in this engine</span>' }));
  }
  return rows;
}

const CHATGPT_STATE: Readonly<Record<NonNullable<ModelsView['chatgpt']>['state'], string>> = { signed_in: 'Signed in', signed_out: 'Not signed in', signing_in: 'Signing in' };
const planWord = (p: string): string => p.charAt(0).toUpperCase() + p.slice(1);

/** The ChatGPT subscription section's rows (ADR-0030): signed in or not with the plan the account names, and Sign in or Sign
    out. The sign-in card itself is drawn under the rows, in `#hx-chatgpt-card`. */
export function chatgptRows(view: ModelsView | { error: string }, canSignIn: boolean): string[] {
  if ('error' in view) return [ui.html.setRow({ label: 'ChatGPT', hint: `Not read: ${view.error}` })];
  const c = view.chatgpt;
  if (!c) return [ui.html.setRow({ label: 'ChatGPT', hint: 'Signing in with ChatGPT is not available here.' })];
  const word = c.state === 'signed_in' && c.plan ? `${CHATGPT_STATE[c.state]} (${planWord(c.plan)})` : CHATGPT_STATE[c.state];
  const hint = c.state === 'signed_in'
    ? 'boopis keeps the sign-in in your OS keychain and renews it by itself. Change models to run governed work on it.'
    : 'Sign in with your ChatGPT account on OpenAI\u2019s own page. Governed work can then run on the models your ChatGPT plan includes.';
  const control = '<span class="ui-set__value">' + esc(word) + '</span>' + (!canSignIn ? '' : c.state === 'signed_in'
    ? ui.html.button({ label: 'Sign out', size: 's', attrs: { id: 'hx-chatgpt-signout' } })
    : c.state === 'signed_out' ? ui.html.button({ label: 'Sign in', size: 's', attrs: { id: 'hx-chatgpt-signin' } }) : '');
  return [ui.html.setRow({ label: 'ChatGPT', hint, control })];
}

/** The Gemini section's rows: whether a key is in place, and "Add key", which asks the models question (where the key is
    asked for and kept in the keychain). */
export function geminiRows(view: ModelsView | { error: string }): string[] {
  if ('error' in view) return [ui.html.setRow({ label: 'Gemini key', hint: `Not read: ${view.error}` })];
  return [ui.html.setRow({
    label: 'Gemini key',
    hint: view.gemini_key
      ? 'Kept in your OS keychain. Change models to run governed work on Gemini.'
      : 'A free key from Google AI Studio (aistudio.google.com/apikey). Add key asks for it and keeps it in your OS keychain.',
    control: '<span class="ui-set__value">' + (view.gemini_key ? 'Saved' : 'No key') + '</span>' +
      (view.gemini_key ? '' : ui.html.button({ label: 'Add key', size: 's', attrs: { id: 'hx-gemini-add' } }))
  })];
}

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
  const claude = section(panel, 'hx-set-claude-h');
  const chatgpt = section(panel, 'hx-set-chatgpt-h');
  const gemini = section(panel, 'hx-set-gemini-h');
  const change = section(panel, 'hx-set-change-h');
  change.innerHTML = ui.html.setHead({ id: 'hx-set-change-h', label: 'Change' }) + ui.html.setRow({
    label: 'Models', hint: 'Ask the models question again: free models, OpenRouter\u2019s free models, Claude, ChatGPT, Gemini, or a model you set up. Nothing changes until you answer.',
    control: ui.html.button({ label: 'Change models', size: 's', attrs: { id: 'hx-models-change' } })
  });
  ui.hydrate(change);
  const askAgain = (): void => {
    void deps.change().then(() => { deps.closeSettings(); }).catch((e: unknown) => { deps.toast(e instanceof Error ? e.message : 'That did not work'); });
  };
  change.querySelector('#hx-models-change')?.addEventListener('click', askAgain);
  let card: { destroy: () => void } | null = null;
  /* one read of the host feeds every section: the ladder, Claude Code's state, the ChatGPT sign-in and the Gemini key */
  const drawAll = async (): Promise<void> => {
    let view: ModelsView | { error: string };
    try { view = await deps.ladder(); } catch (e) { view = { error: e instanceof Error ? e.message : 'unknown error' }; }
    governed.innerHTML = ui.html.setHead({ id: 'hx-set-governed-h', label: 'Governed mode' }) + governedRows(view).join('');
    ladder.innerHTML = ui.html.setHead({ id: 'hx-set-ladder-h', label: 'Model ladder' }) + ladderRows(view).join('');
    claude.innerHTML = ui.html.setHead({ id: 'hx-set-claude-h', label: 'Claude subscription' }) + claudeRows(view).join('');
    card?.destroy();
    card = null;
    chatgpt.innerHTML = ui.html.setHead({ id: 'hx-set-chatgpt-h', label: 'ChatGPT subscription' }) + chatgptRows(view, !!deps.chatgpt).join('') + '<div id="hx-chatgpt-card"></div>';
    gemini.innerHTML = ui.html.setHead({ id: 'hx-set-gemini-h', label: 'Gemini' }) + geminiRows(view).join('');
    for (const s of [governed, ladder, claude, chatgpt, gemini]) ui.hydrate(s);
    governed.querySelector('#hx-governed-change')?.addEventListener('click', askAgain);
    claude.querySelector('#hx-claude-check')?.addEventListener('click', () => { void drawAll(); });
    for (const sw of governed.querySelectorAll<HTMLInputElement>('input[id^="hx-heavy-"]')) {
      const id = sw.id.slice('hx-heavy-'.length);
      if (!deps.setHeavy) { sw.setAttribute('disabled', ''); continue; }
      sw.addEventListener('change', () => {
        deps.setHeavy?.(id, sw.checked).then(() => drawAll(), (e: unknown) => { deps.toast(e instanceof Error ? e.message : 'That did not work'); return drawAll(); });
      });
    }
    const login = deps.login;
    const signin = claude.querySelector<HTMLButtonElement>('#hx-claude-signin');
    if (signin && login) {
      signin.addEventListener('click', () => {
        signin.disabled = true;
        deps.toast('Finish signing in to Claude in your browser.');
        login('claude-code').then((r) => {
          if (!r.ok) deps.toast(r.timed_out ? 'The Claude sign-in took too long and was stopped.' : 'The Claude sign-in did not finish.');
          return drawAll();
        }, (e: unknown) => { deps.toast(e instanceof Error ? e.message : 'The Claude sign-in did not start.'); signin.disabled = false; });
      });
    } else signin?.remove();
    const bridge = deps.chatgpt;
    if (bridge) {
      chatgpt.querySelector('#hx-chatgpt-signin')?.addEventListener('click', () => {
        chatgpt.querySelector('#hx-chatgpt-signin')?.remove();
        const host = chatgpt.querySelector<HTMLElement>('#hx-chatgpt-card');
        if (host) card = mountChatgptSignin(host, bridge, { onSignedIn: () => { void drawAll(); } });
      });
      chatgpt.querySelector('#hx-chatgpt-signout')?.addEventListener('click', () => {
        bridge.signOut().then(() => drawAll(), (e: unknown) => { deps.toast(e instanceof Error ? e.message : 'Could not sign out'); });
      });
      /* a sign-in already waiting (begun in setup, or before the tab was redrawn) shows its code in place */
      if (!('error' in view) && view.chatgpt?.state === 'signing_in') {
        const host = chatgpt.querySelector<HTMLElement>('#hx-chatgpt-card');
        if (host) card = mountChatgptSignin(host, bridge, { onSignedIn: () => { void drawAll(); } });
      }
    }
    gemini.querySelector('#hx-gemini-add')?.addEventListener('click', askAgain);
  };
  await drawAll();
  return { refresh: async () => { await Promise.all([plan.refresh(), drawAll()]); } };
}
