/* The lab for chat motion: who is at work in a conversation (the kit's `ui.presence`), one state per scenario of the catalogue
   (w27/chat-motion, scenarios.md: one bot, several, the mixes, joining and leaving, a reply landing, attention, a failed turn, the
   pill when the end is out of view, narrow, 125%, long names), each drawn in a thread under the owner's message, as the rooms draw
   it. A state that moves plays its sequence once while it draws and ends still (the checker sees the end); `window.__labReplay()`
   plays it again (the clips). "playground" is interactive: its buttons add, change, land, ask and stop bots. The room's own
   wiring, on the mock provider, is `chat/presence-rooms`. */
import { ui } from '@boopis/ui';
import type { BotLike, PresenceActor, PresenceElement, PresenceStatus } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Interaction, State, Story } from '../../types';
import { BOT_LONG } from '../../fixtures';

const CONV = { url: '/v6/design-system/index.html#c-conversation', crop: '#c-conversation' };
const W = 720;
/** one fixed now, so every clock reads the same in every screenshot */
const NOW = Date.UTC(2026, 10, 22, 9, 14, 0);
const ROSTER: Readonly<Record<string, BotLike>> = {
  atlas: { id: 'atlas', name: 'atlas', shape: 'circle', color: '#efece6' },
  nina: { id: 'nina', name: 'nina', shape: 'triangle', color: '#f23b5a' },
  kai: { id: 'kai', name: 'kai', shape: 'circle', color: '#4fc9a8' },
  moss: { id: 'moss', name: 'moss', shape: 'squircle', color: '#2fd26a' },
  iris: { id: 'iris', name: 'iris', shape: 'flower', color: '#3b82f6' },
  sol: { id: 'sol', name: 'sol', shape: 'circle', color: '#f5a337' },
  vox: { id: 'vox', name: 'vox', shape: 'circle', color: '#6d5cf0' },
  terra: { id: 'terra', name: 'terra', shape: 'drop', color: '#c4834a' },
  nimbus: { id: 'nimbus', name: 'nimbus', shape: 'cloud', color: '#9b5cf6' },
  hex: { id: 'hex', name: 'hex', shape: 'hexagon', color: '#a6a6ab' }
};
const NAMES = Object.keys(ROSTER);
const TOOLS = ['reading a file', 'in the terminal', 'searching the web', 'editing a file', 'running code', 'reading a page', 'searching files', 'using github', 'updating its list'];
const COMPUTE = new Set(['in the terminal', 'running code']);
const at = (id: string, status: PresenceStatus = 'thinking', extra: Partial<PresenceActor> = {}): PresenceActor =>
  ({ id, bot: ROSTER[id] ?? { id, name: id }, status, since: NOW - 38_000 - NAMES.indexOf(id) * 7_000, ...extra });
