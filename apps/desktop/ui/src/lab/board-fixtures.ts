/* The approved boards' own content, as provider data (docs/design/v7/boards/src: kit.js LOOKS, botscreens.js bot11, sessiontab.js
   inbox, sessionnew.js newSess, dockv7.js). `pnpm lab:board` draws the app's real modules on it and compares them with the board,
   so every word, look and order here is the board's. Test data: the lab alone reads it. */
import { store } from '../data/store';
import type { DataProvider, GroupsEvent } from '../data/provider';
import { CAREFUL_STEPS, YES } from '../data/session-s0';
import type { LaunchSettings, SessionCapabilities, SessionControls } from '../data/session-s0';
import type { Bot, Conversation, Group, GroupMember, GroupMessage, LimitNotice, Schedule, SessionSummary, ThreadMessage } from '../data/types';

/* ───────── the bots (kit.js LOOKS, in screens.js ORDER) ───────── */
type Look = { id: string; shape: string; color: string; role: string; state: string; attention?: string; activity?: string };
const LOOKS: readonly Look[] = [
  { id: 'boopis', shape: 'squircle', color: '#f5f5f5', role: 'runs the team', state: 'idle' },
  { id: 'kai', shape: 'circle', color: '#4fc9a8', role: 'docs and changelog', state: 'idle' },
  { id: 'nina', shape: 'triangle', color: '#f23b5a', role: 'deploys', state: 'needs', attention: 'approval', activity: 'approve a deploy' },
  { id: 'moss', shape: 'squircle', color: '#2fd26a', role: 'flaky test hunter', state: 'idle' },
  { id: 'iris', shape: 'flower', color: '#3b82f6', role: 'design QA', state: 'idle' },
  { id: 'hex', shape: 'hexagon', color: '#a6a6ab', role: 'security review', state: 'sleeping' },
  { id: 'nimbus', shape: 'cloud', color: '#9b5cf6', role: 'inbox triage', state: 'idle' }
];
const member = (id: string): GroupMember => ({ id, profile: id, handle: id, name: id });
const RELEASE_CREW: Group = { id: 'room-release', name: 'release crew', members: ['kai', 'nina', 'moss'].map(member), working: [], busy: false, queued: [] };

function roster(p: DataProvider, over: Readonly<Record<string, Partial<Bot>>>, ids?: readonly string[]): Bot[] {
  const tpl = p.bots.snapshot().bots[0] as Bot;
  const looks = ids ? ids.map((id) => LOOKS.find((l) => l.id === id) as Look) : LOOKS;
  return looks.map((l) => ({
    ...tpl, id: l.id, name: l.id, role: l.role, shape: l.shape, color: l.color, state: l.state, attention: l.attention ?? null, activity: l.activity ?? '', spent: '0.00', last: null, ideas: [],
    cfg: { ...tpl.cfg, gov: 'governed', model: 'sonnet 5.5', cap: '', cron: '', workspace: 'worktree' }, ...(over[l.id] ?? {})
  }));
}

/* ───────── board 11: kai's chat, an approval waiting ───────── */
const T = 'Today 10:05';
const KAI_THREAD: readonly ThreadMessage[] = [
  { kind: 'text', id: 'b11-1', who: 'you', t: T, text: 'Draft the release notes for 0.2.0 and push them.' },
  { kind: 'text', id: 'b11-2', who: 'kai', t: T, text: 'On it. 14 merges since Monday, most of them the dock and the rooms.' },
  { kind: 'tool', id: 'b11-3', who: 'kai', t: T, tool: 'Read', target: '14 merged pull requests' },
  { kind: 'file', id: 'b11-4', who: 'kai', t: T, name: 'CHANGELOG.md', meta: '41 lines, 2.1 KB' },
  { kind: 'text', id: 'b11-5', who: 'kai', t: T, text: 'The notes are in two sections: one screen for people, one for the Local API.' },
  { kind: 'approval', id: 'b11-6', who: 'kai', t: T, data: { id: 'b11-6', title: 'Push to a shared branch: git push origin notes-0.2', rule: 'Pushes to a shared branch', from: 'kai' } }
];
const KAI_SCHEDULE: Schedule = { id: 'b11-weekly', bot: 'kai', what: 'Weekly changelog', when: 'Fridays around 16:00', next: 'fri 16:00', paused: false };

