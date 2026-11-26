/* What the Session tab's S0 controls show and do (ADR-0057): the launch row's values, the folder chooser, the effort menu and
   the "How careful" menu, in the canvas before the first message and on the composer's line after it. Everything is read
   from the provider's `sessionControls` (the capability map, the launch settings) and the details' governance; a change is
   a command on it, and why it was refused is said, never swallowed. */
import { cap1 } from '../../core/dom';
import { kit, ui } from '@boopis/ui';
import { data } from '../../data';
import { later } from '../chat/compose';
import type { CarefulStep } from '../../data';
import type { LaunchView } from './s0';
import { openCarefulMenu, say, v7Attrs } from './s0';

const controls = () => data().sessionControls;
const base = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

/** the effort as ticks of five, as the launch row draws it: the profile's own (Default) is the middle */
const EFFORT_TICKS: Readonly<Record<string, number>> = { minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 5 };
export function launchView(): LaunchView {
  const c = controls();
  const l = c?.launch.get(), caps = c?.capabilities.get();
  const g = data().details.governance.get();
  const signedIn = data().details.choices.get().length > 0;
  /* the sessions waiting on you: an approval or a question, each with the folder and the branch it works in */
  const waiting = data().sessions.list.get().filter((s) => s.needs).map((s) => ({ id: s.id, title: s.title, sub: [s.project, s.branch].filter(Boolean).join(', '), word: s.needs === 'approval' ? 'Approval' : 'Question', model: s.model ?? null }));
  return {
    folder: l?.folder ? base(l.folder) : null,
    model: !signedIn ? null : g.smart || !g.model ? 'Smart' : g.model,
    effort: caps?.launch.efforts.length ? (l?.effort ? cap1(l.effort) : 'Default') : null,
    effortTicks: l?.effort ? EFFORT_TICKS[l.effort.toLowerCase()] ?? 3 : 3,
    careful: l?.careful ?? 'auto_edits',
    fellBack: l?.fellBack ?? false,
    ...(later('worktree') ? { worktree: true } : {}),
    waiting
  };
}

/** the "How careful" menu: the launch step before the first message, the session's own after it (in place, or continued) */
export function openCarefulFor(anchor: HTMLElement, place: 'above' | 'below'): void {
  const c = controls();
  if (!c) return;
  const caps = c.capabilities.get();
  const started = caps.session.changeModel.ok;
  openCarefulMenu(anchor, {
    current: c.launch.get().careful, avail: started ? caps.session.changeCareful : caps.launch.careful, place,
    onPick: (step: CarefulStep) => { void c.setCareful(step).then((why) => { if (why) say(why); }); }
  });
}

/** who answers the new session: Automatic (Smart picks a tier for each message), or one of the models the person can use now */
export const SMART = '__smart';
export function openModel(anchor: HTMLElement): void {
  const d = data().details, g = d.governance.get();
  const now = g.smart || !g.model ? SMART : g.model;
  const entries = [{ label: 'Automatic', desc: now === SMART ? 'Smart, now' : 'Smart picks for each message', value: SMART, icon: 'spark' },
    ...d.choices.get().map((c) => ({ label: ui.modelMark.short(c.model) || c.model, value: c.value, leadHTML: ui.html.modelMark(c.value, { size: 16, label: false }), desc: ui.modelMark.same(c.value, now) ? c.providerName + ', now' : c.providerName }))];
  kit.openMenu(anchor, { label: 'Model', variant: 'list', entries, place: 'below', align: 'center', attrs: v7Attrs(), onSelect: (v) => { const why = d.setGovernance(v === SMART ? { smart: true } : { smart: false, model: v }); if (why) say(why); } });
}

export function openEffort(anchor: HTMLElement): void {
  const c = controls();
  if (!c) return;
  const now = c.launch.get().effort;
  const entries = [{ label: 'Default', value: '', desc: 'The profile\'s own', ...(now === null ? { icon: 'check' } : {}) }, ...c.capabilities.get().launch.efforts.map((e) => ({ label: cap1(e), value: e, ...(now === e ? { icon: 'check' } : {}) }))];
  kit.openMenu(anchor, { label: 'Effort', entries, place: 'below', align: 'center', attrs: v7Attrs(), onSelect: (v) => { const why = c.setLaunch({ effort: v || null }); if (why) say(why); } });
}

export async function openFolder(): Promise<void> {
  const c = controls();
  if (!c) return;
  if (!c.pickFolder) { say('Choosing a folder needs the desktop app.'); return; }
  const folder = await c.pickFolder();
  if (!folder) return;
  const why = c.setLaunch({ folder });
  if (why) say(why);
}
