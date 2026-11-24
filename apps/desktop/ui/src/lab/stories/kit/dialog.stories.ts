/* Dialog (21.2 row 4; LAB-v7: large (Settings), form: commit, import, new bot, confirm (danger); enter, scrim, close focus, error in a field). */
import { kit } from '@boopis/ui';
import { fill, forced, stage } from '../../story';
import type { Story } from '../../types';

const NAV = [{ label: 'General', icon: 'gear', current: true }, { label: 'Models', icon: 'spark' }, { label: 'Sessions', icon: 'session' }, { label: 'Connectors', icon: 'at' }, { label: 'Appearance', icon: 'sliders' }, { label: 'Keyboard', icon: 'slash' }];
const form = stage(['typical', 'variant'], ({ root }) => {
  fill(root, kit.dialog({ title: 'Commit', body: kit.html.field({ id: 'c-msg', label: 'Message', kind: 'multiline', value: 'Round invoices once, at the end' }), actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Commit', variant: 'split' }] }));
}, { width: 640 });
export default {
  id: 'kit/dialog', title: 'Dialog', area: 'shell', kind: 'component', covers: ['kit.dialog'],
  states: {
    typical: form,
    ...forced(form, '[data-dialog-close]'),
    large: stage(['variant'], ({ root }) => { fill(root, kit.dialog({ variant: 'large', title: 'Settings', nav: NAV, body: kit.html.page({ variant: 'settings', title: 'General', body: kit.section('Layout', kit.html.card({ rows: [{ label: 'Show search', control: kit.html.switch({ checked: true, label: 'Show search' }) }, { label: 'Show the dock', control: kit.html.switch({ checked: true, label: 'Show the dock' }) }] })) }) })); }, { width: 1000 }),
    'new bot': stage(['variant'], ({ root }) => { fill(root, kit.dialog({ title: 'New bot', body: kit.html.field({ id: 'nb-name', label: 'Name', placeholder: 'A name, or roll one' }) + kit.html.field({ id: 'nb-role', label: 'Role', optional: true, placeholder: 'What this bot does' }), actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Create', variant: 'primary' }] })); }, { width: 640 }),
    import: stage(['variant'], ({ root }) => { fill(root, kit.dialog({ title: 'Import sessions', body: kit.html.menu({ label: 'Import', variant: 'options', entries: [{ label: 'From Claude Code', meaning: '12 sessions in ~/.claude', chosen: true }, { label: 'From Codex', meaning: '3 sessions in ~/.codex' }] }), actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Import', variant: 'primary' }] })); }, { width: 640 }),
    confirm: stage(['variant'], ({ root }) => { fill(root, kit.dialog({ title: 'Delete kai?', body: '<p class="k7-type-s">Its chats and routines go with it. This cannot be undone.</p>', actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Delete', variant: 'danger' }] })); }, { width: 640 }),
    error: stage(['error'], ({ root }) => { fill(root, kit.dialog({ title: 'New bot', body: kit.html.field({ id: 'nb-e', label: 'Name', value: 'kai', error: 'There is a bot called kai already' }), actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Create', variant: 'primary' }] })); }, { width: 640 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.dialog({ title: 'Reconcile the invoices against the ledger before the quarterly close', body: '<p class="k7-type-s">' + 'A long explanation of what happens next and why. '.repeat(4) + '</p>', actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Continue', variant: 'primary' }] })); }, { width: 640 })
  }
} satisfies Story;
