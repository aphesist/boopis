/* The Bots tab: the roster (rail and open), a bot's room and thread, its settings sheet, a new bot (the dice: eyes are
   never user-settable, they belong to states; the dice agent, w11/dice, fixes), the Archived group and the "made outside
   boopis" mark, with no bots, one, many and long names. */
import { kit } from '@boopis/ui';
import type { AppCtx, ProviderSpec, State, Story } from '../../types';
import { MANY, TASKS, withKanban } from '../../kanban-fixtures';
import type { Kanban } from '../../kanban-fixtures';
import type { GroupMessage } from '../../../data';
import { drivable, groupRowOverlaps, liveShaped, lookMismatches, recordsArrive, teamBeforeRecords, teamGroups, withActivity, withGroupThread, withKanbanWorker, withMarkdownThread, withQueue, withRun, withWorking } from '../../live-bots';

const bots = async (c: AppCtx): Promise<void> => { c.hx.setState({ tab: 'bots' }); await c.wait(500); };
const pick = (id: string) => async (c: AppCtx): Promise<void> => { await bots(c); c.hx.emit('hx:bot-select', { id, from: 'lab' }); await c.wait(500); };
const st = (tags: State['tags'], provider: ProviderSpec, setup: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, app: { provider, setup }, ...extra });
const live = (withThread = false): ProviderSpec => ({ simulate: false, patch: (p) => liveShaped(p, withThread) });
const grp: ProviderSpec = { fixtures: ['groups'] };
const paper: ProviderSpec = { fixtures: ['groups', 'paper-past'] };
const openPaper = async (c: AppCtx): Promise<void> => { await bots(c); await c.click('.bt-group-rows > [data-kit~="ListRow"]:nth-of-type(2)'); await c.wait(500); };
const openGroup = async (c: AppCtx): Promise<void> => { await bots(c); await c.click('.bt-group-rows > [data-kit~="ListRow"]'); await c.wait(500); };
/** types into a composer the way a person does: the caret at the end, then each character as its own edit (a typed "@" opens the
    list, which the setup waits for). On a loaded machine the room may still be settling when the typing starts and the keys land
    nowhere, so the setup checks what the text says and types again from an empty draft (at most three times) */
const typeIn = (scope: string, text: string) => async (c: AppCtx): Promise<void> => {
  const t = document.querySelector<HTMLElement>(scope + ' .k7-composer__text');
  if (!t) throw new Error('no composer in ' + scope);
  const menu = (): Element | null => document.querySelector('.k7-menu[data-floating]');
  for (let attempt = 0; attempt < 3; attempt++) {
    t.textContent = ''; t.dispatchEvent(new Event('input', { bubbles: true })); t.focus(); await c.wait(60);
    for (const ch of text) { document.execCommand('insertText', false, ch); await c.wait(20); }
    await c.wait(450);
    if (text.endsWith('@')) for (let i = 0; i < 40 && !menu(); i++) await c.wait(50);
    if (t.textContent === text && (!text.endsWith('@') || menu())) return;
    kit.closeMenu();
  }
  throw new Error('the composer in ' + scope + ' did not take the typing: it says "' + t.textContent + '"');
};
/** the bot's header says it is listening while the owner types (its transient state), on its own clock: two draws a moment apart differ */
const LISTENING = { 'stability.render': 'typing in a bot’s chat makes its header say it is listening, a transient state that settles on its own clock, so two draws a moment apart differ in that word' } as const;
const ROOM_COMPOSER = '#hx-view-bots .bt-group';
const BOT_COMPOSER = '#hx-view-bots .bt-room:not(.bt-group)';
const ROOM_MENU = { anchor: ROOM_COMPOSER + ' .k7-composer__box', layer: '.k7-menu[data-floating]' };
/** the room's own controls are in its details pane (the title pill opens it) */
const withDetails = (open: (c: AppCtx) => Promise<void>) => async (c: AppCtx): Promise<void> => { await open(c); c.hx.setState({ right: 'open' }); await c.wait(500); };
/** the owner's mixed draft: two members (chips), the whole room, a bot outside the room (the muted chip and the hint) and "@kai." (a
    full stop right after a name is part of the handle, so it names nobody and stays text) */
