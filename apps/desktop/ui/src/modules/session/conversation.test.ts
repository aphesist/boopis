/* A started session on the kit (boards S20 and S23), driven as a person drives it: the thread draws the feed's turns as kit parts and
   follows its events; a change waiting on its tool row is allowed by the hold and denied by Deny, Esc or by typing feedback; the
   composer's line, its "+" and quick menus, Stop and the keys do their jobs. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { on } from '../../core/bus';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { store } from '../../data/store';
import { emitter } from '../../data/store';
import type { AgentTurn, Conversation, ConversationEvent, DataProvider, FormSpec, Turn } from '../../data';
import type { SessionCapabilities, SessionControls } from '../../data/session-s0';
import { kit } from '@boopis/ui';
import { VIEW, mountView } from './conversation';

const EDIT: FormSpec = { id: 'f1', kind: 'permission', title: 'Allow this change?', file: 'modules/dock/dock.css', diff: '+a\n-b', schema: { properties: { choice: { type: 'string', enum: ['once', 'session', 'deny'] } } } };
const agent = (o: Partial<AgentTurn> = {}): AgentTurn => ({ id: 'a1', role: 'assistant', model: 'sonnet 5.5', time: '', cost: '', stepCount: 0, steps: [], paragraphs: ['Reading the dock first.'], bullets: [], status: 'running', ...o });
let p: DataProvider, turns: Turn[], ev: ReturnType<typeof emitter<ConversationEvent>>, root: HTMLElement;
const calls: Array<[string, ...unknown[]]> = [];
const q = <T extends HTMLElement = HTMLElement>(s: string): T => { const n = root.querySelector<T>(s); if (!n) throw new Error('missing ' + s); return n; };
const parts = (): string[] => [...root.querySelectorAll<HTMLElement>('[data-turn="agent"]')].flatMap((t) => [...t.children].map((c) => (c as HTMLElement).dataset['part'] ?? ''));
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
function boot(start: Turn[], more: Partial<DataProvider> = {}): void {
  turns = start;
  ev = emitter<ConversationEvent>();
  const base = createMockProvider({ simulate: false });
  calls.length = 0;
  p = {
    ...base,
    sessions: { ...base.sessions, list: store([{ id: 's1', project: 'boopis', title: 'Fix the dock', when: '', branch: 'w32/dock-paint' }]), draft: () => '',
      conversation: () => ({ snapshot: (): Conversation => ({ turns }), subscribe: (fn) => ev.subscribe(fn) }),
      send: (...a: unknown[]) => { calls.push(['send', ...a]); }, stop: (...a: unknown[]) => { calls.push(['stop', ...a]); }, answerBlank: (...a: unknown[]) => { calls.push(['blank', ...a]); } },
    forms: { ...base.forms, submit: (...a: unknown[]) => { calls.push(['submit', ...a]); return Promise.resolve(); }, cancel: (...a: unknown[]) => { calls.push(['cancel', ...a]); return Promise.resolve(); } },
    ...more
  };
  setProvider(p);
  document.body.innerHTML = '<div id="v"></div>';
  root = document.getElementById('v') as HTMLElement;
  mountView(root);
}
const type = (t: string): void => { const c = q('.ss-composer .k7-composer__text'); c.textContent = t; c.dispatchEvent(new Event('input', { bubbles: true })); };
const enter = (): void => { q('.ss-composer .k7-composer__text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); };
beforeEach(() => {
  localStorage.clear();
  /* jsdom has no layout: the zone that follows the composer's height observes nothing */
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe(): void { /* no layout */ } unobserve(): void { /* no layout */ } disconnect(): void { /* no layout */ } };
});

