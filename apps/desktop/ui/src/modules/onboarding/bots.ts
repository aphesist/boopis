/* The first run's part (d), the boopis bot in its own chat (boards O-B01 to O-B09; O01's "(d) Bots"): Grok-style choice cards, one exchange
   at a time, drawn into the boopis bot's chat while its part is not done. Only where the host keeps these answers and the bot acts on them
   (`DataProvider.onboarding`): every provider lacks it today, so this stays hidden (REPASS rule 2). What exists elsewhere is used as it is:
   the team the bot proposes is a `teamPlans` plan, applied by the owner's hold (the kit's TeamPlan, 6e); the rules are Settings ›
   Approvals' rules for every bot, in its parts (rule-parts.ts); the dock is the app's own.

   The owner's decisions win over the boards (27 November): only the owner's Approvals list asks (bots have no asks of their own), paying
   with a saved card is a built-in protection, and there is no spending cap by default. */
import { icon, itemTile, kit } from '@boopis/ui';
import type { Tile } from '@boopis/ui';
import { data } from '../../data';
import type { Bot, OnboardingSource, TeamPlan } from '../../data';
import type { Rule } from '../../data/settings-host';
import { emit } from '../../core/bus';
import { BUILT_IN, everyBot, isDraft, ruleRow } from '../settings/rule-parts';
import examples from './examples.json';
import { ledger, writeLedger } from './ledger';

/** where the conversation is: one exchange each (the boards draw each on its own: the time, your last answer, the bot's words, the card) */
export type BotsStep = 'greet' | 'what' | 'goals' | 'place' | 'name' | 'team' | 'rules' | 'built' | 'reach';
/** the examples the bot shows of what a bot is (O-B02, as drawn), and the bot each goal gets (O-B03) */
type Look = { id: string; color: string; shape: string };
const LOOKS: Readonly<Record<string, { color: string; shape: string }>> = examples.looks;
const look = (id: string): Look => ({ id, ...(LOOKS[id] ?? { color: '', shape: 'circle' }) });
const EXAMPLES: ReadonlyArray<Look & { job: string }> = examples.examples.map((e) => ({ ...look(e.id), job: e.job }));
const GOALS: ReadonlyArray<{ label: string; icon: string; bot: Look | null }> = examples.goals.map((g) => ({ label: g.label, icon: g.icon, bot: g.bot ? look(g.bot) : null }));
/** the clock the exchange's time is read from (the lab sets the board's) */
export const botsClock = { now: (): Date => new Date(), /** the lab holds the step the board draws */ hold: false };

interface State {
  step: BotsStep; you: string; goals: string[]; name: string | null; plan: string | null; error: string;
  places: ReadonlyArray<{ id: string; label: string; hint: string; recommended?: boolean }>; names: { full: string | null; login: string | null };
  rules: readonly Rule[]; built: string;
}
const S: State = { step: 'greet', you: '', goals: [], name: null, plan: null, error: '', places: [], names: { full: null, login: null }, rules: [], built: '' };
/** start the bot's part over from its greeting (Settings › General's "Start", the hand-off) */
export function restartBots(step: BotsStep = 'greet'): void { Object.assign(S, { step, you: '', error: '' }); }
/** the lab's way to put the conversation at a step with the board's answers */
export function botsAt(step: BotsStep, o: Partial<Pick<State, 'you' | 'goals' | 'name' | 'plan' | 'built'>> = {}): void { Object.assign(S, { step, error: '' }, o); }

/** whether the bot's chat is the first run's now: the part exists and is not done */
export function botsPartShown(b: Pick<Bot, 'id'>): boolean {
  return b.id === 'boopis' && !!data().onboarding && ledger().bots !== 'done';
}
const hhmm = (d: Date): string => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const say = (t: string): string => kit.html.bubble({ kind: 'agent', text: t });
const you = (t: string): string => (t ? kit.html.bubble({ kind: 'user', text: t }) : '');
const orbOf = (b: { id: string; color: string; shape: string }, size: number): string => kit.html.avatar({ bot: { id: b.id, name: b.id, color: b.color, shape: b.shape, state: 'idle', attention: null } as never, size, still: true });
const words = (list: readonly string[]): string => (list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + (list[list.length - 1] ?? ''));

