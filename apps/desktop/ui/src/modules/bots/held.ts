/* What the host holds for the owner, in a bot's thread (REPASS.md step 6e; the lead's design, no board draws these but O-B06's block):
   - a change to the team a bot proposed: an AskCard that holds the kit's TeamPlan (O-B06's team-plan block: the title and why, then the
     actions with their mark, + added, ~ changed, − removed, and what changes; problems as error lines; a permanent action's quiet note).
     Answers: "Hold to apply", "Change it" (a Field opens; Enter sends those words back as the reason it was not applied), "Later".
     Receipts: "You applied <bot>'s plan" with Undo, "You asked for changes", expired, and why it failed;
   - a step a rule paused while the owner was away: an AskCard "<bot>'s step waited for you" with the rule's words and the tool (the
     host's safe words; never the step's arguments). Answers: Hold to allow once, Always allow (only with `approval-rules`), Deny with esc.
     Receipts as 6d's ("You allowed it once", "You allowed it always · exception drafted", "You denied it").
   The builders are pure kit markup with callbacks (tested and drawn in the lab as they are); `mountHeld` keeps a thread's asks in step
   with the provider's sources, which only the desktop app has. */
import { openDraft } from './rule-route';
import { kit, ui } from '@boopis/ui';
import type { AskAnswer, PlanAction } from '@boopis/ui';
import { data } from '../../data';
import { BOOPIS_ID } from '../../data/types';
import type { Bot, ParkedChoice, ParkedStep, TeamPlan } from '../../data';
import { later } from '../chat/compose';

/* ───────── a team plan ───────── */
export const PERMANENT_NOTE = 'Disbanding a room cannot be undone.';
export const PROBLEMS_TIP = 'It has problems to fix first. Ask for changes, and the bot proposes it again.';
export interface PlanView { /** put off here, for now (nothing is sent) */ later?: boolean; /** "Change it" is open, with what is typed so far */ changing?: string | null; busy?: boolean; error?: string }
export interface PlanActs { apply(): void; reject(words: string): void; undo(): void; later(on: boolean): void; change(open: boolean): void }

const who = (b: Pick<Bot, 'id' | 'name'> | null | undefined): string => b?.name ?? 'boopis';
/** the asker's lead: the boopis bot in its ink (the house bot), else the bot's orb */
const lead = (b: Bot | null): { bot: Bot } | { lead: string } => (b && b.id !== BOOPIS_ID ? { bot: b } : { lead: kit.html.avatar({ variant: 'logomark', label: 'boopis' }) });
/** an action's lead where it names a bot of the team (its 16 orb) */
const actionLead = (target: string, bots: readonly Bot[]): string => { const n = target.replace(/^(bot|member)\s+/i, ''); const b = bots.find((x) => x.name === n || x.id === n); return b ? kit.html.avatar({ bot: { ...b, state: 'idle', attention: null }, size: 16, still: true }) : ''; };

