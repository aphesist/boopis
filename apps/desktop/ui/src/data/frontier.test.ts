import { describe, expect, it } from 'vitest';
import file from '../../../../shared/data/frontier-models.json';
import providers from '../../../../shared/data/providers.json';
import { isFrontier, isHeavy, normalise } from './frontier';

interface Example { provider: string; model: string; frontier: boolean; heavy?: boolean }
const EXAMPLES = (file as unknown as { examples: Example[] }).examples;

describe('the frontier list, read in the UI (the same file and examples as the plugin and the host)', () => {
  it.each(EXAMPLES.map((e) => [`${e.provider}/${e.model}`, e] as const))('%s', (_n, e) => {
    expect(isFrontier(e.provider, e.model)).toBe(e.frontier);
    expect(isHeavy(e.provider, e.model)).toBe(e.heavy ?? false);
  });
  it('normalises like the plugin', () => {
    expect(normalise('OpenRouter/Anthropic/Claude-Opus-5.5')).toEqual(['claude', 'opus', '5', '5']);
    expect(normalise('claude-opus-5-5[1m]')).toEqual(['claude', 'opus', '5', '5']);
  });
  it('Fable, Carbon and Grok are heavy, and only a frontier model of a heavy family is', () => {
    expect(isHeavy('gemini', 'gemini-4-carbon')).toBe(true);
    expect(isHeavy('gemini', 'models/gemini-5-carbon-high')).toBe(true);
    expect(isHeavy('gemini', 'gemini-4-neon')).toBe(false); // the owner: Neon is less costly than Opus, so it is not heavy
    expect(isHeavy('gemini', 'gemini-4-hydrogen')).toBe(false);
    expect(isHeavy('gemini', 'gemini-3-carbon')).toBe(false); // below its floor
    expect(isHeavy('claude-subscription-directsdk-experimental', 'fable')).toBe(true);
    expect(isHeavy('anthropic', 'claude-fable-5-2[1m]')).toBe(true);
    expect(isHeavy('xai', 'grok-4.7')).toBe(true);
    expect(isHeavy('xai', 'grok-4.6')).toBe(false);
    expect(isHeavy('anthropic', 'claude-opus-5-5')).toBe(false);
    expect(isHeavy('openai-codex', 'gpt-6.2-sol')).toBe(false);
    expect(isHeavy('anthropic', 'fable')).toBe(false); // the alias is the subscription's only
  });

  describe('custom endpoints and runtimes on this computer are never frontier (ADR-0039), judged before the name', () => {
    const never = (providers as unknown as { never_frontier: { examples: Example[] } }).never_frontier.examples;
    it.each(never.map((e) => [`${e.provider}/${e.model}`, e] as const))('the rule\'s own example %s', (_n, e) => {
      expect(isFrontier(e.provider, e.model)).toBe(e.frontier);
      if (!e.frontier) expect(isHeavy(e.provider, e.model)).toBe(false);
    });
    it('refuses every frontier example of the list when it is asked of a custom or local provider', () => {
      const providersNever = ['custom', 'custom-x', 'custom-my-server', 'ollama', 'lmstudio', 'llamacpp', 'llama-cpp', 'vllm', 'Custom-Mine', ' ollama '];
      for (const e of EXAMPLES) for (const p of providersNever) {
        expect(isFrontier(p, e.model), `${p}/${e.model}`).toBe(false);
        expect(isHeavy(p, e.model), `${p}/${e.model}`).toBe(false);
      }
    });
    it('leaves a hand-written provider to the name, and a name that only starts like the prefix', () => {
      expect(isFrontier('my-gateway', 'claude-opus-5-5')).toBe(true);
      expect(isFrontier('customer-api', 'claude-opus-5-5')).toBe(true);
    });
  });
});
