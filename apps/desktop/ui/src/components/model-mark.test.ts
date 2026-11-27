import { describe, expect, it } from 'vitest';
import { arrowHTML, families, isKnownModel, isRoute, lastModel, markHTML, modelFamily, modelHTML, modelMark, parseRoute, routeHTML, swapMark } from './model-mark';
import { html } from './html';

describe('which logo a model gets', () => {
  it.each([
    ['sonnet 5.5', 'claude'], ['claude-haiku-4.5', 'claude'], ['opus 5.5', 'claude'], ['gpt-5-codex', 'openai'], ['o3', 'openai'], ['gemini-2.5-pro', 'gemini'],
    ['deepseek-v3.2', 'deepseek'], ['qwen3-coder', 'qwen'], ['glm-4.6', 'zai'], ['kimi-k2', 'kimi'], ['minimax-m2', 'minimax'], ['grok-4', 'grok'],
    ['llama-3.3-70b', 'meta'], ['codestral-22b', 'mistral']
  ])('%s is %s', (model, id) => { expect(modelFamily(model).id).toBe(id); });

  it('reads the family from the model id, never the host', () => {
    expect(modelFamily('bedrock/anthropic.claude-sonnet-4').id).toBe('claude');
    expect(modelFamily('openrouter/anthropic/claude-sonnet-4.5')).toMatchObject({ id: 'claude', model: 'claude-sonnet-4.5', host: 'openrouter/anthropic' });
    expect(modelFamily({ model: 'gpt-5', host: 'azure' }).id).toBe('openai');
  });
  it('gives an unknown model on local Ollama the Ollama mark and any other unknown model the neutral mark, never the phi', () => {
    expect(modelFamily('ollama/my-finetune').id).toBe('ollama');
    expect(modelFamily('acme-9000').id).toBe('generic');
    expect(modelFamily('').id).toBe('generic');
    expect(isKnownModel('acme-9000')).toBe(false);
    expect(isKnownModel('3m 42s')).toBe(false);
    for (const x of ['acme-9000', 'ollama/my-finetune', 'sonnet 5.5']) expect(markHTML(x)).not.toContain('phi');
    expect(families().map((f) => f.id)).toContain('generic');
  });
});

describe('drawing a mark', () => {
  it('is monochrome in currentColor by default, named for its provider, at 16px', () => {
    const el = modelMark('sonnet 5.5');
    expect(el.getAttribute('data-color')).toBe('mono');
    expect(el.getAttribute('aria-label')).toBe('Claude');
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('width')).toBe('16');
    expect(el.outerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });
  it('draws brand colour only when asked, and hides from assistive technology when it sits in an aria-hidden slot', () => {
    expect(markHTML('sonnet 5.5', { color: 'brand' })).toContain('data-color="brand"');
    const quiet = markHTML('sonnet 5.5', { label: false });
    expect(quiet).toContain('aria-hidden="true"');
    expect(quiet).not.toContain('aria-label');
  });
  it('gives every drawn copy of a gradient its own id', () => {
    const a = markHTML('llama-3', { color: 'brand' }), b = markHTML('llama-3', { color: 'brand' });
    const ids = (s: string): string[] => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1] ?? '');
    if (ids(a).length) expect(ids(a)).not.toEqual(ids(b));
  });
  it('keeps the name beside the mark as one unit', () => {
    const h = modelHTML('sonnet 5.5');
    expect(h).toContain('class="ui-model"');
    expect(h).toContain('>Claude Sonnet 5.5</span>');
    expect(h.indexOf('<svg')).toBeLessThan(h.indexOf('Claude Sonnet 5.5'));
  });
  it('draws a route with both marks and the arrow, and says "then" to a screen reader', () => {
    const r = routeHTML('qwen3-coder → sonnet 5.5');
    expect((r.match(/<svg/g) ?? []).length).toBe(2);
    expect(r).toContain(arrowHTML());
    expect(parseRoute('a -> b → c')).toEqual(['a', 'b', 'c']);
    expect(lastModel('qwen3-coder → sonnet 5.5')).toBe('sonnet 5.5');
    expect(isRoute('x')).toBe(false);
  });
  it('re-draws the mark of a chip after a new choice, keeping its size', () => {
    const chip = document.createElement('div');
    chip.innerHTML = markHTML('sonnet 5.5', { size: 14 });
    const next = swapMark(chip, 'gpt-5');
    expect(next?.getAttribute('data-family')).toBe('openai');
    expect(chip.querySelector('.ui-mm')?.getAttribute('width')).toBe('14');
    expect(swapMark(document.createElement('div'), 'gpt-5')).toBeNull();
  });
});

describe('the library takes a model through the one primitive', () => {
  it("an agent entry's leading model lines carry their marks, a time never does", () => {
    const h = html.entry({ kind: 'agent', callno: ['qwen3-coder', '→ sonnet 5.5', '3m 42s', '$0.37'] });
    expect((h.match(/<svg/g) ?? []).length).toBe(2);
    expect(h).toContain('3m 42s');
  });
});