export function planCard(p: TeamPlan, asker: Bot | null, bots: readonly Bot[], v: PlanView = {}): HTMLElement {
  const name = who(asker), l = lead(asker);
  if (p.state !== 'proposed' || v.later) {
    const row = p.state === 'applied' ? { text: 'You applied ' + name + '’s plan', word: 'applied', tone: 'ok' as const, act: p.undoes ? '' : kit.html.button({ label: 'Undo', variant: 'ghost', size: 28, attrs: { 'data-plan': 'undo' } }) }
      : p.state === 'rejected' ? { text: 'You asked for changes', word: 'sent', act: '' }
      : p.state === 'expired' ? { text: cap(p.title), word: 'expired', act: '' }
      : p.state === 'failed' ? { text: 'The plan did not apply' + (p.report ? ': ' + p.report : ''), word: 'failed', tone: 'red' as const, act: '' }
      : { text: cap(p.title), word: 'later', act: kit.html.button({ label: 'Open', variant: 'ghost', size: 28, attrs: { 'data-plan': 'open' } }) };
    return kit.askCard({ variant: 'form', state: 'answered', ask: row.text, word: { text: row.word, ...('tone' in row ? { tone: row.tone } : {}) }, rowAction: row.act, ...l, attrs: { 'data-plan-hash': p.hash, 'data-plan-state': v.later && p.state === 'proposed' ? 'later' : p.state, 'aria-label': cap(p.title) + ': ' + row.text } });
  }
  const actions: PlanAction[] = p.actions.map((a) => ({ mark: a.mark, target: a.target, what: a.what, leadHTML: actionLead(a.target, bots) }));
  const block = kit.html.teamPlan({ actions, problems: p.problems, notes: p.notes, ...(p.permanent ? { permanent: PERMANENT_NOTE } : {}) });
  const changing = v.changing != null;
  const field = changing ? kit.html.field({ id: 'plan-change-' + p.hash.slice(0, 12), value: v.changing ?? '', placeholder: 'What should change? Enter sends it', ariaLabel: 'What should change in the plan', attrs: { 'data-plan-words': '' } }) : '';
  const answers: AskAnswer[] = [
    { label: 'Hold to apply', primary: true, hold: true, value: 'apply', ...(p.problems.length ? { inert: PROBLEMS_TIP } : {}) },
    { label: 'Change it', value: 'change' }, { label: 'Later', value: 'later' }
  ];
  return kit.askCard({ variant: 'form', state: 'needs', who: name + ' asks', ...l, ask: cap(p.title) || 'A change to the team', ...(p.reason ? { sub: p.reason } : {}), fields: block + field, answers, ...(v.busy ? { busy: true } : {}), ...(v.error ? { error: v.error } : {}), attrs: { 'data-plan-hash': p.hash, 'data-plan-state': 'proposed' } });
}
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** wire a plan's card to what pressing it does */
export function wirePlan(card: HTMLElement, acts: PlanActs): HTMLElement {
  card.addEventListener('ui:commit', () => { acts.apply(); });
  card.addEventListener('click', (e) => {
    const t = e.target as Element;
    const c = t.closest<HTMLElement>('[data-kit~="Chip"][data-value]');
    if (c && !c.hasAttribute('data-hold') && c.getAttribute('aria-disabled') !== 'true') {
      if (c.dataset['value'] === 'change') acts.change(true); else if (c.dataset['value'] === 'later') acts.later(true);
      return;
    }
    const b = t.closest<HTMLElement>('[data-plan]');
    if (b?.dataset['plan'] === 'undo') acts.undo(); else if (b?.dataset['plan'] === 'open') acts.later(false);
  });
  card.addEventListener('keydown', (e) => {
    const f = (e.target as Element).closest<HTMLInputElement>('[data-plan-words]');
    if (!f) return;
    if (e.key === 'Enter' && f.value.trim()) { e.preventDefault(); acts.reject(f.value.trim()); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); acts.change(false); }
  });
  return card;
}

/* ───────── a parked step ───────── */
export interface ParkedView { /** answered here: what you chose, and whether the host kept a draft exception */ answered?: { choice: ParkedChoice; drafted: boolean } | undefined; busy?: boolean; error?: string }
export function parkedReceipt(a: { choice: ParkedChoice; drafted: boolean }): { text: string; word: string } {
  if (a.choice === 'deny') return { text: 'You denied it', word: 'denied' };
  return { text: a.choice === 'always' ? 'You allowed it always' + (a.drafted ? ' · exception drafted' : '') : 'You allowed it once', word: 'done' };
}
export function parkedCard(s: ParkedStep, asker: Bot | null, v: ParkedView = {}): HTMLElement {
  const name = asker?.name ?? s.bot ?? 'A bot';
  const l = asker ? { bot: asker } : { lead: '' };
  if (v.answered) {
    const r = parkedReceipt(v.answered);
    const open = v.answered.drafted && later('rules-settings') ? kit.html.button({ label: 'Open', variant: 'ghost', size: 28, attrs: { 'data-open-draft': '' } }) : '';
    const row = kit.askCard({ variant: 'form', state: 'answered', ask: r.text, word: { text: r.word }, rowAction: open, ...l, attrs: { 'data-parked': s.id, 'aria-label': name + '’s step: ' + r.text } });
    row.querySelector('[data-open-draft]')?.addEventListener('click', () => { openDraft(asker ?? (s.bot ? { id: s.bot, name: s.bot } : null)); });
    return row;
  }
  const can = (c: string): boolean => !s.choices.length || s.choices.includes(c);
  const answers: AskAnswer[] = [
    ...(can('once') ? [{ label: 'Hold to allow once', primary: true, hold: true, value: 'once' }] : []),
    ...(can('always') && later('approval-rules') ? [{ label: 'Always allow', value: 'always' }] : []),
    { label: 'Deny', value: 'deny', keys: 'esc', outline: true }
  ];
  return kit.askCard({ variant: 'standalone', state: 'needs', ...(asker ? { bot: { ...asker, state: 'needs' } } : { lead: '' }), who: name + '’s scheduled run', ask: name + '’s step waited for you', ...(s.rule ? { rule: s.rule } : {}), ...(s.tool ? { command: s.tool } : {}),
    answers, ...(v.busy ? { busy: true } : {}), attrs: { 'data-parked': s.id } });
}
export function wireParked(card: HTMLElement, answer: (c: ParkedChoice) => void): HTMLElement {
  card.addEventListener('ui:commit', () => { answer('once'); });
  card.addEventListener('click', (e) => {
    const c = (e.target as Element).closest<HTMLElement>('[data-kit~="Chip"][data-value]');
    if (!c || c.hasAttribute('data-hold')) return;
    if (c.dataset['value'] === 'always') answer('always'); else if (c.dataset['value'] === 'deny') answer('deny');
  });
  card.addEventListener('keydown', (e) => { if ((e.key === 'Escape' || e.key === 'x') && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); answer('deny'); } });
  return card;
}

