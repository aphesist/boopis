// @vitest-environment jsdom
/* The kit's additions of step 6e (REPASS.md, derived): a ToolRow as a row of a Block, its word's tone, Tooltip, end control and what
   stands under it; a FilesCard row that says what happens to its file; the check retrying; TeamPlan; FindBar; the Menu's foot; a
   SystemLine's StatusWord; a Well holding a thread; a Dialog's action that cannot be taken and says why; the TurnFoot's stacked marks. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from './index';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
beforeEach(() => { document.body.replaceChildren(); });

describe('ToolRow (6e)', () => {
  it('a row of a Block has no frame of its own and no glyph where icon is empty', () => {
    const r = put(kit.toolRow({ tool: 'opus 5.5', model: 'claude-opus-5-5', icon: '', row: true, state: 'done', word: 'done' }));
    expect(r.hasAttribute('data-row')).toBe(true);
    expect(r.classList.contains('k7-block')).toBe(false);
    expect(r.hasAttribute('data-sq')).toBe(false);
    expect(r.querySelector('.k7-tool__ic')).toBeNull();
  });
  it('its word takes a tone, and a Tooltip the keyboard reaches', () => {
    const r = put(kit.toolRow({ tool: 'gpt', state: 'failed', wordTip: 'the request timed out' }));
    const w = r.querySelector<HTMLElement>('[data-kit~="StatusWord"]') as HTMLElement;
    expect(w.textContent).toBe('failed');
    expect(w.dataset['tone']).toBe('red');
    expect(w.dataset['tip']).toBe('the request timed out');
    expect(w.tabIndex).toBe(0);
    const amber = put(kit.toolRow({ tool: 'gemini', state: 'done', word: 'no answer', wordTone: 'owe' }));
    expect(amber.querySelector<HTMLElement>('[data-kit~="StatusWord"]')?.dataset['tone']).toBe('owe');
  });
  it('carries a control at its head\'s end and what stands under it', () => {
    const r = put(kit.toolRow({ tool: 'opus', state: 'running', word: 'running', end: kit.html.button({ label: 'Stop', variant: 'ghost', size: 28, attrs: { 'data-action': 'stop' } }), after: kit.html.disclosure({ summary: 'Transcript' }) }));
    expect(r.querySelector('.k7-tool__head > [data-action="stop"]')).not.toBeNull();
    expect(r.querySelector('.k7-tool__after [data-kit~="Disclosure"]')).not.toBeNull();
  });
});

describe('FilesCard (6e)', () => {
  it('a row says what happens to its file in words, and the head can say its own words', () => {
    const c = put(kit.filesCard({ files: [{ path: 'a.ts', word: 'put back' }], title: '1 file' }));
    expect(c.querySelector('.k7-files__word')?.textContent).toBe('put back');
    expect(c.querySelector('.k7-files__counts')).toBeNull();
    expect(c.querySelector('.k7-files__title')?.textContent).toBe('1 file');
  });
  it('the check retrying shimmers its word', () => {
    const c = put(kit.filesCard({ files: [], check: { title: 'npm test', word: 'retrying', live: true } }));
    expect(c.querySelector('[data-kit~="StatusWord"] .k7-shimmer')?.textContent).toBe('retrying');
  });
});

describe('TeamPlan', () => {
  it('a row per action led by its mark, problems as alerts, notes and a permanent note quiet', () => {
    const p = put(kit.teamPlan({ actions: [{ mark: '+', target: 'kai', what: 'reviews' }, { mark: '~', target: 'iris', what: 'weekly' }, { mark: '-', target: 'room old', what: 'disbanded' }], problems: ['no model'], notes: ['a note'], permanent: 'Cannot be undone.' }));
    expect([...p.querySelectorAll<HTMLElement>('[data-kit-part~="PlanRow"]')].map((r) => r.dataset['mark'])).toEqual(['add', 'change', 'del']);
    expect([...p.querySelectorAll('.k7-plan__mark')].map((m) => m.textContent)).toEqual(['+', '~', '−']);
    expect(p.querySelector('[data-kit-part~="PlanRow"]')?.textContent).toContain('adds kai reviews');
    expect(p.querySelector('[role="alert"]')?.textContent).toBe('no model');
    expect(p.querySelector('[data-permanent]')?.textContent).toBe('Cannot be undone.');
  });
});

describe('FindBar', () => {
  it('a search with its count, previous, next and close; "No matches" is quiet', () => {
    const b = put(kit.findBar({ id: 'f', count: '3 of 12' }));
    expect(b.getAttribute('role')).toBe('search');
    expect(b.querySelector('#f')?.getAttribute('aria-describedby')).toBe('f-count');
    expect([...b.querySelectorAll<HTMLElement>('[data-find]')].map((x) => x.dataset['find'])).toEqual(['prev', 'next', 'close']);
    expect(b.querySelector('.k7-find__count')?.textContent).toBe('3 of 12');
    expect(put(kit.findBar({ id: 'f', count: 'No matches' })).querySelector('.k7-find__count')?.hasAttribute('data-none')).toBe(true);
  });
});

describe('Menu, SystemLine, Well, Dialog, TurnFoot (6e)', () => {
  it('a Menu carries a foot under its rows', () => {
    const m = put(kit.menu({ label: 'x', entries: [{ label: 'a' }], foot: kit.html.button({ label: 'Go' }) }));
    expect(m.querySelector('.k7-menu__foot [data-kit~="Button"]')).not.toBeNull();
  });
  it('a SystemLine says a StatusWord before its words', () => {
    const l = put(kit.systemLine({ text: 'Not switched', word: { text: 'capped', tone: 'owe' } }));
    expect(l.querySelector('[data-kit~="StatusWord"]')?.getAttribute('data-tone')).toBe('owe');
  });
  it('a Well holds a compact thread as markup', () => {
    const w = put(kit.well({ kind: 'thread', text: '', html: '<p data-role="user">hi</p>' }));
    expect(w.querySelector('.k7-well__thread [data-role="user"]')?.textContent).toBe('hi');
    expect(w.querySelector('pre')).toBeNull();
  });
  it('a Dialog\'s action that cannot be taken is aria-disabled and says why in its tip', () => {
    const d = put(kit.dialog({ title: 'Rewind', body: '', actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Rewind', variant: 'primary', disabled: true, tip: 'A shared checkout' }] }));
    const b = [...d.querySelectorAll<HTMLButtonElement>('.k7-dialog__foot .k7-btn')].find((x) => x.textContent === 'Rewind') as HTMLButtonElement;
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    expect(b.dataset['tip']).toBe('A shared checkout');
  });
  it('a session\'s foot stacks several models\' marks, three then "+N"', () => {
    const f = put(kit.turnFoot({ kind: 'session', marks: ['claude-opus-5-5', 'gpt-6-luna', 'gemini-3.8-pro', 'grok-4', 'mistral-large-3'], modelName: 'council of 5', actions: [] }));
    expect(f.querySelectorAll('.k7-marks__one').length).toBe(3);
    expect(f.querySelector('.k7-ask__more')?.getAttribute('data-more')).toBe('+2');
    expect(f.querySelector('.k7-foot__meta')?.textContent).toContain('council of 5');
  });
  it('a TurnFoot action that cannot be taken stays focusable for its tip', () => {
    const f = put(kit.turnFoot({ kind: 'session', actions: [{ label: 'Undo', value: 'undo', disabled: true, tip: 'Shared checkout' }] }));
    const b = f.querySelector('.k7-foot__btn') as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('aria-disabled')).toBe('true');
  });
});