export function board11(p: DataProvider): DataProvider {
  const tpl = p.bots.snapshot().bots[0] as Bot;
  const bots = roster(p, { kai: { state: 'needs', attention: 'approval', spent: '0.12', cfg: { ...tpl.cfg, gov: 'governed', model: 'sonnet 5.5', cap: '1.00', cron: '', workspace: 'worktree' } } });
  return {
    ...p,
    bots: { ...p.bots, snapshot: () => ({ bots, threads: { ...Object.fromEntries(bots.map((b) => [b.id, []])), kai: KAI_THREAD } }), workspace: (id: string) => (id === 'kai' ? '/home/you/code/boopis/.worktrees/notes-0.2' : null) },
    waits: { ...p.waits, snapshot: () => [] },
    groups: { ...p.groups, snapshot: () => ({ groups: [RELEASE_CREW], threads: { [RELEASE_CREW.id]: [] } }) },
    schedules: { ...p.schedules, list: store<readonly Schedule[]>([KAI_SCHEDULE]) }
  };
}

/* ───────── board 12: the release crew's room, the Bots sidebar open ─────────
   The room is botscreens.js room12; the sidebar is board K02's (src-k02 screens.js sidebarOpen, the later owner decision: the
   switch, the main bot at 44, rows of 28 orbs, "Groups"). Its rows say what each bot last did (kai is writing, nina waits on you,
   the others their last words, hex sleeps). The room's row says "nina: the deploy is ready" while the thread ends with moss: the
   two boards are not one moment, so the list's snapshot knows the room's latest message and the thread that is read as the room
   opens is the one board 12 draws. */
const T12 = 'Today 11:20';
const CREW_THREAD: readonly GroupMessage[] = [
  { kind: 'text', id: 'b12-1', who: 'you', t: T12, text: '@kai write the notes, @nina ship 0.2.0 to staging when they\'re in.' },
  { kind: 'text', id: 'b12-2', who: 'kai', t: T12, round: 0, text: 'Notes are in `CHANGELOG.md`, two sections. The dock fix is the headline ([WebKit bug 27611](https://bugs.webkit.org/show_bug.cgi?id=27611)).' },
  { kind: 'note', id: 'b12-3', t: T12, text: 'Created routine Weekly changelog', about: 'routine' },
  { kind: 'text', id: 'b12-4', who: 'nina', t: T12, round: 0, text: '@user staging needs your approval before I deploy.' },
  { kind: 'text', id: 'b12-5', who: 'moss', t: T12, round: 0, text: 'The two flaky tests are quarantined, so the gate is green.' }
];
const NINA_ASKS: readonly ThreadMessage[] = [{ kind: 'approval', id: 'b12-ask', who: 'nina', t: T12, data: { id: 'b12-ask', title: 'Deploy 0.2.0 to staging', rule: 'Deploys need my OK', from: 'nina' } }];
/** board K02-12's composer: one message held until the discussion ends */
export const board12Held = (p: DataProvider): DataProvider => board12(p, true);
export function board12(p: DataProvider, held = false): DataProvider {
  const bots = roster(p, {
    kai: { state: 'working', activity: 'Writing the changelog' },
    moss: { last: { t: T12, text: 'Found 2 flaky tests' } }, iris: { last: { t: T12, text: 'Checked the new composer' } }, nimbus: { last: { t: T12, text: 'Sorted 14 emails' } }
  });
  /* kai and moss are replying; the boards draw the composer's voice button there, which the app shows only while no talk is running
     (a running room's button is Stop), so the room is not marked busy here: an owner question (the report) */
  const crew: Group = { ...RELEASE_CREW, working: ['kai', 'moss'], busy: false, spent: '0.21', queued: held ? [{ id: 'b12-held', text: 'And tag it when staging is green.', t: T12 }] : [] };
  const heard: Array<(e: GroupsEvent) => void> = [];
  return {
    ...p,
    bots: { ...p.bots, snapshot: () => ({ bots, threads: { ...Object.fromEntries(bots.map((b) => [b.id, []])), nina: NINA_ASKS } }), archived: store([]) },
    waits: { ...p.waits, snapshot: () => [] },
    groups: {
      ...p.groups,
      snapshot: () => ({ groups: [crew], threads: { [crew.id]: [{ kind: 'text', id: 'b12-0', who: 'nina', t: T12, text: 'the deploy is ready' }] } }),
      subscribe: (fn) => { heard.push(fn); return () => { heard.splice(heard.indexOf(fn), 1); }; },
      open: (id) => { for (const fn of [...heard]) fn({ type: 'thread', groupId: id, messages: CREW_THREAD }); return Promise.resolve(); },
      note: () => null, archived: store([])
    },
    /* nothing of this board is archived, its files are not on this computer, and the person is "you" */
    files: { ...p.files, paths: p.files.paths ? { ...p.files.paths, resolve: () => Promise.resolve([]) } : p.files.paths } as DataProvider['files'],
    user: store({ ...p.user.get(), name: 'you' })
  };
}

