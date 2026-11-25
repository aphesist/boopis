/* The Sessions inbox's sections (board S17; SESSION-TAB.md 9): which section a session is in, and the word of what it waits for. */
import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '../../data';
import { needWord, sectionOf } from './sections';

const s = (o: Partial<SessionSummary>): SessionSummary => ({ id: 'x', project: 'boopis', title: 't', when: '2h', ...o });
describe('the inbox\'s sections', () => {
  it('an approval stops a session: it needs you, running or not', () => {
    expect(sectionOf(s({ needs: 'approval' }))).toBe('needs');
    expect(sectionOf(s({ needs: 'approval', running: true }))).toBe('needs');
    expect(needWord(s({ needs: 'approval' }))).toBe('Approval');
  });
  it('a question does not stop it: a running session with a question open is working; idle, it needs you', () => {
    expect(sectionOf(s({ needs: 'question', running: true }))).toBe('working');
    expect(sectionOf(s({ needs: 'question' }))).toBe('needs');
    expect(needWord(s({ needs: 'question' }))).toBe('Question');
  });
  it('then working, pinned, recent', () => {
    expect(sectionOf(s({ running: true, pinned: true }))).toBe('working');
    expect(sectionOf(s({ pinned: true }))).toBe('pinned');
    expect(sectionOf(s({}))).toBe('recent');
    expect(needWord(s({}))).toBe('');
  });
});
