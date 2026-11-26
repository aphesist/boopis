// @vitest-environment jsdom
/* An escalation, a failed turn, a teammate's ask and a routine's on the kit (REPASS.md 6e), replacing the v6 card kinds. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { escalationLine, escalationText, failedTurn, routineAsk, teammateAsk } from './asks';

const KAI = { id: 'kai', name: 'kai', shape: 'circle', color: '#3ecfa6', state: 'idle' } as const;
beforeEach(() => { document.body.replaceChildren(); });

describe('an escalation', () => {
  it('a SystemLine: switched, or not switched with an amber "capped"', () => {
    expect(escalationText({ to: 'claude-sonnet-5-5', reason: 'after 2 failed gate runs' })).toMatch(/^Switched to .+ for this step: after 2 failed gate runs$/);
    const l = escalationLine({ to: 'claude-opus-5-5', reason: 'x', capped: 'the $0.60 cap is reached' });
    expect(l.matches('[data-kit~="SystemLine"]')).toBe(true);
    expect(l.querySelector('[data-kit~="StatusWord"]')?.textContent).toBe('capped');
    expect(l.querySelector('[data-kit~="StatusWord"]')?.getAttribute('data-tone')).toBe('owe');
    expect(l.textContent).toContain('the $0.60 cap is reached');
  });
});

describe('a failed turn (S38)', () => {
  const F = { gate: 'npm test', output: ['FAIL invoice.test.ts'], note: 'Rolled back.', retryWith: 'claude-sonnet-5-5', at: '09:52' };
  it('failed: the check, a red word, what it printed, why; Retry retries', () => {
    const retry = vi.fn();
    const c = document.body.appendChild(failedTurn(F, 'failed', { retry }));
    expect(c.querySelector('[data-kit~="StatusWord"]')?.getAttribute('data-tone')).toBe('red');
    expect(c.querySelector('[data-kit~="Well"]')?.textContent).toContain('FAIL invoice.test.ts');
    expect(c.textContent).toContain('Rolled back.');
    c.querySelector<HTMLElement>('[data-files]')?.click();
    expect(retry).toHaveBeenCalledOnce();
  });
  it('retrying shimmers; Stop stops', () => {
    const stop = vi.fn();
    const c = document.body.appendChild(failedTurn(F, 'retrying', { stop }));
    expect(c.querySelector('.k7-shimmer')?.textContent).toBe('retrying');
    c.querySelector<HTMLElement>('[data-files]')?.click();
    expect(stop).toHaveBeenCalledOnce();
  });
  it('passed collapses to the one-row receipt', () => {
    const c = failedTurn(F, 'passed');
    expect(c.getAttribute('data-state')).toBe('answered');
    expect(c.textContent).toContain('npm test passed on retry');
  });
});

describe('a teammate\'s ask and a routine\'s', () => {
  it('Accept and Deny (esc), then "You accepted" or "You denied it"', () => {
    const yes = vi.fn(), no = vi.fn();
    const c = document.body.appendChild(teammateAsk({ from: KAI, title: 'hands you a review' }, 'needs', { onYes: yes, onNo: no }));
    expect(c.getAttribute('data-variant')).toBe('question');
    c.querySelector<HTMLElement>('[data-value="yes"]')?.click();
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(yes).toHaveBeenCalledOnce(); expect(no).toHaveBeenCalledOnce();
    expect(teammateAsk({ from: KAI, title: 'hands you a review' }, 'yes').textContent).toContain('You accepted');
    expect(teammateAsk({ from: KAI, title: 'x' }, 'no').textContent).toContain('You denied it');
  });
  it('a routine asks as board 12 says one made, and is answered with 6d\'s receipts', () => {
    const r = { from: KAI, name: 'Weekly changelog', when: 'Fridays at 16:00', next: 'fri 16:00' };
    expect(routineAsk(r, 'needs').textContent).toContain('Create routine Weekly changelog?');
    expect(routineAsk(r, 'yes').textContent).toContain('You created routine Weekly changelog, first run fri 16:00');
    expect(routineAsk(r, 'no').textContent).toContain('You said not now');
  });
});