/* ───────── a thread's held asks, kept in step with the host ───────── */
const PLAN_VIEW = new Map<string, PlanView>();
const PARKED_DONE = new Map<string, { step: ParkedStep; answered: { choice: ParkedChoice; drafted: boolean } }>();
let stop: (() => void) | null = null;

/** the asks a bot's thread carries: the plans it proposed and its parked steps, drawn into `box` and drawn again as the host changes */
export function mountHeld(box: HTMLElement, b: Bot, bots: () => readonly Bot[], say: (t: string) => void): void {
  stop?.(); stop = null;
  const plans = data().teamPlans, parked = data().parked;
  box.replaceChildren();
  if (!plans && !parked) return;
  let PLANS: readonly TeamPlan[] = [], STEPS: readonly ParkedStep[] = [];
  let gone = false;
  const draw = (): void => {
    if (gone) return;
    const hadFocus = box.contains(document.activeElement) ? (document.activeElement as HTMLElement).closest<HTMLElement>('[data-plan-hash], [data-parked]')?.getAttribute('data-plan-hash') ?? null : null;
    const nodes: HTMLElement[] = [];
    for (const p of PLANS.filter((x) => x.bot === b.id)) {
      const view = PLAN_VIEW.get(p.hash) ?? {};
      const set = (patch: PlanView): void => { PLAN_VIEW.set(p.hash, { ...(PLAN_VIEW.get(p.hash) ?? {}), ...patch }); draw(); };
      const run = (job: Promise<TeamPlan> | undefined, ok: string): void => {
        if (!job) return;
        set({ busy: true, error: '' });
        job.then((now) => { PLANS = PLANS.map((x) => (x.hash === now.hash ? now : x)); PLAN_VIEW.set(p.hash, {}); ui.announce(ok); void refresh(); }, (e: unknown) => { set({ busy: false, error: e instanceof Error ? e.message : String(e) }); });
      };
      nodes.push(wirePlan(planCard(p, b, bots(), view), {
        apply: () => { run(plans?.apply(p.hash), 'Applied'); },
        reject: (words) => { run(plans?.reject(p.hash, words), 'Sent'); },
        undo: () => { if (plans) plans.undo(p.hash).then(() => { void refresh(); }, (e: unknown) => { say(e instanceof Error ? e.message : String(e)); }); },
        later: (on) => { set({ later: on, changing: null }); },
        change: (open) => { set({ changing: open ? '' : null }); if (open) requestAnimationFrame(() => box.querySelector<HTMLInputElement>('[data-plan-hash="' + p.hash + '"] [data-plan-words]')?.focus()); }
      }));
    }
    const steps = STEPS.filter((s) => s.bot === b.id);
    for (const [id, d] of PARKED_DONE) if (d.step.bot === b.id && !steps.some((s) => s.id === id)) nodes.push(parkedCard(d.step, b, { answered: d.answered }));
    for (const s of steps) {
      const done = PARKED_DONE.get(s.id);
      nodes.push(done ? parkedCard(s, b, { answered: done.answered }) : wireParked(parkedCard(s, b), (choice) => {
        if (!parked) return;
        parked.answer(s.id, choice).then((r) => { PARKED_DONE.set(s.id, { step: s, answered: { choice, drafted: !!r.draftId } }); ui.announce(choice === 'deny' ? 'Denied' : 'Allowed'); draw(); }, (e: unknown) => { say(e instanceof Error ? e.message : String(e)); });
      }));
    }
    box.replaceChildren(...nodes);
    box.hidden = !nodes.length;
    if (hadFocus) box.querySelector<HTMLElement>('[data-plan-hash="' + hadFocus + '"] [data-plan-words], [data-plan-hash="' + hadFocus + '"] .k7-chip, [data-plan-hash="' + hadFocus + '"] .k7-btn')?.focus({ preventScroll: true });
  };
  const refresh = async (): Promise<void> => {
    const [p, s] = await Promise.all([plans ? plans.list().catch(() => PLANS) : Promise.resolve([]), parked ? parked.list().catch(() => STEPS) : Promise.resolve([])]);
    PLANS = p; STEPS = s; draw();
  };
  const offs = [plans?.subscribe(() => { void refresh(); }), parked?.subscribe(() => { void refresh(); })];
  stop = () => { gone = true; for (const o of offs) o?.(); };
  void refresh();
}
