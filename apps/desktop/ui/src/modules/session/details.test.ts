/* The session's right panel on the kit's Pane, driven as a person drives it: the details (board S40) with every row doing its job,
   what the v6 panel held and S40 draws no place for (the context's parts and Compact, the cap, the environment, the connectors and
   the project's switch), the diff a FilesCard opens (board S24's Diff, alone), a mod's pane as a tab, and the ways in. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emit, on } from '../../core/bus';
import { setState, state } from '../../core/state';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { store } from '../../data/store';
import type { DataProvider, LaterFeature, ProjectPolicy } from '../../data';
import type { SessionCapabilities, SessionControls } from '../../data/session-s0';
import { surface } from '../mods/surfaces';
import { VIEW } from './conversation';
import { CAPS, diffLines, mountDetails, openDetails, openDiff, overflowEntries, panelKind } from './details';

const YES = { ok: true as const }, steps = { supervised: YES, auto_edits: YES, auto: YES, full: YES };
const calls: Array<[string, ...unknown[]]> = [];
let root: HTMLElement, p: DataProvider;
const q = <T extends HTMLElement = HTMLElement>(s: string): T => { const n = root.querySelector<T>(s); if (!n) throw new Error('missing ' + s); return n; };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const menu = (): HTMLElement => { const m = document.querySelector<HTMLElement>('.k7-menu[data-floating]'); if (!m) throw new Error('no menu is open'); return m; };
const pick = (label: string): void => { const r = [...menu().querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((x) => x.textContent?.includes(label)); if (!r) throw new Error('no row ' + label); r.click(); };
const rows = (title: string): string[][] => {
  const h = [...root.querySelectorAll('.k7-pane__sec')].find((x) => x.textContent === title);
  return h ? [...(h.nextElementSibling?.querySelectorAll('.k7-row') ?? [])].map((r) => [r.querySelector('.k7-row__label')?.firstChild?.textContent ?? '', (r.querySelector('.k7-row__value, .k7-sel__value')?.textContent ?? '').trim()]) : [];
};
function controls(): SessionControls {
  return {
    capabilities: store<SessionCapabilities>({
      engine: { caps: new Set(), createParams: new Set() }, plugin: { present: true, version: null, rpc: new Set() },
      launch: { create: YES, folder: YES, model: YES, effort: YES, skills: YES, efforts: ['low', 'medium', 'high'], careful: steps },
      session: { fork: YES, compact: YES, rewind: YES, changeModel: YES, changeEffort: YES, changeCareful: steps, changeFolder: YES, changeSkills: YES }
    }),
    launch: store({ folder: '/home/you/code/boopis', careful: 'auto_edits', effort: null, fellBack: false }), setLaunch: () => null,
    setCareful: (s) => { calls.push(['careful', s]); return Promise.resolve(null); }, setEffort: (e) => { calls.push(['effort', e]); return Promise.resolve(null); },
    rewind: () => Promise.resolve({ status: 'nothing_to_do', isolation: 'own_worktree', files: [] }), head: () => null, pickFolder: null
  };
}
function boot(more: Partial<DataProvider> = {}, later: LaterFeature[] = []): void {
  const base = createMockProvider({ simulate: false });
  calls.length = 0;
  const policy: ProjectPolicy = { project: '~/code/billing-api', governed: true, explicit: null, effective: true };
  p = {
    ...base, info: { ...base.info, later: new Set(later) }, sessionControls: controls(),
    sessions: { ...base.sessions, list: store([{ id: 's1', project: 'boopis', title: 'Fix the dock\'s half paint', when: '', branch: 'w32/dock-paint', pullRequest: '#412' }]), archived: store([]),
      fork: (id: string) => { calls.push(['fork', id]); return null; }, archive: (id: string) => { calls.push(['settle', id]); }, openPullRequest: (id: string) => { calls.push(['pr', id]); } },
    details: { ...base.details, governance: store({ ...base.details.governance.get(), governed: true, smart: false, model: 'sonnet 5.5' }),
      compactContext: () => { calls.push(['compact']); return Promise.resolve(12000); },
      setGovernance: (patch) => { calls.push(['governance', patch]); return null; },
      setConnector: (name, on) => { calls.push(['connector', name, on]); },
      signIn: (name) => { calls.push(['signin', name]); return Promise.resolve(); } },
    store: { ...base.store, projectPolicy: () => Promise.resolve(policy), setProjectPolicy: (project: string, want: boolean) => { calls.push(['policy', project, want]); return Promise.resolve({ ...policy, explicit: want, effective: want }); } },
    ...more
  };
  setProvider(p);
  document.documentElement.removeAttribute('data-right-tools');
  document.body.innerHTML = '<div id="hx-app" data-right-mode="push"><div id="hx-right"></div></div>';
  root = document.getElementById('hx-right') as HTMLElement;
  VIEW.current = 's1';
  setState({ right: 'closed' });
  surface.panelTabs = null;
  mountDetails(root);
  setState({ right: 'open' });
}
beforeEach(() => { localStorage.clear(); });

describe('the session\'s details (board S40)', () => {
  it('is the kit\'s Pane with the session\'s name, where it works, and Session and Use as the board draws them', () => {
    boot();
    const pane = q('[data-kit~="Pane"]');
    expect([pane.dataset['variant'], pane.getAttribute('aria-label')]).toEqual(['session', 'Fix the dock\'s half paint, details']);
    expect(q('.k7-pane__name').textContent).toBe('Fix the dock\'s half paint');
    expect([...q('.k7-pane__where').querySelectorAll('.k7-mono')].map((x) => x.textContent)).toEqual(['boopis', 'cents/proration']);
    expect(rows('Session')).toEqual([['Model', 'sonnet 5.5'], ['Effort', 'Default'], ['How careful', 'Auto-accept edits'], ['Workspace', 'boopis']]);
    expect(rows('Use')).toEqual([['Context', '76k / 200k'], ['Cost', '$0.37 of $0.60']]);
    /* nothing of the v6 panel is in it */
    expect(root.querySelector('.ui-panel, .ui-sec, .ssr-panel, .ui-measure-btn')).toBeNull();
  });
  it('closed, it draws nothing (the collapsed context strip is gone: the context is on the composer\'s line)', () => {
    boot();
    setState({ right: 'closed' });
    expect(root.children.length).toBe(0);
  });
  it('the Model row opens "who answers next" and a pick changes who answers', () => {
    boot();
    q('[data-pane="model"]').click();
    expect(menu().getAttribute('aria-label')).toBe('Who answers next');
    pick('Automatic');
    expect(calls).toContainEqual(['governance', { smart: true }]);
  });
  it('the Effort row opens the engine\'s levels and a pick sets the session\'s', () => {
    boot();
    q('[data-pane="effort"]').click();
    expect([...menu().querySelectorAll('[role^="menuitem"]')].map((x) => x.textContent?.trim())).toEqual(['Low', 'Medium', 'High']);
    pick('High');
    expect(calls).toContainEqual(['effort', 'high']);
  });
  it('the How careful row opens the scale and a pick sets the step', () => {
    boot();
    q('[data-pane="careful"]').click();
    expect(menu().getAttribute('aria-label')).toBe('How careful');
    pick('Supervised');
    expect(calls).toContainEqual(['careful', 'supervised']);
  });
  it('the Workspace says "worktree" once that choice exists, and the Pull request shows only once it does', () => {
    boot({}, ['worktree', 'pull-request']);
    expect(rows('Session').pop()).toEqual(['Workspace', 'worktree']);
    expect(rows('Use').pop()).toEqual(['Pull request', '#412']);
    q('[data-pane="pr"]').click();
    expect(calls).toContainEqual(['pr', 's1']);
  });
});