const MIXED = '@kai check the dates with @nina, then @all read it; ask @sol too. Thanks @kai.';
/** the paper past thread, then nina and kai among themselves; kai's last message asks the user, by the engine's word for the person */
const TO_YOU: ProviderSpec = { ...paper, patch: (p) => withGroupThread(p, (t) => [...t,
  { kind: 'text', id: 'ty1', who: 'nina', t: '09:12', round: 1, to: ['kai'], text: '@kai two points on the script: the numbering of the beats is off by one, and beat 9 leans on Juvenal for something he does not say.' },
  { kind: 'text', id: 'ty2', who: 'kai', t: '09:13', round: 2, text: 'nina, both points are fair. The numbering mix-up is mine.\n\n- **Beat numbers:** go by the line text, not the number.\n- **Juvenal:** the cracked-walls line goes, and its two sources with it.\n\n@user, the two blocking fixes and the source cuts are ready for nina to apply. Should she go ahead?' }
] as GroupMessage[]) };
const MOCK = { url: '/v6/__index.html', note: 'the mock opens on the session; its Bots tab is alt+2' };
/** the owner's sequence: the six drawn before their records, then the records read; every orb must wear the saved look */
const team: ProviderSpec = { simulate: false, patch: teamBeforeRecords };
const recordsRead = async (c: AppCtx): Promise<void> => {
  await bots(c); recordsArrive(); await c.wait(400);
  const bad = lookMismatches();
  if (bad.length) throw new Error('a bot is drawn in a look that is not its own: ' + bad.join('; '));
};
/** the Bots tab, then a check that every group row keeps its text out from under its stack */
const groupsLaidOut = async (c: AppCtx): Promise<void> => { await bots(c); const bad = groupRowOverlaps(); if (bad.length) throw new Error('a group row is drawn over: ' + bad.join('; ')); };
const openSheet = (id: string) => async (c: AppCtx): Promise<void> => { await pick(id)(c); await c.key('i', { ctrlKey: true }); await c.wait(500); };
const lookTab = (name: string) => async (): Promise<void> => { const t = [...document.querySelectorAll<HTMLElement>('#hx-view-bots [data-name="look"] [role="tab"]')].find((x) => x.textContent === name); t?.click(); await new Promise((r) => setTimeout(r, 300)); };

/** live updates of several bots (and a group's members) while the app is watched: no orb may be detached, put back or drawn
    anew, because a worker's canvas is empty until it is painted again (the sidebar's blink, 22 November 2026) */
const LIVE_UPDATES = {
  name: 'bots change state live', watch: '#hx-side', orbs: 'stay', sample: 1200,
  steps: [{ do: 'call', js: `(async () => { const d = window.__labDrive, w = (ms) => new Promise((r) => setTimeout(r, ms));
    d.bot('atlas', { state: 'working', activity: 'reading the diff' }); await w(160);
    d.bot('iris', { state: 'speaking' }); await w(160);
    d.bot('sol', { state: 'thinking' }); d.bot('hex', { state: 'idle' }); await w(160);
    d.group('room-release', { working: ['atlas', 'kai'] }); await w(160);
    d.bot('nina', { state: 'working', attention: null }); await w(160);
    d.bot('atlas', { state: 'idle', activity: '' }); d.bot('iris', { state: 'idle' }); d.group('room-release', { working: [] }); await w(160);
    d.bot('nina', { state: 'needs', attention: 'approval' }); })()`, ms: 1400 }]
} as const;

