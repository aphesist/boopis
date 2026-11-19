// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { data, setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { S } from './model';
import { NAME_POOL, availableNames, botNames, isExhausted, isRollKey, isTaken, nameNote, namesInUse, normaliseNames, numbered, pickName } from './names';

const first = (seed: number) => () => seed;   // a "random" that always answers the same
const bot = (id: string, name = id): { id: string; name: string } => ({ id, name });

describe('the curated list (apps/shared/data/bot-names.json)', () => {
  it('is short, lower case, once each, and fit to be an id', () => {
    expect(NAME_POOL.length).toBeGreaterThan(100);
    expect(new Set(NAME_POOL).size).toBe(NAME_POOL.length);
    for (const n of NAME_POOL) expect(n).toMatch(/^[a-z0-9-]+$/);
  });
  it('is read as the list means it: trimmed, lower case, deduplicated, in order', () => {
    expect(normaliseNames([' Atlas', 'nina', 'ATLAS', '', 'kai '])).toEqual(['atlas', 'nina', 'kai']);
  });
});

describe('availability is derived from the bots that exist, never stored', () => {
  const pool = ['atlas', 'nina', 'kai', 'iris'];
  it('is the list minus the names and ids of the bots now, case-insensitive', () => {
    const used = namesInUse([bot('atlas'), bot('x-1', 'Kai')]);
    expect(availableNames(pool, used)).toEqual(['nina', 'iris']);
    expect(isTaken(' KAI ', used)).toBe(true);
    expect(isTaken('nina', used)).toBe(false);
  });
  it('a name comes back when its bot is gone, because nothing remembers it', () => {
    const bots = [bot('atlas'), bot('nina')];
    expect(availableNames(pool, namesInUse(bots))).toEqual(['kai', 'iris']);
    bots.splice(1, 1);                                       // nina is archived or deleted
    expect(availableNames(pool, namesInUse(bots))).toEqual(['nina', 'kai', 'iris']);
  });
  it('does the same through the provider: a created bot takes its name, an archived one gives it back', () => {
    setProvider(createMockProvider({ simulate: false }));
    S.bots = [];                                             // not initialised: the provider's own list is read
    const name = botNames.pick();
    expect(botNames.available()).toContain(name);
    const made = data().bots.create({ name, role: '', shape: 'circle', color: '#3b82f6', instructions: '' });
    expect(botNames.taken(name)).toBe(true);
    expect(botNames.available()).not.toContain(name);
    data().bots.archive(made.id);
    expect(botNames.taken(name)).toBe(false);
    expect(botNames.available()).toContain(name);
  });
  it('a typed name holds its place like a picked one, and the provider numbers a duplicate', () => {
    setProvider(createMockProvider({ simulate: false }));
    S.bots = [];
    expect(botNames.taken('atlas')).toBe(true);              // one of the sample bots
    expect(botNames.next('atlas')).toBe('atlas-2');
    expect(botNames.next('Not A Name!')).toBe('notaname-2');
  });
});

describe('picking a name', () => {
  const pool = ['atlas', 'nina', 'kai'];
  it('is a free name', () => {
    const used = namesInUse([bot('atlas')]);
    for (const r of [0, 0.4, 0.99]) expect(['nina', 'kai']).toContain(pickName(pool, used, { random: first(r) }));
  });
  it('a reroll avoids what is in the field while another is free', () => {
    expect(pickName(pool, new Set(), { avoid: 'atlas', random: first(0) })).toBe('nina');
    expect(pickName(pool, new Set(), { avoid: ['atlas', 'nina'], random: first(0) })).toBe('kai');
  });
  it('a reroll may repeat the field when it is the only free name', () => {
    expect(pickName(pool, namesInUse([bot('atlas'), bot('nina')]), { avoid: 'kai', random: first(0) })).toBe('kai');
  });
  it('falls back to a numbered list name when the list is used up, and says it is', () => {
    const used = namesInUse(pool.map((n) => bot(n)));
    expect(isExhausted(pool, used)).toBe(true);
    expect(pickName(pool, used, { random: first(0) })).toBe('atlas-2');
    const more = namesInUse([...pool.map((n) => bot(n)), bot('atlas-2'), bot('atlas-3')]);
    expect(pickName(pool, more, { random: first(0) })).toBe('atlas-4');
    expect(numbered('atlas', (n) => n === 'atlas-2')).toBe('atlas-3');
  });
  it('works on the real list when every name of it is in use', () => {
    const used = namesInUse(NAME_POOL.map((n) => bot(n)));
    expect(isExhausted(NAME_POOL, used)).toBe(true);
    const name = pickName(NAME_POOL, used);
    expect(name).toMatch(/^[a-z0-9]+-2$/);
    expect(NAME_POOL).toContain(name.replace(/-2$/, ''));
  });
  it('the fallback skips a number a reroll would repeat', () => {
    const used = namesInUse(pool.map((n) => bot(n)));
    expect(pickName(pool, used, { avoid: 'atlas-2', random: first(0) })).toBe('atlas-3');
  });
});

describe('the note under the name', () => {
  it('says what a name in use will become, and why a rolled name has a number', () => {
    expect(nameNote('atlas', true, 'atlas-2', false)).toBe('There is already a bot called atlas. This one will be atlas-2.');
    expect(nameNote('nova-2', false, 'nova-2-2', true)).toBe('Every name in the list is taken, so this one has a number.');
    expect(nameNote('nova', false, 'nova-2', false)).toBe('');
    expect(nameNote('  ', true, 'bot-2', true)).toBe('');
  });
});

describe('the dice keyboard shortcut', () => {
  const k = (o: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code'>>) => ({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, code: 'KeyR', ...o });
  it('is alt+R, matched by code so Option+R on a Mac (which types a symbol) works', () => {
    expect(isRollKey(k({ altKey: true }))).toBe(true);
  });
  it('is nothing else: not R alone, not with another modifier, not another letter', () => {
    expect(isRollKey(k({}))).toBe(false);
    expect(isRollKey(k({ altKey: true, shiftKey: true }))).toBe(false);
    expect(isRollKey(k({ altKey: true, ctrlKey: true }))).toBe(false);
    expect(isRollKey(k({ altKey: true, metaKey: true }))).toBe(false);
    expect(isRollKey(k({ altKey: true, code: 'KeyT' }))).toBe(false);
  });
});

beforeEach(() => { S.bots = []; });