describe('the thread', () => {
  it('draws your message as an ink Bubble and a running turn as what it said, its work line, the change that waits and the status line at rest', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent({ steps: [{ title: 'read_file', mono: true, time: '' }], forms: [EDIT] })]);
    expect(q('.ss-col .k7-time').textContent).toBe('Today 09:42');
    expect(q('[data-turn="user"] .k7-bubble').dataset['kind']).toBe('user');
    expect(parts()).toEqual(['text', 'log', 'tool:f1', 'status']);
    expect(q('[data-part="text"] .k7-brand')).toBeTruthy();   /* the answering model's mark in the gutter */
    expect(q('.k7-disc__sum').textContent).toBe('Read 1 file');
    expect(q('.k7-tool__name').textContent).toBe('modules/dock/dock.css');
    expect(q('.k7-status').textContent).toBe('Waiting for your approval');
    expect(q('.k7-status').hasAttribute('data-working')).toBe(false);
    expect(root.querySelector('.k7-foot')).toBeNull();
  });
  it('a finished turn starts with "Worked for ...", then the answer and its foot; no Undo without a checkpoint, no Edit or Fork', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent({ status: 'done', time: '0m 59s', cost: '$0.08', steps: [{ title: 'patch', mono: true, time: '' }] })]);
    expect(parts()).toEqual(['log', 'text', 'foot']);
    expect(q('.k7-disc__sum').textContent).toBe('Worked for 59s: changed 1 file');
    expect(q('.k7-foot__meta').textContent).toContain('sonnet 5.5 0m 59s $0.08');
    expect(root.querySelectorAll('.k7-foot__btn').length).toBe(0);
    expect(root.querySelector('.k7-status')).toBeNull();
  });
  it('follows the feed: a step, the text as it streams, the end', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }]);
    const a = agent({ paragraphs: [] });
    ev.emit({ type: 'turn-added', turn: a });
    expect(parts()).toEqual(['status']);
    expect(q('.ss-composer .k7-composer').hasAttribute('data-running')).toBe(true);
    ev.emit({ type: 'step-added', turnId: 'a1', step: { title: 'terminal', mono: true, time: '' } });
    expect(q('.k7-disc__sum').textContent).toBe('Ran 1 command');
    expect(q('.k7-status__phrase').textContent).toBe('In the terminal');
    ev.emit({ type: 'turn-text', turnId: 'a1', paragraphs: ['Half'] });
    ev.emit({ type: 'turn-text', turnId: 'a1', paragraphs: ['Half an answer'] });
    expect(q('[data-part="text"] .k7-bubble').textContent).toContain('Half an answer');
    expect(parts()).toEqual(['text', 'log', 'status']);
    ev.emit({ type: 'turn-finished', turnId: 'a1', time: '12s', cost: '$0.01', stepCount: 1, paragraphs: ['Done.'], stopped: false });
    expect(parts()).toEqual(['log', 'text', 'foot']);
    expect(q('[data-part="text"] .k7-bubble').textContent).toContain('Done.');
    expect(q('.ss-composer .k7-composer').hasAttribute('data-running')).toBe(false);
  });
  it('keeps the work line open across a redraw, and O on the turn opens it', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent({ steps: [{ title: 'read_file', mono: true, time: '' }] })]);
    const t = q('[data-turn="agent"]');
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
    expect(q('.k7-disc').hasAttribute('data-open')).toBe(true);
    ev.emit({ type: 'step-added', turnId: 'a1', step: { title: 'read_file', mono: true, time: '' } });
    expect(q('.k7-disc__sum').textContent).toBe('Read 2 files');
    expect(q('.k7-disc').hasAttribute('data-open')).toBe(true);
  });
  it('E on your message brings it back into the composer', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent({ status: 'done' })]);
    q('[data-turn="user"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    expect(VIEW.composer?.value).toBe('Fix it.');
  });
  it('the line where the answering model changes is the kit\'s SystemLine', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'a' }, agent({ status: 'done', model: 'haiku 4.5' }), { id: 'u2', role: 'user', at: '09:50', text: 'b' }, agent({ id: 'a2', status: 'done', model: 'sonnet 5.5' })]);
    expect(q('.ss-divider .k7-sys').textContent).toContain('→');
  });
});