const roster: Story = {
  id: 'bots/roster', title: 'Bots roster', area: 'bots', kind: 'surface', covers: ['surface:bots-roster'], scope: '#hx-side', mock: MOCK,
  states: {
    typical: st(['typical'], {}, bots),
    'no bots': st(['empty', 'owner'], { bots: 'none' }, bots),
    'one bot': st(['single'], { bots: 'one' }, bots),
    '120 bots, scrolling': st(['many', 'scroll'], { bots: 120 }, bots, { allow: { axe: { el: 'label-content-name-mismatch', reason: 'axe-core reports label-content-name-mismatch (WCAG 2.5.3, R-a11y-1) only for the row that straddles the window\'s bottom edge (bot-017 at 1440 x 900, then bot-034 once scrolled); the same row, with the same name "bot-017, generated teammate 17, needs you" and the same visible words, passes when moved 100 px up, so it is the checker\'s clipping of a half-visible row and not the name, which holds every visible word in order (botLabel, R-a11y-1); every other axe rule still runs on this state' } } }),
    'a long name and the made-outside mark': st(['long'], { fixtures: ['long', 'outside'] }, bots),
    'archived group open': st(['variant', 'open'], { fixtures: ['outside'] }, async (c) => { await bots(c); await c.click('.bt-archived .k7-shead__btn'); await c.wait(300); }),
    'with a group': st(['variant'], grp, groupsLaidOut),
    rail: st(['variant'], {}, async (c) => { await bots(c); c.hx.setState({ left: 'rail' }); await c.wait(500); }),
    'rail with a group': st(['variant'], grp, async (c) => { await bots(c); c.hx.setState({ left: 'rail' }); await c.wait(500); }),
    'groups: one, two, three and six members, a long name': st(['many', 'long'], { patch: teamGroups }, groupsLaidOut, { note: 'each stack in a slot as wide as four places, so the names line up and none starts under a stack (the setup fails if one does); six members are three orbs and "+3"' }),
    'rail with those groups': st(['many', 'variant'], { patch: teamGroups }, async (c) => { await bots(c); c.hx.setState({ left: 'rail' }); await c.wait(500); const bad = groupRowOverlaps(); if (bad.length) throw new Error(bad.join('; ')); }),
    'those groups, a row hovered': st(['hover'], { patch: teamGroups }, groupsLaidOut, { force: [{ sel: '.bt-group-rows [data-gid="g-paper-past-"]', state: 'hover' }] }),
    'those groups, the current one': st(['variant'], { patch: teamGroups }, async (c) => { await groupsLaidOut(c); await c.click('.bt-group-rows [data-gid="g-paper-past-"]'); await c.wait(500); const bad = groupRowOverlaps(); if (bad.length) throw new Error(bad.join('; ')); }),
    'the owner\'s six, their records read after the roster': st(['owner', 'variant'], team, recordsRead, { note: 'the six were drawn with the looks their names give, then their saved records arrived: every row wears the saved look (the setup fails if any orb does not)' }),
    'live updates of several bots': st(['variant'], { fixtures: ['groups'], patch: drivable }, bots, { interact: [LIVE_UPDATES] }),
    'row hover': st(['hover'], {}, bots, { force: [{ sel: '#hx-list-bots .bt-rows > [data-kit~="ListRow"]:nth-of-type(2)', state: 'hover' }] }),
    'row focus': st(['focus'], {}, bots, { force: [{ sel: '#hx-list-bots .bt-rows > [data-kit~="ListRow"]', state: 'focus' }] })
  }
};

