/* The host's held items read into the data seam (6e): a team plan and a parked step, never a parked step's arguments. */
import { describe, expect, it, vi } from 'vitest';
import { parkedFrom, parkedSource, planFrom, teamPlansSource } from './held';
import type { HeldDeps } from './held';

const PLAN = { plan_hash: 'a'.repeat(64), title: 'a crew', reason: 'why', actions: [{ mark: '+', target: 'kai', what: 'reviews' }], problems: ['no model'], notes: [], state: 'proposed', permanent: true, undoes: null, words: null, report: null, created_at: 't', expires_at: null };
const deps = (o: Partial<HeldDeps> = {}): HeldDeps => ({
  plansList: vi.fn(() => Promise.resolve({ plans: [{ plan_hash: PLAN.plan_hash }] })), planGet: vi.fn(() => Promise.resolve(PLAN)), planApply: vi.fn(() => Promise.resolve({ ...PLAN, state: 'applied' })),
  planReject: vi.fn(() => Promise.resolve({ ...PLAN, state: 'rejected' })), planUndo: vi.fn(() => Promise.resolve({ ...PLAN, plan_hash: 'b'.repeat(64), undoes: PLAN.plan_hash })),
  onPlansChanged: vi.fn(() => Promise.resolve(() => undefined)), parkedList: vi.fn(() => Promise.resolve({ parked: [{ id: 'p', bot: 'kai', summary: 'Run a command · git push', action: 'git push --force', rules: [{ id: 'r', text: 'Ask first' }], choices: ['once', 'always', 'deny'] }] })),
  parkedAnswer: vi.fn(() => Promise.resolve({ state: 'rerun', draft_id: 'x_1' })), onFront: vi.fn(() => () => undefined), ...o
});

describe('a team plan', () => {
  it('reads the host\'s plan; the house bot proposes it when the host does not say', () => {
    expect(planFrom(PLAN)).toMatchObject({ hash: PLAN.plan_hash, actions: [{ mark: '+', target: 'kai', what: 'reviews' }], problems: ['no model'], permanent: true, bot: 'boopis', state: 'proposed' });
    expect(planFrom({})).toBeNull();
  });
  it('lists each plan whole, applies by the hold, rejects with words, undoes', async () => {
    const d = deps(), src = teamPlansSource(d);
    expect((await src.list())[0]?.hash).toBe(PLAN.plan_hash);
    expect((await src.apply(PLAN.plan_hash)).state).toBe('applied');
    await src.reject(PLAN.plan_hash, '  leave iris out ');
    expect(d.planReject).toHaveBeenCalledWith(PLAN.plan_hash, 'leave iris out');
    await src.reject(PLAN.plan_hash, '');
    expect(d.planReject).toHaveBeenLastCalledWith(PLAN.plan_hash, null);
    expect((await src.undo(PLAN.plan_hash)).undoes).toBe(PLAN.plan_hash);
  });
  it('a refusal is a sentence', async () => {
    const src = teamPlansSource(deps({ planApply: () => Promise.reject({ code: 'hx.team.plan_stale', message: 'The team changed.' }) }));
    await expect(src.apply(PLAN.plan_hash)).rejects.toThrow('The team changed.');
  });
});

describe('a parked step', () => {
  it('its rule and its tool; never its arguments', async () => {
    const s = (await parkedSource(deps()).list())[0];
    expect(s).toEqual({ id: 'p', bot: 'kai', rule: 'Ask first', tool: 'Run a command · git push', at: '', expiresAt: null, choices: ['once', 'always', 'deny'] });
    expect(JSON.stringify(s)).not.toContain('--force');
    expect(parkedFrom({})).toBeNull();
  });
  it('answers, and says whether a draft exception was kept', async () => {
    const d = deps();
    expect(await parkedSource(d).answer('p', 'always')).toEqual({ state: 'rerun', draftId: 'x_1' });
    expect(d.parkedAnswer).toHaveBeenCalledWith('p', 'always');
  });
});
