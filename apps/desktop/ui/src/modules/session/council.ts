/* The council in the session view (ADR-0035): the form that picks who sits on it, and what a council turn shows.
   The form is a popover from the composer's model menu ("Ask a council"): a list of the models on offer to check (members, at
   least two), a list to choose the combiner from, and one button. It starts from the last council (the engine keeps it in the
   profile's configuration) or from the best model of each provider. The turn shows each member's answer as a quiet, collapsible
   row (the provider's mark, the model's readable name, a state word), then the combiner's byline, then the combined answer
   (the entry's own prose). Built from the kit: no colour, size or control of its own. */
import { el } from '../../core/dom';
import { ui } from '@boopis/ui';
import { data } from '../../data';
import { MIN_COUNCIL } from '../../data/types';
import type { CouncilChoice, CouncilForm, CouncilSlot, CouncilTurn, ModelChoice } from '../../data';
import { randomId } from './shared';

export const COUNCIL_VALUE = '__council';
export const COUNCIL_DESC = 'Several models answer your next message, one combines them';
export const COUNCIL_KEYS = 'alt+C';
/** the cost, said as it is: one call for each member, and the combiner's own turn on top (it keeps the session's tools, so it may take several steps) */
export const COST_NOTE = 'Costs one call for each member, plus the combiner\'s own turn, which may take several steps.';
export const TOOLS_NOTE = 'Members answer without tools. The combiner keeps them.';

const nameOf = (s: CouncilSlot): string => ui.modelMark.called(s.model) || s.model;
const modelEl = (s: CouncilSlot): HTMLElement => ui.model(s.model, { name: nameOf(s) });
const plural = (n: number, one: string, many: string): string => n + ' ' + (n === 1 ? one : many);

/* ───────── the turn ───────── */

const STATE: Record<string, [word: string, tone?: string]> = { waiting: ['thinking', 'busy'], answered: ['done'], failed: ['failed', 'attention'] };
const OPEN = new WeakMap<HTMLElement, Set<number>>();

/** the progress line: where the council has got to, in words */
export function councilStatus(c: CouncilTurn): string {
  const answered = c.members.filter((m) => m.state === 'answered').length;
  if (c.phase !== 'members' && !c.members.length) return 'The members\' answers were not reported, so only the combined answer is shown.';
  if (c.phase === 'members') return c.total ? 'Asking ' + plural(c.total, 'member', 'members') + ': ' + c.done + ' of ' + c.total + ' answered.' : 'Asking the members.';
  if (c.phase === 'combining') return (c.combiner ? nameOf(c.combiner) : 'The combiner') + ' is combining ' + plural(answered, 'answer', 'answers') + '.';
  return (c.combiner ? nameOf(c.combiner) : 'The combiner') + ' combined ' + plural(answered, 'answer', 'answers') + '.';
}

function memberRow(host: HTMLElement, c: CouncilTurn, i: number): HTMLElement {
  const m = c.members[i] as CouncilTurn['members'][number];
  const id = 'ss-cm-' + randomId('');
  const open = OPEN.get(host)?.has(i) ?? false;
  const has = m.state === 'answered' && m.text !== '';
  const head = ui.disclosure({ label: '', controls: id, expanded: open && has });
  head.querySelector('span')?.replaceChildren(modelEl(m.slot));
  head.disabled = !has;
  head.setAttribute('aria-label', nameOf(m.slot) + ', ' + (STATE[m.state]?.[0] ?? '') + (has ? '. Show its answer' : ''));
  const [word, tone] = STATE[m.state] ?? ['', undefined];
  const state = el('span', { class: 'ui-state', text: word, ...(tone ? { 'data-tone': tone } : {}) });
  const body = el('div', { class: 'ss-council__text ui-prose', id, hidden: !(open && has) });
  for (const p of m.text.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean)) body.append(el('p', { html: ui.html.inline(p) }));
  head.addEventListener('ui:change', (e) => {
    const set = OPEN.get(host) ?? new Set<number>();
    if ((e as CustomEvent<{ value: boolean }>).detail.value) set.add(i); else set.delete(i);
    OPEN.set(host, set);
  });
  const row = el('div', { class: 'ss-council__m', 'data-state': m.state }, [el('div', { class: 'ss-council__head' }, [head, state]), body]);
  if (m.state === 'failed') row.append(el('p', { class: 'ss-council__why', text: 'It did not answer. The council went on without it.' }));
  return row;
}

/** draw (or draw again) a council turn's block into `host`; the answers the reader has opened stay open */
export function drawCouncil(host: HTMLElement, c: CouncilTurn): HTMLElement {
  host.className = 'ss-council'; host.setAttribute('role', 'group'); host.setAttribute('aria-label', 'Council');
  const byline = !!c.combiner && c.phase !== 'members' && c.members.length > 0;
  const status = el('p', { class: 'ss-council__status', role: 'status', 'aria-live': 'polite', text: byline ? '' : councilStatus(c) });
  host.replaceChildren(
    el('p', { class: 'ss-council__note', text: TOOLS_NOTE + ' ' + COST_NOTE }),
    ...c.members.map((_, i) => memberRow(host, c, i)),
    status
  );
  /* the combiner's byline: its mark and name, then what it did (the name is not written twice) */
  if (byline && c.combiner) status.append(modelEl(c.combiner), ' ' + councilStatus(c).slice(nameOf(c.combiner).length + 1));
  host.toggleAttribute('data-done', c.phase === 'done');
  return host;
}
export const councilBlock = (c: CouncilTurn): HTMLElement => drawCouncil(el('div'), c);

/* ───────── the form ───────── */

