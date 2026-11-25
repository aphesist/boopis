/* The models plan as a Settings section on the v7 kit: a SectionHead and a Card of Rows (label, value, the explanation behind the
   label's mark), filled only with what the engine reported (free-tier.ts). It has no page of its own: Settings > Models mounts it
   (`mountPlan`), and Diagnostics carries the same facts as text (`planLines`, in the report). Refreshing asks again; nothing is
   cached or guessed. */
import { kit, ui } from '@boopis/ui';
import { currentPlan, inWords, resetText } from './free-tier';
import type { PlanView } from './free-tier';

/** a Row of a settings Card (v7 12.2) */
export type SetRow = Parameters<typeof kit.html.card>[0]['rows'][number];
const PLAN_WORD: Readonly<Record<PlanView['kind'], string>> = { free: 'Free', none: 'None in use', unknown: 'Not reported' };

/** the rows of the section for one view */
export function planRows(view: PlanView, now = Date.now()): SetRow[] {
  const rows: SetRow[] = [{ label: 'Plan', value: view.label ? `${PLAN_WORD[view.kind]} (${view.label})` : PLAN_WORD[view.kind], ...(view.detail ? { explain: view.detail } : {}) }];
  if (view.model) rows.push({ label: 'Model', value: ui.modelMark.called(view.model) || view.model });
  if (view.limit) {
    const when = resetText(view.limit.resetsAtMs, now);
    const why = [view.limit.message, when].filter(Boolean).join(' ');
    rows.push({ label: 'Limit', value: view.limit.code.replace(/^free_tier_/, '').replace(/_/g, ' '), ...(why ? { explain: why } : {}) });
  }
  for (const g of view.gauges) rows.push({ label: g.title, value: String(g.usedPercent) + '% used', mono: false, explain: `${g.provider}${g.resetsAtMs === null ? '' : `, resets ${inWords(g.resetsAtMs - now)}`}` });
  if (view.gaugesNote) rows.push({ label: 'Usage', explain: view.gaugesNote });
  if (view.checking) rows.push({ label: 'Quick check', explain: 'The account service asked for a short browser check. It runs in the background and appears only if it needs you.' });
  return rows;
}

/** a section of a settings page: its SectionHead (`id`-h) and its Card */
export function setSection(id: string, title: string, rows: readonly SetRow[], extra = ''): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'k7-section'; sec.id = id;
  sec.setAttribute('role', 'group'); sec.setAttribute('aria-labelledby', id + '-h');
  sec.innerHTML = kit.html.sectionHead({ title, attrs: { id: id + '-h' } }) + (rows.length ? kit.html.card({ rows }) : '') + extra;
  kit.wire(sec);
  return sec;
}
/** the body of the settings page in `panel` (a page titled `title` is drawn there first when it has none) */
export function pageBody(panel: HTMLElement, title: string): HTMLElement {
  let body = panel.querySelector<HTMLElement>('.k7-page__body');
  if (!body) { panel.innerHTML = kit.html.page({ variant: 'settings', title, body: '' }); body = panel.querySelector<HTMLElement>('.k7-page__body') as HTMLElement; }
  return body;
}

/** build the section for a view */
export function planSection(view: PlanView, now = Date.now()): HTMLElement {
  /* a plan that could not be read says why in the page, not behind a label */
  const why = view.kind === 'unknown' && view.detail ? kit.html.notice({ text: view.detail, tone: 'neutral', place: 'page' }) : '';
  return setSection('hx-set-plan', 'Plan', planRows(view, now), why);
}

/** Put the plan into a Settings panel (Settings > Models) and refresh it: it asks the engine now, and says so when it cannot be
    asked (no live connection). Returns the section, which `refresh` redraws in place. */
export async function mountPlan(panel: HTMLElement, ask: () => Promise<PlanView | null> = currentPlan): Promise<{ section: HTMLElement; refresh: () => Promise<void> }> {
  const unknown: PlanView = { kind: 'unknown', state: 'unknown', label: '', model: null, detail: 'boopis\'s engine is not connected, so the plan cannot be read.', gauges: [], gaugesNote: null, limit: null, checking: false };
  let section = planSection(unknown);
  pageBody(panel, 'Models').append(section);
  const refresh = async (): Promise<void> => {
    const next = planSection((await ask()) ?? unknown);
    section.replaceWith(next);
    section = next;
  };
  await refresh();
  return { get section() { return section; }, refresh };
}
