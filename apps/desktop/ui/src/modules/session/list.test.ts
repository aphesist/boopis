/* The Sessions inbox's sections (board S17; SESSION-TAB.md 9): which section a session is in, and the word of what it waits for. */
import { beforeEach, describe, expect, it } from 'vitest';
import { on } from '../../core/bus';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { store } from '../../data/store';
import type { DataProvider, SessionSummary } from '../../data';
import type { SessionCapabilities, SessionControls } from '../../data/session-s0';
import { mountList } from './list';
import { mountView } from './conversation';
import { needWord, sectionOf } from './sections';

const s = (o: Partial<SessionSummary>): SessionSummary => ({ id: 'x', project: 'boopis', title: 't', when: '2h', ...o });
describe('the inbox\'s sections', () => {
  it('an approval stops a session: it needs you, running or not', () => {
    expect(sectionOf(s({ needs: 'approval' }))).toBe('needs');
    expect(sectionOf(s({ needs: 'approval', running: true }))).toBe('needs');
    expect(needWord(s({ needs: 'approval' }))).toBe('Approval');
  });
  it('a question does not stop it: a running session with a question open is working; idle, it needs you', () => {
    expect(sectionOf(s({ needs: 'question', running: true }))).toBe('working');
    expect(sectionOf(s({ needs: 'question' }))).toBe('needs');
    expect(needWord(s({ needs: 'question' }))).toBe('Question');
  });
  it('then working, pinned, recent', () => {
    expect(sectionOf(s({ running: true, pinned: true }))).toBe('working');
    expect(sectionOf(s({ pinned: true }))).toBe('pinned');
    expect(sectionOf(s({}))).toBe('recent');
    expect(needWord(s({}))).toBe('');
  });
});

/* board S41: nothing yet. The list says so in one line where its rows would start; the switch and "+" over it are the shell's and never
   depend on the list (index.html `.hx-side__head`), so a person with no sessions still reaches Bots. The title pill names the tab until
   there is a folder to start a session in. */

describe('no sessions (board S41)', () => {
  let p: DataProvider;
  const draft: SessionSummary = { id: 'new-1', project: '', title: 'New session', when: '', draft: true };
  function boot(folder: string | null, started = true) {
    const base = createMockProvider({ simulate: false });
    const YES = { ok: true as const }, steps = { supervised: YES, auto_edits: YES, auto: YES, full: YES };
    const launch = store<ReturnType<SessionControls['launch']['get']>>({ folder, careful: 'auto_edits', effort: null, fellBack: false });
    const controls: SessionControls = {
      capabilities: store<SessionCapabilities>({
        engine: { caps: new Set(), createParams: new Set() }, plugin: { present: true, version: null, rpc: new Set() },
        launch: { create: YES, folder: YES, model: YES, effort: YES, skills: YES, efforts: [], careful: steps },
        session: { fork: YES, compact: YES, rewind: YES, changeModel: { ok: false, why: 'The session has not started.' }, changeEffort: YES, changeCareful: steps, changeFolder: YES, changeSkills: YES }
      }),
      launch, setLaunch: () => null, setCareful: () => Promise.resolve(null), setEffort: () => Promise.resolve(null),
      rewind: () => Promise.resolve({ status: 'nothing_to_do', isolation: 'own_worktree', files: [] }), head: () => null, pickFolder: null
    };
    p = { ...base, sessions: { ...base.sessions, list: store<readonly SessionSummary[]>(started ? [draft] : []), archived: store<readonly SessionSummary[]>([]), draft: () => '', conversation: () => ({ snapshot: () => ({ turns: [] }), subscribe: () => () => undefined }) }, sessionControls: controls };
    setProvider(p);
    document.body.innerHTML = '<div id="l"></div><div id="v"></div>';
    const titles: string[] = [];
    on('hx:title', (d) => { titles.push(d.title ?? ''); });
    mountList(document.getElementById('l') as HTMLElement);
    mountView(document.getElementById('v') as HTMLElement);
    return { list: document.getElementById('l') as HTMLElement, titles, launch };
  }
  beforeEach(() => {
    localStorage.clear();
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe(): void { /* no layout */ } unobserve(): void { /* no layout */ } disconnect(): void { /* no layout */ } };
  });
  it('the list says "No sessions yet" as the kit\'s EmptyState in a list, and draws no row for a session that has not started', () => {
    const { list } = boot(null);
    const e = list.querySelector<HTMLElement>('[data-kit="EmptyState"]');
    expect(e?.dataset['place']).toBe('list');
    expect(e?.textContent).toBe('No sessions yet');
    expect(list.querySelector('[data-kit~="ListRow"]')).toBeNull();
  });
  it('the title pill reads "Sessions" with no folder, and "New session" once one is chosen', () => {
    const { titles, launch } = boot(null);
    expect(titles.at(-1)).toBe('Sessions');
    launch.set({ ...launch.get(), folder: '/home/you/boopis' });
    expect(titles.at(-1)).toBe('New session');
  });
  it('a new session with a folder is "New session" from the start (board S17)', () => {
    expect(boot('/home/you/boopis').titles.at(-1)).toBe('New session');
  });
  it('the same with no session in the list at all (the app before its first "+")', () => {
    expect(boot(null, false).titles.at(-1)).toBe('Sessions');
    expect(boot('/home/you/boopis', false).titles.at(-1)).toBe('New session');
  });
});
