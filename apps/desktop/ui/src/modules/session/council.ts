/* The council in the session view (ADR-0035) on the v7 kit (REPASS.md step 6e; the lead's design, no board draws it):
   - The form is board S19's Menu: the models on offer as OptionRows with checks (each its mark, its name, its provider on the second
     line), and under them the combiner as a SelectorItem and "Ask the council". Pressing the combiner turns the same Menu to the models
     as one choice, and choosing one turns it back. It starts from the last council (the engine keeps it in the profile's configuration)
     or from the best model of each provider. alt+C from the composer's model menu opens it.
   - While the members answer and while one combines them, the turn holds one Block: "Council · N models" with a StatusWord ("asking",
     then "combining" with the kit's shimmer), and each member a ToolRow: its mark, its name, and its StatusWord (running, done, failed
     with the reason in its Tooltip, no answer).
   - Done, the combined reply is the turn's ordinary agent message; its foot says "council of N" with the members' marks stacked (three,
     then "+N"), and under the reply a Disclosure, "Answers (N)", opens each member's answer.
   - Where no member was reported, the Block stays with a red StatusWord and "Ask again".
   Everything drawn is the kit's; this file composes and wires it. */
import { kit, layer, ui } from '@boopis/ui';
import type { ToolRowOpts } from '@boopis/ui';
import { data } from '../../data';
import { MIN_COUNCIL } from '../../data/types';
import type { CouncilChoice, CouncilForm, CouncilMember, CouncilSlot, CouncilTurn, ModelChoice } from '../../data';
import { asV7, say, v7Attrs } from './s0';

export const COUNCIL_VALUE = '__council';
export const COUNCIL_DESC = 'Several models answer your next message, one combines them';
export const COUNCIL_KEYS = 'alt+C';
/** the cost, said as it is: one call for each member, and the combiner's own turn on top (it keeps the session's tools, so it may take several steps) */
export const COST_NOTE = 'Costs one call for each member, plus the combiner\'s own turn, which may take several steps.';
/** a resumed answer that was longer than the turn book keeps (ADR-0036): said, never passed off as the whole answer */
export const CUT_NOTE = 'This answer was shortened when it was saved. The rest is not kept.';
/** a member that failed and the engine said nothing of why */
export const FAILED_TIP = 'It did not answer. The council went on without it.';
export const NONE_SAID = 'No member\'s answer was reported, so only the combined answer is shown.';

type MenuEntry = Parameters<typeof kit.html.menu>[0]['entries'][number];
const nameOf = (s: CouncilSlot): string => ui.modelMark.called(s.model) || s.model;
const plural = (n: number, one: string, many: string): string => n + ' ' + (n === 1 ? one : many);

/* ───────── the turn ───────── */

/** what a member's row says: running while the members answer, done, failed (red, the reason in its Tooltip), no answer once the
    council went on without it (amber) */
export function memberRow(m: CouncilMember, phase: CouncilTurn['phase']): ToolRowOpts {
  const base = { tool: nameOf(m.slot), model: m.slot.model, icon: '', row: true, text: true, attrs: { 'data-member': m.slot.provider + '/' + m.slot.model } } as const;
  if (m.state === 'failed') return { ...base, state: 'failed', wordTip: m.reason || FAILED_TIP };
  if (m.state === 'answered') return { ...base, state: 'done', word: 'done' };
  if (phase === 'members') return { ...base, state: 'running', word: 'running' };
  return { ...base, state: 'done', word: 'no answer', wordTone: 'owe' };
}
/** the Block's head word: asking, combining (both with the shimmer), or none reported (red) */
export function councilWord(c: CouncilTurn): { text: string; tone: 'neutral' | 'red'; live: boolean } {
  if (c.phase !== 'members' && !c.members.length) return { text: 'none reported', tone: 'red', live: false };
  if (c.phase === 'members') return { text: 'asking', tone: 'neutral', live: true };
  return { text: c.phase === 'combining' ? 'combining' : 'done', tone: 'neutral', live: c.phase === 'combining' };
}
/** how many sit on it: the members the engine reported, or the count it gave */
const sitting = (c: CouncilTurn): number => Math.max(c.total, c.members.length);
/** whether the turn still shows its Block: while it works, and where no member was reported */
export const showsBlock = (c: CouncilTurn): boolean => c.phase !== 'done' || !c.members.length;

