// @vitest-environment jsdom
/* The first run (modules/onboarding): its data (the consent's settings, the model question's rows), the setup pages against a scripted
   host (consent, a model found and used, nothing found and the free models, a sign-in that did not finish, Skip setup, Try it), the
   ledger, and the canvas's steps. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allRows, foundRows, keyMeaning, offerRows, primaryOf, settingsOf } from './model';
import { runFirstRun, percentOf } from './setup';
import { ledger, startParts, writeLedger } from './ledger';
import { AT_CONSENT, AT_MODELS, CONSENT, DECLINED, DONE, FOUND, NOT_SIGNED_IN, OLLAMA, providerStates, providersHost, ScriptedSetup, signinsFor } from '../../lab/onboarding-fixtures';
import { way } from '../../data/providers';
import { launchCanvas } from '../session/s0';
import type { LaunchView } from '../session/s0';
import type { WindowControls } from '../../host/window-controls';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await tick(100); };
const controls: WindowControls = { attach: () => () => undefined } as unknown as WindowControls;
const press = (sel: string): void => { document.querySelector<HTMLElement>(sel)?.click(); };
const title = (): string => document.querySelector('#k7-setup-title')?.textContent ?? '';
beforeEach(() => { document.body.replaceChildren(); localStorage.clear(); });
afterEach(() => { document.body.replaceChildren(); });

describe('story: the first run\'s data', () => {
  it('names the three settings in the board\'s words, each with its line', () => {
    const rows = settingsOf(CONSENT as never);
    expect(rows.map((r) => r.label)).toEqual(['Show boopis’s tools directly', 'Route governed work to each model tier', 'Let a held message continue a turn']);
    expect(rows[2]?.line).toBe('plugins.entries.boopis.allow_gateway_injection = true');
    expect(settingsOf({ body: 'x.y = 1 (so it works)' })).toEqual([{ label: 'It works', line: 'x.y = 1' }]);
  });
  it('finds what this computer has, sign-ins first; offers two plans and a free key when nothing is found', () => {
    const found = foundRows(new Map(providerStates({ ...FOUND, 'ollama.local': OLLAMA }).map((s) => [s.way, s])));
    expect(found.map((r) => [r.name, r.meaning])).toEqual([['Claude', 'Claude Code, signed in'], ['ChatGPT', 'Your ChatGPT plan, signed in'], ['Ollama', '2 models on this computer']]);
    expect(primaryOf(found[0] as never)).toBe('Use Claude');
    expect(offerRows().map((r) => r.name)).toEqual(['Sign in with Claude', 'Sign in with ChatGPT', 'Use a Gemini key']);
    expect(offerRows()[2]?.meaning).toBe('Paste a key from Google AI Studio');
    expect(allRows(new Map()).length).toBeGreaterThan(5);
    const k = way('anthropic.key');
    expect(k && keyMeaning(k.way)).toBe('Paste a key from the Anthropic console');
  });
  it('says the unpack\'s figure only from the host\'s own numbers', () => {
    expect(percentOf({ step: 'runtime', phase: 'unpack', read: 62, total: 100 } as never)).toBe('62%');
    expect(percentOf({ step: 'runtime', phase: 'unpack', read: null, total: null } as never)).toBe('');
  });
});

describe('scene: the setup pages', { timeout: 15000 }, () => {
  it('hello, then the settings: Apply answers the consent, and the model question follows', async () => {
    const host = new ScriptedSetup([AT_CONSENT, AT_MODELS, DONE]);
    void runFirstRun(host, document.body, { providers: providersHost(providerStates(FOUND)), signins: signinsFor(), windowControls: controls });
    await flush();
    expect(title()).toBe('Hi, I’m boopis');
    press('[data-setup="start"]'); await flush();
    expect(title()).toBe('Settings boopis needs');
    expect(document.querySelector('.k7-setup__skip')).toBeNull();
    press('[data-setup="apply"]'); await flush();
    expect(host.answers[1]).toEqual({ form_id: 'setup.config', cancelled: false, values: {}, secrets: {} });
    expect(title()).toBe('A model to think with');
    expect(document.querySelector('[data-fr-models] [aria-checked="true"]')?.textContent).toContain('Claude');
    press('[data-setup="use"]'); await flush();
    expect(host.answers[2]).toEqual({ form_id: 'setup.ladder', cancelled: false, values: { choice: 'claude-subscription' }, secrets: {} });
    expect(document.querySelector('.hx-first-run'), 'the app opens after the model').toBeNull();
    expect(ledger()).toEqual({ sessions: 'careful', bots: 'todo' });
  });
  it('nothing found: two plans and a key; "Use the free models" answers free', async () => {
    const host = new ScriptedSetup([AT_MODELS, DONE]);
    void runFirstRun(host, document.body, { providers: providersHost(providerStates()), signins: signinsFor(), windowControls: controls, autostart: true });
    await flush();
    expect([...document.querySelectorAll('[data-fr-models] [data-kit~="OptionRow"]')].map((r) => r.getAttribute('data-value'))).toEqual(['anthropic.signin', 'openai.signin', 'google.key']);
    press('[data-setup="free"]'); await flush();
    expect(host.answers.at(-1)).toEqual({ form_id: 'setup.ladder', cancelled: false, values: { choice: 'free' }, secrets: {} });
  });
  it('a key way asks for the key in place, and the primary waits for it', async () => {
    void runFirstRun(new ScriptedSetup([AT_MODELS]), document.body, { providers: providersHost(providerStates()), signins: signinsFor(), windowControls: controls, autostart: true });
    await flush();
    press('[data-value="google.key"]'); await flush();
    expect(document.querySelector('#hx-fr-key')).toBeTruthy();
    expect(document.querySelector<HTMLButtonElement>('[data-setup="use"]')?.disabled).toBe(true);
  });
  it('Claude Code not signed in: the line to run in a terminal, and Check again', async () => {
    void runFirstRun(new ScriptedSetup([AT_MODELS]), document.body, { providers: providersHost(providerStates()), signins: signinsFor(() => Promise.resolve(NOT_SIGNED_IN)), windowControls: controls, autostart: true });
    await flush();
    press('[data-setup="use"]'); await flush();
    expect(document.querySelector('.k7-setup__lede')?.textContent).toContain('isn’t signed in');
    expect(document.querySelector('[data-kit~="Well"]')?.textContent).toContain('claude auth login');
    expect(document.querySelector('[data-setup="recheck"]')).toBeTruthy();
  });
  it('offline: the Notice over the models, with Try again', async () => {
    void runFirstRun(new ScriptedSetup([AT_MODELS]), document.body, { providers: providersHost(providerStates(FOUND)), signins: signinsFor(), windowControls: controls, autostart: true, online: () => false });
    await flush();
    expect(document.querySelector('[data-kit~="Notice"]')?.textContent).toContain('No internet right now.');
  });
  it('Skip setup runs the host\'s steps, puts the model off and skips the Sessions part', async () => {
    const host = new ScriptedSetup([AT_MODELS, DONE]);
    void runFirstRun(host, document.body, { providers: providersHost(providerStates()), signins: signinsFor(), windowControls: controls });
    await flush();
    press('[data-setup="skip"]'); await flush();
    expect(host.answers.at(-1)).toEqual({ form_id: 'setup.ladder', cancelled: false, values: { choice: 'later' }, secrets: {} });
    expect(document.querySelector('.hx-first-run')).toBeNull();
    expect(ledger().sessions).toBe('skipped');
  });
  it('the settings declined: what will not work, and the way to review them', async () => {
    void runFirstRun(new ScriptedSetup([DECLINED]), document.body, { windowControls: controls, autostart: true });
    await flush();
    expect(document.querySelector('[data-setup="reconsider"]')).toBeTruthy();
  });
  it('Try it shows only with `drafts`, after the model, and its reading opens the question of keeping it on', async () => {
    void runFirstRun(new ScriptedSetup([AT_MODELS, DONE]), document.body, { providers: providersHost(providerStates(FOUND)), signins: signinsFor(), windowControls: controls, later: new Set(['drafts']) });
    await flush();
    press('[data-setup="start"]'); await flush();
    press('[data-setup="use"]'); await flush();
    expect(title()).toBe('One thing boopis does differently');
    expect(document.querySelector('[data-kit~="Notice"]')?.textContent).toContain('Recorded example.');
    press('[data-fr-reading] [data-kit~="MenuRow"]'); await flush();
    expect(title()).toBe('Keep reading your drafts?');
  });
});

describe('scene: the ledger and the canvas', () => {
  it('starts the parts after setup, and nothing on a computer set up before', () => {
    expect(ledger()).toEqual({ sessions: 'done', bots: 'done' });
    startParts(false); expect(ledger()).toEqual({ sessions: 'careful', bots: 'todo' });
    writeLedger({ bots: 'later' }); expect(ledger().bots).toBe('later');
  });
  const V: LaunchView = { folder: 'boopis', model: 'opus', effort: 'Default', effortTicks: 3, careful: 'auto_edits', fellBack: false, worktree: true, waiting: [] };
  it('asks how careful with the four steps and the recommended one, and says the pick', () => {
    const seen: string[] = [];
    const c = launchCanvas({ ...V, firstRun: { step: 'careful' } }, { folder: () => undefined, model: () => undefined, effort: () => undefined, careful: () => undefined, firstRun: (w, v) => { seen.push(w + ':' + v); } });
    expect(c.querySelector('.ss-new__h')?.textContent).toBe('How careful should sessions be?');
    expect(c.querySelectorAll('[data-first-careful]').length).toBe(4);
    expect(c.querySelector('[aria-checked="true"]')?.textContent).toContain('recommended');
    c.querySelector<HTMLElement>('[data-first-careful="supervised"]')?.click();
    c.querySelector<HTMLElement>('[data-first="careful"]')?.click();
    expect(seen).toEqual(['pick:supervised', 'careful:auto_edits']);
  });
  it('"You\'re set" keeps the launch row and offers three ways to start; the hand-off counts down with Later', () => {
    const r = launchCanvas({ ...V, firstRun: { step: 'ready' } }, { folder: () => undefined, model: () => undefined, effort: () => undefined, careful: () => undefined });
    expect(r.querySelectorAll('[data-first="suggest"]').length).toBe(3);
    expect(r.querySelector('[data-launch="careful"]')).toBeTruthy();
    const h = launchCanvas({ ...V, firstRun: { step: 'handoff', count: 3 } }, { folder: () => undefined, model: () => undefined, effort: () => undefined, careful: () => undefined });
    expect(h.textContent).toContain('Opening Bots in 3 s');
    expect(h.querySelector('[data-first="later"]')).toBeTruthy();
  });
});
