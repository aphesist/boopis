/* Settings › Sessions (board S39, its scope picked on S04: a Segmented in the page head). "This device" holds what new sessions start
   with on this computer: How careful (the four steps, S01 B; the step the Session tab's launch row starts from, ADR-0057). "This
   project" (shown when a project is open, S04) holds what the project's own setting says: "No engine plugins and no plugin hooks", the
   plugin's setting for that folder (docs/STORE.md 5.8), written where the store writes it.
   S39's other rows have no feature yet and are not shown (rule 2): Workspace (a worktree, `worktree`), the model a new session starts
   with and the one when it runs out, Enter while it runs (steer or queue, `queue`), Wait for my answer, Work log shows, and the four
   Inbox switches. */
import { kit } from '@boopis/ui';
import { data, CAREFUL, CAREFUL_STEPS, DEFAULT_CAREFUL } from '../../data';
import type { CarefulStep, ProjectPolicy } from '../../data';
import { KEYS, readJSON, writeJSON } from '../../core/settings';
import { POLICY_LABEL, policyHint } from '../store/policy';
import { fill, pageEl } from './page';
import type { Page } from './page';
import { openSelect, said, section, selectHTML, switchHTML } from './rows';

export const isStep = (s: unknown): s is CarefulStep => typeof s === 'string' && (CAREFUL_STEPS as readonly string[]).includes(s);
/** the step new sessions start with on this device (the launch row's own memory, `KEYS.sessionLaunch`) */
export const defaultCareful = (): CarefulStep => { const c = readJSON<Record<string, unknown>>(KEYS.sessionLaunch)?.['careful']; return isStep(c) ? c : DEFAULT_CAREFUL; };
export const setDefaultCareful = (step: CarefulStep): void => { writeJSON(KEYS.sessionLaunch, { ...(readJSON<Record<string, unknown>>(KEYS.sessionLaunch) ?? {}), careful: step }); };
const projectNow = (): string => { try { return data().details.environment.get().cwd || ''; } catch { return ''; } };
const base = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

export function sessionsPage(): Page {
  let scope: 'device' | 'project' = 'device', project = projectNow();
  let policy: ProjectPolicy | string | null = null;
  let host: HTMLElement = document.createElement('div');
  const wrap = document.createElement('div');
  wrap.className = 'hx-set__page';
  const build = (): void => {
    const { el, body } = pageEl('sessions', 'Sessions', project ? { items: [{ value: 'device', label: 'This device' }, { value: 'project', label: 'This project' }], value: scope } : undefined);
    host = body;
    wrap.replaceChildren(el);
    el.querySelector('[data-scope]')?.addEventListener('ui:change', (e) => { scope = (e as CustomEvent<{ value: string }>).detail.value === 'project' ? 'project' : 'device'; draw(); });
    draw();
  };
  const readPolicy = (): void => {
    if (!project) return;
    const p = project;
    data().store.projectPolicy(p).then((v) => { if (p === project) { policy = v; draw(); } }).catch((e: unknown) => { if (p === project) { policy = said(e); draw(); } });
  };
  function draw(): void {
    if (scope === 'project' && project) {
      const pol = policy;
      fill(host, section('Engine plugins in ' + base(project), [typeof pol === 'object' && pol
        ? { label: POLICY_LABEL, sub: policyHint(pol), control: switchHTML('policy', POLICY_LABEL, pol.effective) }
        : { label: POLICY_LABEL, sub: typeof pol === 'string' ? pol : 'Reading this project’s setting.' }], { 'data-part': 'project' }));
      return;
    }
    const step = defaultCareful();
    fill(host, data().sessionControls
      ? section('New sessions', [{ label: 'How careful', control: selectHTML('careful', 'How careful', CAREFUL[step].name) }], { 'data-part': 'new' })
      : kit.html.emptyState({ text: 'New sessions start from the Session tab.' }));
  }
  wrap.addEventListener('click', (e) => {
    const sel = (e.target as Element).closest<HTMLElement>('[data-select="careful"]');
    if (!sel) return;
    openSelect(sel, { label: 'How careful', heading: 'New sessions start', value: defaultCareful(), choices: CAREFUL_STEPS.map((s) => ({ value: s, label: CAREFUL[s].name, desc: CAREFUL[s].meaning })), onPick: (v) => { if (isStep(v)) { setDefaultCareful(v); draw(); } } });
  });
  wrap.addEventListener('ui:change', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset['set'] !== 'policy' || !project) return;
    const want = !!(e as CustomEvent<{ value: boolean }>).detail.value, p = project;
    data().store.setProjectPolicy(p, want)
      .then((n) => { policy = n; draw(); kit.notify(want ? 'Plugins and hooks are off for this project' : 'Plugins and hooks may run here once approved'); })
      .catch((err: unknown) => { draw(); kit.notify(said(err)); });
  });
  build();
  readPolicy();
  return {
    el: wrap,
    refresh: async () => {
      const now = projectNow();
      if (now !== project) { project = now; policy = null; if (!project) scope = 'device'; build(); readPolicy(); return; }
      readPolicy(); draw();
    },
    reveal: (o) => { if (o.focus === 'project' && project) { scope = 'project'; build(); } }
  };
}
