/* A project's switch "no engine plugins and no plugin hooks" (docs/STORE.md 5.8): a Card row with the kit's Switch, on by default for a
   governed project, and the words that say what it does. It is the plugin's setting, read and written through the provider. */
import { kit } from '@boopis/ui';
import type { ProjectPolicy, StoreProvider } from '../../data';
import { errorText } from './model';

export const POLICY_LABEL = 'No engine plugins and no plugin hooks';
export function policyHint(_p: ProjectPolicy): string {
  return 'Plugins and hooks run outside the sandbox.';
}

const seen = new Map<string, ProjectPolicy>();   // the last answer per project, so a redrawn page shows it at once

/** the row for `project`, filled when the plugin answers; `say` reports a failure in words */
export function projectSwitch(store: Pick<StoreProvider, 'projectPolicy' | 'setProjectPolicy'>, project: string, say: (text: string) => void): HTMLElement {
  const host = document.createElement('div');
  host.dataset['storePolicy'] = project;
  const draw = (p: ProjectPolicy | null, problem?: string): void => {
    host.innerHTML = kit.html.card({ variant: 'settings', rows: [{ label: POLICY_LABEL, sub: p ? policyHint(p) : (problem ?? 'Reading this project’s setting.'), ...(p ? { control: kit.html.switch({ checked: p.effective, label: POLICY_LABEL, attrs: { 'data-store-policy-switch': '' } }) } : {}) }] });
    kit.wire(host);
    const sw = host.querySelector<HTMLElement>('[data-store-policy-switch]');
    sw?.addEventListener('ui:change', (e) => {
      const want = !!(e as CustomEvent<{ value: boolean }>).detail.value;
      store.setProjectPolicy(project, want).then((n) => { seen.set(project, n); draw(n); say(want ? 'Plugins and hooks are off for this project.' : 'Plugins and hooks may run here once approved.'); }).catch((err: unknown) => { sw.setAttribute('aria-checked', String(!want)); say(errorText(err)); });
    });
  };
  draw(seen.get(project) ?? null);
  store.projectPolicy(project).then((p) => { seen.set(project, p); draw(p); }).catch((e: unknown) => { draw(null, errorText(e)); });
  return host;
}