describe('what S40 draws no place for, kept in the pane (the lead, 26 November)', () => {
  it('the Context row opens what fills the context, with Compact conversation, and its chevron folds it away', async () => {
    boot();
    const row = q('[data-pane="context"]');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('[data-pane-open="context"]')).toBeNull();
    row.click();
    expect(q('[data-pane="context"]').getAttribute('aria-expanded')).toBe('true');
    const more = q('[data-pane-open="context"]');
    expect(more.dataset['kit']).toBe('Disclosure');
    const parts = p.details.context.get().parts;
    expect([...more.querySelectorAll('.k7-step')].map((x) => x.querySelector('.k7-step__text')?.textContent)).toEqual(parts.map(([l]) => l.charAt(0).toUpperCase() + l.slice(1)));
    expect(more.textContent).toContain('It runs on its own at 90%.');
    q<HTMLButtonElement>('[data-pane="compact"]').click();
    expect(calls).toContainEqual(['compact']);
    await tick();
    expect(q('[data-pane-open="context"] [role="status"]').textContent).toBe('Compacted. Freed 12k tokens.');
    q<HTMLButtonElement>('[data-pane-open="context"] .k7-disc__sum').click();
    expect(root.querySelector('[data-pane-open="context"]')).toBeNull();
  });
  it('Compact is drawn and inert where this engine cannot compact', () => {
    const base = createMockProvider({ simulate: false });
    boot({ details: { ...base.details, can: store({ compact: false, connectors: true, signIn: true }) } });
    q('[data-pane="context"]').click();
    expect(q<HTMLButtonElement>('[data-pane="compact"]').disabled).toBe(true);
  });
  it('the Cost row changes the cap of a governed session ("Change cap"); an ungoverned session has none to change', () => {
    boot();
    const row = q('[data-pane="cap"]');
    expect(row.getAttribute('aria-label')).toBe('Cost: $0.37 of $0.60, changes the cap');
    row.click();
    expect([...menu().querySelectorAll('[role^="menuitem"]')].map((x) => x.textContent?.trim())).toEqual([...CAPS]);
    expect(menu().querySelector('[aria-checked="true"]')?.textContent?.trim()).toBe('$0.60');
    const said = vi.fn(); on('hx:governance', said);
    pick('$1.00');
    expect(calls).toContainEqual(['governance', { cap: '$1.00' }]);
    expect(said).toHaveBeenCalled();
    const base = createMockProvider({ simulate: false });
    boot({ details: { ...base.details, governance: store({ ...base.details.governance.get(), governed: false }) } });
    expect(root.querySelector('[data-pane="cap"]')).toBeNull();
    expect(rows('Use')[1]).toEqual(['Cost', '$0.37']);
  });
  it('Environment lists what is known, in plain rows', () => {
    boot();
    expect(rows('Environment').map((r) => r[0])).toEqual(['Folder', 'Branch', 'Sandbox', 'Runtime', 'Harness', 'Gate']);
    expect(rows('Environment')[2]).toEqual(['Sandbox', 'bubblewrap, network off']);
  });
  it('Connectors: a switch turns one on or off for this session, a sign-in starts, the store opens; the project\'s switch moved to Settings (7a)', async () => {
    boot();
    await tick();
    expect(rows('Connectors').map((r) => r[0])).toEqual(expect.arrayContaining(['github', 'postgres', 'linear', 'Browse the store']));
    expect(rows('Connectors').map((r) => r[0])).not.toContain('No engine plugins and no plugin hooks');
    q<HTMLButtonElement>('[data-conn="github"]').click();
    expect(calls).toContainEqual(['connector', 'github', false]);
    q<HTMLButtonElement>('[data-signin="linear"]').click();
    expect(calls).toContainEqual(['signin', 'linear']);
    const opened = vi.fn(); on('hx:open-store', opened);
    q('[data-pane="store"]').click();
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ screen: 'browse' }));
    expect(document.querySelector('[data-policy]')).toBeNull();
  });
  it('a connector switch is drawn and inert where this engine cannot change connectors', () => {
    const base = createMockProvider({ simulate: false });
    boot({ details: { ...base.details, can: store({ compact: true, connectors: false, signIn: false }) } });
    expect(q<HTMLButtonElement>('[data-conn="github"]').disabled).toBe(true);
    expect(q<HTMLButtonElement>('[data-signin="linear"]').disabled).toBe(true);
  });
  it('the overflow holds what exists: Fork and Settle; Pin is not shown until pinning exists', () => {
    boot();
    expect(overflowEntries().map((e) => e.label)).toEqual(['Fork', 'Settle']);
    q('[data-pane-more]').click();
    pick('Settle');
    expect(calls).toContainEqual(['settle', 's1']);
    q('[data-pane-more]').click();
    pick('Fork');
    expect(calls).toContainEqual(['fork', 's1']);
    boot({}, ['pin']);
    expect(overflowEntries().map((e) => e.label)).toEqual(['Pin', 'Fork', 'Settle']);
  });
});