const tool = (id: string, doing: string): PresenceActor => at(id, 'tool', { doing, compute: COMPUTE.has(doing) });
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ───────── a thread: the owner's message, what was said, and the presence where the replies land ───────── */
interface Thread { log: HTMLElement; presence: PresenceElement | null; scroll: HTMLElement }
function botEntry(id: string, text: string, t = '09:14'): HTMLElement {
  const b = ROSTER[id] ?? { id, name: id };
  const e = ui.entry({ kind: 'bot', who: ui.html.orb(b, { size: 20 }) + '<span>' + ui.esc(b.name ?? id) + '</span>', callno: [t], label: (b.name ?? id) + ', ' + t });
  e.querySelector('.ui-entry__body')?.append(ui.markdown(text));
  return e;
}
function thread(root: HTMLElement, o: { ask?: string; said?: Array<[string, string]>; height?: number; narrow?: boolean } = {}): Thread {
  const scroll = fill(root);
  scroll.className = 'lab-fill ui-scroll';
  if (o.height) { scroll.style.maxHeight = o.height + 'px'; scroll.style.overflowY = 'auto'; scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Conversation'); }
  if (o.narrow) scroll.dataset['margin'] = 'off';
  const log = document.createElement('div');
  log.setAttribute('role', 'log'); log.setAttribute('aria-label', 'Messages');
  log.append(ui.entry({ kind: 'user', who: 'You', callno: ['09:13'], body: ui.html.request(o.ask ?? 'Can you two look at the billing migration before I merge it?'), label: 'You, 09:13' }));
  for (const [who, text] of o.said ?? []) log.append(botEntry(who, text, '09:13'));
  scroll.append(log);
  return { log, presence: null, scroll };
}
function show(t: Thread, actors: readonly PresenceActor[]): PresenceElement {
  const p = ui.presence({ actors, now: () => NOW, announce: false });
  t.log.append(p); t.presence = p;
  return p;
}
/** a state that draws `actors` once, still */
const still = (tags: State['tags'], actors: readonly PresenceActor[], o: Partial<State> & { ask?: string; said?: Array<[string, string]>; open?: boolean; narrow?: boolean } = {}): State => {
  const { ask, said, open, narrow, ...rest } = o;
  return stage(tags, ({ root }) => { const t = thread(root, { ...(ask ? { ask } : {}), ...(said ? { said } : {}), ...(narrow ? { narrow } : {}) }); const p = show(t, actors); if (open) p.open = true; }, { width: W, mock: CONV, ...rest });
};
/** a state that plays a sequence while it draws (and again on `window.__labReplay()`), and ends still */
const played = (tags: State['tags'], seq: (t: Thread) => Promise<void>, o: Partial<State> & { ask?: string; said?: Array<[string, string]> } = {}): State => {
  const { ask, said, ...rest } = o;
  return stage(tags, async ({ root }) => {
    const run = async (): Promise<void> => { root.textContent = ''; await seq(thread(root, { ...(ask ? { ask } : {}), ...(said ? { said } : {}) })); };
    (window as unknown as { __labReplay?: () => Promise<void> }).__labReplay = run;
    await run();
  }, { width: W, mock: CONV, ...rest });
};
const BEAT = 900;

/* ───────── the playground: buttons that move the scene ───────── */
function playground(root: HTMLElement): void {
  const bar = document.createElement('div'); bar.className = 'lab-row';
  const t = thread(root, { ask: '@all can you each look at the billing migration?' });
  root.prepend(bar);
  let actors: PresenceActor[] = [at('atlas')];
  let k = 1, turn = 0;
  const paint = (u: { arrived?: Element | null } = {}): void => {
    if (!actors.length) { t.presence?.leave(); t.presence = null; return; }
    if (!t.presence || !t.presence.isConnected) show(t, actors); else t.presence.update(actors, u);
  };
  const btn = (label: string, fn: () => void): void => { const b = ui.button({ label, size: 's' }); b.addEventListener('click', fn); bar.append(b); };
  btn('Add a bot', () => { const id = NAMES.find((n) => !actors.some((a) => a.id === n)); if (id) { actors = [...actors, at(id)]; paint(); } });
  btn('Change what one does', () => {
    if (!actors.length) return;
    const i = turn++ % actors.length, a = actors[i] as PresenceActor;
    const next: PresenceActor = a.status === 'thinking' ? tool(a.id, TOOLS[k++ % TOOLS.length] as string) : a.status === 'tool' ? at(a.id, 'replying') : at(a.id);
    actors = actors.map((x, j) => (j === i ? next : x)); paint();
  });
  btn('Land a reply', () => {
    const a = actors[0]; if (!a) return;
    const e = botEntry(a.id, 'Done: the migration is reversible, and it backfills in batches of 500.');
    if (t.presence && actors.length === 1) { t.presence.replaceWith(e); t.presence = null; actors = []; return; }
    if (t.presence) t.presence.before(e); else t.log.append(e);
    actors = actors.slice(1); paint({ arrived: e });
  });
  btn('Ask for approval', () => { const a = actors[actors.length - 1]; if (a) { actors = actors.map((x) => (x === a ? at(a.id, x.status === 'needs' ? 'thinking' : 'needs') : x)); paint(); } });
  btn('Stop one', () => { actors = actors.slice(0, -1); paint(); });
  btn('Start over', () => { t.presence?.remove(); t.presence = null; t.log.querySelectorAll('.ui-entry:not(:first-child):not(.ui-presence)').forEach((n) => n.remove()); actors = [at('atlas')]; paint(); });
  paint();
}
const PLAY: Interaction = {
  name: 'bots join, change, land and stop', watch: '.lab-cell', orbs: 'stay', sample: 900,
  steps: [
    { do: 'click', sel: '.lab-row .ui-btn:nth-child(1)' }, { do: 'wait', ms: 400 },
    { do: 'click', sel: '.lab-row .ui-btn:nth-child(1)' }, { do: 'wait', ms: 400 },
    { do: 'click', sel: '.lab-row .ui-btn:nth-child(2)' }, { do: 'wait', ms: 400 },
    { do: 'click', sel: '.lab-row .ui-btn:nth-child(4)' }, { do: 'wait', ms: 400 },
    { do: 'click', sel: '.lab-row .ui-btn:nth-child(3)' }, { do: 'wait', ms: 400 }
  ]
};

/* ───────── the pill: the end of the conversation out of view ───────── */
function pillState(unread: number): State {
  return stage(['scroll', 'variant'], ({ root }) => {
    const t = thread(root, { height: 220, ask: 'Can you three review the release notes, the migration and the changelog, and tell me what is left?', said: [['iris', 'The release notes read well. Two links point at the old docs; I fixed them.\n\nThe screenshots are from the last release, which is fine for now.']] });
    show(t, [at('atlas'), tool('nina', 'reading a file')]);
    t.scroll.scrollTop = 0;
    const zone = document.createElement('div'); zone.className = 'lab-row';
    const pill = ui.presence.pill();
    pill.paint([at('atlas'), tool('nina', 'reading a file')], unread);
    zone.append(pill);
    root.append(zone);
  }, { width: W, mock: CONV, note: 'the room shows this pill where its jump button is while the presence entry is out of view' });
}

const long = { ...BOT_LONG, attention: null, state: 'idle' } as BotLike;

const story: Story = {
  id: 'chat/presence', title: 'Who is at work (chat presence)', area: 'bots', kind: 'component', covers: ['ui.presence'], mock: CONV,
  states: {
    /* one bot */
    'one bot thinking': still(['typical', 'single'], [at('atlas')], { ask: 'Can you look at the billing migration before I merge it?' }),
    'one bot in a tool': still(['variant', 'single'], [tool('atlas', 'reading factcheck.md')], { ask: 'Can you look at the billing migration before I merge it?' }),
    'one bot in the terminal': still(['variant', 'single'], [tool('atlas', 'in the terminal')], { ask: 'Run the migration on the copy of production.' }),
    'one bot replying': still(['variant', 'single'], [at('atlas', 'replying')], { ask: 'Can you look at the billing migration before I merge it?' }),
    'one bot next': still(['variant', 'single'], [at('kai', 'next', { since: null })]),
    'needs you': still(['variant', 'owner'], [at('nina', 'needs')], { ask: 'Deploy the fix to staging.' }),
    'a turn fails': played(['error'], async (t) => { const p = show(t, [at('atlas')]); await wait(BEAT); p.update([at('atlas', 'failed')]); }, { ask: 'Can you look at the billing migration before I merge it?' }),
    'stopped': played(['variant'], async (t) => { const p = show(t, [at('atlas')]); await wait(BEAT); p.leave(); await wait(400); }, { ask: 'Can you look at the billing migration before I merge it?' }),
    'a long turn': still(['long'], [{ ...tool('atlas', 'in the terminal'), since: NOW - 3_790_000 }], { ask: 'Rebuild the search index from scratch.' }),
    'long names': still(['long'], [{ id: 'long', bot: long, status: 'tool', doing: 'reading src/billing/migrations/0042_move_invoices_to_integer_cents_and_backfill_in_batches.sql', since: NOW - 64_000 }, at('nina'), at('kai', 'tool', { doing: 'searching the web for the postgres advisory lock documentation' })]),
    /* several */
    'two thinking': still(['typical', 'owner'], [at('atlas'), at('nina')]),
    'three thinking': still(['many'], [at('atlas'), at('nina'), at('kai')], { ask: '@all can you each look at the billing migration?' }),
    'six thinking': still(['many'], NAMES.slice(0, 6).map((n) => at(n)), { ask: '@all can you each look at the billing migration?' }),
    'nine at work': still(['many'], [...NAMES.slice(0, 7).map((n) => at(n)), at('nimbus', 'next', { since: null }), at('hex', 'next', { since: null })], { ask: '@all what is left before the release?' }),
    'thinking and a tool': still(['variant'], [at('atlas'), tool('nina', 'reading a file')]),
    'three different things': still(['variant'], [at('atlas'), tool('nina', 'reading a file'), at('kai', 'replying')], { ask: '@all can you each look at the billing migration?' }),
    'six doing different things': still(['many'], NAMES.slice(0, 6).map((n, i) => tool(n, TOOLS[i] as string)), { ask: '@all what is left before the release?' }),
    'details open': still(['open'], NAMES.slice(0, 6).map((n, i) => tool(n, TOOLS[i] as string)), { ask: '@all what is left before the release?', open: true }),
    'a lead first': still(['variant'], [at('atlas'), at('nina', 'next', { since: null }), at('kai', 'next', { since: null })], { ask: 'What should we cut from this release?' }),
    'needs you among others': still(['variant', 'owner'], [at('atlas'), at('kai'), at('nina', 'needs')], { ask: '@all ship the fix: atlas reviews, kai writes the note, nina deploys.' }),
    'mentioned mid-turn': still(['variant'], [at('kai', 'thinking', { by: 'atlas' })], { said: [['atlas', 'The migration is fine. @kai can you add it to the changelog?']] }),
    /* moving */
    'one joins': played(['variant'], async (t) => { const p = show(t, [at('atlas')]); await wait(BEAT); p.update([at('atlas'), at('nina')]); await wait(BEAT); p.update([at('atlas'), at('nina'), at('kai')]); }),
    'several start at once': played(['variant'], async (t) => { await wait(300); show(t, [at('atlas'), at('nina'), at('kai'), at('moss')]); await wait(BEAT); }, { ask: '@all can you each look at the billing migration?' }),
    'one leaves': played(['variant'], async (t) => { const p = show(t, [at('atlas'), at('nina'), at('kai')]); await wait(BEAT); p.update([at('atlas'), at('kai')]); }, { ask: '@all can you each look at the billing migration?' }),
    'a reply arrives while others work': played(['variant', 'owner'], async (t) => {
      const p = show(t, [at('atlas'), at('nina'), at('kai')]); await wait(BEAT);
      const e = botEntry('nina', 'The migration is reversible, and it backfills in batches of **500**, so it will not lock the table.');
      p.before(e); ui.markdown.arrive(e.querySelector('.ui-entry__body > *') ?? e); p.update([at('atlas'), at('kai')], { arrived: e }); await wait(BEAT);
    }, { ask: '@all can you each look at the billing migration?' }),
    'the last one leaves': played(['variant'], async (t) => {
      const p = show(t, [at('atlas')]); await wait(BEAT);
      const e = botEntry('atlas', 'Yes. The migration is reversible, and it backfills in batches of 500, so it will not lock the table.');
      p.replaceWith(e); ui.markdown.arrive(e.querySelector('.ui-entry__body > *') ?? e); await wait(400);
    }, { ask: 'Can you look at the billing migration before I merge it?' }),
    'a mix unfolds into rows': played(['variant'], async (t) => {
      const p = show(t, [at('atlas'), at('nina'), at('kai')]); await wait(BEAT);
      p.update([at('atlas'), tool('nina', 'reading a file'), at('kai')]); await wait(BEAT);
      p.update([at('atlas'), tool('nina', 'reading a file'), tool('kai', 'in the terminal')]); await wait(BEAT);
    }, { ask: '@all can you each look at the billing migration?' }),
    'tools change quickly': played(['variant'], async (t) => {
      const p = show(t, [tool('atlas', 'reading a file')]);
      for (const d of ['searching files', 'reading a file', 'editing a file', 'in the terminal']) { await wait(300); p.update([tool('atlas', d)]); }
      await wait(1400);
    }, { ask: 'Fix the rounding in prorate().', note: 'the words hold for a moment, so four tools in a second read as two' }),
    /* the room around it */
    'scrolled away': pillState(0),
    'scrolled away, replies below': pillState(2),
    'narrow': still(['variant'], [at('atlas'), tool('nina', 'reading a file'), at('kai', 'replying')], { width: 358, narrow: true, ask: '@all can you each look at the billing migration?' }),
    'narrow, one bot': still(['variant', 'single'], [tool('atlas', 'reading factcheck.md')], { width: 358, narrow: true }),
    'at 125%': still(['size'], [at('atlas'), tool('nina', 'reading a file')], { zoom: 1.25 }),
    'playground': stage(['variant'], ({ root }) => { playground(root); }, { width: W, mock: CONV, interact: [PLAY], note: 'Add a bot, change what one does, land a reply, ask for approval, stop one' })
  }
};
export default story;
