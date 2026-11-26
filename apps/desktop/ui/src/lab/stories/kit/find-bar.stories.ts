/* FindBar (6e, derived: find in a conversation, mod+F): the search Field, "3 of 12" or "No matches" in quiet words, previous and next,
   esc. In a thread, the matches washed in the find token and the one the bar is on stronger (the CSS highlight `k7-find`). */
import { kit } from '@boopis/ui';
import { fill, forced, stage } from '../../story';
import type { Story } from '../../types';
import { findRanges } from '../../../modules/session/find';

const bar = (count: string, value = 'cents'): HTMLElement => kit.findBar({ id: 'lab-find', value, count });
const thread = (q: string): HTMLElement => {
  const box = document.createElement('div'); box.style.position = 'relative'; box.style.paddingTop = '56px';
  const t = document.createElement('div'); t.className = 'k7-thread'; t.dataset['kind'] = 'session';
  t.append(kit.bubble({ kind: 'user', text: 'Move the invoices to integer cents.' }), kit.bubble({ kind: 'agent', brand: 'claude-sonnet-5-5', text: 'Done: money.ts keeps cents as integers, and prorate() rounds once, in cents, at the end. The invoice total is cents too.' }));
  const b = bar('', q); b.style.position = 'absolute'; b.style.top = '0'; b.style.right = '0'; b.style.zIndex = '3';
  box.append(b, t);
  const hits = findRanges(t, q), H = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight, hl = (CSS as unknown as { highlights?: { set(k: string, v: unknown): void } }).highlights;
  if (H && hl && hits.length) { hl.set('k7-find', new H(...hits)); hl.set('k7-find-now', new H(hits[1] ?? (hits[0] as Range))); }
  (b.querySelector('.k7-find__count') as HTMLElement).textContent = hits.length ? Math.min(2, hits.length) + ' of ' + hits.length : 'No matches';
  return box;
};
const typical = stage(['typical'], ({ root }) => { fill(root, bar('3 of 12')); }, { width: 420 });
export default {
  id: 'kit/find-bar', title: 'FindBar', area: 'components', kind: 'component', covers: ['kit.findBar'],
  states: {
    typical,
    ...forced(typical, '[data-find="next"]'),
    'no matches': stage(['empty'], ({ root }) => { fill(root, bar('No matches', 'centz')); }, { width: 420 }),
    empty: stage(['variant'], ({ root }) => { fill(root, bar('', '')); }, { width: 420 }),
    'in a thread': stage(['variant', 'open'], ({ root }) => { fill(root, thread('cents')); }, { width: 720 }),
    long: stage(['long'], ({ root }) => { fill(root, bar('1204 of 12 000', 'a query long enough that the field cuts it where the bar ends')); }, { width: 360 })
  }
} satisfies Story;