/* ───────── board 17: kai works through a task of five steps ───────── */
const T17 = 'Today 14:02';
const KAI_WORKING: readonly ThreadMessage[] = [
  { kind: 'text', id: 'b17-1', who: 'you', t: T17, text: 'Prepare the 0.2.0 release: notes, tests, tag, and staging.' },
  { kind: 'text', id: 'b17-2', who: 'kai', t: T17, text: 'On it. Five steps; I’ll tell you when staging is up.' },
  { kind: 'tool', id: 'b17-3', who: 'kai', t: T17, tool: 'Release 0.2.0', target: 'step 3 of 5', steps: [
    { text: 'Read 14 merged pull requests', state: 'done', time: '0:12' }, { text: 'Wrote CHANGELOG.md, 41 lines', state: 'done', time: '0:48' },
    { text: 'Run the tests', state: 'now', time: '3 of 5 suites' }, { text: 'Tag 0.2.0', state: 'todo' }, { text: 'Deploy to staging (asks first)', state: 'todo' }] },
  { kind: 'tool', id: 'b17-4', who: 'kai', t: T17, tool: 'Terminal', target: 'ran 2 commands', shell: true },
  { kind: 'file', id: 'b17-5', who: 'kai', t: T17, name: 'CHANGELOG.md', meta: '41 lines, 2.1 KB' }
];
export function board17(p: DataProvider): DataProvider {
  const tpl = p.bots.snapshot().bots[0] as Bot;
  const bots = roster(p, { kai: { state: 'working', activity: 'Running the tests', spent: '0.12', cfg: { ...tpl.cfg, gov: 'governed', model: 'sonnet 5.5', cap: '1.00', cron: '', workspace: 'worktree' } } });
  return {
    ...p,
    bots: { ...p.bots, snapshot: () => ({ bots, threads: { ...Object.fromEntries(bots.map((b) => [b.id, []])), kai: KAI_WORKING } }) },
    waits: { ...p.waits, snapshot: () => [] },
    groups: { ...p.groups, snapshot: () => ({ groups: [RELEASE_CREW], threads: { [RELEASE_CREW.id]: [] } }) }
  };
}