/** the council's Block while it runs, or where no member was reported (with "Ask again", when `again` is given) */
export function councilBlock(c: CouncilTurn, o: { again?: (() => void) | undefined } = {}): HTMLElement {
  const w = councilWord(c), n = sitting(c);
  const word = kit.html.statusWord({ text: w.text, tone: w.tone }).replace(/>([^<]*)<\/span>$/, w.live ? '><span class="k7-shimmer" data-live>$1</span></span>' : '>$1</span>');
  const none = w.tone === 'red';
  const head = '<div class="k7-tool__head k7-text" data-council-head><b class="k7-tool__name" data-face="text">' + ui.esc('Council · ' + plural(n, 'model', 'models')) + '</b><span class="k7-grow"></span>' + word +
    (none && o.again ? kit.html.button({ label: 'Ask again', variant: 'ghost', size: 28, attrs: { 'data-again': '' } }) : '') + '</div>';
  const rows = c.members.map((m) => kit.html.toolRow(memberRow(m, c.phase))).join('');
  const block = kit.block({ body: head + rows + (none ? '<p class="k7-tool__note k7-text">' + ui.esc(NONE_SAID) + '</p>' : ''), attrs: { role: 'group', 'aria-label': 'Council of ' + n, 'data-council': c.phase, 'aria-busy': w.live ? 'true' : null } });
  block.querySelector('[data-again]')?.addEventListener('click', () => { o.again?.(); });
  return block;
}

/** done: each member's answer under the reply, in a Disclosure ("Answers (3)"), a compact thread in a Well (a failed member says so) */
export function councilAnswers(c: CouncilTurn, open = false): HTMLElement | null {
  if (c.phase !== 'done' || !c.members.length) return null;
  const html = c.members.map((m) => {
    const head = '<p data-role="user">' + ui.html.modelMark(m.slot.model, { size: 12, label: false }) + ' ' + ui.esc(nameOf(m.slot)) + '</p>';
    if (m.state === 'failed') return head + '<p>' + ui.esc(m.reason ? 'It did not answer: ' + m.reason : FAILED_TIP) + '</p>';
    if (m.state !== 'answered' || !m.text) return head + '<p>It did not answer.</p>';
    return head + m.text.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean).map((p) => '<p>' + ui.html.inline(p) + '</p>').join('') + (m.cut ? '<p>' + ui.esc(CUT_NOTE) + '</p>' : '');
  }).join('');
  return kit.disclosure({ summary: 'Answers (' + c.members.length + ')', open, after: kit.html.well({ kind: 'thread', text: '', html, label: 'The members\' answers' }), attrs: { 'data-council-answers': '' } });
}

/** the reply's foot when a council answered: "council of N" and the members' marks stacked */
export function councilFoot(c: CouncilTurn): { marks: string[]; modelName: string } {
  return { marks: c.members.map((m) => m.slot.model), modelName: 'council of ' + sitting(c) };
}

/* ───────── the form (S19's Menu) ───────── */

