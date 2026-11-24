/* Mark (21.2 row 31, section 17; LAB-v7: feedforward, blank opened, filled, waiting, lapsed, info label; shown, hover, open,
   chosen, owed). Shown at rest only for feedforward and blanks; an info label only on hover or focus. */
import { kit } from '@boopis/ui';
import { put, stage } from '../../story';
import type { Story } from '../../types';

const ff = (state?: 'shown' | 'hover' | 'open' | 'chosen'): string => '<p class="k7-type-m" data-mark-context>Deploy to ' + kit.html.mark({ text: 'staging', state }) + ' after ' + kit.html.mark({ text: 'the tests pass', state: 'shown' }) + '</p>';
const info = (): HTMLElement => {
  const row = document.createElement('div'); row.className = 'k7-type-m'; row.setAttribute('data-mark-reveal', 'hover');
  row.append(kit.mark({ kind: 'info', text: 'Governed', explain: 'boopis checks every change at the gate before it reaches your files.' }));
  return row;
};
export default {
  id: 'kit/mark', title: 'Mark', area: 'components', kind: 'component', covers: ['kit.mark'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { put(root, ff('shown')); }),
    hover: stage(['hover'], ({ root }) => { put(root, ff('hover')); }),
    open: stage(['open'], ({ root }) => { put(root, ff('open')); }),
    chosen: stage(['variant'], ({ root }) => { put(root, ff('chosen')); }),
    'blank waiting (owed)': stage(['variant'], ({ root }) => { put(root, '<p class="k7-type-l" data-mark-context>I will deploy to ' + kit.html.mark({ kind: 'blank', blank: 'waiting', text: 'Which environment?', countdown: '0:42' }) + ' tonight.</p>'); }),
    'blank opened': stage(['variant', 'focus'], ({ root }) => { put(root, '<p class="k7-type-l" data-mark-context>I will deploy to ' + kit.html.mark({ kind: 'blank', blank: 'opened', text: 'Which environment?' }) + ' tonight.</p>'); }),
    'blank filled': stage(['variant', 'success'], ({ root }) => { put(root, '<p class="k7-type-l" data-mark-context>I will deploy to ' + kit.html.mark({ kind: 'blank', blank: 'filled', text: 'staging' }) + ' tonight.</p>'); }),
    'blank lapsed': stage(['variant', 'expired'], ({ root }) => { put(root, '<p class="k7-type-l" data-mark-context>I will deploy to ' + kit.html.mark({ kind: 'blank', blank: 'lapsed', text: 'staging' }) + ' tonight.</p>'); }),
    'info label at rest': stage(['variant'], ({ root }) => { put(root, info()); }),
    'info label hovered': stage(['hover'], ({ root }) => { put(root, info()); }, { force: [{ sel: '[data-mark-reveal]', state: 'hover' }], allow: { 'mark.rest': 'the state forces its row\'s hover, which is what reveals an info label (17.1); the static pass reads it as rest' } }),
    'info label open': stage(['open'], async ({ root, wait }) => { const r = info(); put(root, r); (r.querySelector('.k7-info') as HTMLElement).click(); await wait(200); }, { overlay: { anchor: '.k7-info', layer: '.k7-pop' } }),
    long: stage(['long'], ({ root }) => { put(root, '<p class="k7-type-m" data-mark-context>Then ' + kit.html.mark({ text: 'reconcile the invoices against the ledger before the quarterly close and the audit', state: 'shown' }) + ' and stop.</p>'); }, { width: 360 })
  }
} satisfies Story;
