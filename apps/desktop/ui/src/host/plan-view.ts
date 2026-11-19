/* The models plan as a Settings section: the same rows the design system's settings use (`setRow`), filled only with what
   Hermes reported (free-tier.ts). It has no tab of its own here: Settings > Models mounts it (`mountPlan`), and Diagnostics
   carries the same facts as text (`planLines`, in the report). Refreshing asks Hermes again; nothing is cached or guessed. */
import { ui } from '../components';
import { currentPlan, inWords, resetText } from './free-tier';
import type { PlanView } from './free-tier';

const PLAN_WORD: Readonly<Record<PlanView['kind'], string>> = { free: 'Free', none: 'None in use', unknown: 'Not reported' };

/** the rows of the section for one view */
export function planRows(view: PlanView, now = Date.now()): string[] {
  const rows = [
    ui.html.setRow({ label: 'Plan', hint: view.detail, control: '<span class="ui-set__value">' + esc(view.label ? `${PLAN_WORD[view.kind]} (${view.label})` : PLAN_WORD[view.kind]) + '</span>' })
  ];
  if (view.model) rows.push(ui.html.setRow({ label: 'Model', control: '<span class="ui-set__value">' + esc(view.model) + '</span>' }));
  if (view.limit) {
    const when = resetText(view.limit.resetsAtMs, now);
    rows.push(ui.html.setRow({ label: 'Limit', hint: [view.limit.message, when].filter(Boolean).join(' ') || null, control: '<span class="ui-set__value">' + esc(view.limit.code.replace(/^free_tier_/, '').replace(/_/g, ' ')) + '</span>' }));
  }
  for (const g of view.gauges) {
    rows.push(ui.html.setRow({ label: g.title, hint: `${g.provider}${g.resetsAtMs === null ? '' : `, resets ${inWords(g.resetsAtMs - now)}`}`, control: '<span class="ui-set__value">' + String(g.usedPercent) + '% used</span>' }));
  }
  if (view.gaugesNote) rows.push(ui.html.setRow({ label: 'Usage', hint: view.gaugesNote }));
  if (view.checking) rows.push(ui.html.setRow({ label: 'Quick check', hint: 'The account service asked for a short browser check. It runs in the background and appears only if it needs you.' }));
  return rows;
}
const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** build the section for a view */
export function planSection(view: PlanView, now = Date.now()): HTMLElement {
  const sec = document.createElement('section');
  sec.className = 'hx-set';
  sec.setAttribute('aria-labelledby', 'hx-set-plan-h');
  sec.innerHTML = '<h3 class="ui-set__head" id="hx-set-plan-h">Plan</h3>' + planRows(view, now).join('');
  return sec;
}

/** Put the plan into a Settings panel (Settings > Models) and refresh it: it asks Hermes now, and says so when Hermes cannot
    be asked (no live connection). Returns the section, which `refresh` redraws in place. */
export async function mountPlan(panel: HTMLElement, ask: () => Promise<PlanView | null> = currentPlan): Promise<{ section: HTMLElement; refresh: () => Promise<void> }> {
  const unknown: PlanView = { kind: 'unknown', state: 'unknown', label: '', model: null, detail: 'Hermes is not connected, so the plan cannot be read.', gauges: [], gaugesNote: null, limit: null, checking: false };
  let section = planSection(unknown);
  panel.append(section);
  const refresh = async (): Promise<void> => {
    const next = planSection((await ask()) ?? unknown);
    section.replaceWith(next);
    section = next;
    ui.hydrate(next);
  };
  await refresh();
  return { get section() { return section; }, refresh };
}