describe('the diff (board S24\'s Diff tab, alone)', () => {
  it('"Open diff" draws the changed files as the kit\'s DiffViews in the tools pane, with no strip of tabs; the first is open and each folds', () => {
    boot();
    openDiff();
    const pane = q('[data-kit~="Pane"]');
    expect([pane.dataset['variant'], panelKind(), document.documentElement.hasAttribute('data-right-tools')]).toEqual(['tools', 'diff', true]);
    expect(root.querySelector('.k7-pane__tabs .k7-seg')).toBeNull();
    const files = p.sessions.diff('s1', { blank: null });
    expect(q('.k7-pane__summary').textContent).toContain(files.length + ' files');
    const views = [...root.querySelectorAll<HTMLElement>('[data-kit~="DiffView"]')];
    expect(views.map((v) => v.dataset['file'])).toEqual(files.map((f) => f.path));
    expect(views.map((v) => v.hasAttribute('data-open'))).toEqual(files.map((_, i) => i === 0));
    expect(views[0]?.querySelectorAll('.k7-diff__row').length).toBe(diffLines(files[0] as (typeof files)[number]).length);
    views[1]?.querySelector<HTMLButtonElement>('.k7-diff__head')?.click();
    expect(views[1]?.hasAttribute('data-open')).toBe(true);
    /* what the reader opened stays open across a redraw */
    surface.redrawRight?.();
    expect([...root.querySelectorAll<HTMLElement>('[data-kit~="DiffView"]')].map((v) => v.hasAttribute('data-open')).slice(0, 2)).toEqual([true, true]);
  });
  it('its close button and Esc close the panel, and the details are what opens next', () => {
    boot();
    openDiff();
    q<HTMLButtonElement>('[data-pane-close]').click();
    expect(state.right).toBe('closed');
    expect(document.documentElement.hasAttribute('data-right-tools')).toBe(false);
    setState({ right: 'open' });
    expect(q('[data-kit~="Pane"]').dataset['variant']).toBe('session');
    openDiff();
    q('[data-kit~="Pane"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(state.right).toBe('closed');
  });
  it('a session that changed nothing says so', () => {
    const base = createMockProvider({ simulate: false });
    boot({ sessions: { ...base.sessions, list: store([{ id: 's1', project: 'boopis', title: 'Fix', when: '' }]), archived: store([]), diff: () => [] } });
    openDiff();
    expect(q('.k7-empty').textContent).toContain('No changes yet.');
  });
  it('a diff line keeps its number: an added line the new file\'s, a removed line the old one\'s', () => {
    expect(diffLines({ path: 'a.css', add: 1, del: 1, hunks: [['@@ -40,3 +40,3 @@', [' .page {', '-  left: 50%;', '+  left: 0;', ' }']]] })).toEqual([
      { n: 40, sign: ' ', text: '.page {' }, { n: 41, sign: '-', text: '  left: 50%;' }, { n: 41, sign: '+', text: '  left: 0;' }, { n: 42, sign: ' ', text: '}' }]);
  });
});

describe('the ways in, a mod\'s pane, and a narrow window', () => {
  it('the palette\'s "Open context" opens the details on what fills the context; "Open changes" opens the diff', () => {
    boot();
    setState({ right: 'closed' });
    emit('hx:open-panel', { panel: 'context', from: 'shell' });
    setState({ right: 'open' });   /* the shell opens the panel on that event */
    expect(q('[data-pane-open="context"]')).toBeTruthy();
    emit('hx:open-panel', { panel: 'changes', from: 'shell' });
    expect(q('[data-kit~="Pane"]').dataset['variant']).toBe('tools');
    openDetails();
    expect(q('[data-kit~="Pane"]').dataset['variant']).toBe('session');
  });
  it('a mod\'s pane is a tab of the panel: the strip is the kit\'s tabs, and choosing one puts that pane in the body', () => {
    boot();
    let active = 'details';
    const body = document.createElement('div'); body.className = 'mod-pane'; body.textContent = 'tests pane';
    surface.panelTabs = () => ({ items: [{ value: 'details', label: 'Details' }, { value: 'tests', label: 'TESTS', tip: 'test-runner mod' }], value: active, label: active === 'details' ? 'Session details' : 'TESTS, test-runner mod', sig: active, body: () => (active === 'details' ? null : body), select: (id) => { active = id; } });
    surface.redrawRight?.();
    const tabs = [...root.querySelectorAll<HTMLElement>('.k7-pane__tabs .k7-seg__item')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Details', 'TESTS']);
    expect(q('.k7-pane__name').textContent).toBe('Fix the dock\'s half paint');
    tabs[1]?.click();
    expect(active).toBe('tests');
    expect(q('.ss-pane__mod').textContent).toBe('tests pane');
    expect(q('[data-kit~="Pane"]').getAttribute('aria-label')).toBe('TESTS, test-runner mod');
    expect(root.querySelector('.k7-pane__name')).toBeNull();
    /* with no pane left the strip goes */
    surface.panelTabs = () => null;
    surface.redrawRight?.();
    expect(root.querySelector('.k7-pane__tabs')).toBeNull();
  });
  it('under 900 wide the pane is drawn as an overlay (the shell lays it over the work)', () => {
    boot();
    (document.getElementById('hx-app') as HTMLElement).dataset['rightMode'] = 'overlay';
    surface.redrawRight?.();
    expect(q('[data-kit~="Pane"]').hasAttribute('data-overlay')).toBe(true);
  });
});
