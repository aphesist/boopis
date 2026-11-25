/* What the Session tab's S0 controls show and do (ADR-0057): the launch row's values, the folder chooser, the effort menu and
   the "How careful" menu, in the canvas before the first message and on the composer's line after it. Everything is read
   from the provider's `sessionControls` (the capability map, the launch settings) and the details' governance; a change is
   a command on it, and why it was refused is said, never swallowed. */
import { cap1 } from '../../core/dom';
import { kit, ui } from '@boopis/ui';
import { data } from '../../data';
import type { CarefulStep } from '../../data';
import type { LaunchView } from './s0';
import { openCarefulMenu, v7Attrs } from './s0';

const controls = () => data().sessionControls;
const base = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

export function launchView(): LaunchView {
  const c = controls();
  const l = c?.launch.get(), caps = c?.capabilities.get();
  const g = data().details.governance.get();
  const signedIn = data().details.choices.get().length > 0;
  return {
    folder: l?.folder ? base(l.folder) : null,
    model: !signedIn ? null : g.smart || !g.model ? 'Smart' : ui.modelMark.called(g.model) || g.model,
    effort: caps?.launch.efforts.length ? (l?.effort ? cap1(l.effort) : 'Default') : null,
    careful: l?.careful ?? 'auto_edits',
    fellBack: l?.fellBack ?? false,
    waiting: []
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
    onPick: (step: CarefulStep) => { void c.setCareful(step).then((why) => { if (why) ui.toast(why); }); }
  });
}

export function openEffort(anchor: HTMLElement): void {
  const c = controls();
  if (!c) return;
  const now = c.launch.get().effort;
  const entries = [{ label: 'Default', value: '', desc: 'The profile\'s own', ...(now === null ? { icon: 'check' } : {}) }, ...c.capabilities.get().launch.efforts.map((e) => ({ label: cap1(e), value: e, ...(now === e ? { icon: 'check' } : {}) }))];
  kit.openMenu(anchor, { label: 'Effort', entries, place: 'below', align: 'center', attrs: v7Attrs(), onSelect: (v) => { const why = c.setLaunch({ effort: v || null }); if (why) ui.toast(why); } });
}

export async function openFolder(): Promise<void> {
  const c = controls();
  if (!c) return;
  if (!c.pickFolder) { ui.toast('Choosing a folder needs the desktop app.'); return; }
  const folder = await c.pickFolder();
  if (!folder) return;
  const why = c.setLaunch({ folder });
  if (why) ui.toast(why);
}