/* ───────── board S17: a new session, the inbox, the dock ───────── */
const SESSIONS: readonly SessionSummary[] = [
  { id: 's17-dock', project: 'boopis', title: 'Fix the dock\'s half paint', when: '', branch: 'w32/dock-paint', model: 'sonnet 5.5', needs: 'approval' },
  { id: 's17-mentions', project: 'boopis', title: 'Room mentions in every composer', when: '', branch: 'w29/mentions', model: 'sonnet 5.5', running: true },
  { id: 's17-store', project: 'boopis', title: 'Store: de-duplicate items', when: '', branch: 'main', model: 'gpt-5.5', running: true, needs: 'question' },
  { id: 's17-release', project: 'boopis', title: 'Release checklist', when: '', branch: 'main', model: 'gemini-3-pro', pinned: true },
  { id: 's17-notice', project: 'boopis', title: 'Startup notice for Windows', when: '2h', branch: 'w29/notice', model: 'sonnet 5.5' },
  { id: 's17-hold', project: 'boopis', title: 'Hold to approve in the dock', when: 'mon', branch: 'w28/hold', model: 'sonnet 5.5' },
  { id: 's17-archive', project: 'boopis', title: 'Archived bots group', when: 'sun', branch: 'w27/archive', model: 'sonnet 5.5' }
];
const SETTLED: readonly SessionSummary[] = Array.from({ length: 12 }, (_, i) => ({ id: 's17-settled-' + i, project: 'boopis', title: 'Settled session ' + (i + 1), when: 'oct', branch: 'main', model: 'sonnet 5.5' }));
const LIMIT: LimitNotice = { id: 'weekly', title: 'Approaching the weekly limit', detail: '81% used, resets Wed 09:00' };
const all = <T extends string>(keys: readonly T[]): Record<T, typeof YES> => Object.fromEntries(keys.map((k) => [k, YES])) as Record<T, typeof YES>;
const CAPS: SessionCapabilities = {
  engine: { caps: new Set(), createParams: new Set() },
  plugin: { present: true, version: null, rpc: new Set() },
  launch: { create: YES, folder: YES, model: YES, effort: YES, skills: YES, efforts: ['low', 'medium', 'high'], careful: all(CAREFUL_STEPS) },
  session: { fork: YES, compact: YES, rewind: YES, changeModel: { ok: false, why: 'The session has not started.' }, changeEffort: YES, changeCareful: all(CAREFUL_STEPS), changeFolder: YES, changeSkills: YES }
};
function controls(): SessionControls {
  const launch = store<LaunchSettings>({ folder: '/home/you/code/boopis', careful: 'auto_edits', effort: null, fellBack: false });
  return {
    capabilities: store(CAPS), launch,
    setLaunch: (patch) => { launch.set({ ...launch.get(), ...patch }); return null; },
    setCareful: (step) => { launch.set({ ...launch.get(), careful: step }); return Promise.resolve(null); },
    rewind: () => Promise.resolve({ status: 'nothing_to_do', isolation: 'own_worktree', files: [] }),
    head: () => null, pickFolder: null
  };
}

export function boardS17(p: DataProvider): DataProvider {
  /* the dock's bots as the board draws them (dockv7.js BOTS): nina needs you, kai works, hex rests */
  const bots = roster(p, { kai: { state: 'working', activity: 'Writing the changelog' } }, ['nina', 'kai', 'boopis', 'moss', 'iris', 'hex']);
  const draft: SessionSummary = { id: 's17-new', project: 'boopis', title: 'New session', when: '', draft: true };
  const list = store<readonly SessionSummary[]>([draft, ...SESSIONS]);
  const empty: Conversation = { turns: [] };
  const started: Conversation = { turns: [{ id: 's17-t1', role: 'user', at: '09:42', text: 'The dock loses its right half while the slab moves. Find why and fix it.' }] };
  const gov = p.details.governance.get();
  return {
    ...p,
    /* the new session has no turn yet; every other session has started (one turn stands for its thread) */
    sessions: { ...p.sessions, list, archived: store(SETTLED), draft: () => '', conversation: (id: string) => ({ snapshot: () => (id === draft.id ? empty : started), subscribe: () => () => undefined }), create: () => draft },
    details: { ...p.details, governance: store({ ...gov, governed: true, smart: false, model: 'sonnet 5.5', cap: '', spent: '' }), choices: store([{ value: 'anthropic/sonnet 5.5', provider: 'anthropic', model: 'sonnet 5.5', providerName: 'Claude' }]) },
    bots: { ...p.bots, snapshot: () => ({ bots, threads: Object.fromEntries(bots.map((b) => [b.id, []])) }) },
    /* nina's approval is the dock's ask ("nina needs you") */
    waits: { ...p.waits, snapshot: () => [{ id: 's17-nina', kind: 'approval', bot: 'nina', who: 'nina', title: 'Deploy 0.2.0 to staging?', data: { id: 's17-nina', title: 'Deploy 0.2.0 to staging?', item: ['boopis deploy staging --tag 0.2.0'], from: 'nina' } }] },
    groups: { ...p.groups, snapshot: () => ({ groups: [], threads: {} }) },
    sessionControls: controls(),
    limits: store<LimitNotice | null>(LIMIT)
  };
}
