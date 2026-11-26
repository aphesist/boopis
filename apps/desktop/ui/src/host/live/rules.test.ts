/* The rules engine's seam (ADR-0060): what an approval card reads from a rules card, the engine's answer for each of the
   four buttons, the capability switched on only by the plugin's own word, and "Always allow" kept as a draft. */
import { describe, expect, it } from 'vitest';
import { enableRules, keepDraft, ruleCard, ruleChoice } from './rules';
import type { RulesDeps } from './rules';
import { approvalToWait, choiceFor } from '../map';
import type { LaterFeature } from '../../data/types';

const CARD = [
  'kai asks: Run a command · git push',
  'git push --force origin main',
  'Rule: “Ask before a git force-push or history rewrite, and before deleting branches, repositories or cloud resources.”',
  '(Asked for by @nina, a teammate in the room “paper past”.)'
].join('\n');

describe('a rules card', () => {
  it('gives the card its rule, verbatim, and its scope', () => {
    expect(ruleCard(CARD)).toEqual({
      rule: 'Ask before a git force-push or history rewrite, and before deleting branches, repositories or cloud resources.',
      scope: 'git push'
    });
  });
  it('a held card has a scope and no rule; any other approval has neither', () => {
    expect(ruleCard('kai asks: Use the computer\nclick\nThe reviewer could not check this (it timed out).')).toEqual({});
    expect(ruleCard('rm -rf build')).toBeNull();
    expect(ruleCard('kai asks before pushing to protected branches: terminal (git push).')).toBeNull();
  });
  it('reaches the dock through the approval event', () => {
    const w = approvalToWait({ type: 'approval.request', payload: { prompt_id: 'p1', command: 'terminal (plugin approval rule)', description: CARD } } as never);
    expect(w?.data?.scope).toBe('git push');
    expect(w?.data?.rule).toMatch(/^Ask before a git force-push/);
  });
});

describe('the answers', () => {
  it('turn is session, always is once, approved is once, anything else denies', () => {
    expect(ruleChoice('turn')).toBe('session');
    expect(ruleChoice('always')).toBe('once');
    expect(choiceFor('approved')).toBe('once');
    expect(choiceFor('denied')).toBe('deny');
    expect(choiceFor('session')).toBe('deny');
  });
});

function deps(caps: unknown, host = true): RulesDeps & { puts: unknown[] } {
  const puts: unknown[] = [];
  return {
    puts,
    plugin: (method) => Promise.resolve(method === 'describe' ? { capabilities: caps } : { text: 'kai may run git push --force origin main in /w.', excepts: ['default.git_cloud'], bots: ['kai'], match: ['Bash(git push --force origin main)'] }),
    host: host ? { get: () => Promise.resolve({ rules: { revision: 7 } }), put: (rule, rev) => { puts.push([rule, rev]); return Promise.resolve({ revision: 8, id: 'x_1' }); } } : null
  };
}

describe('the capability and the draft', () => {
  it('approval-rules is on only when the plugin says rules-v1 and the host can save', async () => {
    const later = new Set<LaterFeature>();
    expect(await enableRules(deps(['describe']), later)).toBe(false);
    expect(await enableRules(deps(['rules-v1'], false), later)).toBe(false);
    expect(later.has('approval-rules')).toBe(false);
    expect(await enableRules(deps(['rules-v1']), later)).toBe(true);
    expect(later.has('approval-rules')).toBe(true);
    expect(later.has('rules-settings')).toBe(true);
  });
  it('always allow keeps the drafted exception as a draft, against the revision read', async () => {
    const d = deps(['rules-v1']);
    expect(await keepDraft(d, 'g1', CARD)).toBe('x_1');
    const [rule, rev] = d.puts[0] as [Record<string, unknown>, number];
    expect(rev).toBe(7);
    expect(rule).toMatchObject({ type: 'exception', state: 'draft', source: 'card', excepts: ['default.git_cloud'], bots: ['kai'] });
  });
});