const room: Story = {
  id: 'bots/room', title: 'Bot room', area: 'bots', kind: 'surface', covers: ['surface:bots-room'], scope: '#hx-view-bots', mock: MOCK,
  states: {
    'nina (an approval)': st(['typical', 'owner'], {}, pick('nina')),
    'atlas (a thread)': st(['typical'], {}, pick('atlas')),
    'kai (no thread yet)': st(['empty'], {}, pick('kai')),
    'a long name': st(['long'], { fixtures: ['long'] }, pick('cassiopeia-staging-deploy-guardian')),
    'made outside boopis': st(['variant'], { fixtures: ['outside'] }, pick('sage')),
    'kai, its record read after the roster': st(['owner', 'variant'], team, async (c) => { await recordsRead(c); c.hx.emit('hx:bot-select', { id: 'kai', from: 'lab' }); await c.wait(500); const bad = lookMismatches(); if (bad.length) throw new Error('a bot is drawn in a look that is not its own: ' + bad.join('; ')); }, { note: 'the room\'s header, the roster and the dock all draw kai as its record says: a teal circle' }),
    'also running a kanban task': st(['variant', 'loading'], { simulate: false, patch: (p) => withKanbanWorker(liveShaped(p), 'review the render') }, pick('atlas')),
    'live bot: recent sessions and a live composer': st(['typical', 'owner'], live(), pick('atlas')),
    'live bot: a session open, with a line the app says': st(['variant', 'owner'], live(true), pick('atlas')),
    'live bot: a long name': st(['long'], { fixtures: ['long'], simulate: false, patch: (p) => liveShaped(p) }, pick('cassiopeia-staging-deploy-guardian')),
    'a reply in markdown: lists, a quote, code, a path, a mention': st(['typical', 'owner'], { simulate: false, patch: (p) => withMarkdownThread(p, 'atlas') }, pick('atlas')),
    'a reply under way: the status line': st(['loading', 'owner'], { simulate: false, patch: (p) => withRun(p, 'atlas') }, pick('atlas'), { allow: { 'stability.render': 'the pending entry counts the seconds the reply has taken (a clock, text only), so two draws a moment apart differ in that one number' } }),
    'no bots at all': st(['empty', 'owner'], { bots: 'none' }, bots),
    'the composer: "@" names a teammate': st(['open', 'owner'], {}, async (c) => { await pick('atlas')(c); await typeIn(BOT_COMPOSER, '@')(c); }, { overlay: { anchor: BOT_COMPOSER + ' .k7-composer__box', layer: '.k7-menu[data-floating]' }, allow: LISTENING }),
    'the composer: a teammate drawn as a chip': st(['variant', 'owner'], {}, async (c) => { await pick('atlas')(c); await typeIn(BOT_COMPOSER, 'ask @nina before you merge it ')(c); }, { allow: LISTENING }),
    'composer send hover': st(['hover', 'owner'], {}, pick('atlas'), { force: [{ sel: BOT_COMPOSER + ' [data-send]', state: 'hover' }] }),
    'composer attach tooltip': st(['tooltip', 'owner'], {}, async (c) => { await pick('atlas')(c); const b = document.querySelector<HTMLElement>(BOT_COMPOSER + ' .k7-composer [data-plus]'); if (b) { b.focus(); c.hx.ui.tooltip.show(b); } await c.wait(250); }, { overlay: { anchor: BOT_COMPOSER + ' .k7-composer [data-plus]', layer: '.ui-tip' } })
  }
};

