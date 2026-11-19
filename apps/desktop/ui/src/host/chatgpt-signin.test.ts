// @vitest-environment jsdom
/* The ChatGPT sign-in card and the sign-ins setup's forms offer (ADR-0030), against fakes of the host. */
import { beforeEach, describe, expect, it } from 'vitest';
import { mountChatgptSignin, pageText } from './chatgpt-signin';
import type { ChatgptBridge, ChatgptSigninEvent, ChatgptStatus } from './chatgpt-signin';
import { runFirstRun } from './first-run';
import type { SetupSignins } from './first-run';
import type { SetupBridge, SetupProgress, SetupStatus } from './setup-bridge';
import type { ConnectorLogin } from './bindings';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const CODE = { verification_url: 'https://auth.openai.com/codex/device', user_code: 'ABCD-1234' };

function fake(over: Partial<ChatgptBridge> = {}): ChatgptBridge & { calls: string[]; end: (e: ChatgptSigninEvent) => void; listening: () => boolean } {
  let listener: ((e: ChatgptSigninEvent) => void) | null = null;
  const calls: string[] = [];
  return {
    calls,
    end: (e) => { listener?.(e); },
    listening: () => listener !== null,
    status: (): Promise<ChatgptStatus> => Promise.resolve({ state: 'signed_out', plan: null, code: null }),
    start: () => { calls.push('start'); return Promise.resolve(CODE); },
    cancel: () => { calls.push('cancel'); return Promise.resolve(); },
    signOut: () => { calls.push('signout'); return Promise.resolve(); },
    onEnd: (cb) => { listener = cb; return Promise.resolve(() => { listener = null; }); },
    open: (url) => { calls.push('open:' + url); return Promise.resolve(); },
    copy: (t) => { calls.push('copy:' + t); return Promise.resolve(); },
    ...over
  };
}
const act = (root: ParentNode, name: string): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>(`[data-act="${name}"]`);

beforeEach(() => { document.body.replaceChildren(); });

describe('the ChatGPT sign-in card', () => {
  it('shows OpenAI’s page as a button and the code in large mono with a copy button, then says it is signed in', async () => {
    const host = document.createElement('div');
    const b = fake();
    let signedIn = 0;
    mountChatgptSignin(host, b, { label: 'Sign in with ChatGPT', onSignedIn: () => { signedIn += 1; } });
    expect(act(host, 'start')?.textContent).toBe('Sign in with ChatGPT');
    act(host, 'start')?.click();
    await tick(); await tick();
    const code = host.querySelector<HTMLElement>('[data-code]');
    expect(code?.textContent).toBe('ABCD-1234');
    expect(code?.getAttribute('style')).toContain('var(--mono)');
    expect(code?.getAttribute('style')).toContain('var(--fs-xl)');
    expect(host.querySelector('[data-page]')?.textContent).toBe('auth.openai.com/codex/device');
    expect(host.textContent).toContain('Waiting for you to finish signing in');
    expect(host.textContent).toContain('only if you started this sign-in in boopis');
    act(host, 'open')?.click();
    act(host, 'copy')?.click();
    await tick();
    expect(b.calls).toEqual(['start', 'open:https://auth.openai.com/codex/device', 'copy:ABCD-1234']);
    expect(host.textContent).toContain('Copied');
    b.end({ outcome: 'signed_in', message: '' });
    expect(host.textContent).toContain('Signed in with ChatGPT.');
    expect(signedIn).toBe(1);
    expect(host.textContent).not.toContain('Hermes');
  });

  it('cancel, an expired code and a refusal each say so and offer to try again', async () => {
    const host = document.createElement('div');
    const b = fake();
    mountChatgptSignin(host, b);
    act(host, 'start')?.click();
    await tick(); await tick();
    act(host, 'cancel')?.click();
    await tick();
    expect(b.calls).toContain('cancel');
    b.end({ outcome: 'cancelled', message: 'The sign-in was cancelled.' });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('The sign-in was cancelled.');
    expect(act(host, 'start')?.textContent).toBe('Try again');
    act(host, 'start')?.click();
    await tick(); await tick();
    b.end({ outcome: 'timed_out', message: 'The code expired before the sign-in finished. Start again for a new code.' });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('code expired');
  });

  it('says why when OpenAI gives no code, and draws a sign-in already waiting at its code', async () => {
    const host = document.createElement('div');
    mountChatgptSignin(host, fake({ start: () => Promise.reject(new Error('OpenAI is limiting sign-in requests right now. Wait a minute and try again.')) }));
    act(host, 'start')?.click();
    await tick(); await tick();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Wait a minute');
    const again = document.createElement('div');
    const b = fake({ status: () => Promise.resolve({ state: 'signing_in', plan: null, code: CODE }) });
    mountChatgptSignin(again, b);
    await tick(); await tick();
    expect(again.querySelector('[data-code]')?.textContent).toBe('ABCD-1234');
    expect(b.calls, 'no new code is asked for').toEqual([]);
  });

  it('taking the card away stops listening and leaves the host’s wait running', async () => {
    const host = document.createElement('div');
    const b = fake();
    const card = mountChatgptSignin(host, b);
    act(host, 'start')?.click();
    await tick(); await tick();
    expect(b.listening()).toBe(true);
    card.destroy();
    expect(b.listening()).toBe(false);
    expect(b.calls).toEqual(['start']);
    expect(host.children).toHaveLength(0);
  });

  it('prints the page without its scheme', () => { expect(pageText('https://auth.openai.com/codex/device/')).toBe('auth.openai.com/codex/device'); });
});

