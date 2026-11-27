// @vitest-environment jsdom
/* The boopis bot's part of the first run (modules/onboarding/bots.ts): hidden without a host that keeps its answers; with one, each step's
   exchange, the goals picked, the team built only by the hold, and the rules for every bot. */
import { beforeEach, describe, expect, it } from 'vitest';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { boardFirstRunBots } from '../../lab/board-fixtures';
import { botsAt, botsPartShown, mountBotsPart } from './bots';
import { ledger, writeLedger } from './ledger';

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));
let box: HTMLElement;
const mount = async (): Promise<string[]> => {
  const drafts: string[] = [];
  box = document.createElement('div'); document.body.replaceChildren(box);
  mountBotsPart(box, { draft: (t) => { drafts.push(t); }, redraw: () => undefined });
  await tick();
  return drafts;
};
beforeEach(() => { localStorage.clear(); writeLedger({ sessions: 'done', bots: 'todo' }); });

describe('story: the boopis bot\'s part', () => {
  it('stays hidden where the host keeps none of its answers', () => {
    setProvider(createMockProvider());
    expect(botsPartShown({ id: 'boopis' })).toBe(false);
  });
  it('greets with its head and the first choice card; other bots never show it', async () => {
    setProvider(boardFirstRunBots(false)(createMockProvider()));
    expect(botsPartShown({ id: 'boopis' })).toBe(true);
    expect(botsPartShown({ id: 'kai' })).toBe(false);
    botsAt('greet'); await mount();
    expect(box.querySelector('.hx-ob__head')?.textContent).toContain('Your main bot. It makes and runs the others.');
    expect(box.querySelector('[data-ob="greet"] .k7-ask__title')?.textContent).toBe('Build your team now?');
  });
});

describe('scene: the boopis bot\'s part', () => {
  it('goes from the greeting to the goals, and Next waits for a pick', async () => {
    setProvider(boardFirstRunBots(false)(createMockProvider()));
    botsAt('greet', { goals: [] }); await mount();
    box.querySelector<HTMLElement>('[data-ob="greet"] [data-value="yes"]')?.click(); await tick();
    expect(box.querySelector('[data-ob="goals"]')).toBeTruthy();
    expect(box.querySelector('[data-tiles-act]')?.getAttribute('aria-disabled')).toBe('true');
    box.querySelector<HTMLElement>('.k7-tiles__tile[data-value="Code and reviews"]')?.click();
    box.querySelector<HTMLElement>('[data-tiles-act]')?.click(); await tick();
    expect(box.querySelector('[data-ob="place"] .k7-ask__title')?.textContent).toBe('Where should your bots work?');
    expect(box.textContent).toContain('Code and reviews');
  });
  it('Later puts the part off', async () => {
    setProvider(boardFirstRunBots(false)(createMockProvider()));
    botsAt('greet'); await mount();
    box.querySelector<HTMLElement>('[data-ob="greet"] [data-value="later"]')?.click(); await tick();
    expect(ledger().bots).toBe('later');
  });
  it('the team is the plan the host holds, built only by the hold; the rules are the list for every bot', async () => {
    setProvider(boardFirstRunBots(false)(createMockProvider()));
    botsAt('team', { you: 'Alex', name: 'Alex', goals: ['Code and reviews'], plan: null }); await mount(); await tick(60);
    expect(box.querySelector('[data-ob="team"] [data-kit~="TeamPlan"]')).toBeTruthy();
    expect(box.querySelector('[data-ob="connector"]')?.textContent).toContain('Asks before every change.');
    box.querySelector<HTMLElement>('[data-ob="team"] [data-value="build"]')?.click(); await tick();
    expect(box.querySelector('[data-ob="rules"]'), 'a click alone builds nothing').toBeNull();
    box.querySelector('[data-ob="team"] [data-value="build"]')?.dispatchEvent(new CustomEvent('ui:commit', { bubbles: true })); await tick(60);
    expect(box.querySelector('[data-ob="rules"]')).toBeTruthy();
    expect(box.querySelectorAll('[data-ob="rules"] [data-rule-switch]').length).toBeGreaterThan(0);
    expect(box.textContent).toContain('paying with a saved card always asks');
  });
});