export interface CouncilFormNode { el: HTMLElement; choice(): CouncilChoice | null }
/** the form: the members to check, the combiner, and "Ask the council". `submit` is told the choice; it rejects with a sentence */
export function councilFormNode(form: CouncilForm, submit: (c: CouncilChoice) => Promise<void>): CouncilFormNode {
  const { options } = form;
  const slotOf = (v: string): CouncilSlot => { const c = options.find((x) => x.value === v) as ModelChoice; return { provider: c.provider, model: c.model }; };
  const valueOf = (s: CouncilSlot): string => options.find((c) => c.provider === s.provider && ui.modelMark.same(c.model, s.model))?.value ?? '';
  const members = new Set(form.choice.members.map(valueOf).filter(Boolean));
  let combiner = valueOf(form.choice.combiner) || (options[0]?.value ?? '');
  let page: 'members' | 'combiner' = 'members';
  let host: HTMLElement | null = null;
  const mark = (m: string): string => ui.html.modelMark(m, { size: 14, label: false });
  const nameOfValue = (v: string): string => { const c = options.find((x) => x.value === v); return c ? ui.modelMark.called(c.model) || c.model : 'Choose a model'; };
  const draw = (): void => {
    const n = members.size, can = n >= MIN_COUNCIL && !!combiner;
    const entries: MenuEntry[] = page === 'members'
      ? [{ heading: 'Members, choose any' }, ...options.map((c) => ({ label: ui.modelMark.called(c.model) || c.model, meaning: c.providerName, leadHTML: mark(c.model), value: c.value, chosen: members.has(c.value), check: true, attrs: { role: 'menuitemcheckbox' } })),
        { heading: (n < MIN_COUNCIL ? 'Choose at least ' + MIN_COUNCIL + ' members. ' : plural(n, 'member answers', 'members answer') + ', then ' + nameOfValue(combiner) + ' combines them. ') + COST_NOTE }]
      : [{ heading: 'Combiner: writes the answer and keeps the tools' }, ...options.map((c) => ({ label: ui.modelMark.called(c.model) || c.model, meaning: c.providerName, leadHTML: mark(c.model), value: c.value, chosen: c.value === combiner }))];
    const foot = page === 'members'
      ? '<span class="k7-menu__head" aria-hidden="true">Combiner</span>' + kit.html.selectorItem({ variant: 'line', label: 'Combiner', value: nameOfValue(combiner), leadHTML: combiner ? mark(slotOf(combiner).model) : undefined, attrs: { 'data-combiner': '' } }) + '<span class="k7-grow"></span>' +
        kit.html.button({ label: 'Ask the council', variant: 'primary', size: 28, disabled: !can, attrs: { 'data-ask': '' } })
      : kit.html.button({ label: 'Back to the members', variant: 'ghost', size: 28, icon: 'back', attrs: { 'data-back': '' } });
    const fresh = kit.menu({ label: 'Ask a council', variant: 'options', entries, foot, attrs: { ...v7Attrs(), 'data-page': page, 'data-remembered': form.remembered ? '' : null } });
    /* the Menu is drawn again in place as the choice changes: the node that floats keeps its place and its listeners */
    if (!host) host = fresh; else { host.replaceChildren(...fresh.childNodes); host.dataset['page'] = page; }
    (host.querySelector<HTMLElement>(page === 'members' ? '[data-kit~="OptionRow"]' : '[data-kit~="OptionRow"][aria-checked="true"]'))?.focus({ preventScroll: true });
  };
  draw();
  const el = host as unknown as HTMLElement;
  el.addEventListener('click', (e) => {
    const t = e.target as Element;
    const row = t.closest<HTMLElement>('[data-kit~="OptionRow"]');
    if (row) {
      const v = row.dataset['value'] ?? '';
      if (page === 'members') { if (members.has(v)) members.delete(v); else members.add(v); draw(); el.querySelector<HTMLElement>('[data-value="' + CSS.escape(v) + '"]')?.focus({ preventScroll: true }); }
      else { combiner = v; page = 'members'; draw(); el.querySelector<HTMLElement>('[data-combiner]')?.focus({ preventScroll: true }); }
      return;
    }
    if (t.closest('[data-combiner]')) { page = 'combiner'; draw(); return; }
    if (t.closest('[data-back]')) { page = 'members'; draw(); el.querySelector<HTMLElement>('[data-combiner]')?.focus({ preventScroll: true }); return; }
    const ask = t.closest<HTMLButtonElement>('[data-ask]');
    if (ask && !ask.disabled) {
      ask.disabled = true;
      submit({ members: [...members].map(slotOf), combiner: slotOf(combiner) }).catch((err: unknown) => { say(err instanceof Error ? err.message : 'The council could not be set up.'); draw(); });
    }
  });
  return { el, choice: () => (members.size >= MIN_COUNCIL && combiner ? { members: [...members].map(slotOf), combiner: slotOf(combiner) } : null) };
}

/** open the form from the composer: it arms the next message on Ask. `done` runs once the council is armed */
export async function openCouncilForm(anchor: HTMLElement, uiId: string, done: () => void): Promise<void> {
  const src = data().council;
  const can = src.can(uiId);
  if (!can.ok) { say(can.reason); return; }
  let form: CouncilForm;
  try { form = await src.prepare(uiId); } catch (e) { say(e instanceof Error ? e.message : 'The council could not be read.'); return; }
  if (form.options.length < MIN_COUNCIL) { say('A council needs at least ' + MIN_COUNCIL + ' models you can use. Sign in to another provider in Settings, Models.'); return; }
  const f = councilFormNode(form, async (choice) => { await src.arm(uiId, choice); layer.close(true); done(); ui.announce('The next message goes to a council of ' + choice.members.length); });
  /* the Menu floats as the kit's menus do (one layer open at a time; Esc or a press outside closes it and focus returns) */
  f.el.setAttribute('data-floating', '');
  asV7(f.el);
  if (!layer.open(anchor, f.el, { place: 'above', align: 'start' })) return;
  (f.el.querySelector<HTMLElement>('[data-kit~="OptionRow"]'))?.focus({ preventScroll: true });
}
