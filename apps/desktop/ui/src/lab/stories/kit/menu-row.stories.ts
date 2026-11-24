/* MenuRow (21.2 row 19; LAB-v7: glyph + name, name + description, with kbd, danger; hover, focus, long description). */
import { kit } from '@boopis/ui';
import { line, stage } from '../../story';
import type { Story } from '../../types';

const rows = (): HTMLElement => kit.menu({ label: 'Rows', entries: [
  { label: 'New session', icon: 'plus' }, { label: 'webapp-testing', desc: 'Drive the web app in a browser' }, { label: 'Search', icon: 'search', keys: 'mod+K' }, { label: 'Delete', icon: 'close', danger: true }
] });
export default {
  id: 'kit/menu-row', title: 'MenuRow', area: 'components', kind: 'component', covers: ['kit.menuRow'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, rows()); }),
    hover: stage(['hover'], ({ root }) => { line(root, rows()); }, { force: [{ sel: '[data-kit~="MenuRow"]', state: 'hover' }] }),
    focus: stage(['focus'], ({ root }) => { line(root, rows()); }, { force: [{ sel: '[data-kit~="MenuRow"]:first-child', state: 'focus' }] }),
    long: stage(['long'], ({ root }) => { line(root, kit.menu({ label: 'Rows', entries: [{ label: 'reconcile-invoices', desc: 'Reconcile the invoices against the ledger before the quarterly close and the audit' }] })); })
  }
} satisfies Story;