const sheet: Story = {
  id: 'bots/settings-sheet', title: 'Bot settings sheet', area: 'bots', kind: 'surface', covers: ['surface:bots-sheet'], scope: '#hx-view-bots', mock: MOCK,
  states: {
    nina: st(['typical'], {}, async (c) => { await pick('nina')(c); await c.key('i', { ctrlKey: true }); await c.wait(500); }),
    'a long name': st(['long'], { fixtures: ['long'] }, async (c) => { await pick('cassiopeia-staging-deploy-guardian')(c); await c.key('i', { ctrlKey: true }); await c.wait(500); }),
    'live bot: where each routine posts': st(['typical', 'variant'], { fixtures: ['groups'], simulate: false, patch: (p) => liveShaped(p) }, async (c) => { await pick('atlas')(c); await c.key('i', { ctrlKey: true }); await c.wait(500); document.querySelector('#hx-view-bots .bt-routines')?.scrollIntoView({ block: 'center' }); await c.wait(200); }),
    'live bot: the room link, focused': st(['focus'], { fixtures: ['groups'], simulate: false, patch: (p) => liveShaped(p) }, async (c) => { await pick('atlas')(c); await c.key('i', { ctrlKey: true }); await c.wait(500); document.querySelector('#hx-view-bots .bt-routines')?.scrollIntoView({ block: 'center' }); await c.wait(200); }, { force: [{ sel: '#hx-view-bots .bt-routine-open', state: 'focus' }] }),
    'live bot: a routine posting to a long group name': st(['long'], { fixtures: ['groups'], simulate: false, patch: (p) => { const l = liveShaped(p); return { ...l, groups: { ...l.groups, snapshot: () => { const s = l.groups.snapshot(); return { ...s, groups: s.groups.map((g) => ({ ...g, name: 'the quarterly close review with finance, audit and the platform team' })) }; } } }; } }, async (c) => { await pick('atlas')(c); await c.key('i', { ctrlKey: true }); await c.wait(500); document.querySelector('#hx-view-bots .bt-routines')?.scrollIntoView({ block: 'center' }); await c.wait(200); }),
    'look: the shape tab': st(['variant', 'owner'], {}, async (c) => { await openSheet('nina')(c); await lookTab('Shape')(); }),
    'look: a new shape, on every orb at once': st(['variant', 'owner'], {}, async (c) => { await openSheet('nina')(c); await lookTab('Shape')(); document.querySelector<HTMLElement>('#hx-view-bots [data-name="look"] .bt-opt[aria-label="Star"]')?.click(); await c.wait(2500); const bad = [...document.querySelectorAll('.ui-orb[data-bot="nina"] > orb-avatar')].filter((o) => o.getAttribute('shape') !== 'star'); if (bad.length) throw new Error(bad.length + ' orbs of nina did not take the new shape'); }, { note: 'the sheet\'s orb, the room\'s header, the roster row and the dock wear the new shape; it is saved when the choosing stops' }),
    'look: a live bot made outside boopis': st(['variant'], { fixtures: ['outside'], simulate: false, patch: (p) => liveShaped(p) }, openSheet('sage')),
    'look: dice hover': st(['hover'], {}, openSheet('nina'), { force: [{ sel: '#hx-view-bots .bt-look-dice', state: 'hover' }] }),
    'look: a swatch focused': st(['focus'], {}, openSheet('nina'), { force: [{ sel: '#hx-view-bots [data-name="look"] .bt-opt[aria-checked="true"]', state: 'focus' }] }),
    'run limit: the row, in the model section': st(['variant'], {}, async (c) => { await openSheet('nina')(c); document.querySelector('#hx-view-bots [aria-label^="Turns a run may take"]')?.scrollIntoView({ block: 'center' }); await c.wait(200); }),
    'run limit menu, the bot has its own': st(['open', 'variant'], { patch: (p) => ({ ...p, bots: { ...p.bots, runLimit: () => Promise.resolve({ turns: 45, fallback: 10 }) } }) }, async (c) => { await openSheet('nina')(c); document.querySelector('#hx-view-bots [aria-label^="Turns a run may take"]')?.scrollIntoView({ block: 'center' }); await c.wait(200); await c.click('#hx-view-bots [aria-label^="Turns a run may take"]'); await c.wait(400); }, { overlay: { anchor: '#hx-view-bots [aria-label^="Turns a run may take"]', layer: '.ui-menu' } }),
    'scrolled to the end': st(['scroll'], {}, async (c) => { await pick('nina')(c); await c.key('i', { ctrlKey: true }); await c.wait(500); for (const n of document.querySelectorAll<HTMLElement>('#hx-view-bots [class*="sheet"] *')) if (n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY)) n.scrollTop = n.scrollHeight; await c.wait(200); })
  }
};

const newBot: Story = {
  id: 'bots/new-bot', title: 'New bot', area: 'bots', kind: 'surface', covers: ['surface:bots-new'], scope: '#hx-view-bots', mock: MOCK,
  states: {
    typical: st(['typical'], {}, async (c) => { await bots(c); c.hx.emit('hx:new-bot'); await c.wait(600); }, { allow: { 'stability.render': 'the dice and autoname pick at random' } }),
    'from no bots': st(['empty', 'owner'], { bots: 'none' }, async (c) => { await bots(c); c.hx.emit('hx:new-bot'); await c.wait(600); }, { allow: { 'stability.render': 'the dice and autoname pick at random' } }),
    'dice hover': st(['hover'], {}, async (c) => { await bots(c); c.hx.emit('hx:new-bot'); await c.wait(600); }, { force: [{ sel: '#hx-view-bots [aria-label*="Surprise"], #hx-view-bots .bt-dice', state: 'hover' }], allow: { 'stability.render': 'random by design' } })
  }
};

