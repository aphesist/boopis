import { describe, expect, it } from 'vitest';
import { recentFailures, smartLevel, smartPick, tierFor } from './smart';

const fence = (n: number): string => '```ts\n' + 'const x = 1;\n'.repeat(n) + '```';

describe('Smart: the level of a message', () => {
  it('the cheapest tier answers by default', () => {
    expect(smartLevel({ text: 'rename the button label to Save' })).toEqual({ level: 0, reason: 'a short, plain request' });
    expect(smartLevel({ text: '' }).level).toBe(0);
  });
  it.each([
    ['Please design the sync layer', 2, 'design work'],
    ['plan the migration to postgres', 2, 'design work'],
    ['debug why the login test is flaky', 1, 'debugging'],
    ['find the root cause of the crash', 1, 'debugging'],
    ['refactor the parser', 1, 'refactoring'],
    ['rewrite this module', 1, 'refactoring'],
    ['look at this:\n```\nfoo\n```', 1, 'code in the message'],
    ['diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b', 1, 'code in the message']
  ])('%s -> level %i (%s)', (text, level, reason) => { expect(smartLevel({ text })).toEqual({ level, reason }); });
  it('length: medium raises to 1, long to 2', () => {
    expect(smartLevel({ text: 'a '.repeat(201) })).toEqual({ level: 1, reason: 'a longer request' });
    expect(smartLevel({ text: 'a '.repeat(751) })).toEqual({ level: 2, reason: 'a long request' });
  });
  it('a lot of code is level 2, a little is 1', () => {
    expect(smartLevel({ text: fence(41) })).toEqual({ level: 2, reason: 'a lot of code' });
    expect(smartLevel({ text: fence(5) }).level).toBe(1);
  });
  it('attachments and mentions count', () => {
    expect(smartLevel({ text: 'summarise', attachments: 1 })).toEqual({ level: 1, reason: 'an attachment' });
    expect(smartLevel({ text: 'summarise @file:src/a.ts' }).level).toBe(1);
    expect(smartLevel({ text: 'summarise', attachments: 4 })).toEqual({ level: 2, reason: 'many attachments' });
    expect(smartLevel({ text: '@file:a @file:b', attachments: 2 }).level).toBe(2);
  });
  it('recent failures raise the level', () => {
    expect(smartLevel({ text: 'try again', failures: 1 })).toEqual({ level: 1, reason: 'the last turn failed' });
    expect(smartLevel({ text: 'try again', failures: 2 })).toEqual({ level: 2, reason: 'it failed twice already' });
  });
  it('the highest signal wins and names the reason', () => {
    expect(smartLevel({ text: 'debug this and design the fix', failures: 1 })).toEqual({ level: 2, reason: 'design work' });
  });
});
describe('Smart: the tier', () => {
  it('spreads the levels over the ladder', () => {
    expect([0, 1, 2].map((l) => tierFor(l as 0 | 1 | 2, 3))).toEqual([0, 1, 2]);
    expect([0, 1, 2].map((l) => tierFor(l as 0 | 1 | 2, 2))).toEqual([0, 0, 1]);
    expect([0, 1, 2].map((l) => tierFor(l as 0 | 1 | 2, 1))).toEqual([0, 0, 0]);
    expect([0, 1, 2].map((l) => tierFor(l as 0 | 1 | 2, 5))).toEqual([0, 2, 4]);
  });
  it('has nothing to choose from on an empty ladder', () => {
    expect(smartPick({ text: 'x' }, 0)).toBeNull();
    expect(smartPick({ text: 'design it' }, 3)).toEqual({ index: 2, level: 2, reason: 'design work' });
  });
  it('counts failures among the last three turns', () => {
    expect(recentFailures([true, false, false, true, true])).toBe(2);
    expect(recentFailures([])).toBe(0);
  });
});
