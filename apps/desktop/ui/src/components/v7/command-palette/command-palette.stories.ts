/* CommandPalette (derived, no board: S31's rows, P2's search): mod+K over sessions, bots and commands; a typed query with its word marked;
   nothing matching; many rows; long words; a row hovered; the field focused. The app's own palette is `shell/palette`. */
import { kit } from '@boopis/ui';
import type { CommandPaletteGroup } from '@boopis/ui';
import { fill, forced, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

const KAI = { name: 'kai', color: '#5fb39a', shape: 'squircle' };
const GROUPS: CommandPaletteGroup[] = [
  { label: 'Sessions', rows: [{ value: 's1', label: 'Fix the dock\'s half paint', meta: 'boopis', trail: '2h', icon: 'session' }, { value: 's2', label: 'Round invoices once', meta: 'billing-api', trail: 'yesterday', icon: 'session' }] },
  { label: 'Bots', rows: [{ value: 'b1', label: 'kai', meta: 'docs and changelog', leadHTML: kit.html.avatar({ bot: KAI, size: 16 }), trail: 'needs you', attn: true }] },
  { label: 'Commands', rows: [{ value: 'c1', label: 'New session', icon: 'plus', keys: 'mod+shift+O' }, { value: 'c2', label: 'Settings', icon: 'gear', keys: 'mod+,' }, { value: 'c3', label: 'Keyboard shortcuts', icon: 'keyboard', keys: 'mod+/' }] }
];
const pal = (o: Partial<Parameters<typeof kit.commandPalette>[0]> = {}): HTMLElement => kit.commandPalette({ id: 'lab-pal', label: 'Search and commands', placeholder: 'Search, or type > for commands and @ for bots', groups: GROUPS, ...o });
const typical = stage(['typical', 'open'], ({ root }) => { fill(root, pal()); }, { width: 700 });
const many: CommandPaletteGroup[] = [{ label: 'Sessions', rows: Array.from({ length: 40 }, (_, i) => ({ value: 'm' + String(i), label: 'Session number ' + String(i + 1), meta: 'a-project', trail: String(i + 1) + 'd', icon: 'session' })) }];
export default {
  id: 'kit/command-palette', title: 'CommandPalette', area: 'shell', kind: 'component', covers: ['kit.commandPalette', 'kit.commandPaletteList'],
  states: {
    typical,
    ...forced(typical, '[data-kit-part="CommandPaletteRow"]:nth-of-type(3)'),
    'a typed query': stage(['variant'], ({ root }) => { fill(root, pal({ value: 'se', query: 'se', groups: [GROUPS[2] as CommandPaletteGroup] })); }, { width: 700 }),
    'no matches': stage(['empty'], ({ root }) => { fill(root, pal({ value: 'zzqxv', groups: [], empty: 'Nothing matches “zzqxv”.' })); }, { width: 700 }),
    'many rows, scrolling': stage(['many', 'scroll'], ({ root }) => { fill(root, pal({ groups: many })); }, { width: 700 }),
    long: stage(['long'], ({ root }) => { fill(root, pal({ value: 'reconcile', query: 'reconcile', groups: [{ label: 'Sessions', rows: [{ value: 'l', label: 'Reconcile the invoices_v2 backfill against the ledger before the quarterly close and the auditors arrive', meta: 'billing-api-with-a-long-folder-name', trail: 'yesterday', icon: 'session' }] }] })); }, { width: 420 })
  }
} satisfies Story;
