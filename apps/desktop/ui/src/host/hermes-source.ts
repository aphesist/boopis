/* Settings > General > Advanced > "Use my own Hermes" (ADR-0023: pointing the app at an existing Hermes is an advanced
   setting). The app runs the Hermes it carries, in a folder of its own. This switch saves the other choice, the Hermes already
   on the computer, as the host's `hermes_source` (which `BOOPIS_HERMES` overrides). The host reads it when the app starts, so
   the control says that and offers the restart. It knows nothing about Hermes beyond what the host reports. */
import { ui } from '../components';
import { restartApp } from './renderer';
import { loadSource, saveSource } from './setup-bridge';
import type { Source, SourceInfo } from './setup-bridge';

export interface SourceDeps {
  load: () => Promise<SourceInfo>;
  save: (s: Source) => Promise<SourceInfo>;
  restart: () => Promise<void>;
  toast: (text: string) => void;
}
export const realSourceDeps = (): SourceDeps => ({ load: loadSource, save: saveSource, restart: restartApp, toast: (t) => { ui.toast(t); } });

const WHICH: Readonly<Record<Source, string>> = { bundled: 'the Hermes boopis carries', existing: 'the Hermes on this computer' };

/** what is true about the choice right now, one sentence each: the first says what the switch does, the rest where it stands */
export function sourceNotes(v: SourceInfo): string[] {
  const out: string[] = [];
  if (!v.carries_runtime) {
    out.push('This build carries no Hermes of its own, so it always uses the one on this computer.');
    return out;
  }
  if (v.from_env) out.push(`BOOPIS_HERMES is set to ${v.from_env} and overrides this choice.`);
  out.push(`Running now: ${WHICH[v.running]}.`);
  if (!v.from_env && v.next !== v.running) out.push('Saved. It applies after a restart.');
  return out;
}

export const BASE_HINT = 'boopis runs the Hermes it carries, in a folder of its own. Turn this on to use the Hermes already installed on this computer instead, with its own settings and profile. Setup then runs again there and asks before it changes any Hermes setting. It applies the next time the app starts.';

/** build the section, load the choice and wire the switch. Resolves with the section once it shows what the host reported. */
export async function mountHermesSource(panel: HTMLElement, deps: SourceDeps = realSourceDeps()): Promise<HTMLElement> {
  const sec = document.createElement('section');
  sec.className = 'hx-set';
  sec.setAttribute('aria-labelledby', 'hx-set-adv-h');
  sec.innerHTML = '<h3 class="ui-set__head" id="hx-set-adv-h">Advanced</h3>' + ui.html.setRow({
    for: 'hx-set-own-hermes', label: 'Use my own Hermes', hint: BASE_HINT,
    control: '<div class="ui-set__actions">' + ui.html.switch({ id: 'hx-set-own-hermes', checked: false, disabled: true }) + ui.html.button({ label: 'Restart to switch', size: 's', attrs: { id: 'hx-set-own-restart', hidden: true } }) + '</div>'
  });
  panel.append(sec);
  ui.hydrate(sec);
  const sw = sec.querySelector<HTMLInputElement>('#hx-set-own-hermes');
  const restart = sec.querySelector<HTMLElement>('#hx-set-own-restart');
  const hint = sec.querySelector<HTMLElement>('.ui-set__label small');
  if (!sw || !restart || !hint) return sec;
  const show = (v: SourceInfo): void => {
    sw.checked = v.next === 'existing';
    sw.disabled = !v.carries_runtime || v.from_env !== null;
    hint.textContent = [v.carries_runtime ? BASE_HINT : '', ...sourceNotes(v)].filter(Boolean).join(' ');
    restart.hidden = !(v.carries_runtime && v.from_env === null && v.next !== v.running);
  };
  let current: SourceInfo;
  try { current = await deps.load(); show(current); } catch (e) {
    sw.disabled = true;
    hint.textContent = `${BASE_HINT} The host could not report the choice: ${e instanceof Error ? e.message : 'unknown error'}.`;
    return sec;
  }
  sw.addEventListener('ui:change', (e) => {
    const want: Source = (e as CustomEvent<{ value: boolean }>).detail.value ? 'existing' : 'bundled';
    void deps.save(want).then((v) => { current = v; show(v); }).catch((err: unknown) => {
      show(current);
      deps.toast(err instanceof Error ? err.message : 'That did not save');
    });
  });
  restart.addEventListener('click', () => { void deps.restart().catch((err: unknown) => { deps.toast(err instanceof Error ? err.message : 'That did not work'); }); });
  return sec;
}
