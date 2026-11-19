import { describe, expect, it } from 'vitest';
import { restate } from './provider';

describe('the lab restates the recorder\'s scripts', () => {
  it('shows a scripted user message as the plain request it makes, never its payload', () => {
    const t = restate('@@call todo_list {"todos": [{"id": "1"}]}@@ @@reply Done.@@');
    expect(t).toBe('Run todo_list');
    expect(t).not.toContain('{');
  });
  it('names every call of a script and leaves a person\'s words alone', () => {
    expect(restate('@@call skill_view {"name": "x"}@@ @@call terminal {"command": "ls"}@@')).toBe('Run skill_view, terminal');
    expect(restate('Round the totals once per invoice')).toBe('Round the totals once per invoice');
  });
});