type Item = { label: string; model: string; value: string; checked: boolean; desc: string };
const listOf = (choices: readonly ModelChoice[], on: (c: ModelChoice) => boolean): Item[] => choices.map((c) => ({ label: ui.modelMark.called(c.model) || c.model, model: c.model, value: c.value, checked: on(c), desc: c.providerName }));

/** the form's content: members to check, the combiner to choose, and the button. `submit` is told the choice; it rejects with a sentence */
export function councilFormNode(form: CouncilForm, submit: (c: CouncilChoice) => Promise<void>): HTMLElement {
  const { options } = form;
  const slotOf = (v: string): CouncilSlot => { const c = options.find((x) => x.value === v) as ModelChoice; return { provider: c.provider, model: c.model }; };
  const valueOf = (s: CouncilSlot): string => options.find((c) => c.provider === s.provider && ui.modelMark.same(c.model, s.model))?.value ?? '';
  const members = new Set(form.choice.members.map(valueOf).filter(Boolean));
  let combiner = valueOf(form.choice.combiner);

  const lead = el('p', { class: 'ss-cf__lead', text: 'Your next message goes to several models, each answering on its own. One then combines their answers.' });
  const mList = el('div', { class: 'ss-cf__list ' + ui.scrollClass({ axis: 'y' }), role: 'menu', 'aria-label': 'Members' });
  const cList = el('div', { class: 'ss-cf__list ' + ui.scrollClass({ axis: 'y' }), role: 'menu', 'aria-label': 'Combiner' });
  const items = (list: Item[], role: 'menuitemcheckbox' | 'menuitemradio'): string => ui.html.menuItems(list.map((i) => ({ label: i.label, model: i.model, modelColor: 'mono' as const, value: i.value, desc: i.desc, checked: i.checked, role })));
  const err = el('p', { class: 'ss-cf__err', role: 'alert', 'data-tone': 'attention' });
  const go = ui.button({ label: 'Ask the council', variant: 'primary' });
  const note = el('p', { class: 'ss-cf__note', role: 'status', 'aria-live': 'polite' });

  const paint = (): void => {
    for (const b of mList.querySelectorAll<HTMLElement>('.ui-menu__item')) { const on = members.has(b.dataset['value'] ?? ''); b.setAttribute('aria-checked', String(on)); const g = b.querySelector('.ui-menu__glyph'); if (g) g.innerHTML = on ? ui.icon('check') : ''; }
    for (const b of cList.querySelectorAll<HTMLElement>('.ui-menu__item')) { const on = (b.dataset['value'] ?? '') === combiner; b.setAttribute('aria-checked', String(on)); const g = b.querySelector('.ui-menu__glyph'); if (g) g.innerHTML = on ? ui.icon('check') : ''; }
    const n = members.size;
    note.textContent = (n < MIN_COUNCIL ? 'Choose at least ' + MIN_COUNCIL + ' members. ' : plural(n, 'member', 'members') + ' answer, then ' + (combiner ? nameOf(slotOf(combiner)) : 'one model') + ' combines them. ') + COST_NOTE;
    go.disabled = n < MIN_COUNCIL || !combiner;
  };
  mList.innerHTML = items(listOf(options, (c) => members.has(c.value)), 'menuitemcheckbox');
  cList.innerHTML = items(listOf(options, (c) => c.value === combiner), 'menuitemradio');
  for (const b of [...mList.querySelectorAll<HTMLElement>('.ui-menu__item'), ...cList.querySelectorAll<HTMLElement>('.ui-menu__item')]) b.tabIndex = 0;   /* in a form each row is a tab stop (the menu's arrow keys belong to the layer's menu) */
  mList.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.ui-menu__item'); if (!b) return;
    const v = b.dataset['value'] ?? ''; if (members.has(v)) members.delete(v); else members.add(v);
    paint();
  });
  cList.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLElement>('.ui-menu__item'); if (!b) return; combiner = b.dataset['value'] ?? combiner; paint(); });
  go.addEventListener('click', () => {
    err.textContent = ''; go.disabled = true;
    submit({ members: [...members].map(slotOf), combiner: slotOf(combiner) }).catch((e: unknown) => { err.textContent = e instanceof Error ? e.message : 'The council could not be set up.'; paint(); });
  });
  const h = (t: string): HTMLElement => el('h3', { class: 'ss-cf__head', text: t });
  const hint = form.remembered ? 'Your last council.' : 'The best model of each provider you are signed in to.';
  const node = el('div', { class: 'ss-cf' }, [lead, h('Members, choose any'), el('p', { class: 'ss-cf__hint', text: hint }), mList, h('Combiner'), el('p', { class: 'ss-cf__hint', text: 'Writes the answer and keeps the tools. The session\'s model, unless you choose another.' }), cList, note, err, el('div', { class: 'ss-cf__foot' }, go)]);
  paint();
  return node;
}

/** open the form from the composer: it arms the next message on Ask. `done` runs once the council is armed */
export async function openCouncilForm(anchor: HTMLElement, uiId: string, done: () => void): Promise<void> {
  const src = data().council;
  const can = src.can(uiId);
  if (!can.ok) { ui.toast(can.reason); return; }
  let form: CouncilForm;
  try { form = await src.prepare(uiId); } catch (e) { ui.toast(e instanceof Error ? e.message : 'The council could not be read.'); return; }
  if (form.options.length < MIN_COUNCIL) { ui.toast('A council needs at least ' + MIN_COUNCIL + ' models you can use. Sign in to another provider in Settings, Models.'); return; }
  const node = councilFormNode(form, async (choice) => { await src.arm(uiId, choice); ui.popover.close(true); done(); ui.announce('The next message goes to a council of ' + choice.members.length); });
  ui.popover.open(anchor, node, { place: 'above', label: 'Ask a council' });
}
