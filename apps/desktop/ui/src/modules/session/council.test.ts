// @vitest-environment jsdom
/* The council on the kit (REPASS.md 6e): the form (S19's Menu), the Block while it runs, the answers once done, none reported. */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import type { CouncilChoice, CouncilForm, CouncilTurn, ModelChoice } from '../../data';
import { FAILED_TIP, councilAnswers, councilBlock, councilFoot, councilFormNode, councilWord, memberRow, showsBlock } from './council';

beforeAll(() => { setProvider(createMockProvider()); });
beforeEach(() => { document.body.replaceChildren(); });
const ch = (provider: string, model: string): ModelChoice => ({ value: provider + '/' + model, provider, model, providerName: provider });
const OPTIONS = [ch('c', 'claude-sonnet-5-5'), ch('c', 'claude-opus-5-5'), ch('o', 'gpt-6-luna'), ch('g', 'gemini-3.8-pro')];
const FORM: CouncilForm = { options: OPTIONS, remembered: true, choice: { members: [{ provider: 'c', model: 'claude-opus-5-5' }, { provider: 'o', model: 'gpt-6-luna' }], combiner: { provider: 'c', model: 'claude-sonnet-5-5' } } };
const s = (provider: string, model: string) => ({ provider, model });
const turn = (phase: CouncilTurn['phase'], members: CouncilTurn['members']): CouncilTurn => ({ members, combiner: s('c', 'claude-sonnet-5-5'), phase, done: members.filter((m) => m.state !== 'waiting').length, total: members.length });

describe('a member\'s row', () => {
  it('running while the members answer, done, failed with its reason, no answer once the council went on', () => {
    expect(memberRow({ slot: s('o', 'gpt-6-luna'), state: 'waiting', text: '' }, 'members')).toMatchObject({ state: 'running', word: 'running', row: true, icon: '' });
    expect(memberRow({ slot: s('o', 'gpt-6-luna'), state: 'answered', text: 'x' }, 'members')).toMatchObject({ state: 'done', word: 'done' });
    expect(memberRow({ slot: s('o', 'gpt-6-luna'), state: 'failed', text: '', reason: 'timed out' }, 'combining')).toMatchObject({ state: 'failed', wordTip: 'timed out' });
    expect(memberRow({ slot: s('o', 'gpt-6-luna'), state: 'failed', text: '' }, 'combining').wordTip).toBe(FAILED_TIP);
    expect(memberRow({ slot: s('o', 'gpt-6-luna'), state: 'waiting', text: '' }, 'combining')).toMatchObject({ word: 'no answer', wordTone: 'owe' });
  });
});

describe('the Block', () => {
  it('"Council · N models" with "asking", then "combining" with the shimmer, a ToolRow per member', () => {
    const run = turn('members', [{ slot: s('c', 'claude-opus-5-5'), state: 'answered', text: 'a' }, { slot: s('o', 'gpt-6-luna'), state: 'waiting', text: '' }]);
    const b = document.body.appendChild(councilBlock(run));
    expect(b.querySelector('[data-council-head]')?.textContent).toContain('Council · 2 models');
    expect(b.querySelector('[data-council-head] .k7-shimmer')?.textContent).toBe('asking');
    expect(b.querySelectorAll('[data-kit~="ToolRow"][data-row]').length).toBe(2);
    expect(councilWord({ ...run, phase: 'combining' })).toEqual({ text: 'combining', tone: 'neutral', live: true });
  });
  it('none reported: red, and "Ask again" asks again', () => {
    const none = turn('done', []);
    expect(showsBlock(none)).toBe(true);
    const again = vi.fn();
    const b = document.body.appendChild(councilBlock({ ...none, total: 2 }, { again }));
    expect(b.querySelector('[data-kit~="StatusWord"]')?.getAttribute('data-tone')).toBe('red');
    b.querySelector<HTMLElement>('[data-again]')?.click();
    expect(again).toHaveBeenCalledOnce();
  });
});

describe('done', () => {
  const done = turn('done', [{ slot: s('c', 'claude-opus-5-5'), state: 'answered', text: 'one\n\ntwo', cut: true }, { slot: s('o', 'gpt-6-luna'), state: 'failed', text: '', reason: 'timed out' }, { slot: s('g', 'gemini-3.8-pro'), state: 'answered', text: 'three' }]);
  it('no Block; the answers fold under the reply in a Disclosure, each member\'s in a Well', () => {
    expect(showsBlock(done)).toBe(false);
    const d = document.body.appendChild(councilAnswers(done) as HTMLElement);
    expect(d.querySelector('.k7-disc__sum')?.textContent).toBe('Answers (3)');
    expect(d.querySelectorAll('.k7-well__thread [data-role="user"]').length).toBe(3);
    expect(d.textContent).toContain('It did not answer: timed out');
    expect(d.textContent).toContain('shortened when it was saved');
  });
  it('its foot says "council of N" with the members\' marks', () => {
    expect(councilFoot(done)).toEqual({ marks: ['claude-opus-5-5', 'gpt-6-luna', 'gemini-3.8-pro'], modelName: 'council of 3' });
  });
});

describe('the form (S19\'s Menu)', () => {
  it('members as checked OptionRows, the combiner a SelectorItem, Ask the council', () => {
    const f = councilFormNode(FORM, () => Promise.resolve());
    document.body.append(f.el);
    const rows = [...f.el.querySelectorAll<HTMLElement>('[data-kit~="OptionRow"]')];
    expect(rows.length).toBe(4);
    expect(rows.filter((r) => r.getAttribute('aria-checked') === 'true').length).toBe(2);
    expect(rows[0]?.getAttribute('role')).toBe('menuitemcheckbox');
    expect(f.el.querySelector('[data-combiner]')?.textContent).toContain('Sonnet');
    expect(f.el.querySelector<HTMLButtonElement>('[data-ask]')?.disabled).toBe(false);
  });
  it('fewer than two members cannot ask; checking one more can', () => {
    const f = councilFormNode({ ...FORM, choice: { ...FORM.choice, members: [FORM.choice.members[0] as never] } }, () => Promise.resolve());
    document.body.append(f.el);
    expect(f.el.querySelector<HTMLButtonElement>('[data-ask]')?.disabled).toBe(true);
    f.el.querySelector<HTMLElement>('[data-value="g/gemini-3.8-pro"]')?.click();
    expect(f.el.querySelector<HTMLButtonElement>('[data-ask]')?.disabled).toBe(false);
  });
  it('the combiner turns the Menu to one choice, and choosing returns', () => {
    const f = councilFormNode(FORM, () => Promise.resolve());
    document.body.append(f.el);
    f.el.querySelector<HTMLElement>('[data-combiner]')?.click();
    expect(f.el.dataset['page']).toBe('combiner');
    f.el.querySelector<HTMLElement>('[data-value="o/gpt-6-luna"]')?.click();
    expect(f.el.dataset['page']).toBe('members');
    expect(f.choice()?.combiner).toEqual({ provider: 'o', model: 'gpt-6-luna' });
  });
  it('Ask the council hands over the choice', async () => {
    let got: CouncilChoice | null = null;
    const f = councilFormNode(FORM, (c) => { got = c; return Promise.resolve(); });
    document.body.append(f.el);
    f.el.querySelector<HTMLElement>('[data-ask]')?.click();
    await Promise.resolve();
    expect(got).toEqual({ members: FORM.choice.members, combiner: FORM.choice.combiner });
  });
});
