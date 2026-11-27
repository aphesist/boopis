/* The models plan as a Settings section: the kit's settings Card of rows (board 14's `.sr`), filled only with what
   Hermes reported (free-tier.ts). It has no tab of its own here: Settings > Models mounts it (`mountPlan`), and Diagnostics
   carries the same facts as text (`planLines`, in the report). Refreshing asks Hermes again; nothing is cached or guessed. */
import { kit, ui } from '@boopis/ui';
import type { RowOpts } from '@boopis/ui';
import { frag } from '../core/dom';
import { currentPlan, inWords, resetText } from './free-tier';
import type { PlanView } from './free-tier';

const PLAN_WORD: Readonly<Record<PlanView['kind'], string>> = { free: 'Free', none: 'None in use', unknown: 'Not reported' };

/** the rows of the section for one view */
export function planRows(view: PlanView, now = Date.now()): RowOpts[] {
  const rows: RowOpts[] = [
    { label: 'Plan', ...(view.detail ? { sub: view.detail } : {}), value: view.label ? `${PLAN_WORD[view.kind]} (${view.label})` : PLAN_WORD[view.kind] }
  ];
  if (view.model) rows.push({ label: 'Model', value: ui.modelMark.called(view.model) || view.model });
  if (view.limit) {
    const when = resetText(view.limit.resetsAtMs, now);
    const sub = [view.limit.message, when].filter(Boolean).join(' ');
    rows.push({ label: 'Limit', ...(sub ? { sub } : {}), value: view.limit.code.replace(/^free_tier_/, '').replace(/_/g, ' ') });
  }
  for (const g of view.gauges) rows.push({ label: g.title, sub: `${g.provider}${g.resetsAtMs === null ? '' : `, resets ${inWords(g.resetsAtMs - now)}`}`, value: String(g.usedPercent) + '% used' });
  if (view.gaugesNote) rows.push({ label: 'Usage', sub: view.gaugesNote });
  if (view.checking) rows.push({ label: 'Quick check', sub: 'Runs in the background and shows only if it needs you.' });
  return rows;
}

/** build the section for a view */
export function planSection(view: PlanView, now = Date.now()): HTMLElement {
  return kit.wire(frag(kit.section('Plan', kit.html.card({ variant: 'settings', rows: planRows(view, now), attrs: { 'data-part': 'plan' } }))));
}

/** Put the plan into a Settings panel (Settings > Models) and refresh it: it asks Hermes now, and says so when Hermes cannot
    be asked (no live connection). Returns the section, which `refresh` redraws in place. */
export async function mountPlan(panel: HTMLElement, ask: () => Promise<PlanView | null> = currentPlan): Promise<{ section: HTMLElement; refresh: () => Promise<void> }> {
  const unknown: PlanView = { kind: 'unknown', state: 'unknown', label: '', model: null, detail: 'Engine not connected.', gauges: [], gaugesNote: null, limit: null, checking: false };
  let section = planSection(unknown);
  panel.append(section);
  const refresh = async (): Promise<void> => {
    const next = planSection((await ask()) ?? unknown);
    section.replaceWith(next);
    section = next;
  };
  await refresh();
  return { get section() { return section; }, refresh };
}
