import { describe, expect, it } from 'vitest';
import { connectedList, continueLabel, LATER_LINE, phaseOf, PHASES, progressText, startChoices, summaryOf } from './first-run-model';
import type { ModelsView, ProviderState } from './bindings';
import type { SetupStatus } from './setup-bridge';

const st = (way: string, status: ProviderState['status'], extra: Partial<ProviderState> = {}): ProviderState =>
  ({ provider: way.split('.')[0] ?? way, way, kind: 'key', status, code: null, detail: null, plan: null, models_count: null, base_url: null, signin: null, checked_at: null, ...extra });
const step = (id: string, state: SetupStatus['steps'][number]['state']) => ({ id, title: id, state, detail: '', code: null });
const status = (over: Partial<SetupStatus>): SetupStatus => ({ steps: [], form: null, done: false, install_command: null, receipt: null, ...over });
const form = (id: string) => ({ form_id: id, kind: 'choice', title: 't', body: '', schema: {}, submit: {}, cancel: {}, sensitive: false, origin: 'host', diff: [] }) as never;
const OFFERED = ['free', 'connected', 'later', 'anthropic', 'claude-subscription', 'chatgpt-subscription', 'openai-key', 'gemini', 'xai', 'xai-subscription'];

describe('the steps', () => {
  it('lists six steps in order and says where the person is', () => {
    expect(PHASES.map((p) => p.id)).toEqual(['welcome', 'engine', 'settings', 'models', 'extras', 'ready']);
    expect(progressText('models')).toBe('Step 4 of 6: Models');
  });
  it('reads the phase from the form that is open, else the first step that is not done', () => {
    expect(phaseOf(null)).toBe('welcome');
    expect(phaseOf(status({ steps: [step('runtime', 'pending')] }))).toBe('engine');
    expect(phaseOf(status({ steps: [step('runtime', 'done'), step('config', 'needs_input')], form: form('setup.config') }))).toBe('settings');
    expect(phaseOf(status({ steps: [step('runtime', 'done'), step('models', 'needs_input')], form: form('setup.ladder') }))).toBe('models');
    expect(phaseOf(status({ steps: [step('runtime', 'done'), step('config', 'blocked')] }))).toBe('settings');
    expect(phaseOf(status({ steps: [step('runtime', 'done')], done: true }))).toBe('models');
  });
});

describe('what is connected', () => {
  it('lists connected ways with the host\'s own choice for each, and leaves a way the host has no route for with none', () => {
    const states = new Map([
      ['openai.signin', st('openai.signin', 'connected', { kind: 'signin', plan: 'ChatGPT Plus' })],
      ['google.key', st('google.key', 'connected')],
      ['deepseek.key', st('deepseek.key', 'connected')],
      ['xai.key', st('xai.key', 'needs_key')],
      ['ollama.local', st('ollama.local', 'found_local', { kind: 'local' })],
      ['custom.lab', st('custom.lab', 'connected', { kind: 'custom' })]
    ]);
    const list = connectedList(states, OFFERED);
    expect(list.map((c) => [c.way, c.choice])).toEqual([
      ['openai.signin', 'chatgpt-subscription'], ['google.key', 'gemini'], ['deepseek.key', null], ['custom.lab', null]
    ]);
    expect(list[0]?.plan).toBe('ChatGPT Plus');
    expect(list[3]?.lab).toBe('Your own endpoint');
  });
  it('offers a starting model once per choice, only where the host has a route', () => {
    const states = new Map([['openai.signin', st('openai.signin', 'connected')], ['openai.key', st('openai.key', 'connected')], ['deepseek.key', st('deepseek.key', 'connected')]]);
    const starts = startChoices(connectedList(states, OFFERED));
    expect(starts.map((c) => c.choice)).toEqual(['chatgpt-subscription', 'openai-key']);
  });
  it('words the primary button by how many are connected, and never claims one when none is', () => {
    expect([0, 1, 3].map(continueLabel)).toEqual(['Continue', 'Continue with 1 connected', 'Continue with 3 connected']);
  });
});

describe('the summary', () => {
  const view = (tiers: Array<{ name: string; model: string }>, available = true, why: string | null = null): ModelsView => ({ state: tiers.length ? 'set' : 'default', tiers, governed: { available, why, allowed: [], heavy: [], sentence: '', tiers: [] }, heavy: [] } as never);
  it('says the free models when nothing is connected or the ladder is the free tier', () => {
    expect(summaryOf(null, [], false).later).toBe(true);
    const free = summaryOf(view([{ name: 'free', model: 'nous/nous/welcome' }]), [], true);
    expect(free.startsWith).toEqual({ free: true, model: null, tier: null });
    expect(free.ladder).toEqual([]);
    expect(LATER_LINE).toContain('Settings, Models');
  });
  it('starts with the first tier of the ladder the host wrote, and shows the whole ladder and whether governed mode can run', () => {
    const tiers = [{ name: 'sol', model: 'openai-codex/gpt-6.2-sol' }, { name: 'astra', model: 'openai-codex/gpt-6.2-astra' }];
    const s = summaryOf(view(tiers), connectedList(new Map([['openai.signin', st('openai.signin', 'connected')]]), OFFERED), false);
    expect(s.startsWith).toEqual({ free: false, model: 'openai-codex/gpt-6.2-sol', tier: 'sol' });
    expect(s.ladder).toEqual(tiers);
    expect(s.governed.available).toBe(true);
    expect(s.later).toBe(false);
    const none = summaryOf(view([{ name: 'free', model: 'nous/x' }], false, 'Needs a frontier model.'), [], false);
    expect(none.governed).toEqual({ available: false, why: 'Needs a frontier model.' });
  });
});