/** the head of the bot's chat where the first run starts (O-B01, O01's morph lands here): its orb at 64, its name, what it is */
function head(): string {
  return '<div class="hx-ob__head">' + kit.html.avatar({ bot: { id: 'boopis', name: 'boopis', state: 'idle', attention: null } as never, size: 64, ink: true, still: true }) +
    '<p class="k7-type-l hx-ob__name">boopis</p><p class="k7-type-xs hx-ob__what">Your main bot. It makes and runs the others.</p></div>';
}

/** the rules for every bot (Settings › Approvals' list), the ones that ask */
async function readRules(): Promise<void> {
  const view = data().rules ? await data().rules?.get().catch(() => null) : null;
  S.rules = (view?.rules ?? []).filter((r) => everyBot(r) && !isDraft(r) && r.type === 'ask');
}
/** the exchange for the step, as kit markup */
async function exchange(src: OnboardingSource): Promise<string> {
  const time = kit.html.timeSeparator({ text: 'Today ' + hhmm(botsClock.now()) });
  switch (S.step) {
    case 'greet':
      return head() + time + say('Hi again. Same eyes, now with a body.') + say('I’m the boopis bot. I make your bots, hand them work, and tell you what it cost. Shall we build your team?') +
        kit.html.askCard({ variant: 'choices', heading: true, ask: 'Build your team now?', something: false, choices: [{ label: 'Yes, let’s go', hint: 'about two minutes', value: 'yes' }, { label: 'Tell me what bots are first', value: 'what' }, { label: 'Later', hint: 'I’ll be here, in Bots', value: 'later' }], attrs: { 'data-ob': 'greet' } });
    case 'what':
      return time + you(S.you) + say('A bot is a teammate with one job. It works on its own computer, on its own time, and asks you before anything your rules name.') + say('Here are three I could make for you:') +
        kit.html.tiles({ variant: 'bots', label: 'Three bots I could make', tiles: EXAMPLES.map((b): Tile => ({ label: b.job, value: b.id, leadHTML: orbOf(b, 40) })), action: { label: 'Got it', value: 'got' }, note: 'Yours get their own jobs next', attrs: { 'data-ob': 'what' } });
    case 'goals': {
      const free = GOALS.filter((g) => g.bot && !S.goals.includes(g.label)).map((g) => orbOf(g.bot as { id: string; color: string; shape: string }, 24)).join('');
      return time + you(S.you) + say('So what should your bots work on first?') +
        kit.html.tiles({ label: 'What your bots work on first', head: 'Pick up to three. Each pick gets a bot.', headEndHTML: free, max: 3, action: { label: 'Next', on: S.goals.length > 0, value: 'next' },
          tiles: GOALS.map((g): Tile => ({ label: g.label, value: g.label, icon: g.icon, chosen: S.goals.includes(g.label), ...(g.bot ? { colour: g.bot.color, leadHTML: orbOf(g.bot, 24) } : {}) })), attrs: { 'data-ob': 'goals' } });
    }
    case 'place': {
      S.places = await src.places();
      return time + you(S.you) + say('Good picks. Your bots need a computer to work on. Where should it be?') +
        kit.html.askCard({ variant: 'choices', heading: true, ask: 'Where should your bots work?', something: false, foot: 'Change it any time in Settings, Bots.', choices: S.places.map((p) => ({ label: p.label, hint: p.hint, value: p.id })), attrs: { 'data-ob': 'place' } });
    }
    case 'name': {
      S.names = await src.names();
      const p = src.setup.get();
      const line = p ? kit.html.statusLine({ kind: 'system', phrase: p.label, count: (p.done / 1e9).toFixed(1) + ' of ' + (p.total / 1e9).toFixed(1) + ' GB', attrs: { 'data-ob-setup': '' } }) : '';
      const choices = [...(S.names.full ? [{ label: S.names.full, hint: 'your name on this computer', value: 'full' }] : []), ...(S.names.login ? [{ label: S.names.login, hint: 'your login name', value: 'login' }] : []),
        { label: 'Something else', value: 'else' }, { label: 'Don’t use a name', value: 'none' }];
      return time + you(S.you) + (p ? say('Setting it up in the background; I’ll tell you when it’s ready.') + line : '') + say(p ? 'While it does, what should I call you?' : 'What should I call you?') +
        kit.html.askCard({ variant: 'choices', heading: true, ask: 'What should I call you?', something: false, foot: 'Your bots use it too. Change it in Settings, Bots.', choices, attrs: { 'data-ob': 'name' } });
    }
    case 'team': return teamExchange(src, time);
    case 'rules': {
      await readRules();
      const on = S.rules.filter((r) => r.enabled).length;
      const rows = S.rules.map((r) => ruleRow({ key: r.id, text: r.text, enabled: r.enabled }));
      return time + you(S.you) + say('Before they start: these are the things every bot asks you about first. Keep, edit or remove any of them.') +
        kit.html.askCard({ variant: 'form', state: 'asked', who: 'Your approval rules, for every bot', lead: '<span class="hx-ob__glyph" aria-hidden="true">' + icon('shield', { size: 's' }) + '</span>', word: { text: String(on) + ' on' }, ask: 'Your bots ask you before',
          fields: S.rules.length ? kit.html.card({ variant: 'settings', rows, attrs: { 'data-mark-reveal': 'hover' } }) : kit.html.emptyState({ text: 'No rules yet.' }), effect: BUILT_IN.replace(/^Built in: /, 'Built in, whatever the list says: '),
          answers: [{ label: 'Keep these rules', primary: true, value: 'keep' }, { label: 'Add a rule', value: 'add' }, { label: 'Open in Settings', value: 'settings' }], attrs: { 'data-ob': 'rules' } });
    }
    case 'built':
      if (!S.rules.length) await readRules();
      /* O-B08: the receipts (the rules kept, the team built, with Undo), and the bot says where they are; the next exchange follows */
      return time + you(S.you) + kit.html.systemLine({ icon: 'check', text: 'Kept: ' + String(S.rules.length) + ' approval rules for every bot' }) +
        (S.built ? kit.html.systemLine({ icon: 'check', text: S.built, action: 'Undo', attrs: { 'data-ob-act': 'undo' } }) : '') + say(S.plan ? 'They’re ready. They’re in your sidebar, under me.' : 'You and me, then. Make a bot any time with +.');
    case 'reach':
      return time + say('You don’t need this window open to keep up with your bots.') +
        kit.html.askCard({ variant: 'form', state: 'asked', who: 'Keeping up without this window', lead: kit.html.avatar({ variant: 'logomark', label: 'boopis' }), word: { text: '' }, ask: '',
          fields: kit.html.card({ variant: 'settings', rows: [{ label: 'The dock, in Sessions', sub: 'Your bots under the composer while you work in a session.', control: kit.html.button({ label: 'Show me', variant: 'ghost', size: 28, attrs: { 'data-ob-act': 'dock' } }) }] }),
          answers: [{ label: 'Done with this', primary: true, value: 'done' }, { label: 'Skip', value: 'skip', end: true, ghost: true }], attrs: { 'data-ob': 'reach' } });
  }
}
/* O-B06: the team the bot proposed for the goals (a `teamPlans` plan: the kit's TeamPlan, built only by the owner's hold), then one connector
   its bots would use, from the store's collection */
