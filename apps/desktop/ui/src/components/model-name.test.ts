import { describe, expect, it } from 'vitest';
import { aliasOf, modelName, providerName, sameModel, splitRef } from './model-name';

describe('modelName', () => {
  const cases: Array<[string, string]> = [
    ['claude-subscription-directsdk-experimental/haiku', 'Claude Haiku'],
    ['sonnet', 'Claude Sonnet'],
    ['opus', 'Claude Opus'],
    ['claude-sonnet-5-5[1m]', 'Claude Sonnet 5.5'],
    ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5'],
    ['claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet'],
    ['anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5'],
    ['sonnet 5.5', 'Claude Sonnet 5.5'],
    ['gpt-6-luna', 'GPT-6 Luna'],
    ['gpt-5.1-codex-mini', 'GPT-5.1 Codex Mini'],
    ['gpt-4o-mini', 'GPT-4o Mini'],
    ['gpt-5', 'GPT-5'],
    ['o3', 'o3'],
    ['o4-mini', 'o4-mini'],
    ['gemini-3.8-flash', 'Gemini 3.8 Flash'],
    ['gemini-2.5-pro-preview-06-05', 'Gemini 2.5 Pro Preview'],
    ['meta-llama/llama-3.3-70b-instruct', 'Llama 3.3 70B'],
    ['qwen3-coder', 'Qwen3 Coder'],
    ['qwen3-coder-480b-a35b-instruct', 'Qwen3 Coder 480B'],
    ['deepseek-v3.2', 'DeepSeek V3.2'],
    ['deepseek-r1', 'DeepSeek R1'],
    ['mistral-large-latest', 'Mistral Large'],
    ['mistral-small-3.1-24b-instruct-2503', 'Mistral Small 3.1 24B'],
    ['kimi-k2-0905', 'Kimi K2'],
    ['glm-4.6', 'GLM-4.6'],
    ['grok-4-fast', 'Grok 4 Fast'],
    ['minimax-m2', 'MiniMax M2'],
    ['llama3:8b', 'Llama3 8B'],
    ['some-model:free', 'Some Model'],
    ['fake-a', 'Fake A']
  ];
  it.each(cases)('%s -> %s', (id, name) => { expect(modelName(id)).toBe(name); });
  it('never shows the host path', () => { expect(modelName('openrouter/vendor/deepseek-chat')).toBe('DeepSeek Chat'); expect(modelName('a/b/c')).not.toContain('/'); });
  it('reads an object ref and an empty one', () => { expect(modelName({ model: 'gpt-5', host: 'openai' })).toBe('GPT-5'); expect(modelName('')).toBe(''); expect(modelName(null)).toBe(''); });
});
describe('providerName', () => {
  it('uses the table, then the engine name, then the slug', () => {
    expect(providerName('claude-subscription-directsdk-experimental', 'Claude Subscription DirectSDK (Experimental)')).toBe('Claude subscription');
    expect(providerName('acme', 'Acme Cloud')).toBe('Acme Cloud');
    expect(providerName('custom:my-box')).toBe('My Box');
  });
});
describe('same model', () => {
  it('folds an alias and the id it points at', () => {
    expect(sameModel('haiku', 'claude-haiku-5-5[1m]')).toBe(true);
    expect(sameModel('p/haiku', 'q/haiku')).toBe(false);
    expect(sameModel('haiku', 'sonnet')).toBe(false);
    expect(aliasOf('claude-opus-5-5[1m]')).toBe('opus');
    expect(aliasOf('gpt-5')).toBeNull();
    expect(splitRef('a/b').host).toBe('a');
  });
});
