// @vitest-environment jsdom
/* What the host holds for the owner in a bot's thread (REPASS.md 6e): a proposed team plan, a parked step, and the approval card's
   Edit and receipts. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { data, setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import type { Bot, LaterFeature, ParkedStep, TeamPlan } from '../../data';
import { PERMANENT_NOTE, PROBLEMS_TIP, parkedCard, parkedReceipt, planCard, wireParked, wirePlan } from './held';
import { approvalAnswers, approvalReceipt } from './room';

beforeAll(() => { setProvider(createMockProvider()); });
beforeEach(() => { document.body.replaceChildren(); });
const setLater = (f: LaterFeature[]): void => { (data().info as { later?: ReadonlySet<LaterFeature> }).later = new Set(f); };
afterEach(() => { setLater([]); });
const BOT = { id: 'kai', name: 'kai', shape: 'circle', color: '#3ecfa6', state: 'idle' } as unknown as Bot;
const PLAN: TeamPlan = { hash: 'h'.repeat(64), title: 'a small crew', reason: 'You asked for help.', actions: [{ mark: '+', target: 'kai', what: 'reviews' }, { mark: '-', target: 'room old', what: 'disbanded' }], problems: [], notes: [], state: 'proposed', permanent: true, undoes: null, words: null, report: null, bot: 'boopis', createdAt: '', expiresAt: null };

describe('a team plan', () => {
  it('an AskCard with the TeamPlan block, the permanent note, and its three answers', () => {
    const c = document.body.appendChild(planCard(PLAN, null, [BOT]));
    expect(c.querySelector('[data-kit~="TeamPlan"]')).not.toBeNull();
    expect(c.querySelector('[data-permanent]')?.textContent).toBe(PERMANENT_NOTE);
    expect([...c.querySelectorAll('.k7-ask__answers .k7-chip')].map((x) => x.textContent?.trim())).toEqual(['Hold to apply', 'Change it', 'Later']);
    expect(c.querySelector('[data-kit-part~="PlanRow"] orb-avatar, [data-kit-part~="PlanRow"] .ui-orb')).not.toBeNull();   /* kai is on the team: its orb leads */
  });
  it('with problems, the hold cannot be taken and says why', () => {
    const c = planCard({ ...PLAN, problems: ['no model'] }, null, []);
    expect(c.querySelector('[data-value="apply"]')?.getAttribute('data-tip')).toBe(PROBLEMS_TIP);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('no model');
  });
  it('the hold applies, Change it opens a Field whose Enter sends the words, Later puts it off', () => {
    const acts = { apply: vi.fn(), reject: vi.fn(), undo: vi.fn(), later: vi.fn(), change: vi.fn() };
    const c = document.body.appendChild(wirePlan(planCard(PLAN, null, [], { changing: 'leave iris out' }), acts));
    c.dispatchEvent(new CustomEvent('ui:commit'));
    expect(acts.apply).toHaveBeenCalledOnce();
    const f = c.querySelector<HTMLInputElement>('[data-plan-words]') as HTMLInputElement;
    expect(f.value).toBe('leave iris out');
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(acts.reject).toHaveBeenCalledWith('leave iris out');
    c.querySelector<HTMLElement>('[data-value="later"]')?.click();
    expect(acts.later).toHaveBeenCalledWith(true);
  });
  it('the receipts: applied with Undo, changes asked, expired, failed, put off with Open', () => {
    const acts = { apply: vi.fn(), reject: vi.fn(), undo: vi.fn(), later: vi.fn(), change: vi.fn() };
    const applied = document.body.appendChild(wirePlan(planCard({ ...PLAN, state: 'applied' }, BOT, []), acts));
    expect(applied.textContent).toContain('You applied kai’s plan');
    applied.querySelector<HTMLElement>('[data-plan="undo"]')?.click();
    expect(acts.undo).toHaveBeenCalledOnce();
    expect(planCard({ ...PLAN, state: 'rejected' }, BOT, []).textContent).toContain('You asked for changes');
    expect(planCard({ ...PLAN, state: 'expired' }, BOT, []).textContent).toContain('expired');
    expect(planCard({ ...PLAN, state: 'failed', report: 'folder taken' }, BOT, []).textContent).toContain('The plan did not apply: folder taken');
    expect(planCard(PLAN, BOT, [], { later: true }).querySelector('[data-plan="open"]')).not.toBeNull();
  });
});

describe('a parked step', () => {
  const STEP: ParkedStep = { id: 'p1', bot: 'kai', rule: 'Ask before a force-push', tool: 'Run a command · git push', at: '', expiresAt: null, choices: ['once', 'always', 'deny'] };
  it('"kai\'s step waited for you" with the rule and the tool; Always allow only with approval rules', () => {
    const c = parkedCard(STEP, BOT);
    expect(c.textContent).toContain('kai’s step waited for you');
    expect(c.querySelector('.k7-ask__rule')?.textContent).toContain('Ask before a force-push');
    expect([...c.querySelectorAll('.k7-ask__answers .k7-chip')].map((x) => x.textContent?.replace('esc', '').trim())).toEqual(['Hold to allow once', 'Deny']);
    setLater(['approval-rules']);
    expect(parkedCard(STEP, BOT).querySelector('[data-value="always"]')).not.toBeNull();
  });
  it('answers once by the hold, always, deny by esc', () => {
    setLater(['approval-rules']);
    const answer = vi.fn();
    const c = document.body.appendChild(wireParked(parkedCard(STEP, BOT), answer));
    c.dispatchEvent(new CustomEvent('ui:commit'));
    c.querySelector<HTMLElement>('[data-value="always"]')?.click();
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(answer.mock.calls.map((x) => x[0])).toEqual(['once', 'always', 'deny']);
  });
  it('the receipts as 6d\'s, the drafted exception\'s Open only once Settings › Approvals exists', () => {
    expect(parkedReceipt({ choice: 'always', drafted: true }).text).toBe('You allowed it always · exception drafted');
    expect(parkedReceipt({ choice: 'deny', drafted: false }).text).toBe('You denied it');
    expect(parkedCard(STEP, BOT, { answered: { choice: 'always', drafted: true } }).querySelector('[data-open-draft]')).toBeNull();
    setLater(['rules-settings']);
    expect(parkedCard(STEP, BOT, { answered: { choice: 'always', drafted: true } }).querySelector('[data-open-draft]')).not.toBeNull();
  });
});

describe('a bot\'s approval card (6e)', () => {
  it('Edit shows only with approval-edit (no provider has it), and editing holds to approve the edited request', () => {
    expect(approvalAnswers().map((a) => a.label)).not.toContain('Edit');
    setLater(['approval-edit']);
    expect(approvalAnswers().map((a) => a.label)).toContain('Edit');
    expect(approvalAnswers(true)[0]).toMatchObject({ label: 'Hold to approve edited', hold: true });
  });
  it('its receipts say what you did', () => {
    expect(approvalReceipt({ resolved: 'approved', how: 'edited' }).text).toBe('You approved it, edited');
    expect(approvalReceipt({ resolved: 'approved', how: 'always', drafted: true }).text).toBe('You allowed it always · exception drafted');
    expect(approvalReceipt({ resolved: 'approved', how: 'always' }).text).toBe('You allowed it always');
    expect(approvalReceipt({ resolved: 'approved' }).text).toBe('You allowed it once');
    expect(approvalReceipt({ resolved: 'denied' }).text).toBe('You denied it');
  });
});