const groupRoom: Story = {
  id: 'bots/group', title: 'Group room', area: 'bots', kind: 'surface', covers: ['surface:bots-group'], scope: '#hx-view-bots', mock: MOCK,
  states: {
    'several members answered': st(['typical', 'owner'], grp, openGroup),
    'two members replying': st(['loading'], { ...grp, patch: (p) => withWorking(p) }, openGroup),
    'a team across rounds: to-lines, mentions, paths, code': st(['typical', 'owner'], paper, openPaper),
    'three members at work, each in a tool': st(['loading', 'owner'], { ...paper, patch: (p) => withActivity(p, [{ at: 0, status: 'running', tool: 'read_file' }, { at: 1, status: 'running', tool: 'terminal' }, { at: 2, status: 'queued' }]) }, openPaper),
    'five at work: one status line': st(['many', 'loading'], { ...paper, patch: (p) => withActivity(p, [0, 1, 2, 3, 4].map((at) => ({ at, status: at < 2 ? 'running' as const : 'queued' as const }))) }, openPaper),
    'the composer: "@" names the members': st(['open', 'owner'], paper, async (c) => { await openPaper(c); await typeIn(ROOM_COMPOSER, '@')(c); }, { overlay: ROOM_MENU }),
    'the composer: "@" with a member option hovered': st(['hover'], paper, async (c) => { await openPaper(c); await typeIn(ROOM_COMPOSER, '@')(c); }, { overlay: ROOM_MENU, force: [{ sel: '.k7-menu[data-floating] [data-kit~="MenuRow"]:nth-of-type(2)', state: 'hover' }] }),
    'the composer: mentions drawn as chips, an outsider muted, "@kai." left as text': st(['variant', 'owner'], paper, async (c) => { await openPaper(c); await typeIn(ROOM_COMPOSER, MIXED)(c); document.querySelector<HTMLElement>(ROOM_COMPOSER + ' .k7-composer__text')?.blur(); await c.wait(400); }),
    'a message addressed to you': st(['variant', 'owner'], TO_YOU, openPaper),
    'members in tools from a connected server': st(['loading', 'owner'], { ...paper, patch: (p) => withActivity(p, [{ at: 0, status: 'running', tool: 'mcp__fetch__fetch' }, { at: 2, status: 'running', tool: 'mcp__github__create_issue' }]) }, openPaper),
    'a mention hovered': st(['hover', 'owner'], paper, async (c) => { await openPaper(c); const m = document.querySelector<HTMLElement>('#hx-view-bots .k7-bubble .k7-mention'); if (m) { m.focus(); } await c.wait(700); }),
    'a mention of a bot that is not in the room: the chip and the hint': st(['variant', 'owner'], { fixtures: ['groups'], simulate: false }, async (c) => {
      await openGroup(c);
      const comp = document.querySelector<HTMLElement>('#hx-view-bots .bt-group .bt-composer');
      comp?.dispatchEvent(new CustomEvent('ui:send', { detail: { text: '@sol can you look at this? @nimbus. and @kai' } }));
      await c.wait(300);
      const t = comp?.querySelector<HTMLElement>('.k7-composer__text'); t?.focus(); if (t) kit.composerInsert(t, '@sol are you there'); await c.wait(400);
    }),
    'a message waiting for a member': st(['variant'], { ...grp, patch: (p) => withQueue(p, ['and could you add the changelog to the notes?']) }, openGroup),
    'two messages waiting': st(['variant'], { ...grp, patch: (p) => withQueue(p, ['and could you add the changelog to the notes?', '@nina what did staging say about the migration on the copy of production, and how long did it take to run end to end?'], 2) }, openGroup),
    'a member also running a kanban task': st(['variant'], { ...grp, patch: (p) => withKanbanWorker(liveShaped(p), 'review the render') }, openGroup),
    'a member names a bot that is not in the room: the note and Send to': st(['variant', 'owner'], { fixtures: ['groups'], simulate: false, patch: (p) => ({ ...p, groups: { ...p.groups, snapshot: () => { const s = p.groups.snapshot(); return { ...s, threads: Object.fromEntries(Object.entries(s.threads).map(([k, v]) => [k, [...v, { kind: 'text' as const, id: 'out1', who: 'kai', t: '06:14', text: '@sol please confirm the tag before we cut it.', round: 1 }]])) }; } } }) }, openGroup),
    'no messages yet': st(['empty'], { fixtures: ['groups'], simulate: false, patch: (p) => ({ ...p, groups: { ...p.groups, snapshot: () => ({ groups: p.groups.snapshot().groups, threads: {} }) } }) }, openGroup),
    'group chat is off': st(['error'], { ...grp, patch: (p) => ({ ...p, groups: { ...p.groups, note: () => 'Group chat is not running in the engine. Restart boopis and try again.' } }) }, openGroup),
    'a lead answers first': st(['variant'], { ...grp, patch: (p) => ({ ...p, groups: { ...p.groups, snapshot: () => { const s = p.groups.snapshot(); return { ...s, groups: s.groups.map((g) => ({ ...g, working: [], ...(g.members[0] ? { lead: g.members[0].id } : {}) })) }; } } }) }, openGroup),
    'a long name': st(['long'], { ...grp, patch: (p) => ({ ...p, groups: { ...p.groups, snapshot: () => { const s = p.groups.snapshot(); return { ...s, groups: s.groups.map((g) => ({ ...g, name: 'the quarterly close review with finance, audit and the platform team' })) }; } } }) }, openGroup)
  }
};

