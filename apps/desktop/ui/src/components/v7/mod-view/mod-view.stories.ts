/* ModView (2b, derived: no board draws a mod; the lead's decisions for conflict 32): what a mod draws, in the kit's parts, on each surface
   it stands on: a tab of the Pane, a ToolRow in the thread, the band in the strip over the composer. Progress is the kit's ticks. */
import { kit } from '@boopis/ui';
import { fill, frames, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';
import { LONG_TITLE, UNBROKEN } from '../../../lab/fixtures';

const { Box, Text, Button, Input, Select, Markdown, Code, Link, Svg } = kit.modH;
const TREE = Box({ flexDirection: 'column', gap: 1 },
  Text({ bold: true }, 'test-runner'), Text({ dimColor: true }, '1 failing · 141 passing'),
  Box({ gap: 1, alignItems: 'center' }, Box({ progress: 70, label: 'Tests run' }), Text({ mono: true, dimColor: true }, '70%')),
  Box({ gap: 1 }, Button({ variant: 'primary', onPress: { $handler: 'r' } }, 'Re-run'), Button({ variant: 'ghost', onPress: { $handler: 's' } }, 'Skip'), Button({ role: 'danger', onPress: { $handler: 'c' } }, 'Clear cache')),
  Box({ gap: 1 }, Input({ placeholder: 'Filter tests', onSubmit: { $handler: 'f' }, submitLabel: 'Filter' })),
  Select({ label: 'Show', value: 'all', options: [{ label: 'All tests', value: 'all' }, { label: 'Failing only', value: 'failing' }], onSelect: { $handler: 'w' } }),
  Markdown({}, 'Failing: `invoice.test.ts` **rounds per line item**'),
  Code({ path: 'src/money.ts', startLine: 41 }, 'export function roundCents(n: number): number {\n  return Math.round(n * 100) / 100;\n}'),
  Link({ href: 'https://example.com/runs/412' }, 'Run 412'));
const CHART = Svg({ label: 'Tokens per turn', svg: '<svg viewBox="0 0 120 40"><rect x="4" y="20" width="16" height="20" fill="claude"/><rect x="28" y="10" width="16" height="30" fill="#b8a4f0"/><rect x="52" y="26" width="16" height="14" fill="subtle"/><text x="4" y="10">12.4k</text></svg>' });
const DIFF = Code({ format: 'diff', path: 'src/money.ts' }, '@@ -41,3 +41,3 @@\n-  return Math.round(n * 100);\n+  return Math.round(n * 100) / 100;\n }');
const LONG = Box({ flexDirection: 'column', gap: 1 }, Text({}, LONG_TITLE + ' ' + UNBROKEN), Code({}, UNBROKEN + UNBROKEN), Box({ gap: 1 }, ...Array.from({ length: 12 }, (_, i) => Button({ onPress: { $handler: 'b' + i } }, 'Action ' + i))));
const view = (tree: unknown, surface: 'pane' | 'row' | 'band'): string => kit.html.modView({ tree, surface, label: 'Tests, test-runner mod' });
const onPane = (html: string): string => kit.html.pane({ variant: 'tools', fixed: ['diff'], extra: [{ value: 'tests', label: 'Tests', tip: 'test-runner mod' }], tab: 'tests', label: 'Tests, test-runner mod', body: html });

export default {
  id: 'kit/mod-view', title: 'ModView', area: 'cards', kind: 'component', covers: ['kit.modView'],
  states: {
    typical: stage(['typical', 'owner'], async ({ root }) => { fill(root, onPane(view(TREE, 'pane'))); await frames(2); }, { width: 520 }),
    'in the thread, a ToolRow': stage(['variant'], async ({ root }) => { fill(root, kit.html.toolRow({ icon: 'mod', tool: 'test-runner', text: true, word: '09:41', after: view(TREE, 'row') })); await frames(2); }, { width: 640 }),
    'the band over the composer': stage(['variant'], async ({ root }) => { fill(root, kit.html.queue({ variant: 'mod', mods: [{ name: 'test-runner', html: view(Box({ gap: 1, alignItems: 'center' }, Text({}, 'Running tests'), Box({ progress: null, label: 'Running tests' })), 'band') }] })); await frames(2); }, { width: 640 }),
    'a chart and a diff': stage(['variant'], async ({ root }) => { fill(root, onPane(view(Box({ flexDirection: 'column', gap: 1 }, CHART, DIFF), 'pane'))); await frames(2); }, { width: 520 }),
    'a button hovered': stage(['hover'], async ({ root }) => { fill(root, onPane(view(TREE, 'pane'))); await frames(2); }, { width: 520, force: [{ sel: '.k7-mv [data-kit~="Button"]', state: 'hover' }] }),
    'a field focused': stage(['focus'], async ({ root }) => { fill(root, onPane(view(TREE, 'pane'))); await frames(2); }, { width: 520, force: [{ sel: '.k7-mv .k7-field__input', state: 'focus' }] }),
    long: stage(['long', 'many'], async ({ root }) => { fill(root, onPane(view(LONG, 'pane'))); await frames(2); }, { width: 520 }),
    empty: stage(['empty'], ({ root }) => { fill(root, onPane(view(Box({}), 'pane'))); }, { width: 520 }),
    'a refused tree: the pane says so in one line': stage(['error'], ({ root }) => { fill(root, onPane(kit.html.modView({ tree: { type: 'Client', props: {}, children: [] } }) || kit.html.emptyState({ text: 'This pane can’t be drawn.' }))); }, { width: 520 })
  }
} satisfies Story;
