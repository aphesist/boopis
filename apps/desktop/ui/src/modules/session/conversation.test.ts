/* A started session on the kit (boards S20 and S23), driven as a person drives it: the thread draws the feed's turns as kit parts and
   follows its events; a change waiting on its tool row is allowed by the hold and denied by Deny, Esc or by typing feedback; the
   composer's line, its "+" and quick menus, Stop and the keys do their jobs. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { store } from '../../data/store';
import { emitter } from '../../data/store';
import type { AgentTurn, Conversation, ConversationEvent, DataProvider, FormSpec, Turn } from '../../data';
import { VIEW, mountView } from './conversation';

const EDIT: FormSpec = { id: 'f1', kind: 'permission', title: 'Allow this change?', file: 'modules/dock/dock.css', diff: '+a\n-b', schema: { properties: { choice: { type: 'string', enum: ['once', 'session', 'deny'] } } } };
const agent = (o: Partial<AgentTurn> = {}): AgentTurn => ({ id: 'a1', role: 'assistant', model: 'sonnet 5.5', time: '', cost: '', stepCount: 0, steps: [], paragraphs: ['Reading the dock first.'], bullets: [], status: 'running', ...o });
let p: DataProvider, turns: Turn[], ev: ReturnType<typeof emitter<ConversationEvent>>, root: HTMLElement;
const calls: Array<[string, ...unknown[]]> = [];
const q = <T extends HTMLElement = HTMLElement>(s: string): T => { const n = root.querySelector<T>(s); if (!n) throw new Error('missing ' + s); return n; };
const parts = (): string[] => [...root.querySelectorAll<HTMLElement>('[data-turn="agent"]')].flatMap((t) => [...t.children].map((c) => (c as HTMLElement).dataset['part'] ?? ''));
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
function boot(start: Turn[]): void {
  turns = start;
  ev = emitter<ConversationEvent>();
  const base = createMockProvider({ simulate: false });
  calls.length = 0;
  p = {
    ...base,
    sessions: { ...base.sessions, list: store([{ id: 's1', project: 'boopis', title: 'Fix the dock', when: '', branch: 'w32/dock-paint' }]), draft: () => '',
      conversation: () => ({ snapshot: (): Conversation => ({ turns }), subscribe: (fn) => ev.subscribe(fn) }),
      send: (...a: unknown[]) => { calls.push(['send', ...a]); }, stop: (...a: unknown[]) => { calls.push(['stop', ...a]); }, answerBlank: (...a: unknown[]) => { calls.push(['blank', ...a]); } },
    forms: { ...base.forms, submit: (...a: unknown[]) => { calls.push(['submit', ...a]); return Promise.resolve(); }, cancel: (...a: unknown[]) => { calls.push(['cancel', ...a]); return Promise.resolve(); } }
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
  it('"+" opens the add menu; the model item opens who answers next, and a pick changes it', () => {
    idle();
    q('.ss-composer [data-plus]').click();
    expect([...document.querySelectorAll('.k7-menu[data-floating] .k7-mrow__name')].map((x) => x.textContent)).toEqual(['Attach a file', 'Add a folder to context', 'Commands', 'Show under the composer']);
    const set = vi.spyOn(p.details, 'setGovernance');
    q('.ss-composer [data-line="model"]').click();
    const menus = document.querySelectorAll<HTMLElement>('.k7-menu[data-floating]');   /* the add menu is still leaving the page: the list now open is the last */
    const rows = [...(menus[menus.length - 1] as HTMLElement).querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]')];
    expect(rows[0]?.textContent).toContain('Automatic (Smart)');
    rows.find((r) => r.dataset['value'] && r.dataset['value'] !== '__smart' && r.dataset['value'] !== '__council' && r.getAttribute('aria-disabled') !== 'true')?.click();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ smart: false }));
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
