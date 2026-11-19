/* Blanks: the questions a cell leaves open (`blank.opened`), answered with `blank.fill`. Pure helpers; the provider
   owns the conversation and the waits. */
import type { BlankData } from '../../data/types';
import type { BlankState } from './session-model';

/** the short form of the question the popover shows under the sentence it came from */
export function shortOf(question: string): string {
  const q = question.trim().replace(/\s+/g, ' ');
  if (q.length <= 48) return q;
  const cut = q.slice(0, 48), at = cut.lastIndexOf(' ');
  return (at > 20 ? cut.slice(0, at) : cut) + '…';
}
export function blankData(b: BlankState): BlankData {
  return { id: b.id, question: b.question, short: shortOf(b.question), options: b.options, ...(b.answer !== null ? { answer: b.answer } : {}), free: ['You answered', '.'] };
}
/** the blank waiting for an answer: the oldest not yet filled */
export const openBlank = (blanks: readonly BlankState[]): BlankState | undefined => blanks.find((b) => b.answer === null);

/** the blanks a session's ledger records, in order: opened, then filled or lapsed (for a session resumed after a restart) */
export function blanksFromLedger(events: readonly { type: string; payload: Record<string, unknown> }[]): BlankState[] {
  const out: BlankState[] = [];
  for (const e of events) {
    const p = e.payload, id = typeof p['blank_id'] === 'string' ? p['blank_id'] : '';
    if (!id) continue;
    if (e.type === 'blank.opened') out.push({ id, question: String(p['question'] ?? ''), options: Array.isArray(p['options']) ? (p['options'] as string[]) : [], blocks: Array.isArray(p['blocks']) ? (p['blocks'] as string[]) : [], answer: null, lapsed: false });
    else if (e.type === 'blank.filled') { const b = out.find((x) => x.id === id); if (b) b.answer = String(p['answer'] ?? ''); }
    else if (e.type === 'blank.lapsed') { const b = out.find((x) => x.id === id); if (b) b.lapsed = true; }
  }
  return out;
}