describe('the gate failed (board S38)', () => {
  const GATE = { checks: ['tests'], output: ['FAIL centred.test.ts > the dock does not move', '  expected 720 to be 744'], files: ['modules/dock/dock.css'], note: 'Nothing was kept: every file is back as it was.' };
  it('the ended turn draws the card under its answer: "Gate", "failed", what the check printed, the files, the note; the composer says "Message"', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent({ status: 'done', time: '0m 59s', steps: [{ title: 'patch', mono: true, time: '' }], paragraphs: ['I changed the centring; the gate ran the tests.'], gate: GATE })]);
    expect(parts()).toEqual(['log', 'text', 'gate', 'foot']);
    const card = q('[data-part="gate"]');
    expect(card.querySelector('[data-kit="FilesCard"], [data-kit~="FilesCard"]') ?? card.closest('[data-kit~="FilesCard"]')).toBeTruthy();
    expect(q('[data-part="gate"] .k7-files__name, [data-part="gate"].k7-files .k7-files__name').textContent).toBe('Gate');
    expect(q('.k7-files [data-kit="StatusWord"]').textContent).toBe('failed');
    expect(q('.k7-files [data-kit="Well"] pre').textContent).toBe(GATE.output.join('\n'));
    expect(q('.k7-files__note').textContent).toBe(GATE.note);
    expect(q('.ss-composer .k7-composer__text').getAttribute('data-placeholder')).toBe('Message');
  });
  it('"Fix and retry" sends the ask as your next message; an earlier turn\'s card has no action; a later ship that passes takes the card away', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent({ id: 'a0', status: 'done', time: '5s', gate: GATE }), { id: 'u2', role: 'user', at: '09:44', text: 'Again.' }, agent({ id: 'a1', status: 'done', time: '9s', gate: GATE })]);
    const acts = [...root.querySelectorAll<HTMLElement>('[data-part="gate"] [data-files], [data-part="gate"][data-files]')];
    expect(acts.map((b) => b.textContent?.trim())).toEqual(['Fix and retry']);
    expect(acts[0]?.closest('[data-turn-id], [data-hx-turn]')).toBe(root.querySelectorAll('[data-turn="agent"]')[1]);
    acts[0]?.click();
    expect(calls.filter((c) => c[0] === 'send').map((c) => c[2])).toEqual(['The gate failed. Fix what it found and ship the change again.']);
    ev.emit({ type: 'turn-gate', turnId: 'a1', gate: null });
    expect(root.querySelectorAll('[data-part="gate"]').length).toBe(1);   /* the earlier turn's stays: it is that turn's history */
  });
});

describe('a new session with no model signed in (board S37)', () => {
  const YES = { ok: true as const }, steps = { supervised: YES, auto_edits: YES, auto: YES, full: YES };
  const controls = (): SessionControls => ({
    capabilities: store<SessionCapabilities>({
      engine: { caps: new Set(), createParams: new Set() }, plugin: { present: true, version: null, rpc: new Set() },
      launch: { create: YES, folder: YES, model: YES, effort: YES, skills: YES, efforts: [], careful: steps },
      session: { fork: YES, compact: YES, rewind: YES, changeModel: { ok: false, why: 'The session has not started.' }, changeEffort: YES, changeCareful: steps, changeFolder: YES, changeSkills: YES }
    }),
    launch: store({ folder: '/home/you/code/boopis', careful: 'auto_edits', effort: null, fellBack: false }), setLaunch: () => null, setCareful: () => Promise.resolve(null), setEffort: () => Promise.resolve(null),
    rewind: () => Promise.resolve({ status: 'nothing_to_do', isolation: 'own_worktree', files: [] }), head: () => null, pickFolder: null
  });
  it('the canvas offers the sign-ins and the composer says "Choose a model to start"; a lab opens Settings at Models on that lab, More and "+ Choose a model" on every way', () => {
    const base = createMockProvider({ simulate: false });
    boot([], { sessionControls: controls(), details: { ...base.details, choices: store([]), governance: store({ ...base.details.governance.get(), model: '', smart: false }) } });
    expect(q('.ss-new .k7-composer__text').dataset['placeholder']).toBe('Choose a model to start');
    const went: Array<{ section: string; from?: string; find?: string }> = [];
    const off = on('hx:open-settings', (d) => { if (d) went.push(d); });
    q('.ss-new [data-signin="ChatGPT"]').click();
    q('.ss-new [data-signin=""]').click();
    q('.ss-new [data-launch="model"]').click();
    off();
    expect(went).toEqual([{ section: 'models', from: 'no-model', find: 'ChatGPT' }, { section: 'models', from: 'no-model' }, { section: 'models', from: 'no-model' }]);
  });
});

