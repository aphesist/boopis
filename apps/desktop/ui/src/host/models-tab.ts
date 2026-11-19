/* Settings > Models: the plan Hermes reports (`mountPlan`), the ladder the plugin runs governed work on (which model at which
   tier, as Hermes's configuration holds it) and "Change models", which asks setup's models question again through the same
   first-run view and forms. Everything shown is read now, from the host or Hermes; what could not be read is said so, never
   filled in. The rows are the design system's settings rows and ladder list. */
import { ui } from '@boopis/ui';
import { changeModels } from './change-models';
import { currentPlan } from './free-tier';
import type { PlanView } from './free-tier';
import { mountPlan } from './plan-view';
import { loadModelsView } from './setup-bridge';
import type { ModelsView } from './setup-bridge';

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
}
export const realModelsDeps = (closeSettings: () => void): ModelsDeps => ({
  plan: currentPlan, ladder: loadModelsView, change: () => changeModels(), closeSettings, toast: (t) => { ui.toast(t); }
});

const SCOPE = 'A task starts at the first tier and moves to the next only when its gate fails.';

const CLAUDE_STATE: Readonly<Record<ModelsView['claude']['state'], string>> = {
  signed_in: 'Signed in', signed_out: 'Not signed in', not_installed: 'Not installed', metered: 'Signed in, but not to your subscription', old_version: 'Needs an update'
};
const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** The Claude subscription section's rows: whether the user's own Claude Code is signed in, its version, and whether Hermes has
    the plugin. Everything is what the host read from the CLI's own commands; a plan or version it did not report is not shown. */
export function claudeRows(view: ModelsView | { error: string }): string[] {
  if ('error' in view) return [ui.html.setRow({ label: 'Claude Code', hint: `Not read: ${view.error}` })];
  const c = view.claude;
  const word = c.state === 'signed_in' && c.plan ? `${CLAUDE_STATE[c.state]} (${c.plan})` : CLAUDE_STATE[c.state];
  const hint = c.state === 'signed_in' ? 'Runs on your own Claude Code login, through Hermes\'s official plugin. boopis never sees your Claude login.' : c.detail;
  const rows = [
    ui.html.setRow({
      label: 'Claude Code', hint,
      control: '<span class="ui-set__value">' + esc(word) + '</span>' + (c.state === 'signed_in' ? '' : ui.html.button({ label: 'Check again', size: 's', attrs: { id: 'hx-claude-check' } }))
    }),
    ui.html.setRow({ label: 'Version', control: '<span class="ui-set__value">' + esc(c.version ?? 'Not reported') + '</span>' }),
    ui.html.setRow({
      label: 'Plugin', hint: view.claude_plugin ? null : 'Hermes\'s Claude subscription plugin. Change models installs it, after showing you what it is, when you choose the Claude subscription.',
      control: '<span class="ui-set__value">' + (view.claude_plugin ? 'Installed in Hermes' : 'Not installed') + '</span>'
    })
  ];
  return rows;
}

/** the ladder section's rows for what the host read, or for why it could not */
export function ladderRows(view: ModelsView | { error: string }): string[] {
  if ('error' in view) return [ui.html.setRow({ label: 'Tiers', hint: `Hermes could not be asked, so the ladder is not shown: ${view.error}` })];
  if (view.state === 'set') {
    return [
      ui.html.setRow({ label: 'Tiers', hint: `Cheapest first. ${SCOPE}` }),
      '<div class="hx-ladder">' + ui.html.ladder({ variant: 'list', current: 0, label: 'Model ladder', stations: view.tiers.map((t) => [t.model, t.name] as const) }) + '</div>'
    ];
  }
  if (view.state === 'default') return [ui.html.setRow({ label: 'Tiers', hint: 'No ladder is saved here, so boopis uses its built-in Claude ladder: haiku, sonnet, opus. Change models saves one of your own.' })];
  return [ui.html.setRow({ label: 'Tiers', hint: 'A ladder is saved, but it does not read as a list of named tiers, so none is shown. Change models saves a new one.' })];
}

/** Put the tab into `panel`. `refresh` asks Hermes and the host again; call it each time the tab is shown. */
export async function mountModels(panel: HTMLElement, deps: ModelsDeps): Promise<{ refresh: () => Promise<void> }> {
  const plan = await mountPlan(panel, deps.plan);
  const ladder = document.createElement('section');
  ladder.className = 'ui-set';
  ladder.setAttribute('aria-labelledby', 'hx-set-ladder-h');
  panel.append(ladder);
  const claude = document.createElement('section');
  claude.className = 'ui-set';
  claude.setAttribute('aria-labelledby', 'hx-set-claude-h');
  panel.append(claude);
  const change = document.createElement('section');
  change.className = 'ui-set';
  change.setAttribute('aria-labelledby', 'hx-set-change-h');
  change.innerHTML = ui.html.setHead({ id: 'hx-set-change-h', label: 'Change' }) + ui.html.setRow({
    label: 'Models', hint: 'Ask the models question again: free models, OpenRouter\'s free models, Claude, or a model you set up. Nothing changes until you answer.',
    control: ui.html.button({ label: 'Change models', size: 's', attrs: { id: 'hx-models-change' } })
  });
  panel.append(change);
  ui.hydrate(change);
  change.querySelector('#hx-models-change')?.addEventListener('click', () => {
    void deps.change().then(() => { deps.closeSettings(); }).catch((e: unknown) => { deps.toast(e instanceof Error ? e.message : 'That did not work'); });
  });
  /* one read of the host feeds both sections: the ladder and Claude Code's state */
  const drawLadder = async (): Promise<void> => {
    let view: ModelsView | { error: string };
    try { view = await deps.ladder(); } catch (e) { view = { error: e instanceof Error ? e.message : 'unknown error' }; }
    ladder.innerHTML = ui.html.setHead({ id: 'hx-set-ladder-h', label: 'Model ladder' }) + ladderRows(view).join('');
    claude.innerHTML = ui.html.setHead({ id: 'hx-set-claude-h', label: 'Claude subscription' }) + claudeRows(view).join('');
    ui.hydrate(ladder);
    ui.hydrate(claude);
    claude.querySelector('#hx-claude-check')?.addEventListener('click', () => { void drawLadder(); });
  };
  await drawLadder();
  return { refresh: async () => { await Promise.all([plan.refresh(), drawLadder()]); } };
}
