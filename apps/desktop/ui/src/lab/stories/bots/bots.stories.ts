/* The Bots tab: the roster (rail and open), a bot's room and thread, its settings sheet, a new bot (the dice: eyes are
   never user-settable, they belong to states; the dice agent, w11/dice, fixes), the Archived group and the "made outside
   boopis" mark, with no bots, one, many and long names. */
import type { AppCtx, ProviderSpec, State, Story } from '../../types';
import { drivable, groupRowOverlaps, liveShaped, lookMismatches, recordsArrive, teamBeforeRecords, teamGroups, withActivity, withKanbanWorker, withMarkdownThread, withQueue, withRun, withWorking } from '../../live-bots';

const bots = async (c: AppCtx): Promise<void> => { c.hx.setState({ tab: 'bots' }); await c.wait(500); };
const pick = (id: string) => async (c: AppCtx): Promise<void> => { await bots(c); c.hx.emit('hx:bot-select', { id, from: 'lab' }); await c.wait(500); };
const st = (tags: State['tags'], provider: ProviderSpec, setup: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, app: { provider, setup }, ...extra });
const live = (withThread = false): ProviderSpec => ({ simulate: false, patch: (p) => liveShaped(p, withThread) });
const grp: ProviderSpec = { fixtures: ['groups'] };
const paper: ProviderSpec = { fixtures: ['groups', 'paper-past'] };
const openPaper = async (c: AppCtx): Promise<void> => { await bots(c); await c.click('.bt-groups li:nth-of-type(2) .ui-row'); await c.wait(500); };
const openGroup = async (c: AppCtx): Promise<void> => { await bots(c); await c.click('.bt-groups .ui-row'); await c.wait(500); };
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
    'those groups, a row hovered': st(['hover'], { patch: teamGroups }, groupsLaidOut, { force: [{ sel: '.bt-groups .ui-row[data-gid="g-paper-past-"]', state: 'hover' }] }),
    'those groups, the current one': st(['variant'], { patch: teamGroups }, async (c) => { await groupsLaidOut(c); await c.click('.bt-groups .ui-row[data-gid="g-paper-past-"]'); await c.wait(500); const bad = groupRowOverlaps(); if (bad.length) throw new Error(bad.join('; ')); }),
    'the owner\'s six, their records read after the roster': st(['owner', 'variant'], team, recordsRead, { note: 'the six were drawn with the looks their names give, then their saved records arrived: every row wears the saved look (the setup fails if any orb does not)' }),
    'live updates of several bots': st(['variant'], { fixtures: ['groups'], patch: drivable }, bots, { interact: [LIVE_UPDATES] }),
    'row hover': st(['hover'], {}, bots, { force: [{ sel: '#hx-list-bots li:nth-of-type(2) .ui-row', state: 'hover' }] }),
    'row focus': st(['focus'], {}, bots, { force: [{ sel: '#hx-list-bots .ui-row', state: 'focus' }] })
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
    'composer send hover': st(['hover', 'owner'], {}, pick('atlas'), { force: [{ sel: '#hx-view-bots .ui-send', state: 'hover' }] }),
    'composer attach tooltip': st(['tooltip', 'owner'], {}, async (c) => { await pick('atlas')(c); const b = document.querySelector<HTMLElement>('#hx-view-bots .ui-composer__attach, #hx-view-bots .ui-composer__mic'); if (b) { b.focus(); c.hx.ui.tooltip.show(b); } await c.wait(250); }, { overlay: { anchor: '#hx-view-bots .ui-composer__attach, #hx-view-bots .ui-composer__mic', layer: '.ui-tip' } })
  }
};

const sheet: Story = {
  id: 'bots/settings-sheet', title: 'Bot settings sheet', area: 'bots', kind: 'surface', covers: ['surface:bots-sheet'], scope: '#hx-view-bots', mock: MOCK,
  states: {
    nina: st(['typical'], {}, async (c) => { await pick('nina')(c); await c.key('i', { ctrlKey: true }); await c.wait(500); }),
    'a long name': st(['long'], { fixtures: ['long'] }, async (c) => { await pick('cassiopeia-staging-deploy-guardian')(c); await c.key('i', { ctrlKey: true }); await c.wait(500); }),
    'look: the shape tab': st(['variant', 'owner'], {}, async (c) => { await openSheet('nina')(c); await lookTab('Shape')(); }),
    'look: a new shape, on every orb at once': st(['variant', 'owner'], {}, async (c) => { await openSheet('nina')(c); await lookTab('Shape')(); document.querySelector<HTMLElement>('#hx-view-bots [data-name="look"] .bt-opt[aria-label="Star"]')?.click(); await c.wait(2500); const bad = [...document.querySelectorAll('.ui-orb[data-bot="nina"] > orb-avatar')].filter((o) => o.getAttribute('shape') !== 'star'); if (bad.length) throw new Error(bad.length + ' orbs of nina did not take the new shape'); }, { note: 'the sheet\'s orb, the room\'s header, the roster row and the dock wear the new shape; it is saved when the choosing stops' }),
    'look: a live bot made outside boopis': st(['variant'], { fixtures: ['outside'], simulate: false, patch: (p) => liveShaped(p) }, openSheet('sage')),
    'look: dice hover': st(['hover'], {}, openSheet('nina'), { force: [{ sel: '#hx-view-bots .bt-look-dice', state: 'hover' }] }),
    'look: a swatch focused': st(['focus'], {}, openSheet('nina'), { force: [{ sel: '#hx-view-bots [data-name="look"] .bt-opt[aria-checked="true"]', state: 'focus' }] }),
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
    'a member chip hover': st(['hover'], grp, openGroup, { force: [{ sel: '#hx-view-bots .bt-group .ui-chip', state: 'hover' }] }),
    'a lead answers first': st(['variant'], { ...grp, patch: (p) => ({ ...p, groups: { ...p.groups, snapshot: () => { const s = p.groups.snapshot(); return { ...s, groups: s.groups.map((g) => ({ ...g, working: [], ...(g.members[0] ? { lead: g.members[0].id } : {}) })) }; } } }) }, openGroup),
    'a long name': st(['long'], { ...grp, patch: (p) => ({ ...p, groups: { ...p.groups, snapshot: () => { const s = p.groups.snapshot(); return { ...s, groups: s.groups.map((g) => ({ ...g, name: 'the quarterly close review with finance, audit and the platform team' })) }; } } }) }, openGroup)
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

export default [roster, room, sheet, newBot, groupRoom, newGroup];
