/* The Bots tab: the roster (rail and open), a bot's room and thread, its settings sheet, a new bot (the dice: eyes are
   never user-settable, they belong to states; the dice agent, w11/dice, fixes), the Archived group and the "made outside
   boopis" mark, with no bots, one, many and long names. */
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
/** the sample thread cut after the huddle (the last of the bots' own rounds), so the talk is live; `extra` more rounds are added */
const huddleLive = (extra = 0): ProviderSpec => ({ ...paper, patch: (p) => withGroupThread(p, (t) => {
  const end = t.findIndex((m) => m.kind === 'text' && m.who === 'you' && m.id !== t[0]?.id);
  const cut = (end < 0 ? [...t] : t.slice(0, end)) as GroupMessage[];
  const more: GroupMessage[] = ['nina', 'kai', 'moss', 'hex', 'iris'].slice(0, extra).map((who, i) => ({ kind: 'text', id: 'hx' + i, who, t: '09:' + String(8 + i).padStart(2, '0'), round: 5 + i, to: [], text: i % 2 ? 'Checked again: nothing changed since the last round, so I am leaving `' + 'episodes/2026-11-22-cooking-pot/episode.json' + '` as it is.' : 'One more pass over the captions: the third line of beat 2 runs to 41 characters in PT-BR, so I cut *quase* and it fits. @' + (['kai', 'moss', 'hex', 'iris', 'nina'][i] ?? 'kai') + ' please look.' }));
  return [...cut, ...more];
}) });
const openHuddle = async (c: AppCtx): Promise<void> => { await openPaper(c); await c.click('#hx-view-bots .bt-huddle-entry .ui-disclosure'); await c.wait(400); };
const openGroup = async (c: AppCtx): Promise<void> => { await bots(c); await c.click('.bt-group-rows > [data-kit~="ListRow"]'); await c.wait(500); };
/** types into a composer the way a person does: the caret at the end, then each character as its own edit (a typed "@" opens the
    list, which the setup waits for). On a loaded machine the room may still be settling when the typing starts and the keys land
    nowhere, so the setup checks what the text says and types again from an empty draft (at most three times) */
