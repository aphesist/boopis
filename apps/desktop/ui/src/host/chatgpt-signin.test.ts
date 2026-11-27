// @vitest-environment jsdom
/* The ChatGPT sign-in card (on OpenAI's Sign in with ChatGPT program) and the sign-ins setup's forms offer (ADR-0030), against
   fakes of the host. The card's own behaviour is `signin-card.test.ts`; here are ChatGPT's words and its bridge. */
import { beforeEach, describe, expect, it } from 'vitest';
import { mountChatgptSignin, pageText } from './chatgpt-signin';
import type { ChatgptBridge, ChatgptSigninEvent, ChatgptStatus } from './chatgpt-signin';
import { runFirstRun } from '../modules/onboarding/setup';
import type { SetupSignins } from '../modules/onboarding/setup';
import type { SetupBridge, SetupProgress, SetupStatus } from './setup-bridge';
import type { ConnectorLogin } from './bindings';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/* the program's sign-in has a page and nothing to type */
const PAGE = { verification_url: 'https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&state=s', user_code: '', expires_at: Date.now() + 15 * 60000 };
const OUT: ChatgptStatus = { state: 'signed_out', plan: null, code: null, account: null, notice: null };

function fake(over: Partial<ChatgptBridge> = {}): ChatgptBridge & { calls: string[]; end: (e: ChatgptSigninEvent) => void; listening: () => boolean } {
  let listener: ((e: ChatgptSigninEvent) => void) | null = null;
  const calls: string[] = [];
  return {
    calls,
    end: (e) => { listener?.(e); },
    listening: () => listener !== null,
    status: (): Promise<ChatgptStatus> => Promise.resolve(OUT),
    start: () => { calls.push('start'); return Promise.resolve(PAGE); },
    cancel: () => { calls.push('cancel'); return Promise.resolve(); },
    signOut: () => { calls.push('signout'); return Promise.resolve({ revoked: true }); },
    onEnd: (cb) => { listener = cb; return Promise.resolve(() => { listener = null; }); },
    open: (url) => { calls.push('open:' + url); return Promise.resolve(); },
    copy: (t) => { calls.push('copy:' + t); return Promise.resolve(); },
    ...over
  };
}
const act = (root: ParentNode, name: string): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>(`[data-act="${name}"]`);

beforeEach(() => { document.body.replaceChildren(); });

describe('the ChatGPT sign-in card', () => {
  it('opens OpenAI’s page for the program\u2019s sign-in, shows no code to type, and says it is signed in', async () => {
    const host = document.createElement('div');
    const b = fake();
    let signedIn = 0;
    mountChatgptSignin(host, b, { label: 'Sign in with ChatGPT', onSignedIn: () => { signedIn += 1; } });
    expect(act(host, 'start')?.querySelector('.ui-sso__label')?.textContent, 'the lab\u2019s own button, with its own words').toBe('Sign in with ChatGPT');
    act(host, 'start')?.click();
    await tick(); await tick();
    expect(host.querySelector('[data-code]'), 'the page does everything: nothing to type').toBeNull();
    expect(host.querySelector('[data-act="copy"]')).toBeNull();
    expect(host.querySelector('[data-page]')?.textContent).toBe('auth.openai.com/api/accounts/authorize');
    expect(host.textContent).toContain('allow boopis to use your ChatGPT plan');
    expect(host.textContent).toContain('Waiting for you to finish signing in');
    expect(host.textContent).toContain('auth.openai.com');
    act(host, 'open')?.click();
    await tick();
    expect(b.calls).toEqual(['start', 'open:' + PAGE.verification_url]);
    b.end({ outcome: 'signed_in', message: '' });
    expect(host.textContent).toContain('Signed in with ChatGPT.');
    expect(signedIn).toBe(1);
    expect(host.textContent).not.toContain('Hermes');
  });

  it('draws a sign-in already waiting at its page without opening another', async () => {
    const again = document.createElement('div');
    const b = fake({ status: () => Promise.resolve({ ...OUT, state: 'signing_in', code: PAGE }) });
    mountChatgptSignin(again, b);
    await tick(); await tick();
    expect(again.querySelector('[data-page]')?.textContent).toBe('auth.openai.com/api/accounts/authorize');
    expect(b.calls, 'no new sign-in is started').toEqual([]);
  });

  it('prints the page without its scheme, query or trailing slash', () => {
    expect(pageText('https://auth.openai.com/codex/device/')).toBe('auth.openai.com/codex/device');
    expect(pageText('https://auth.openai.com/api/accounts/authorize?client_id=x#y')).toBe('auth.openai.com/api/accounts/authorize');
  });
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
    expect(document.querySelector('[data-page]')?.textContent).toBe('auth.openai.com/api/accounts/authorize');
    b.end({ outcome: 'signed_in', message: '' });
    await tick(); await tick();
    expect(bridge.answers.at(-1)).toEqual({ form_id: 'setup.chatgpt', cancelled: false, values: {}, secrets: {} });
    expect(document.querySelector('.hx-first-run'), 'setup is over: the page leaves').toBeNull();
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