async function teamExchange(src: OnboardingSource, time: string): Promise<string> {
  const plans = data().teamPlans;
  if (!S.plan && plans) { try { S.plan = await src.propose(S.goals); } catch (e) { S.error = e instanceof Error ? e.message : String(e); } }
  const plan: TeamPlan | null = plans && S.plan ? (await plans.list().catch(() => [] as TeamPlan[])).find((p) => p.hash === S.plan) ?? null : null;
  const looks = new Map(GOALS.flatMap((g) => (g.bot ? [[g.bot.id, g.bot] as const] : [])));
  const offer = await src.connector().catch(() => null);
  const greet = (S.name ? S.name + ' it is. ' : '') + 'Here’s a small team for ' + words(S.goals.map((g) => g.toLowerCase())) + '. Nothing is made until you hold the button.';
  const card = plan
    ? kit.html.askCard({ variant: 'form', state: 'asked', who: 'Team plan', lead: kit.html.avatar({ variant: 'logomark', label: 'boopis' }), word: { text: plan.state === 'proposed' ? 'nothing made yet' : plan.state }, ask: plan.title,
        fields: kit.html.teamPlan({ actions: plan.actions.map((a) => { const id = a.target.replace(/^(bot|member)\s+/i, ''); const l = looks.get(id); return { mark: a.mark, target: id, what: a.what, ...(l ? { leadHTML: orbOf(l, 16) } : {}) }; }), notes: plan.notes, problems: plan.problems }),
        answers: [{ label: 'Hold to build this team', primary: true, hold: true, value: 'build' }, { label: 'Change it', value: 'change' }, { label: 'Just you and me', value: 'alone' }], ...(S.error ? { error: S.error } : {}), attrs: { 'data-ob': 'team', 'data-plan-hash': plan.hash } })
    : kit.html.askCard({ variant: 'form', state: 'asked', who: 'Team plan', lead: kit.html.avatar({ variant: 'logomark', label: 'boopis' }), word: { text: S.error ? 'failed' : 'thinking', tone: S.error ? 'red' : 'neutral' }, ask: S.error || 'Putting a team together.', attrs: { 'data-ob': 'team' } });
  const connector = offer ? say('They can also use tools you already work in. Each one asks before it does anything.') +
    kit.html.askCard({ variant: 'form', state: 'asked', who: 'Optional, from the Store', lead: '', word: { text: '' }, ask: '', fields: '<div role="list">' + kit.html.listRow({ variant: 'item', title: offer.name, sub: offer.why, ...itemTile({ name: offer.name, collection: offer.id }), action: 'Add ' + offer.name, actionAttrs: { 'data-ob-act': 'connector', 'data-value': offer.id } }) + '</div>',
      foot: 'Asks before every change. Remove it any time in Settings, Connectors.', attrs: { 'data-ob': 'connector' } }) : '';
  return time + you(S.you) + say(greet) + card + connector;
}

