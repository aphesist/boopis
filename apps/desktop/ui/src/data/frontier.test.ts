import { describe, expect, it } from 'vitest';
import file from '../../../../shared/data/frontier-models.json';
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
  it('Fable and Grok are heavy, and only a frontier model of a heavy family is', () => {
    expect(isHeavy('claude-subscription-directsdk-experimental', 'fable')).toBe(true);
    expect(isHeavy('anthropic', 'claude-fable-5-2[1m]')).toBe(true);
    expect(isHeavy('xai', 'grok-4.7')).toBe(true);
    expect(isHeavy('xai', 'grok-4.6')).toBe(false);
    expect(isHeavy('anthropic', 'claude-opus-5-5')).toBe(false);
    expect(isHeavy('openai-codex', 'gpt-6.2-sol')).toBe(false);
    expect(isHeavy('anthropic', 'fable')).toBe(false); // the alias is the subscription's only
  });
});
