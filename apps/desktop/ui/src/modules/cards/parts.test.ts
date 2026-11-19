// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { setProvider, data } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { accentOf, byline, expiryText, mini, namesText, originOf, originText, originVisual } from './parts';
import type { Ctx } from './types';

beforeAll(() => { setProvider(createMockProvider({ simulate: false })); });
const ids = (): string[] => data().bots.snapshot().bots.map((b) => b.id);

describe('the origin slot', () => {
  it('reads older data ({from}, {model}) as an origin, and a named origin as itself', () => {
    expect(originOf({ from: 'nina' })).toEqual({ kind: 'teammate', ids: ['nina'], via: null });
    expect(originOf({ from: 'nina', via: 'atlas' })).toEqual({ kind: 'teammate', ids: ['nina'], via: 'atlas' });
    expect(originOf({ model: 'sonnet 5.5' })).toEqual({ kind: 'agent', model: 'sonnet 5.5', route: 'sonnet 5.5' });
    expect(originOf({ origin: { kind: 'plugin' } })).toEqual({ kind: 'plugin' });
    expect(originOf({ origin: { kind: 'teammate', ids: ['nobody'] } })).toBeNull();
    expect(originOf({})).toBeNull();
  });
  it('says every name, for one, two, several and relayed', () => {
    const [a, b, c] = ids();
    expect(namesText([a as string, b as string])).toBe(`${a} and ${b}`);
    expect(namesText([a as string, b as string, c as string])).toBe(`${a}, ${b} and ${c}`);
    expect(originText({ kind: 'teammate', ids: [a as string], via: b as string })).toBe(`${a}, via ${b}`);
    expect(originText({ kind: 'agent', model: 'sonnet 5.5' })).toBe('sonnet 5.5');
    expect(originText({ kind: 'mcp', server: 'sentry', trust: 'trusted' })).toBe('sentry MCP server, trusted');
    expect(originText({ kind: 'hermes' })).toBe('Hermes');
    expect(originText({ kind: 'agent', model: '' })).toBe('The agent');
  });
  it('draws one orb for one teammate and a stack with +N and every name for several', () => {
    const all = ids();
    expect(originVisual({ kind: 'teammate', ids: [all[0] as string], via: null }, 20)).toContain('orb-avatar');
    const stack = originVisual({ kind: 'teammate', ids: all.slice(0, 5), via: null }, 20);
    expect(stack).toContain('cd-stack__more');
    expect(stack).toContain('role="img"');
    expect(stack).toContain('aria-label="' + namesText(all.slice(0, 5)));
  });
  it('draws the agent as its provider\'s mark, a system source as a glyph and an MCP server as its initial', () => {
    expect(originVisual(originOf({ model: 'qwen3-coder → sonnet 5.5' }), 20)).toContain('data-family="claude"');
    expect(originVisual({ kind: 'plugin' }, 20)).toContain('cd-glyph');
    expect(originVisual({ kind: 'mcp', server: 'sentry' }, 20)).toContain('>S<');
  });
  it('names every card in its byline, with a screen-reader list when names are hidden behind +N', () => {
    const all = ids();
    const h = byline({ origin: { kind: 'teammate', ids: all.slice(0, 6), via: null }, size: 'inline' });
    expect(h).toContain('data-origin="joint"');
    expect(h).toContain('and 5 others');
    expect(h).toContain('ui-sr');
    expect(byline({ origin: { kind: 'teammate', ids: [all[0] as string], via: all[1] as string }, size: 'compact' })).toContain('data-origin="relay"');
    expect(byline({ origin: null, size: 'inline' })).toBe('');
  });
  it('lends one teammate\'s colour as the accent, and nobody\'s for several', () => {
    const b = data().bots.snapshot().bots[0];
    expect(accentOf({ kind: 'teammate', ids: [b?.id as string], via: null })).toBeTruthy();
    expect(accentOf({ kind: 'teammate', ids: ids().slice(0, 2), via: null })).toBe('');
    expect(accentOf({ kind: 'agent', model: 'x' })).toBe('');
  });
  it('lays a one-row card out in aligned columns: lead mark, text, status (dot and meta)', () => {
    const c = { id: 'x', owe: 'needs you', origin: { kind: 'agent', model: 'sonnet 5.5' } } as unknown as Ctx;
    const h = mini(c, { text: 'Add a key', meta: '5 min' });
    expect(h.indexOf('cd-mini__lead')).toBeLessThan(h.indexOf('cd-mini__text'));
    expect(h.indexOf('cd-mini__text')).toBeLessThan(h.indexOf('cd-mini__status'));
    expect(h).toContain('cd-mini__dot');
    expect(h).toContain('cd-mini__meta');
    expect(h).toContain('needs you');
  });
  it('counts down in seconds, then minutes', () => {
    expect(expiryText(45000, false)).toBe('Expires in 45 s');
    expect(expiryText(10 * 60000, true)).toBe('10 min');
    expect(expiryText(0, false)).toBe('Expires now');
  });
});