describe('a setting changed mid-session (board S33)', () => {
  const TWO: Turn[] = [{ id: 'u1', role: 'user', at: '09:42', text: 'a' }, agent({ status: 'done', model: 'haiku 4.5' }), { id: 'u2', role: 'user', at: '09:50', text: 'b' }, agent({ id: 'a2', status: 'done', model: 'sonnet 5.5' })];
  it('leaves one line in the thread after the turn it follows: the sliders glyph, the words, the extra cost in mono at its end, the cost in full in its tip', () => {
    boot(TWO.slice(0, 2));
    ev.emit({ type: 'line', line: { kind: 'settings', id: 'l1', afterTurn: 'a1', text: 'Settings changed: continued with Auto-accept edits', cost: '+$0.04', costWhy: 'The next reply reads about 18,000 tokens without the cache' } });
    const line = q('.ss-s0-line .k7-sys');
    expect(line.querySelector('.k7-sys__text')?.textContent).toBe('Settings changed: continued with Auto-accept edits');
    expect([line.querySelector('.k7-sys__meta')?.textContent, line.querySelector('.k7-sys__meta')?.classList.contains('k7-mono')]).toEqual(['+$0.04', true]);
    expect(line.getAttribute('data-tip')).toBe('The next reply reads about 18,000 tokens without the cache');
    expect(q('.ss-s0-line').previousElementSibling?.getAttribute('data-turn-id')).toBe('a1');
  });
  it('a change that keeps the cache names no cost', () => {
    boot(TWO.slice(0, 2));
    ev.emit({ type: 'line', line: { kind: 'settings', id: 'l1', afterTurn: 'a1', text: 'Effort changed to High', cost: null } });
    expect(q('.ss-s0-line .k7-sys').textContent).toBe('Effort changed to High');
    expect(root.querySelector('.ss-s0-line .k7-sys__meta')).toBeNull();
  });
  it('a model you picked says so once: its own line, and no second line where the next answer comes from it', () => {
    boot(TWO);
    expect(root.querySelectorAll('.ss-divider')).toHaveLength(1);
    ev.emit({ type: 'line', line: { kind: 'settings', id: 'l2', afterTurn: 'a1', text: 'Model changed to Sonnet 5.5', cost: '+76,000 tokens uncached', what: 'model' } });
    expect(root.querySelectorAll('.ss-divider')).toHaveLength(0);
    expect(q('.ss-s0-line .k7-sys__text').textContent).toBe('Model changed to Sonnet 5.5');
  });
});

