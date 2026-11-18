import { beforeAll, describe, expect, it } from 'vitest';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { costAssume, makeReader } from './feedforward';

beforeAll(() => setProvider(createMockProvider({ simulate: false })));
const gov = { governed: true, smart: true, model: 'sonnet 5.5' };

describe('how the agent reads decision words in the composer', () => {
  it('marks the words that are decisions, and nothing else', () => {
    const r = makeReader(() => gov);
    const marks = r.marks('refactor the proration helpers in src/billing to use integer cents, run the tests, then open a PR. keep it cheap.');
    expect(marks.map((m) => m.text)).toEqual(['refactor', 'src/billing', 'run the tests', 'open a PR', 'cheap']);
    expect(marks.map((m) => m.kind)).toEqual(['verb', 'path', 'tests', 'pr', 'cost']);
    expect(marks.every((m) => !m.confirmed)).toBe(true);
  });
  it('turns the marks into the assumptions row', () => {
    const r = makeReader(() => gov);
    expect(r.items('refactor src/billing, run the tests, draft a PR, cheap').map((i) => i.label)).toEqual(['>refactor', '>src/billing', '>npm test', '>draft a PR', '>governed starts on qwen']);
  });
  it('a different reading of a word changes the assumption, and a dropped word leaves the row', () => {
    const r = makeReader(() => gov);
    r.reading('verb', 'refactor').value = 'review';
    expect(r.items('refactor it').map((i) => i.label)).toEqual(['>review, no edits', '>governed starts on qwen']);
    r.reading('verb', 'refactor').dropped = true;
    expect(r.marks('refactor it')).toEqual([]);
  });
  it('the guess comes from the word: review, fix and rewrite read as themselves, push reads as the branch only', () => {
    const r = makeReader(() => gov);
    expect(r.reading('verb', 'review').value).toBe('review');
    expect(r.reading('verb', 'rewrite').value).toBe('rewrite');
    expect(r.reading('pr', 'push it').value).toBe('branch');
    expect(r.reading('cost', 'thoroughly').value).toBe('thorough');
  });
  it('a path offers its folder, its tree and its tests', () => {
    const r = makeReader(() => gov);
    expect(r.items('look at src/billing/money').map((i) => i.text)).toContain('src/billing/money');
  });
  it('governance decides the cost assumption: ungoverned pins a model, smart off starts on the chosen one', () => {
    expect(costAssume({ governed: false, smart: true, model: 'opus 5.5' }, null)).toBe('>ungoverned, pinned to opus 5.5');
    expect(costAssume({ governed: true, smart: false, model: 'haiku 4.5' }, null)).toBe('>governed starts on haiku');
    expect(costAssume(gov, 'thorough')).toBe('>governed starts on sonnet');
  });
  it('with no decision words and the defaults on, there is nothing to assume', () => {
    expect(makeReader(() => gov).items('hello there')).toEqual([]);
  });
});
