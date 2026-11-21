/* Who answered, drawn: the divider where the answering model changes, and the "ungoverned" mark on a turn the person sent to one
   model outside governed mode. Pure DOM over the turns the conversation already drew: each agent turn carries `data-answered`
   (the model that answered it: the last of its route, empty when nothing recorded it), and `syncDividers` places a divider
   before every turn whose model differs from the last known one. A turn of unknown model neither draws a divider nor hides one
   (nothing is guessed). The engine's own "[Model switched to ...]" rows are not shown; this row replaces them. */
import { ui } from '@boopis/ui';
import { el } from '../../core/dom';

export const UNKNOWN_MODEL = 'Model unknown';
export const UNGOVERNED_TIP = 'You sent this message to one model with @. It ran without governance: no cascade, no gate. The next message is governed again.';

/** the model that answered a turn: the last of its route ('a → b' answered with b); empty when unknown */
export const answeredModel = (model: string): string => ui.modelMark.last(model);

/** record who answered a turn on its element (for the dividers) */
export function markAnswered(t: HTMLElement, model: string): void { t.dataset['answered'] = answeredModel(model); }

/** the row between two answers by different models: "Claude Haiku → GPT-6 Luna", each with its logo */
export function dividerRow(from: string, to: string): HTMLElement {
  /* the conversation is a feed, whose children are turns: the row is a plain block, drawn for the eye (aria-hidden) and said once in words */
  const row = el('div', { class: 'ss-divider' });
  row.append(el('span', { class: 'ui-sr', text: 'The answering model changed from ' + (ui.modelMark.called(from) || from) + ' to ' + (ui.modelMark.called(to) || to) }),
    el('span', { class: 'ss-divider__rule', 'aria-hidden': 'true' }), el('span', { class: 'ss-divider__who', 'aria-hidden': 'true' }, ui.modelRoute(from + ' → ' + to)), el('span', { class: 'ss-divider__rule', 'aria-hidden': 'true' }));
  return row;
}

/** draw the dividers of a conversation column again: one before each agent turn whose model differs from the last known one */
export function syncDividers(col: HTMLElement): void {
  col.querySelectorAll('.ss-divider').forEach((d) => { d.remove(); });
  let last = '';
  for (const t of col.querySelectorAll<HTMLElement>('[data-hx-turn][data-answered]')) {
    const now = t.dataset['answered'] ?? '';
    if (!now) continue;
    if (last && !ui.modelMark.same(last, now)) t.before(dividerRow(last, now));
    last = now;
  }
}

/** the small "ungoverned" mark beside a turn's model, or none */
export function stampUngoverned(t: HTMLElement, on: boolean): void {
  const callno = t.querySelector('.ui-callno');
  if (!callno) return;
  callno.querySelector('.ss-ungov')?.remove();
  t.toggleAttribute('data-ungoverned', on);
  /* the badge is not a control, so the turn's name says it too (a screen reader reads the turn, not the badge) */
  const named = (t.getAttribute('aria-label') ?? '').replace(/, ungoverned$/, '');
  if (named) t.setAttribute('aria-label', named + (on ? ', ungoverned' : ''));
  if (!on) return;
  const badge = ui.html.badge({ label: 'ungoverned', tip: UNGOVERNED_TIP, class: 'ss-ungov' });
  const mark = document.createElement('template');
  mark.innerHTML = badge;
  const kids = [...callno.children].filter((c) => !c.classList.contains('ui-callno__who'));
  const lead = kids.filter((c) => c.querySelector('.ui-model') || /^\s*(→|->)/.test(c.textContent ?? '') || c.textContent === UNKNOWN_MODEL);
  const after = lead[lead.length - 1];
  const node = mark.content.firstElementChild as HTMLElement;
  if (after) after.after(node); else callno.prepend(node);
}
