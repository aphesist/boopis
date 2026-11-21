/* A project's switch "no engine plugins and no plugin hooks" (docs/STORE.md 5.8): a settings row with a switch, on by default for
   a governed project, and the words that say which it is. It is the plugin's setting, read and written through the provider. */
import { ui } from '@boopis/ui';
import type { ProjectPolicy, StoreProvider } from '../../data';
import { errorText } from './model';

export const POLICY_LABEL = 'No engine plugins and no plugin hooks';
export function policyHint(p: ProjectPolicy): string {
  const base = 'Engine plugins run in every session, outside the sandbox. Plugin hooks run commands on this computer.';
  if (p.explicit === null) return `${base} On by default here: this project is ${p.governed ? 'governed' : 'not governed'}.`.replace('On by default here', p.governed ? 'On by default here' : 'Off by default here');
  return `${base} Your choice for this project.`;
}

const seen = new Map<string, ProjectPolicy>();   // the last answer per project, so a redrawn panel shows it at once

/** the row for `project`, filled when the plugin answers; `say` reports a failure in words */
export function projectSwitch(store: Pick<StoreProvider, 'projectPolicy' | 'setProjectPolicy'>, project: string, say: (text: string) => void, id = 'hx-store-policy'): HTMLElement {
  const host = document.createElement('div');
  host.dataset['storePolicy'] = project;
  const draw = (p: ProjectPolicy | null, problem?: string): void => {
    host.innerHTML = ui.html.setRow({ label: POLICY_LABEL, hint: p ? policyHint(p) : (problem ?? 'Reading this project\'s setting.'), ...(p ? { for: id } : {}), control: p ? ui.html.switch({ id, checked: p.effective, label: POLICY_LABEL + (p.effective ? ' is on' : ' is off') }) : '' });
    ui.hydrate(host);
    const sw = host.querySelector<HTMLInputElement>('input[role=switch]');
    sw?.addEventListener('change', () => {
      const want = sw.checked;
      store.setProjectPolicy(project, want).then((n) => { seen.set(project, n); draw(n); say(want ? 'Engine plugins and plugin hooks are off for this project.' : 'Engine plugins and plugin hooks are allowed here once approved.'); }).catch((e: unknown) => { sw.checked = !want; say(errorText(e)); });
    });
  };
  draw(seen.get(project) ?? null);
  store.projectPolicy(project).then((p) => { seen.set(project, p); draw(p); }).catch((e: unknown) => { draw(null, errorText(e)); });
  return host;
}