/** draw the bot's part into `box` (its chat's log), and answer what the person picks; `redraw` draws it again */
export function mountBotsPart(box: HTMLElement, o: { draft(text: string): void; redraw(): void }): void {
  const src = data().onboarding;
  if (!src) return;
  let gone = false;
  const draw = async (): Promise<void> => {
    const html = await exchange(src);
    if (gone || !box.isConnected) return;
    box.innerHTML = html;
    kit.wire(box);
    /* after the build the bot goes on by itself: how to keep up without the window (O-B09) */
    if (S.step === 'built' && !botsClock.hold) window.setTimeout(() => { if (S.step === 'built' && !gone) next('reach', ''); }, 1600);
  };
  const next = (step: BotsStep, said: string): void => { S.step = step; S.you = said; S.error = ''; void draw(); };
  const off = data().onboarding?.setup.subscribe(() => { if (S.step === 'name') void draw(); });
  new MutationObserver(() => { if (!box.isConnected) { gone = true; off?.(); } }).observe(box.parentElement ?? box, { childList: true });
  box.addEventListener('ui:change', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-ob="goals"]')) { const v = (e as CustomEvent<{ value: string }>).detail.value as string; S.goals = S.goals.includes(v) ? S.goals.filter((g) => g !== v) : [...S.goals, v]; }
    const sw = t.closest<HTMLElement>('[data-rule-switch]');
    if (sw && data().rules) { const id = sw.dataset['ruleSwitch'] ?? ''; void data().rules?.get().then((v) => data().rules?.setEnabled(id, !!(e as CustomEvent<{ value: boolean }>).detail.value, v.revision)).catch(() => undefined); }
  });
  box.addEventListener('click', (e) => {
    const t = e.target as Element;
    const ch = t.closest<HTMLElement>('.k7-ask__choice');
    const card = t.closest<HTMLElement>('[data-ob]')?.dataset['ob'];
    const label = ch?.querySelector('.k7-ask__label')?.textContent ?? '';
    const v = ch?.dataset['value'] ?? t.closest<HTMLElement>('[data-value]')?.dataset['value'] ?? '';
    if (card === 'greet' && ch) { if (v === 'later') { writeLedger({ bots: 'later' }); o.redraw(); return; } next(v === 'what' ? 'what' : 'goals', label); return; }
    if (card === 'what' && t.closest('[data-tiles-act]')) { next('goals', 'Got it'); return; }
    if (card === 'goals' && t.closest('[data-tiles-act]:not([aria-disabled="true"])')) { void src.answer('goals', S.goals); next('place', S.goals.join(', ')); return; }
    if (card === 'place' && ch) { void src.answer('place', v); next('name', label); return; }
    if (card === 'name' && ch) {
      if (v === 'else') { o.draft(''); return; }
      S.name = v === 'full' ? S.names.full : v === 'login' ? S.names.login : null;
      void src.answer('name', S.name ?? ''); next('team', S.name ?? label); return;
    }
    if (card === 'connector' && t.closest('[data-ob-act="connector"]')) { emit('hx:open-settings', { section: 'connectors', from: 'first-run' }); return; }
    if (card === 'team') {
      if (v === 'alone') { next('rules', 'Just you and me'); return; }
      if (v === 'change') { o.draft('Change the team: '); return; }
    }
    if (card === 'rules') {
      if (v === 'keep') { next('built', 'Keep these rules'); return; }
      if (v === 'add' || v === 'settings' || t.closest('[data-rule-edit], [data-rule-remove]')) { emit('hx:open-settings', { section: 'approvals', from: 'first-run' }); return; }
    }
    if (t.closest('[data-ob-act="undo"]') && S.plan && data().teamPlans) { void data().teamPlans?.undo(S.plan).catch(() => undefined); return; }
    if (card === 'reach') {
      if (t.closest('[data-ob-act="dock"]')) { emit('hx:state', { tab: 'session' } as never); return; }
      if (v === 'done' || v === 'skip') { finish(); o.redraw(); }
    }
  });
  /* the team is built by the owner's hold on the plan's primary (ui:commit), never by a click */
  box.addEventListener('ui:commit', (e) => {
    if (!(e.target as Element).closest('[data-ob="team"]') || !S.plan) return;
    const plans = data().teamPlans;
    if (!plans) return;
    plans.apply(S.plan).then((p) => {
      if (p.state !== 'applied') { S.error = p.report ?? 'The team was not built.'; void draw(); return; }
      S.built = 'Built at ' + hhmm(botsClock.now()) + ': ' + (p.report ?? p.title);
      next('rules', 'Hold to build this team');
    }, (err: unknown) => { S.error = err instanceof Error ? err.message : String(err); void draw(); });
  });
  void draw();
}
/** the bot's part is over: the chat is the bot's own from here */
function finish(): void { writeLedger({ bots: 'done' }); }
/** the hand-off and Settings › General's "Start": the Bots tab opens on the boopis bot, whose chat starts the part */
export function startBotsPart(): void {
  if (!data().onboarding) return;
  if (ledger().bots === 'done') writeLedger({ bots: 'todo' });
  if (ledger().bots === 'later') writeLedger({ bots: 'todo' });
  restartBots();
  emit('hx:bot-select', { id: 'boopis', from: 'first-run' });
}