const typeIn = (scope: string, text: string) => async (c: AppCtx): Promise<void> => {
  const comp = document.querySelector<HTMLElement & { setValue(t: string): void; focus(): void; readonly value: string }>(scope + ' .ui-composer');
  if (!comp) throw new Error('no composer in ' + scope);
  for (let attempt = 0; attempt < 3; attempt++) {
    comp.setValue(''); comp.focus(); await c.wait(60);
    for (const ch of text) { document.execCommand('insertText', false, ch); await c.wait(20); }
    await c.wait(450);
    if (text.endsWith('@')) for (let i = 0; i < 40 && !document.querySelector('.ui-listbox'); i++) await c.wait(50);
    if (comp.value === text && (!text.endsWith('@') || document.querySelector('.ui-listbox'))) return;
    c.hx.ui.listbox.close(false);
  }
  throw new Error('the composer in ' + scope + ' did not take the typing: it says "' + comp.value + '"');
};
/** the bot's header says it is listening while the owner types (its transient state), on its own clock: two draws a moment apart differ */
const LISTENING = { 'stability.render': 'typing in a bot’s chat makes its header say it is listening, a transient state that settles on its own clock, so two draws a moment apart differ in that word' } as const;
const ROOM_COMPOSER = '#hx-view-bots .bt-group';
const BOT_COMPOSER = '#hx-view-bots .bt-room:not(.bt-group)';
const ROOM_MENU = { anchor: ROOM_COMPOSER + ' .ui-composer__anchor', layer: '.ui-listbox' };
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
    'archived group open': st(['variant', 'open'], { fixtures: ['outside'] }, async (c) => { await bots(c); await c.click('.bt-archived .ui-group__head'); await c.wait(300); }),
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
    'a reply under way: the presence entry': st(['loading', 'owner'], { simulate: false, patch: (p) => withRun(p, 'atlas') }, pick('atlas'), { allow: { 'stability.render': 'the pending entry counts the seconds the reply has taken (a clock, text only), so two draws a moment apart differ in that one number' } }),
    'no bots at all': st(['empty', 'owner'], { bots: 'none' }, bots),
    'the composer: "@" names a teammate': st(['open', 'owner'], {}, async (c) => { await pick('atlas')(c); await typeIn(BOT_COMPOSER, '@')(c); }, { overlay: { anchor: BOT_COMPOSER + ' .ui-composer__anchor', layer: '.ui-listbox' }, allow: LISTENING }),
    'the composer: a teammate drawn as a chip': st(['variant', 'owner'], {}, async (c) => { await pick('atlas')(c); await typeIn(BOT_COMPOSER, 'ask @nina before you merge it ')(c); }, { allow: LISTENING }),
    'composer send hover': st(['hover', 'owner'], {}, pick('atlas'), { force: [{ sel: '#hx-view-bots .ui-send', state: 'hover' }] }),
    'composer attach tooltip': st(['tooltip', 'owner'], {}, async (c) => { await pick('atlas')(c); const b = document.querySelector<HTMLElement>('#hx-view-bots .ui-composer__attach, #hx-view-bots .ui-composer__mic'); if (b) { b.focus(); c.hx.ui.tooltip.show(b); } await c.wait(250); }, { overlay: { anchor: '#hx-view-bots .ui-composer__attach, #hx-view-bots .ui-composer__mic', layer: '.ui-tip' } })
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
    'five at work: one presence entry': st(['many', 'loading'], { ...paper, patch: (p) => withActivity(p, [0, 1, 2, 3, 4].map((at) => ({ at, status: at < 2 ? 'running' as const : 'queued' as const }))) }, openPaper),
    'a huddle opened': st(['open', 'owner'], paper, openHuddle),
    'a long huddle, opened': st(['long', 'owner'], huddleLive(5), openPaper),
    'a huddle under way: open while the talk is live': st(['loading', 'owner'], huddleLive(), openPaper),
    'a huddle with a mention chip hovered inside': st(['hover', 'owner'], paper, async (c) => { await openHuddle(c); const m = document.querySelector<HTMLElement>('#hx-view-bots .bt-huddle__body .ui-mention'); if (m) m.focus(); await c.wait(700); }),
    'a huddle grows as messages arrive, then folds when you write': st(['variant', 'owner'], { ...paper, patch: (p) => withGroupThread(drivable(p), (t) => { const end = t.findIndex((m) => m.kind === 'text' && m.who === 'you' && m.id !== t[0]?.id); return end < 0 ? t : t.slice(0, end); }) }, async (c) => {
      await openPaper(c);
      const drive = (window as unknown as { __labDrive: { message(g: string, m: GroupMessage): void } }).__labDrive;
      const huddle = (): HTMLElement | null => document.querySelector<HTMLElement>('#hx-view-bots .bt-huddle-entry');
      const say = (id: string, who: string, round: number, text: string): GroupMessage => ({ kind: 'text', id, who, t: '09:' + (8 + round), round, text });
      const g = 'room-paper', n0 = huddle()?.dataset['huddle'];
      drive.message(g, say('lv1', 'nina', 5, 'One more look at beat 2: it fits in three lines now.')); await c.wait(350);
      drive.message(g, say('lv2', 'kai', 6, 'Good. @moss ship the captions as they are.')); await c.wait(350);
      const grown = document.querySelectorAll('#hx-view-bots .bt-huddle-entry');
      if (n0 !== '4' || grown.length !== 1 || huddle()?.dataset['huddle'] !== '6') throw new Error('the huddle did not take the arriving messages in: ' + n0 + ' then ' + [...grown].map((e) => (e as HTMLElement).dataset['huddle']).join(','));
      if (huddle()?.querySelector('.ui-disclosure')?.getAttribute('aria-expanded') !== 'true') throw new Error('a huddle under way folded while the talk was live');
      drive.message(g, { kind: 'text', id: 'lv3', who: 'you', t: '09:15', text: 'Thanks, ship it.' }); await c.wait(350);
      if (huddle()?.querySelector('.ui-disclosure')?.getAttribute('aria-expanded') !== 'false') throw new Error('the huddle stayed open after the user wrote');
    }),
    'the composer: "@" names the members': st(['open', 'owner'], paper, async (c) => { await openPaper(c); await typeIn(ROOM_COMPOSER, '@')(c); }, { overlay: ROOM_MENU }),
    'the composer: "@" with a member option hovered': st(['hover'], paper, async (c) => { await openPaper(c); await typeIn(ROOM_COMPOSER, '@')(c); }, { overlay: ROOM_MENU, force: [{ sel: '.ui-listbox .ui-option:nth-of-type(2)', state: 'hover' }] }),
    'the composer: mentions drawn as chips, an outsider muted, "@kai." left as text': st(['variant', 'owner'], paper, async (c) => { await openPaper(c); await typeIn(ROOM_COMPOSER, MIXED)(c); document.querySelector<HTMLElement>(ROOM_COMPOSER + ' .ui-composer__input')?.blur(); await c.wait(400); }),
    'a message addressed to you': st(['variant', 'owner'], TO_YOU, openPaper),
    'members in tools from a connected server': st(['loading', 'owner'], { ...paper, patch: (p) => withActivity(p, [{ at: 0, status: 'running', tool: 'mcp__fetch__fetch' }, { at: 2, status: 'running', tool: 'mcp__github__create_issue' }]) }, openPaper),
    'a mention hovered': st(['hover', 'owner'], paper, async (c) => { await openPaper(c); const m = document.querySelector<HTMLElement>('#hx-view-bots .ui-mention'); if (m) { m.focus(); } await c.wait(700); }),
    'a mention of a bot that is not in the room: the chip and the hint': st(['variant', 'owner'], { fixtures: ['groups'], simulate: false }, async (c) => {
      await openGroup(c);
      const comp = document.querySelector<HTMLElement & { insert(t: string): void; focus(): void }>('#hx-view-bots .bt-group .ui-composer');
      comp?.dispatchEvent(new CustomEvent('ui:send', { detail: { text: '@sol can you look at this? @nimbus. and @kai' } }));
      await c.wait(300);
      comp?.focus(); comp?.insert('@sol are you there'); await c.wait(400);
    }),
    'a message waiting for a member': st(['variant'], { ...grp, patch: (p) => withQueue(p, ['and could you add the changelog to the notes?']) }, openGroup),
    'two messages waiting': st(['variant'], { ...grp, patch: (p) => withQueue(p, ['and could you add the changelog to the notes?', '@nina what did staging say about the migration on the copy of production, and how long did it take to run end to end?'], 2) }, openGroup),
    'a member also running a kanban task': st(['variant'], { ...grp, patch: (p) => withKanbanWorker(liveShaped(p), 'review the render') }, openGroup),
    'a member names a bot that is not in the room: the note and Send to': st(['variant', 'owner'], { fixtures: ['groups'], simulate: false, patch: (p) => ({ ...p, groups: { ...p.groups, snapshot: () => { const s = p.groups.snapshot(); return { ...s, threads: Object.fromEntries(Object.entries(s.threads).map(([k, v]) => [k, [...v, { kind: 'text' as const, id: 'out1', who: 'kai', t: '06:14', text: '@sol please confirm the tag before we cut it.', round: 1 }]])) }; } } }) }, openGroup),
    'no messages yet': st(['empty'], { fixtures: ['groups'], simulate: false, patch: (p) => ({ ...p, groups: { ...p.groups, snapshot: () => ({ groups: p.groups.snapshot().groups, threads: {} }) } }) }, openGroup),
    'group chat is off': st(['error'], { ...grp, patch: (p) => ({ ...p, groups: { ...p.groups, note: () => 'Group chat is not running in the engine. Restart boopis and try again.' } }) }, openGroup),
    'renaming': st(['variant'], grp, async (c) => { await openGroup(c); await c.click('#hx-view-bots [aria-label^="Rename"]'); await c.wait(300); }),
    'run limit menu open': st(['open', 'owner'], grp, async (c) => { await openGroup(c); await c.click('#hx-view-bots [aria-label^="Rounds a run may take"]'); await c.wait(400); }, { overlay: { anchor: '#hx-view-bots [aria-label^="Rounds a run may take"]', layer: '.ui-menu' } }),
    'run limit menu, the group has its own': st(['open', 'variant'], { ...grp, patch: (p) => ({ ...p, groups: { ...p.groups, roundLimit: () => Promise.resolve({ rounds: 45, fallback: 30 }) } }) }, async (c) => { await openGroup(c); await c.click('#hx-view-bots [aria-label^="Rounds a run may take"]'); await c.wait(400); }, { overlay: { anchor: '#hx-view-bots [aria-label^="Rounds a run may take"]', layer: '.ui-menu' } }),
    'a lead answers first': st(['variant'], { ...grp, patch: (p) => ({ ...p, groups: { ...p.groups, snapshot: () => { const s = p.groups.snapshot(); return { ...s, groups: s.groups.map((g) => ({ ...g, working: [], ...(g.members[0] ? { lead: g.members[0].id } : {}) })) }; } } }) }, openGroup),
    'a long name': st(['long'], { ...grp, patch: (p) => ({ ...p, groups: { ...p.groups, snapshot: () => { const s = p.groups.snapshot(); return { ...s, groups: s.groups.map((g) => ({ ...g, name: 'the quarterly close review with finance, audit and the platform team' })) }; } } }) }, openGroup)
  }
};