const boardOf = (k: Kanban): ProviderSpec => ({ fixtures: ['groups'], simulate: false, patch: (p) => withKanban(p, k) });
const openBoard = async (c: AppCtx): Promise<void> => { await withDetails(openGroup)(c); await c.click('#hx-right-bots [data-room="board"]'); await c.wait(500); };
const groupBoard: Story = {
  id: 'bots/group-board', title: 'Group kanban board', area: 'bots', kind: 'surface', covers: ['surface:bots-kanban'], scope: '#hx-view-bots', mock: MOCK,
  states: {
    'columns and their tasks': st(['typical', 'owner'], boardOf({}), openBoard),
    'reading the board': st(['loading'], boardOf({ never: true }), openBoard),
    'nothing on the board yet': st(['empty'], boardOf({ tasks: [] }), openBoard),
    'no board named like the group': st(['variant'], boardOf({ boards: [{ slug: 'default', name: 'Default', archived: false, counts: {} }, { slug: 'paper-past', name: 'Paper past', archived: false, counts: {} }] }), openBoard),
    'the engine has no board': st(['empty', 'variant'], boardOf({ boards: [] }), openBoard),
    'the board could not be read': st(['error'], boardOf({ failView: 'The engine is not running. Open boopis again to start it.' }), openBoard),
    'the boards could not be listed': st(['error'], boardOf({ failBoards: 'The engine is not running. Open boopis again to start it.' }), openBoard),
    'this build cannot read boards': st(['disabled'], { fixtures: ['groups'], simulate: false }, openBoard),
    'a blocked task and long titles': st(['long'], boardOf({ tasks: [...TASKS, { ...TASKS[4]!, id: 't_99', title: 'Compare every figure in the quarterly close report against the ledger, the bank statements and last year\'s filing, and list each difference with its page', problem: 'two of the sources could not be opened and the checker stopped before it reached the second table of the ledger' }] }), openBoard),
    'forty tasks, scrolling': st(['many', 'scroll'], boardOf({ tasks: MANY }), openBoard),
    'a column collapsed': st(['variant'], boardOf({}), async (c) => { await openBoard(c); document.querySelector<HTMLElement>('#hx-view-bots .bt-board .ui-sec__head')?.click(); await c.wait(300); }),
    'a long group name': st(['long'], { fixtures: ['groups'], simulate: false, patch: (p) => { const k = withKanban(p, {}); return { ...k, groups: { ...k.groups, snapshot: () => { const s = k.groups.snapshot(); return { ...s, groups: s.groups.map((g) => ({ ...g, name: 'the quarterly close review with finance, audit and the platform team' })) }; } } }; } }, openBoard)
  }
};

