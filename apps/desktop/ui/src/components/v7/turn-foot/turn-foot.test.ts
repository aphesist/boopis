// @vitest-environment jsdom
/* TurnFoot: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from kit-6e.test.ts and thread.test.ts keep their words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './turn-foot';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.turnFoot>[0] = { modelName: 'Opus', time: '4s', cost: '$0.02' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: TurnFoot', () => {
  it('draws the component its contract names (data-kit="TurnFoot")', () => {
    const el = put(kit.turnFoot(EX));
    expect(el.matches('[data-kit~="TurnFoot"]') || !!el.querySelector('[data-kit~="TurnFoot"]')).toBe(true);
    expect(contract.name).toBe('TurnFoot');
  });
  it('a bot\'s foot says the model, the time and the cost', () => {
    const f = put(kit.turnFoot(EX));
    expect(f.dataset['kind']).toBe('bot');
    expect(f.textContent).toContain('Opus');
    expect(f.textContent).toContain('$0.02');
  });
  it('TurnFoot, a session\'s: the checkpoint, the actions that exist, the model with its time and cost; a bot\'s has no actions', () => {
    const foot = put(kit.turnFoot({ kind: 'session', label: 'Checkpoint 3', model: 'sonnet 5.5', modelName: 'sonnet 5.5', time: '0m 59s', cost: '$0.08', actions: [{ label: 'Undo', value: 'undo', icon: 'back' }] }));
    expect(foot.querySelector('.k7-foot__label')?.textContent).toBe('Checkpoint 3');
    expect([...foot.querySelectorAll<HTMLElement>('.k7-foot__btn')].map((b) => b.dataset['value'])).toEqual(['undo']);
    expect(foot.querySelector('.k7-foot__meta')?.textContent?.trim()).toBe('sonnet 5.5 0m 59s $0.08');
    expect(put(kit.turnFoot({ kind: 'session', actions: [] })).querySelector('.k7-foot__acts')).toBeNull();
    expect([...put(kit.turnFoot({ kind: 'session' })).querySelectorAll('.k7-foot__btn')].map((b) => b.textContent)).toEqual(['Undo', 'Edit from here', 'Fork']);
    expect(put(kit.turnFoot({ kind: 'bot', model: 'sonnet 5.5', modelName: 'sonnet 5.5', time: '12s' })).querySelector('.k7-foot__btn')).toBeNull();
  });
});

describe('story: TurnFoot, 6e', () => {
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
