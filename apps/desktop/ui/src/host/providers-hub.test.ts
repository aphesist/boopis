import { describe, expect, it } from 'vitest';
import { moreNames } from './providers-hub';
import type { Row } from './providers-view';

const row = (entry: string, label: string, way: string, wayLabel: string): Row => ({ entry: { id: entry, label }, way: { id: way, label: wayLabel }, state: null }) as unknown as Row;

describe('the "More providers" tile', () => {
  const kimi = row('moonshot', 'Moonshot (Kimi)', 'moonshot.key', 'Kimi API key');
  const minimax = row('minimax', 'MiniMax', 'minimax.key', 'MiniMax API key');
  it('names labs that are not already on the wall, not a shown lab\'s regional key', () => {
    const tail = [row('moonshot', 'Moonshot (Kimi)', 'moonshot-cn.key', 'Kimi (China)'), row('minimax', 'MiniMax', 'minimax-cn.key', 'MiniMax (China)'), row('meta', 'Meta (Muse)', 'meta.key', 'Muse API key'), row('qwen', 'Qwen', 'qwen.key', 'Qwen API key')];
    expect(moreNames(tail, [kimi, minimax])).toBe('Meta (Muse), Qwen');
  });
  it('falls back to the regional ways by their own names when the tail holds nothing else', () => {
    const tail = [row('moonshot', 'Moonshot (Kimi)', 'moonshot-cn.key', 'Kimi (China)'), row('minimax', 'MiniMax', 'minimax-cn.key', 'MiniMax (China)')];
    expect(moreNames(tail, [kimi, minimax])).toBe('Kimi (China), MiniMax (China)');
  });
  it('names three at most, each once', () => {
    const tail = ['a', 'b', 'c', 'd'].map((x) => row(x, x.toUpperCase(), x + '.key', x)).concat([row('a', 'A', 'a2.key', 'a2')]);
    expect(moreNames(tail, [])).toBe('A, B, C');
  });
});
