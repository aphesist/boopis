/* The Claude subscription's card in every state the host reports (ADR-0029, amended 22 November 2026): the first run's plate and
   the row of Settings > Models > Providers. Not installed is calm, with Anthropic's installer for the person's system, where to
   paste it, Copy and the guide; "failed" is only for a Claude Code that was found and did not start; an old version and a login
   that bills the API are steps to take, not failures. */
import { beforeEach, describe, expect, it } from 'vitest';
import { entries } from '../data/providers';
import { plateHtml } from './providers-hub';
import { actionsFor, failed, mountProviders, statusWord } from './providers-view';
import type { Row } from './providers-view';
import type { ProviderState, ProvidersBridge } from './providers-bridge';
import type { InstallHint } from './bindings';

const entry = entries().find((e) => e.id === 'anthropic');
const way = entry?.ways.find((w) => w.id === 'anthropic.signin');
if (!entry || !way) throw new Error('the catalogue has the Claude subscription');

const WINDOWS: InstallHint = { kind: 'install', command: 'irm https://claude.ai/install.ps1 | iex', shell: 'PowerShell', page: 'https://code.claude.com/docs/en/setup' };
const UPDATE: InstallHint = { kind: 'update', command: 'claude update', shell: 'a terminal', page: 'https://code.claude.com/docs/en/setup#update-claude-code' };
const claude = (status: ProviderState['status'], extra: Partial<ProviderState> = {}): ProviderState => ({
  provider: 'anthropic', way: 'anthropic.signin', kind: 'signin', status, code: null, detail: null, plan: null, models_count: null, base_url: null, signin: null, checked_at: 1, install: null, ...extra
});
const STATES = {
  missing: claude('needs_install', { detail: 'Claude Code, Anthropic\'s command-line tool, is not installed yet. boopis runs your Claude plan through it: install it, then choose Check again.', install: WINDOWS }),
  desktop: claude('needs_install', { detail: 'The Claude desktop app is here, but its Claude Code works only inside the app. boopis needs the Claude Code command-line tool, which is separate: install it, then choose Check again.', install: WINDOWS }),
  broken: claude('error', { code: 'hx.provider.cli_failed', detail: 'Claude Code is installed (C:\\Users\\ana\\AppData\\Roaming\\npm\\claude.cmd), but the system could not start it. Install it again with Anthropic\'s installer, then choose Check again.', install: WINDOWS }),
  old: claude('error', { code: 'hx.provider.needs_update', detail: 'Claude Code 2.1.200 is older than the oldest one that serves a Claude model here (2.1.280). Update it with `claude update`, then choose Check again.', install: UPDATE }),
  metered: claude('error', { code: 'hx.provider.metered', detail: 'Claude Code 2.1.328 is signed in with an Anthropic API key, which bills API usage instead of your Claude subscription.' }),
  out: claude('signed_out'),
  in: claude('connected', { plan: 'Claude Max' })
};
const plate = (s: ProviderState): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = plateHtml({ entry, way, state: s } as Row, () => true);
  return host.firstElementChild as HTMLElement;
};
const does = (el: HTMLElement): string[] => [...el.querySelectorAll<HTMLElement>('[data-do]')].map((b) => b.dataset['do'] ?? '');
const word = (el: HTMLElement): string => el.querySelector('.fr-st')?.textContent ?? '';

describe('the first run\'s Claude plate', () => {
  it('not installed is calm: a word, Anthropic\'s installer for PowerShell, Copy, the guide and Check again, never red', () => {
    const p = plate(STATES.missing);
    expect(p.dataset['state']).toBe('off');
    expect(word(p)).toBe('not installed');
    expect(p.querySelector('[data-tone="red"]')).toBeNull();
    const line = p.querySelector('[data-install]') as HTMLElement;
    expect(line.textContent).toBe('In PowerShell: irm https://claude.ai/install.ps1 | iex');
    expect(line.querySelector('code.ui-code')?.textContent).toBe('irm https://claude.ai/install.ps1 | iex');
    expect(does(p)).toEqual(['copy', 'guide', 'recheck']);
    expect(p.textContent).not.toContain('npm');
    expect(p.textContent).not.toContain('failed');
  });
  it('says plainly when only the desktop app\'s own Claude Code is here', () => {
    expect(plate(STATES.desktop).querySelector('[data-note]')?.textContent).toContain('command-line tool, which is separate');
  });
  it('a Claude Code that does not start is the one failure, in plain words, with the installer to put it back', () => {
    const p = plate(STATES.broken);
    expect(p.dataset['state']).toBe('failed');
    expect(word(p)).toBe('failed');
    expect(p.querySelector('.fr-st')?.getAttribute('data-tone')).toBe('red');
    expect(p.querySelector('[data-note]')?.textContent).toContain('could not start it');
    expect(does(p)).toEqual(['copy', 'guide', 'recheck']);
  });
  it('an old version is a step, not a failure: update needed, `claude update` as code, the update guide', () => {
    const p = plate(STATES.old);
    expect([p.dataset['state'], word(p)]).toEqual(['off', 'update needed']);
    expect(p.querySelector('[data-note]')?.innerHTML).toContain('<code class="ui-code">claude update</code>');
    expect(p.querySelector('[data-note]')?.textContent).not.toContain('`');
    expect(p.querySelector('[data-do="guide"]')?.textContent).toBe('Update guide');
  });
  it('a login that bills the API offers Claude\'s own sign-in, calmly', () => {
    const p = plate(STATES.metered);
    expect([p.dataset['state'], word(p)]).toEqual(['off', 'not your plan']);
    expect(does(p)).toEqual(['signin', 'recheck']);
  });
  it('signed out offers the branded sign-in, and signed in shows the plan', () => {
    expect(does(plate(STATES.out))).toEqual(['signin', 'recheck']);
    const yes = plate(STATES.in);
    expect([yes.dataset['state'], word(yes)]).toEqual(['connected', 'connected']);
    expect(yes.textContent).toContain('Claude Max');
  });
});