describe('an answer\'s hover actions (the ones a bot\'s message has)', () => {
  const done = (): void => boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent({ status: 'done', paragraphs: ['Fixed. The pages are **centred** by layout now.'] })]);
  it('the answer carries the kit\'s HoverBar beside its bubble: copy and more; your own message has none, as in a bot\'s chat', () => {
    done();
    const bar = q('[data-turn="agent"] .k7-hoverbar');
    expect([...bar.querySelectorAll('button')].map((b) => b.getAttribute('data-tip'))).toEqual(['Copy', 'More']);
    expect(bar.parentElement?.classList.contains('k7-hoverrow')).toBe(true);
    expect(bar.previousElementSibling?.matches('[data-kit~="Bubble"]')).toBe(true);
    expect(root.querySelector('[data-turn="user"] .k7-hoverbar')).toBeNull();
  });
  it('copy takes the answer as it reads; more offers the copy as Markdown', async () => {
    done();
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t: string) => { copied.push(t); return Promise.resolve(); } } });
    q('[data-turn="agent"] .k7-hoverbar [data-act="copy"]').click();
    await tick();
    expect(copied[0]).toBe('Fixed. The pages are centred by layout now.');
    q('[data-turn="agent"] .k7-hoverbar [data-act="more"]').click();
    const menus = document.querySelectorAll<HTMLElement>('.k7-menu[data-floating]');   /* an earlier test's menu may still be leaving the page: the one now open is the last */
    const rows = [...(menus[menus.length - 1] as HTMLElement).querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]')];
    expect(rows.map((r) => r.querySelector('.k7-mrow__name')?.textContent)).toEqual(['Copy as Markdown']);
    rows[0]?.click();
    await tick();
    expect(copied[1]).toBe('Fixed. The pages are **centred** by layout now.');
  });
  it('a turn drawn again (a stream, a step) keeps one bar', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent()]);
    ev.emit({ type: 'text', turnId: 'a1', text: ' More.' } as never);
    ev.emit({ type: 'end', turnId: 'a1' } as never);
    expect(root.querySelectorAll('[data-turn="agent"] .k7-hoverbar').length).toBeLessThanOrEqual(1);
  });
});

describe('a change that waits', () => {
  const waiting = (): void => boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent({ forms: [EDIT] })]);
  it('the hold allows it once, and the row says so', async () => {
    waiting();
    q('.k7-tool [data-hold]').dispatchEvent(new CustomEvent('ui:commit', { bubbles: true }));
    await tick();
    expect(calls).toContainEqual(['submit', 'f1', { values: { choice: 'once' }, secrets: {} }]);
    expect(q('.k7-tool .k7-word').textContent).toMatch(/^Allowed once \d\d:\d\d$/);
    expect(root.querySelector('.k7-tool .k7-chip')).toBeNull();
    expect(q('.k7-status__phrase').textContent).not.toBe('Waiting for your approval');
  });
  it('a wider grant is its own answer; Deny and Esc deny', async () => {
    waiting();
    q('.k7-tool [data-value="session"]').click();
    await tick();
    expect(calls).toContainEqual(['submit', 'f1', { values: { choice: 'session' }, secrets: {} }]);
    waiting();
    q('.k7-tool [data-value="deny"]').click();
    await tick();
    expect(calls).toContainEqual(['submit', 'f1', { values: { choice: 'deny' }, secrets: {} }]);
    expect(q('.k7-tool .k7-word').textContent).toMatch(/^Denied/);
    waiting();
    q('.k7-tool').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await tick();
    expect(calls).toContainEqual(['submit', 'f1', { values: { choice: 'deny' }, secrets: {} }]);
  });
  it('typing while it waits declines it with those words, and sends them', async () => {
    waiting();
    expect(q('.ss-composer .k7-composer__text').dataset['placeholder']).toBe('Send feedback to decline this request');
    type('Keep the transform');
    expect(q<HTMLButtonElement>('.ss-composer [data-send]').hidden).toBe(false);
    enter();
    await tick(); await tick();
    expect(calls).toContainEqual(['submit', 'f1', { values: { choice: 'deny' }, secrets: {} }]);
    expect(calls.find((c) => c[0] === 'send')?.[2]).toBe('Keep the transform');
    expect(q('.k7-tool__note').textContent).toBe('“Keep the transform”');
  });
  it('lapsed, it becomes the ask card; answered elsewhere, the row follows', () => {
    waiting();
    ev.emit({ type: 'form-resolved', turnId: 'a1', formId: 'f1', status: 'expired' });
    expect(root.querySelector('.k7-tool')).toBeNull();
    expect(q('.k7-ask').dataset['state']).toBe('lapsed');
    waiting();
    ev.emit({ type: 'form-resolved', turnId: 'a1', formId: 'f1', status: 'submitted' });
    expect(root.querySelector('.k7-tool .k7-chip')).toBeNull();
  });
  it('a form opened while the turn runs is drawn where it was raised', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent()]);
    expect(root.querySelector('.k7-tool')).toBeNull();
    ev.emit({ type: 'form-opened', turnId: 'a1', form: EDIT });
    expect(q('.k7-tool').dataset['state']).toBe('waiting');
  });
});