/* a room's details pane (group-details.ts): what the v6 room kept in its header, on the kit's Pane; no board draws it (an owner question) */
const LIMIT_MENU = { anchor: '#hx-right-bots [data-room="limit"]', layer: '.k7-menu[data-floating]' };
const groupDetails: Story = {
  id: 'bots/group-details', title: 'Group details', area: 'bots', kind: 'surface', covers: ['surface:bots-group-details'], scope: '#hx-right-shell', mock: MOCK,
  states: {
    typical: st(['typical', 'owner'], grp, withDetails(openGroup)),
    'six members, a long name': st(['long', 'many'], { patch: teamGroups }, withDetails(async (c) => { await bots(c); await c.click('.bt-group-rows > [data-kit~="ListRow"]:last-child'); await c.wait(500); })),
    'a row hovered': st(['hover'], grp, withDetails(openGroup), { force: [{ sel: '#hx-right-bots [data-room="members"]', state: 'hover' }] }),
    'a row focused': st(['focus'], grp, withDetails(openGroup), { force: [{ sel: '#hx-right-bots [data-room="board"]', state: 'focus' }] }),
    'renaming: the name field focused': st(['focus', 'variant'], grp, async (c) => { await withDetails(openGroup)(c); document.querySelector<HTMLInputElement>('#hx-right-bots input[data-room="name"]')?.focus(); await c.wait(200); }),
    'run limit menu open': st(['open', 'owner'], grp, async (c) => { await withDetails(openGroup)(c); await c.click(LIMIT_MENU.anchor); await c.wait(400); }, { overlay: LIMIT_MENU }),
    'run limit menu, the group has its own': st(['open', 'variant'], { ...grp, patch: (p) => ({ ...p, groups: { ...p.groups, roundLimit: () => Promise.resolve({ rounds: 45, fallback: 30 }) } }) }, async (c) => { await withDetails(openGroup)(c); await c.click(LIMIT_MENU.anchor); await c.wait(400); }, { overlay: LIMIT_MENU }),
    'the board is open': st(['variant'], { fixtures: ['groups'], simulate: false, patch: (p) => withKanban(p, {}) }, openBoard)
  }
};

const newGroup: Story = {
  id: 'bots/new-group', title: 'New group', area: 'bots', kind: 'surface', covers: ['surface:bots-new-group'], scope: '#hx-view-bots', mock: MOCK,
  states: {
    typical: st(['typical', 'owner'], grp, async (c) => { await bots(c); c.hx.emit('hx:new-group'); await c.wait(500); }),
    'members picked': st(['variant', 'owner'], grp, async (c) => { await bots(c); c.hx.emit('hx:new-group'); await c.wait(400); for (const n of [...document.querySelectorAll<HTMLElement>('#hx-view-bots .bt-member')].slice(0, 3)) n.click(); const name = document.querySelector<HTMLInputElement>('#hx-view-bots .bt-new:not([hidden]) .bt-name'); if (name) name.value = 'release crew'; await c.wait(300); }),
    'changing the members': st(['variant'], grp, async (c) => { await withDetails(openGroup)(c); await c.click('#hx-right-bots [data-room="members"]'); await c.wait(400); }),
    'only one bot': st(['empty'], { bots: 'one' }, async (c) => { await bots(c); c.hx.emit('hx:new-group'); await c.wait(500); }),
    'group chat is off': st(['error'], { patch: (p) => ({ ...p, groups: { ...p.groups, note: () => 'Group chat is not running in the engine. Restart boopis and try again.' } }) }, async (c) => { await bots(c); c.hx.emit('hx:new-group'); await c.wait(500); })
  }
};

export default [roster, room, sheet, newBot, groupRoom, groupDetails, groupBoard, newGroup];
