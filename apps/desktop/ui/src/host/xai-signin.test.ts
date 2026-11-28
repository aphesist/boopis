// @vitest-environment jsdom
/* The SuperGrok sign-in card (ADR-0039) against fakes of the host: the code and the page, the wait, each way it ends, a card drawn
   again while a code waits, and the first-run form that offers it. */
import { beforeEach, describe, expect, it } from 'vitest';
import { mountXaiSignin, tauriXaiBridge, XAI_COPY, XAI_WAY } from './xai-signin';
import { mountSigninCard } from './signin-card';
import type { SigninBridge, SigninEnd, SigninPage } from './signin-card';
import { formExtras } from '../modules/onboarding/setup';
import type { SetupSignins } from '../modules/onboarding/setup';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const NOW = 1_000_000_000_000;
const CODE: SigninPage = { url: 'https://accounts.x.ai/oauth2/device?user_code=QMJM-H3XJ', code: 'QMJM-H3XJ', expiresAt: NOW + 30 * 60_000 };
const ev = (outcome: string, message = ''): SigninEnd => ({ outcome, message });

function fake(over: Partial<SigninBridge> = {}): SigninBridge & { calls: string[]; end: (e: SigninEnd) => void; listening: () => boolean } {
  let listener: ((e: SigninEnd) => void) | null = null;
  const calls: string[] = [];
  return {
    calls,
    end: (e) => { listener?.(e); },
    listening: () => listener !== null,
    waiting: () => Promise.resolve(null),
    start: () => { calls.push('start'); return Promise.resolve(CODE); },
    cancel: () => { calls.push('cancel'); return Promise.resolve(); },
    onEnd: (cb) => { listener = cb; return Promise.resolve(() => { listener = null; }); },
    open: (url) => { calls.push('open:' + url); return Promise.resolve(); },
    copy: (t) => { calls.push('copy:' + t); return Promise.resolve(); },
    ...over
  };
}
const act = (root: ParentNode, name: string): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>(`[data-act="${name}"]`);

beforeEach(() => { document.body.replaceChildren(); });