const boardOf = (k: Kanban): ProviderSpec => ({ fixtures: ['groups'], simulate: false, patch: (p) => withKanban(p, k) });
const openBoard = async (c: AppCtx): Promise<void> => { await openGroup(c); const b = [...document.querySelectorAll<HTMLElement>('#hx-view-bots .bt-ghead button')].find((x) => x.textContent === 'Board'); if (!b) throw new Error('lab: no Board button'); b.click(); await c.wait(600); };
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
    'the board button hover': st(['hover'], boardOf({}), openGroup, { force: [{ sel: '#hx-view-bots .bt-ghead button:not([aria-label])', state: 'hover' }] }),
    'the board button focus': st(['focus'], boardOf({}), openGroup, { force: [{ sel: '#hx-view-bots .bt-ghead button:not([aria-label])', state: 'focus' }] }),
    'a long group name': st(['long'], { fixtures: ['groups'], simulate: false, patch: (p) => { const k = withKanban(p, {}); return { ...k, groups: { ...k.groups, snapshot: () => { const s = k.groups.snapshot(); return { ...s, groups: s.groups.map((g) => ({ ...g, name: 'the quarterly close review with finance, audit and the platform team' })) }; } } }; } }, openBoard)
  }
};

const newGroup: Story = {
  id: 'bots/new-group', title: 'New group', area: 'bots', kind: 'surface', covers: ['surface:bots-new-group'], scope: '#hx-view-bots', mock: MOCK,
  states: {
    typical: st(['typical', 'owner'], grp, async (c) => { await bots(c); c.hx.emit('hx:new-group'); await c.wait(500); }),
    'members picked': st(['variant', 'owner'], grp, async (c) => { await bots(c); c.hx.emit('hx:new-group'); await c.wait(400); for (const n of [...document.querySelectorAll<HTMLElement>('#hx-view-bots .bt-member')].slice(0, 3)) n.click(); const name = document.querySelector<HTMLInputElement>('#hx-view-bots .bt-new:not([hidden]) .bt-name'); if (name) name.value = 'release crew'; await c.wait(300); }),
    'changing the members': st(['variant'], grp, async (c) => { await openGroup(c); await c.click('#hx-view-bots [aria-label^="Change the members"]'); await c.wait(400); }),
    'only one bot': st(['empty'], { bots: 'one' }, async (c) => { await bots(c); c.hx.emit('hx:new-group'); await c.wait(500); }),
    'group chat is off': st(['error'], { patch: (p) => ({ ...p, groups: { ...p.groups, note: () => 'Group chat is not running in the engine. Restart boopis and try again.' } }) }, async (c) => { await bots(c); c.hx.emit('hx:new-group'); await c.wait(500); })
  }
};

export default [roster, room, sheet, newBot, groupRoom, groupBoard, newGroup];
