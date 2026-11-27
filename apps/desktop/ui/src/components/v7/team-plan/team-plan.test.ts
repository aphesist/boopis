// @vitest-environment jsdom
/* TeamPlan: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from kit-6e.test.ts keep their words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './team-plan';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.teamPlan>[0] = { actions: [{ mark: '+', target: 'nina', what: 'joins the room' }] };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: TeamPlan', () => {
  it('draws the component its contract names (data-kit="TeamPlan")', () => {
    const el = put(kit.teamPlan(EX));
    expect(el.matches('[data-kit~="TeamPlan"]') || !!el.querySelector('[data-kit~="TeamPlan"]')).toBe(true);
    expect(contract.name).toBe('TeamPlan');
  });
  it('a row per action, its mark said in words', () => {
    const p = put(kit.teamPlan(EX));
    const row = p.querySelector('[data-kit-part~="PlanRow"]') as HTMLElement;
    expect(row.textContent).toContain('nina');
    expect(row.textContent).toContain('adds');
  });
  it('a row per action led by its mark, problems as alerts, notes and a permanent note quiet', () => {
    const p = put(kit.teamPlan({ actions: [{ mark: '+', target: 'kai', what: 'reviews' }, { mark: '~', target: 'iris', what: 'weekly' }, { mark: '-', target: 'room old', what: 'disbanded' }], problems: ['no model'], notes: ['a note'], permanent: 'Cannot be undone.' }));
    expect([...p.querySelectorAll<HTMLElement>('[data-kit-part~="PlanRow"]')].map((r) => r.dataset['mark'])).toEqual(['add', 'change', 'del']);
    expect([...p.querySelectorAll('.k7-plan__mark')].map((m) => m.textContent)).toEqual(['+', '~', '−']);
    expect(p.querySelector('[data-kit-part~="PlanRow"]')?.textContent).toContain('adds kai reviews');
    expect(p.querySelector('[role="alert"]')?.textContent).toBe('no model');
    expect(p.querySelector('[data-permanent]')?.textContent).toBe('Cannot be undone.');
  });
});