describe('the SuperGrok sign-in card', () => {
  it('shows xAI’s page as a button and the code in large mono with a copy button, then says it is signed in', async () => {
    const host = document.createElement('div');
    const b = fake();
    let signedIn = 0;
    mountXaiSignin(host, b, { onSignedIn: () => { signedIn += 1; }, now: () => NOW });
    expect(act(host, 'start')?.querySelector('.k7-btn__label')?.textContent).toBe('Sign in with xAI');
    act(host, 'start')?.click();
    await tick(); await tick();
    const code = host.querySelector<HTMLElement>('[data-code]');
    expect(code?.textContent).toBe('QMJM-H3XJ');
    expect(code?.getAttribute('style')).toContain('var(--mono)');
    expect(code?.getAttribute('style')).toContain('var(--fs-xl)');
    expect(host.querySelector('[data-page]')?.textContent, 'the page without its scheme or its query').toBe('accounts.x.ai/oauth2/device');
    expect(host.textContent).toContain('The code works for 30 minutes.');
    expect(host.textContent).toContain('Approve it only on accounts.x.ai');
    expect(host.textContent).toContain('only if you started this sign-in in boopis');
    expect(host.textContent).toContain('Waiting for you to finish signing in');
    act(host, 'open')?.click();
    act(host, 'copy')?.click();
    await tick();
    expect(b.calls).toEqual(['start', 'open:' + CODE.url, 'copy:QMJM-H3XJ']);
    expect(host.textContent).toContain('Copied');
    b.end(ev('signed_in'));
    expect(host.textContent).toContain('Signed in with SuperGrok.');
    expect(signedIn).toBe(1);
    expect(host.textContent).not.toContain('Hermes');
    expect(host.querySelector('[data-signin="xai"]')).toBeTruthy();
  });

  it('says nothing about minutes when the host named no expiry', async () => {
    const host = document.createElement('div');
    mountXaiSignin(host, fake({ start: () => Promise.resolve({ ...CODE, expiresAt: null }) }));
    act(host, 'start')?.click();
    await tick(); await tick();
    expect(host.textContent).not.toContain('minutes');
    expect(host.textContent).toContain('Approve it only on accounts.x.ai');
  });

  it('cancel, an expired code, a declined page and a refused account each say so and offer to try again', async () => {
    const host = document.createElement('div');
    const b = fake();
    mountXaiSignin(host, b);
    act(host, 'start')?.click();
    await tick(); await tick();
    act(host, 'cancel')?.click();
    await tick();
    expect(b.calls).toContain('cancel');
    b.end(ev('cancelled', 'The sign-in was cancelled.'));
    expect(host.querySelector('[role="status"]')?.textContent).toBe('The sign-in was cancelled.');
    expect(act(host, 'start')?.textContent).toBe('Try again');
    for (const [outcome, message, at] of [
      ['timed_out', 'The code expired before the sign-in finished. Start again for a new code.', 'code expired'],
      ['failed', 'The sign-in was declined on xAI’s page.', 'declined'],
      ['failed', 'xAI did not allow this account to use the SuperGrok sign-in. An xAI API key works instead', 'API key']
    ] as const) {
      act(host, 'start')?.click();
      await tick(); await tick();
      b.end(ev(outcome, message));
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(at);
    }
  });

  it('says why when xAI gives no code, and draws a sign-in already waiting at its code', async () => {
    const host = document.createElement('div');
    mountXaiSignin(host, fake({ start: () => Promise.reject(new Error('xAI is limiting sign-in requests right now. Wait a minute and try again.')) }));
    act(host, 'start')?.click();
    await tick(); await tick();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Wait a minute');
    const again = document.createElement('div');
    const b = fake({ waiting: () => Promise.resolve(CODE) });
    mountXaiSignin(again, b, { now: () => NOW });
    await tick(); await tick();
    expect(again.querySelector('[data-code]')?.textContent).toBe('QMJM-H3XJ');
    expect(b.calls, 'no new code is asked for').toEqual([]);
    expect(b.listening(), 'and the card hears how it ends').toBe(true);
  });

  it('ignores an event after the card is gone or before it waits, and taking the card away stops listening', async () => {
    const host = document.createElement('div');
    const b = fake();
    const card = mountXaiSignin(host, b);
    b.end(ev('signed_in'));
    expect(host.textContent, 'an event while nothing waits changes nothing').toContain('Sign in with xAI');
    act(host, 'start')?.click();
    await tick(); await tick();
    expect(b.listening()).toBe(true);
    card.destroy();
    expect(b.listening()).toBe(false);
    expect(b.calls).toEqual(['start']);
    expect(host.children).toHaveLength(0);
  });

  it('is one card with a lab’s words as its argument', async () => {
    const host = document.createElement('div');
    mountSigninCard(host, fake(), { ...XAI_COPY, brand: undefined as never, provider: 'other', button: 'Sign in to another lab', done: 'Signed in.' });
    expect(act(host, 'start')?.textContent).toBe('Sign in to another lab');
    expect(host.querySelector('[data-signin="other"]')).toBeTruthy();
  });
});

describe('the host bridge', () => {
  it('names the way in every call', () => {
    const b = tauriXaiBridge();
    expect(typeof b.start).toBe('function');
    expect(XAI_WAY).toBe('xai.signin');
  });
});

describe('first-run setup: the form that offers the SuperGrok sign-in', () => {
  it('draws the card under the form, and a finished sign-in runs setup again on its own', async () => {
    const b = fake();
    const deps = (): SetupSignins => ({ chatgpt: {} as never, xai: b, login: () => Promise.reject(new Error('no')), open: () => Promise.resolve() });
    let next = 0;
    const form = { form_id: 'setup.xai', kind: 'setup', title: 'Sign in with xAI', body: 'Why', schema: { type: 'object', properties: {} }, submit: { label: 'Check again' }, cancel: { label: 'Choose another model' }, sensitive: false, origin: 'host', diff: [], signin: { provider: 'xai', label: 'Sign in with xAI' } };
    const extras = formExtras(form as never, deps, () => { next += 1; });
    expect(extras).toBeTruthy();
    document.body.append(extras?.node as Node);
    act(document, 'start')?.click();
    await tick(); await tick();
    b.end(ev('signed_in'));
    expect(next).toBe(1);
    extras?.destroy();
  });
});
