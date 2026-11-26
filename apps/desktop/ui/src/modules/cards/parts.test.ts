// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { setProvider, data } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { diffWell, expiryText, namesText, originOf } from './parts';

beforeAll(() => { setProvider(createMockProvider({ simulate: false })); });
const ids = (): string[] => data().bots.snapshot().bots.map((b) => b.id);

describe('what a form reads from its data', () => {
  it('reads older data ({from}, {model}) as an origin, and a named origin as itself', () => {
    expect(originOf({ from: 'nina' })).toEqual({ kind: 'teammate', ids: ['nina'], via: null });
    expect(originOf({ from: 'nina', via: 'atlas' })).toEqual({ kind: 'teammate', ids: ['nina'], via: 'atlas' });
    expect(originOf({ model: 'sonnet 5.5' })).toEqual({ kind: 'agent', model: 'sonnet 5.5', route: 'sonnet 5.5' });
    expect(originOf({ model: 'qwen3-coder → sonnet 5.5' })).toEqual({ kind: 'agent', model: 'sonnet 5.5', route: 'qwen3-coder → sonnet 5.5' });
    expect(originOf({ origin: { kind: 'plugin' } })).toEqual({ kind: 'plugin' });
    expect(originOf({ origin: { kind: 'mod', plugin: 'test-runner' } })).toEqual({ kind: 'mod', plugin: 'test-runner' });
    expect(originOf({ origin: { kind: 'teammate', ids: ['nobody'] } })).toBeNull();
    expect(originOf({})).toBeNull();
  });
  it('says every name, for one, two and several', () => {
    const [a, b, c] = ids();
    expect(namesText([a as string, b as string])).toBe(`${a} and ${b}`);
    expect(namesText([a as string, b as string, c as string])).toBe(`${a}, ${b} and ${c}`);
  });
  it('counts down in seconds, then minutes', () => {
    expect(expiryText(45000, false)).toBe('Expires in 45 s');
    expect(expiryText(10 * 60000, true)).toBe('10 min');
    expect(expiryText(0, false)).toBe('Expires now');
  });
  it('draws a config diff line by line, each saying added or removed to a screen reader', () => {
    const h = diffWell('+ model: sonnet\n- model: haiku\n  cap: 5', 'nina.yaml');
    expect(h).toContain('data-d="add"');
    expect(h).toContain('data-d="del"');
    expect(h).toContain('added: ');
    expect(h).toContain('aria-label="Changes to nina.yaml"');
  });
});