/* first-run setup: the forms that carry a sign-in or a page */
const status = (over: Partial<SetupStatus>): SetupStatus => ({ steps: [], form: null, done: false, install_command: null, receipt: null, ...over });
const form = (id: string, kind: string, extra: Partial<NonNullable<SetupStatus['form']>> = {}): NonNullable<SetupStatus['form']> => ({
  form_id: id, kind, title: 'Title ' + id, body: 'Why', schema: { type: 'object', properties: {} }, submit: { label: 'Check again' }, cancel: { label: 'Choose another model' },
  sensitive: false, origin: 'host', diff: [], ...extra });
class Bridge implements SetupBridge {
  answers: unknown[] = [];
  constructor(private script: SetupStatus[]) {}
  check() { return Promise.resolve({ hermes_installed: true, needed: true, reason: 'x' }); }
  source() { return Promise.resolve(null); }
  onProgress(_cb: (p: SetupProgress) => void) { return Promise.resolve(() => undefined); }
  advance(answer: Parameters<SetupBridge['advance']>[0]) { this.answers.push(answer); return Promise.resolve(this.script.shift() ?? status({})); }
}
const ok: ConnectorLogin = { command_line: 'claude auth login --claudeai', ok: true, code: 0, timed_out: false, output: [] };

function signins(chatgpt: ChatgptBridge, login: (p: string) => Promise<ConnectorLogin> = () => Promise.resolve(ok)): SetupSignins & { opened: string[]; logins: string[] } {
  const opened: string[] = [];
  const logins: string[] = [];
  return { opened, logins, chatgpt, login: (p) => { logins.push(p); return login(p); }, open: (u) => { opened.push(u); return Promise.resolve(); } };
}

describe('first-run setup: the sign-ins and pages a form offers', () => {
  it('the ChatGPT form draws the sign-in card, and a finished sign-in runs setup again on its own', async () => {
    const chat = form('setup.chatgpt', 'setup', { title: 'Sign in with ChatGPT', signin: { provider: 'chatgpt', label: 'Sign in with ChatGPT' } });
    const bridge = new Bridge([status({ form: chat }), status({ done: true, receipt: { lines: ['ChatGPT subscription: gpt-6-luna, gpt-6-sol on your ChatGPT sign-in'] } })]);
    const b = fake();
    void runFirstRun(bridge, document.body, { autostart: true, signins: signins(b) });
    await tick(); await tick();
    const extras = document.querySelector('[data-form-extras="setup.chatgpt"]');
    expect(extras).toBeTruthy();
    act(document, 'start')?.click();
    await tick(); await tick();
    expect(document.querySelector('[data-code]')?.textContent).toBe('ABCD-1234');
    b.end({ outcome: 'signed_in', message: '' });
    await tick(); await tick();
    expect(bridge.answers.at(-1)).toEqual({ form_id: 'setup.chatgpt', cancelled: false, values: {}, secrets: {} });
    expect(document.body.textContent).toContain('You are set');
  });

  it('the Gemini key form offers its page, opened in the browser', async () => {
    const key = form('setup.credential.gemini', 'credential', { links: [['Get a free key', 'https://aistudio.google.com/apikey']] });
    const s = signins(fake());
    void runFirstRun(new Bridge([status({ form: key })]), document.body, { autostart: true, signins: s });
    await tick(); await tick();
    const link = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Get a free key');
    link?.click();
    expect(s.opened).toEqual(['https://aistudio.google.com/apikey']);
  });

  it('the Claude form runs Claude Code’s own login by its table id, then runs setup again; a failed one says so', async () => {
    const claude = form('setup.claude', 'setup', { title: 'Sign in to Claude', signin: { provider: 'claude-code', label: 'Sign in to Claude' } });
    const bridge = new Bridge([status({ form: claude }), status({ form: claude })]);
    const s = signins(fake());
    void runFirstRun(bridge, document.body, { autostart: true, signins: s });
    await tick(); await tick();
    document.querySelector<HTMLButtonElement>('[data-signin="claude-code"]')?.click();
    await tick(); await tick();
    expect(s.logins).toEqual(['claude-code']);
    expect(bridge.answers.at(-1)).toEqual({ form_id: 'setup.claude', cancelled: false, values: {}, secrets: {} });

    document.body.replaceChildren();
    const failing = signins(fake(), () => Promise.resolve({ ...ok, ok: false, code: 1, output: ['error: the browser could not be opened'] }));
    const b2 = new Bridge([status({ form: claude })]);
    void runFirstRun(b2, document.body, { autostart: true, signins: failing });
    await tick(); await tick();
    document.querySelector<HTMLButtonElement>('[data-signin="claude-code"]')?.click();
    await tick(); await tick();
    expect(document.querySelector('[data-form-extras] [role="alert"]')?.textContent).toContain('did not finish');
    expect(document.querySelector('[data-form-extras] pre')?.textContent).toContain('the browser could not be opened');
    expect(b2.answers, 'setup is not run again after a failed sign-in').toHaveLength(1);
  });
});
