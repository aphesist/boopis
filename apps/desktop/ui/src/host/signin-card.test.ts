// @vitest-environment jsdom
/* The shared sign-in card (`signin-card.ts`): every state, the code flow and the page-only flow, against a fake of the host. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { minutesLeft, mountSigninCard, pageOf, pageText } from './signin-card';
import type { SigninBridge, SigninCopy, SigninEnd, SigninPage } from './signin-card';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const COPY: SigninCopy = {
  provider: 'test', button: 'Sign in to Test', starting: 'Getting a code…', done: 'Signed in with Test.', gave: 'Test gave no code.',
  explain: (hasCode) => (hasCode ? 'Open the page and type the code.' : 'The page does everything.'),
  caution: (p) => `Only on ${pageText(p.url)}.`
};
const CODE: SigninPage = { url: 'https://example.test/login/device', code: 'ABCD-1234', expiresAt: null };
const PAGE: SigninPage = { url: 'https://example.test/authorize?state=s', code: '', expiresAt: null };

function fake(over: Partial<SigninBridge> = {}, page: SigninPage = CODE): SigninBridge & { calls: string[]; end: (e: SigninEnd) => void; listening: () => boolean } {
  let listener: ((e: SigninEnd) => void) | null = null;
  const calls: string[] = [];
  return {
    calls,
    end: (e) => { listener?.(e); },
    listening: () => listener !== null,
    waiting: () => Promise.resolve(null),
    start: () => { calls.push('start'); return Promise.resolve(page); },
    cancel: () => { calls.push('cancel'); return Promise.resolve(); },
    onEnd: (cb) => { listener = cb; return Promise.resolve(() => { listener = null; }); },
    open: (url) => { calls.push('open:' + url); return Promise.resolve(); },
    copy: (t) => { calls.push('copy:' + t); return Promise.resolve(); },
    ...over
  };
}
const act = (root: ParentNode, name: string): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>(`[data-act="${name}"]`);

beforeEach(() => { document.body.replaceChildren(); });

describe('the shared sign-in card', () => {
  it('starts at its button, shows the page as a button and the code in large mono with Copy, then says it is signed in', async () => {
    const host = document.createElement('div');
    const b = fake();
    let signedIn = 0;
    mountSigninCard(host, b, COPY, { onSignedIn: () => { signedIn += 1; } });
    expect(host.querySelector('[data-signin="test"]')).toBeTruthy();
    expect(act(host, 'start')?.textContent).toBe('Sign in to Test');
    act(host, 'start')?.click();
    expect(act(host, 'start')?.textContent, 'the button says it is working while the host starts').toBe('Getting a code…');
    expect(act(host, 'start')?.disabled).toBe(true);
    await tick(); await tick();
    const code = host.querySelector<HTMLElement>('[data-code]');
    expect(code?.textContent).toBe('ABCD-1234');
    expect(code?.getAttribute('aria-label')).toBe('One-time code');
    expect(code?.getAttribute('style')).toContain('var(--mono)');
    expect(code?.getAttribute('style')).toContain('var(--fs-xl)');
    expect(host.querySelector('[data-page]')?.textContent).toBe('example.test/login/device');
    expect(host.textContent).toContain('Open the page and type the code.');
    expect(host.textContent).toContain('Only on example.test/login/device.');
    expect(host.textContent).toContain('Waiting for you to finish signing in');
    act(host, 'open')?.click();
    act(host, 'copy')?.click();
    await tick();
    expect(b.calls).toEqual(['start', 'open:https://example.test/login/device', 'copy:ABCD-1234']);
    expect(host.textContent).toContain('Copied');
    b.end({ outcome: 'signed_in', message: '' });
    expect(host.querySelector('[data-done]')?.textContent).toBe('Signed in with Test.');
    expect(signedIn).toBe(1);
  });

  it('a page with no code shows the page and the wait, and no code or Copy', async () => {
    const host = document.createElement('div');
    mountSigninCard(host, fake({}, PAGE), COPY);
    act(host, 'start')?.click();
    await tick(); await tick();
    expect(host.querySelector('[data-code]')).toBeNull();
    expect(act(host, 'copy')).toBeNull();
    expect(act(host, 'open')).toBeTruthy();
    expect(host.textContent).toContain('The page does everything.');
    expect(host.querySelector('[data-page]')?.textContent).toBe('example.test/authorize');
  });

  it('a failed copy says how to copy by hand', async () => {
    const host = document.createElement('div');
    mountSigninCard(host, fake({ copy: () => Promise.reject(new Error('denied')) }), COPY);
    act(host, 'start')?.click();
    await tick(); await tick();
    act(host, 'copy')?.click();
    await tick();
    expect(host.textContent).toContain('Could not copy: select the code and copy it');
  });

  it('cancelled, expired, declined and refused ends each say so, offer to try again, and only a person’s own cancel is calm', async () => {
    const host = document.createElement('div');
    const b = fake();
    mountSigninCard(host, b, COPY);
    act(host, 'start')?.click();
    await tick(); await tick();
    act(host, 'cancel')?.click();
    await tick();
    expect(b.calls).toContain('cancel');
    b.end({ outcome: 'cancelled', message: 'The sign-in was cancelled.' });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('The sign-in was cancelled.');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(act(host, 'start')?.textContent).toBe('Try again');
    for (const [outcome, message] of [['timed_out', 'The code expired before the sign-in finished.'], ['failed', 'This account has no plan.'], ['failed', '']] as const) {
      act(host, 'start')?.click();
      await tick(); await tick();
      b.end({ outcome, message });
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(message || 'The sign-in did not finish.');
      expect(act(host, 'start')?.textContent).toBe('Try again');
    }
  });

  it('says why when the host cannot start, and with no reason the provider’s own sentence', async () => {
    const host = document.createElement('div');
    mountSigninCard(host, fake({ start: () => Promise.reject(new Error('GitHub is limiting sign-in requests right now. Wait a minute and try again.')) }), COPY);
    act(host, 'start')?.click();
    await tick(); await tick();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Wait a minute');
    const other = document.createElement('div');
    mountSigninCard(other, fake({ start: () => Promise.reject('nothing') }), COPY);
    act(other, 'start')?.click();
    await tick(); await tick();
    expect(other.querySelector('[role="alert"]')?.textContent).toBe('Test gave no code.');
  });

  it('draws a sign-in already waiting in the host at its page, and asks for no new one', async () => {
    const host = document.createElement('div');
    const b = fake({ waiting: () => Promise.resolve(CODE) });
    mountSigninCard(host, b, COPY);
    await tick(); await tick();
    expect(host.querySelector('[data-code]')?.textContent).toBe('ABCD-1234');
    expect(b.calls).toEqual([]);
    b.end({ outcome: 'signed_in', message: '' });
    expect(host.querySelector('[data-done]')).toBeTruthy();
  });

  it('a host that cannot say what waits leaves the card at its button', async () => {
    const host = document.createElement('div');
    mountSigninCard(host, fake({ waiting: () => Promise.reject(new Error('no host')) }), COPY);
    await tick(); await tick();
    expect(act(host, 'start')?.textContent).toBe('Sign in to Test');
  });

  it('ignores an end it is not waiting for, and taking the card away stops listening and leaves the host’s wait running', async () => {
    const host = document.createElement('div');
    const b = fake();
    const onSignedIn = vi.fn();
    const card = mountSigninCard(host, b, COPY, { onSignedIn });
    await tick();
    b.end({ outcome: 'signed_in', message: '' });
    expect(onSignedIn, 'nothing was started here').not.toHaveBeenCalled();
    act(host, 'start')?.click();
    await tick(); await tick();
    expect(b.listening()).toBe(true);
    card.destroy();
    expect(b.listening()).toBe(false);
    expect(b.calls).toEqual(['start']);
    expect(host.children).toHaveLength(0);
  });

  it('the first button’s words can be set by the view', () => {
    const host = document.createElement('div');
    mountSigninCard(host, fake(), COPY, { label: 'Continue' });
    expect(act(host, 'start')?.textContent).toBe('Continue');
  });
});

describe('the card’s small helpers', () => {
  it('prints a page without its scheme, query, fragment or trailing slash', () => {
    expect(pageText('https://github.com/login/device/')).toBe('github.com/login/device');
    expect(pageText('http://127.0.0.1:1/a?b=c#d')).toBe('127.0.0.1:1/a');
  });
  it('counts whole minutes left, never under one, and nothing when the host did not say', () => {
    expect(minutesLeft(null)).toBeNull();
    expect(minutesLeft(1_000_000 + 15 * 60000, 1_000_000)).toBe(15);
    expect(minutesLeft(1_000_000 + 61_000, 1_000_000)).toBe(2);
    expect(minutesLeft(5, 1_000_000)).toBe(1);
  });
  it('reads the host’s code as a page', () => {
    expect(pageOf({ verification_url: 'https://x.test', user_code: '', expires_at: 7 })).toEqual({ url: 'https://x.test', code: '', expiresAt: 7 });
  });
});