describe('a blank', () => {
  const BLANK = { question: 'Keep the old name?', short: 'Keep the old name?', options: ['as an alias', 'removed now'], rewrites: { 'as an alias': { lead: 'It stays', tail: '.' } } };
  it('is the kit\'s question: an option answers it, and the sentence is written around the answer', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent({ status: 'done', blank: BLANK })]);
    expect(q('[data-blank] .k7-ask__ask').textContent).toBe('Keep the old name?');
    q('[data-blank] [data-value="as an alias"]').click();
    expect(calls).toContainEqual(['blank', 's1', 'as an alias']);
    ev.emit({ type: 'blank-answered', turnId: 'a1', answer: 'as an alias' });
    expect(q('.ss-q').textContent).toBe('It stays as an alias.');
    expect(q('[data-blank] [data-value="as an alias"]').hasAttribute('data-chosen')).toBe(true);
  });
  it('"Something else" takes your own words', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent({ status: 'done', blank: BLANK })]);
    q('[data-blank] [data-value="else"]').click();
    const input = q<HTMLInputElement>('[data-blank] input');
    input.value = 'for one release';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(calls).toContainEqual(['blank', 's1', 'for one release']);
  });
});

describe('the composer', () => {
  const idle = (): void => boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent({ status: 'done' })]);
  it('sends on Enter with what the text was read as, and asks "What next?" after a turn', async () => {
    idle();
    expect(q('.ss-composer .k7-composer__text').dataset['placeholder']).toBe('What next?');
    type('now the tests');
    enter();
    await tick(); await tick();
    const sent = calls.find((c) => c[0] === 'send');
    expect(sent?.slice(1, 3)).toEqual(['s1', 'now the tests']);
    expect(sent?.[3]).toMatchObject({ attachments: [] });
  });
  it('Stop is there only while a turn runs, and stops it; nothing is sent while it runs and nothing waits', async () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent()]);
    expect(q('.ss-composer .k7-composer').hasAttribute('data-running')).toBe(true);
    q('.ss-composer [data-stop]').click();
    expect(calls).toContainEqual(['stop', 's1']);
    type('wait');
    expect(q<HTMLButtonElement>('.ss-composer [data-send]').hidden).toBe(true);
    enter();
    await tick(); await tick();
    expect(calls.some((c) => c[0] === 'send')).toBe(false);
    expect(VIEW.composer?.value).toBe('wait');
  });
  it('the line says the branch, who answers next, the context and the cost; the quick menu turns an item off and remembers it', () => {
    idle();
    const line = (): string[] => [...root.querySelectorAll<HTMLElement>('.ss-composer [data-line]')].map((x) => x.dataset['line'] ?? '');
    expect(line()).toEqual(['branch', 'model', 'context', 'cost']);
    q('.ss-composer .k7-composer__line .k7-grow').click();
    const menu = document.querySelector<HTMLElement>('.k7-menu[data-floating]') as HTMLElement;
    expect([...menu.querySelectorAll('.k7-mrow__name')].map((x) => x.textContent)).toEqual(['Branch', 'Model and effort', 'Context', 'Cost']);
    menu.querySelector<HTMLElement>('[data-value="cost"]')?.click();
    expect(line()).toEqual(['branch', 'model', 'context']);
    idle();
    expect(line()).toEqual(['branch', 'model', 'context']);
  });
  it('where the line has folded the branch and the context away (a window under 900 wide), the quick menu says what they hold', () => {
    idle();
    const real = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => (el.hasAttribute('data-fold') ? { display: 'none' } as CSSStyleDeclaration : real(el, pseudo)));
    q('.ss-composer .k7-composer__line .k7-grow').click();
    const menus = document.querySelectorAll<HTMLElement>('.k7-menu[data-floating]'), menu = menus[menus.length - 1] as HTMLElement;
    const rows = Object.fromEntries([...menu.querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]')].map((r) => [r.dataset['value'] ?? '', r.querySelector('.k7-mrow__desc')?.textContent ?? null]));
    expect(rows['branch']).toBe(p.details.environment.get().branch);
    expect(rows['context']).toMatch(/\d+k \/ \d+k/);
    expect([rows['model'], rows['cost']]).toEqual([null, null]);   /* they still show on the line */
    spy.mockRestore();
    kit.closeMenu();
  });
  it('"+" opens the add menu; the model item opens who answers next, and a pick changes it', () => {
    idle();
    q('.ss-composer [data-plus]').click();
    expect([...document.querySelectorAll('.k7-menu[data-floating] .k7-mrow__name')].map((x) => x.textContent)).toEqual(['Attach a file', 'Add a folder to context', 'Commands', 'Show under the composer']);
    const set = vi.spyOn(p.details, 'setGovernance');
    q('.ss-composer [data-line="model"]').click();
    const menus = document.querySelectorAll<HTMLElement>('.k7-menu[data-floating]');   /* the add menu is still leaving the page: the list now open is the last */
    const rows = [...(menus[menus.length - 1] as HTMLElement).querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]')];
    expect(rows[0]?.textContent).toContain('Automatic (Smart)');
    /* its rows say what they are beside their name: the kit's list Menu, wide enough for them (boards S31, S32) */
    expect((menus[menus.length - 1] as HTMLElement).dataset['variant']).toBe('list');
    expect(rows[0]?.querySelector('.k7-mrow__desc')?.textContent).toMatch(/^Picks a tier for each message/);
    rows.find((r) => r.dataset['value'] && r.dataset['value'] !== '__smart' && r.dataset['value'] !== '__council' && r.getAttribute('aria-disabled') !== 'true')?.click();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ smart: false }));
  });
  it('a file dropped on it or pasted into it is a chip in the text and rides with the message; taken out with Backspace, it does not', async () => {
    idle();
    const c = q('.ss-composer .k7-composer'), t = q('.ss-composer .k7-composer__text');
    const give = (name: string, via: string): void => { c.dispatchEvent(new CustomEvent('ui:files', { bubbles: true, detail: { files: [new File(['xy'], name)], via } })); };
    give('notes.md', 'drop'); give('shot.png', 'paste');
    expect([...t.querySelectorAll<HTMLElement>('[data-att]')].map((x) => [x.dataset['attKind'], x.textContent])).toEqual([['file', ''], ['image', '']]);
    /* the caret is after the last chip's space: one step back, then Backspace takes the picture out as one unit */
    const pic = t.querySelectorAll<HTMLElement>('[data-att]')[1] as HTMLElement;
    const r = document.createRange(); r.setStartAfter(pic); r.collapse(true); getSelection()?.removeAllRanges(); getSelection()?.addRange(r);
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(t.querySelectorAll('[data-att]')).toHaveLength(1);
    t.append('read this');
    t.dispatchEvent(new Event('input', { bubbles: true }));
    enter();
    await tick(); await tick();
    const sent = calls.find((x) => x[0] === 'send');
    expect(sent?.[3]).toMatchObject({ attachments: [{ name: 'notes.md', kind: 'file', bytes: 2 }] });
  });
  it('mod+Z in the session\'s composer undoes an attachment and brings it back', () => {
    idle();
    const c = q('.ss-composer .k7-composer'), t = q('.ss-composer .k7-composer__text');
    c.dispatchEvent(new CustomEvent('ui:files', { bubbles: true, detail: { files: [new File(['xy'], 'notes.md')], via: 'drop' } }));
    expect(t.querySelectorAll('[data-att]')).toHaveLength(1);
    const z = (shiftKey = false): void => { t.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey, bubbles: true, cancelable: true })); };
    z();
    expect(t.querySelectorAll('[data-att]')).toHaveLength(0);
    z(true);
    expect(t.querySelectorAll('[data-att]')).toHaveLength(1);
  });
  it('the effort is changed from the line\'s "who answers next" menu: the engine\'s levels under the models, the session\'s own checked; a level that cannot be chosen says why', async () => {
    const YES = { ok: true as const }, steps = { supervised: YES, auto_edits: YES, auto: YES, full: YES };
    const asked: string[] = [];
    const caps = (changeEffort: SessionCapabilities['session']['changeEffort']): SessionCapabilities => ({
      engine: { caps: new Set(), createParams: new Set() }, plugin: { present: true, version: null, rpc: new Set() },
      launch: { create: YES, folder: YES, model: YES, effort: YES, skills: YES, efforts: ['low', 'medium', 'high'], careful: steps },
      session: { fork: YES, compact: YES, rewind: YES, changeModel: YES, changeEffort, changeCareful: steps, changeFolder: YES, changeSkills: YES }
    });
    const controls = (c: SessionCapabilities): SessionControls => ({
      capabilities: store(c), launch: store({ folder: '/w', careful: 'auto_edits', effort: 'medium', fellBack: false }), setLaunch: () => null, setCareful: () => Promise.resolve(null),
      setEffort: (e) => { asked.push(e); return Promise.resolve(null); }, rewind: () => Promise.resolve({ status: 'nothing_to_do', isolation: 'own_worktree', files: [] }), head: () => null, pickFolder: null
    });
    const open = (): HTMLElement[] => { q('.ss-composer [data-line="model"]').click(); const menus = document.querySelectorAll<HTMLElement>('.k7-menu[data-floating]'); return [...(menus[menus.length - 1] as HTMLElement).querySelectorAll<HTMLElement>('[data-value^="__effort:"]')]; };
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent()], { sessionControls: controls(caps(YES)) });
    const rows = open();
    expect(rows.map((r) => [r.querySelector('.k7-mrow__name')?.textContent, r.getAttribute('aria-checked')])).toEqual([['Low', 'false'], ['Medium', 'true'], ['High', 'false']]);
    rows[2]?.click();
    await tick();
    expect(asked).toEqual(['high']);
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent()], { sessionControls: controls(caps({ ok: false, why: 'This version of boopis\'s engine cannot change the effort while a session runs.' })) });
    const off = open();
    expect(off.every((r) => r.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(off[0]?.textContent).toContain('cannot change the effort');
    off[0]?.click();
    await tick();
    expect(asked).toEqual(['high']);
  });
  it('while a turn runs and nothing waits the placeholder is "Message" (S33); after a turn "What next?" (S23)', () => {
    boot([{ id: 'u1', role: 'user', at: '09:42', text: 'Fix it.' }, agent()]);
    expect(q('.ss-composer .k7-composer__text').dataset['placeholder']).toBe('Message');
  });
  it('alt+S turns Smart on or off, alt+G governed mode where there is no scale; ArrowUp in an empty composer brings your last message back', () => {
    idle();
    const set = vi.spyOn(p.details, 'setGovernance');
    const t = q('.ss-composer .k7-composer__text');
    const smart = p.details.governance.get().smart, governed = p.details.governance.get().governed;
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', altKey: true, bubbles: true, cancelable: true }));
    expect(set).toHaveBeenCalledWith({ smart: !smart });
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', altKey: true, bubbles: true, cancelable: true }));
    expect(set.mock.calls.some((c) => 'governed' in (c[0] as object)) || !!p.details.governance.get().frontier || governed === p.details.governance.get().governed).toBe(true);
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(VIEW.composer?.value).toBe('Fix it.');
  });
});
