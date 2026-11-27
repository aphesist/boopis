/* Page (21.2 row 2; LAB-v7: column, settings page with scope; content, empty, long names). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

const scope = { items: [{ value: 'device', label: 'This device' }, { value: 'project', label: 'This project' }], value: 'device' };
const settings = (): HTMLElement => kit.page({ variant: 'settings', title: 'Sessions', scope, body:
  kit.section('New sessions', kit.html.card({ rows: [{ label: 'How careful', control: kit.html.selectorItem({ variant: 'field', label: 'How careful', value: 'Auto-accept edits', ticks: { of: 4, on: 2 } }) }, { label: 'Wait for my answer', control: kit.html.selectorItem({ variant: 'field', label: 'Wait for my answer', value: '60 s' }) }] })) +
  kit.section('While it runs', kit.html.card({ rows: [{ label: 'Enter queues, ctrl Enter steers', control: kit.html.switch({ checked: true, label: 'Enter queues' }) }] })) });
export default {
  id: 'kit/page', title: 'Page', area: 'shell', kind: 'component', covers: ['kit.page', 'kit.section'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { fill(root, kit.page({ body: kit.html.timeSeparator({ text: 'Today 10:05' }) + kit.html.bubble({ kind: 'user', text: 'Write the changelog.' }) + kit.html.bubble({ kind: 'agent', text: 'Reading the merged pull requests.' }) })); }, { width: 900 }),
    settings: stage(['variant'], ({ root }) => { fill(root, settings()); }, { width: 680 }),
    empty: stage(['empty'], ({ root }) => { fill(root, kit.page({ empty: { text: 'No sessions yet', action: 'New session' } })); }, { width: 900 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.page({ variant: 'settings', title: 'Connectors and the sources they read from on this computer', scope, body: kit.section('Connected', kit.html.card({ rows: [{ label: 'GitHub for the organization with a rather long name', value: 'connected' }] })) })); }, { width: 680 })
  }
} satisfies Story;