describe('the Settings row of the Claude subscription', () => {
  it('names each state in words and only a real failure as one', () => {
    expect(statusWord(STATES.missing)).toBe('Not installed');
    expect(statusWord(STATES.broken)).toBe('Did not start');
    expect(statusWord(STATES.old)).toBe('Needs an update');
    expect(failed(STATES.broken)).toBe(true);
    for (const s of [STATES.missing, STATES.old, STATES.metered, STATES.out]) expect(failed(s)).toBe(false);
    expect(actionsFor(way, STATES.missing, true).map((a) => a.label)).toEqual(['Copy command', 'Install guide', 'Check again']);
  });

  beforeEach(() => { document.body.replaceChildren(); });
  const bridge = (list: ProviderState[]): ProvidersBridge => ({
    list: () => Promise.resolve(list), probe: () => Promise.resolve([]), setKey: () => Promise.reject(new Error('no')), remove: () => Promise.reject(new Error('no')),
    signOut: () => Promise.reject(new Error('no')), signinStart: () => Promise.reject(new Error('no')), signinCancel: () => Promise.resolve(), onSigninEnd: () => Promise.resolve(() => undefined),
    testEndpoint: () => Promise.reject(new Error('no')), addEndpoint: () => Promise.reject(new Error('no')), useLocal: () => Promise.reject(new Error('no'))
  });
  it('shows the command under the row; Copy puts it on the clipboard and says where to paste it; the guide opens Anthropic\'s page', async () => {
    const el = document.createElement('section');
    document.body.append(el);
    const copied: string[] = [];
    const opened: string[] = [];
    const toasts: string[] = [];
    const view = mountProviders(el, {
      bridge: bridge([STATES.missing]), toast: (t) => { toasts.push(t); },
      copy: (t) => { copied.push(t); return Promise.resolve(); }, open: (u) => { opened.push(u); return Promise.resolve(); }
    });
    await view.ready;
    expect(el.querySelector('[data-install]')?.textContent).toBe('In PowerShell: irm https://claude.ai/install.ps1 | iex');
    el.querySelector<HTMLButtonElement>('[data-do="copy"][data-way="anthropic.signin"]')?.click();
    await Promise.resolve(); await Promise.resolve();
    expect(copied).toEqual(['irm https://claude.ai/install.ps1 | iex']);
    expect(toasts).toEqual(['Copied. Paste it into PowerShell and run it, then choose Check again.']);
    el.querySelector<HTMLButtonElement>('[data-do="guide"][data-way="anthropic.signin"]')?.click();
    expect(opened).toEqual(['https://code.claude.com/docs/en/setup']);
  });
  it('shows a command in the host\'s words as code, not as raw backticks', async () => {
    const el = document.createElement('section');
    document.body.append(el);
    const view = mountProviders(el, { bridge: bridge([STATES.old]), toast: () => undefined });
    await view.ready;
    const hint = el.querySelector('.ui-set__label small');
    expect(hint?.innerHTML).toContain('<code class="ui-code">claude update</code>');
    expect(hint?.textContent).not.toContain('`');
  });
  it('Sign in runs Claude Code\'s own sign-in, keeps the button off while it is open, and reads the state again after', async () => {
    const el = document.createElement('section');
    document.body.append(el);
    const ran: string[] = [];
    const toasts: string[] = [];
    let finish: (ok: boolean) => void = () => undefined;
    let reads = 0;
    const b = bridge([STATES.out]);
    const view = mountProviders(el, {
      bridge: { ...b, list: () => { reads += 1; return b.list(); } }, toast: (t) => { toasts.push(t); },
      login: (id) => { ran.push(id); return new Promise((ok) => { finish = (o) => { ok({ command_line: 'claude auth login --claudeai', ok: o, code: o ? 0 : 1, timed_out: false, output: [] }); }; }); }
    });
    await view.ready;
    const btn = el.querySelector<HTMLButtonElement>('[data-do="signin"][data-way="anthropic.signin"]');
    btn?.click();
    expect(ran).toEqual(['claude-code']);
    expect(btn?.disabled).toBe(true);
    expect(toasts).toEqual(['Finish signing in to Claude in your browser.']);
    const before = reads;
    finish(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(toasts.at(-1)).toBe('The Claude sign-in did not finish. Choose Sign in to try again.');
    expect(reads).toBe(before + 1);
  });
});
