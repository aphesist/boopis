import { describe, expect, it } from 'vitest';
import { findMentions, mentionName, routeMentions } from './mentions';
import type { ModelChoice } from './types';

const choice = (model: string, tier?: number): ModelChoice => ({ value: 'p/' + model, provider: 'p', model, providerName: 'P', ...(tier !== undefined ? { tier } : {}) });
const CHOICES = [choice('haiku', 0), choice('gpt-6'), choice('gpt-6-luna')];
const called = (m: string): string => ({ haiku: 'Claude Haiku', 'gpt-6': 'GPT-6', 'gpt-6-luna': 'GPT-6 Luna' })[m] ?? m;

describe('mentions', () => {
  it('reads "@" and a readable name', () => {
    const m = findMentions('@Claude Haiku fix this', CHOICES, called);
    expect(m.map((x) => [x.text, x.start, x.end, x.choice.model])).toEqual([['@Claude Haiku', 0, 13, 'haiku']]);
  });
  it('the longest name wins, and a name must end at a boundary', () => {
    expect(findMentions('ask @GPT-6 Luna to look', CHOICES, called)[0]?.choice.model).toBe('gpt-6-luna');
    expect(findMentions('ask @GPT-6, then', CHOICES, called)[0]?.choice.model).toBe('gpt-6');
    expect(findMentions('@GPT-6x', CHOICES, called)).toEqual([]);
  });
  it('an "@" inside a word (an address) is not a mention', () => {
    expect(findMentions('mail me@Claude Haiku', CHOICES, called)).toEqual([]);
  });
  it('is case-insensitive about the name', () => { expect(findMentions('@claude haiku hi', CHOICES, called)).toHaveLength(1); });
  it('one model, however many times, routes the message there', () => {
    expect(routeMentions('@Claude Haiku do this, and @Claude Haiku that', CHOICES, called)).toEqual({ kind: 'one', choice: CHOICES[0] });
  });
  it('two different models are left as written', () => {
    const r = routeMentions('@Claude Haiku do this, @GPT-6 that', CHOICES, called);
    expect(r.kind).toBe('many');
  });
  it('no mention is an ordinary message; the file mentions are not models', () => {
    expect(routeMentions('fix @file:src/a.ts please', CHOICES, called)).toEqual({ kind: 'none' });
  });
  it('the menu writes the name the reader looks for', () => { expect(mentionName(CHOICES[2] as ModelChoice, called)).toBe('GPT-6 Luna'); });
});
