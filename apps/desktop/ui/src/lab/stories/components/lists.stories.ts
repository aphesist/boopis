/* Rows, groups, sections, disclosures and settings rows (14.4, 14.8, 14.11, 14.21). */
import { html, ui } from '../../kit';
import { line, list, put, stage, forced } from '../../story';
import type { Story } from '../../types';
import { LONG_NAME, LONG_TITLE, RTL, UNBROKEN } from '../../fixtures';
import { SESSIONS } from '../../../data/mock-data';

const LISTS = { url: '/v6/design-system/index.html#c-lists', crop: '#c-lists' };
const rowsOf = (n: number): string => Array.from({ length: n }, (_, i) => html.row({ title: (SESSIONS[i % SESSIONS.length]?.title ?? 'session') + (i >= SESSIONS.length ? ' ' + i : ''), end: SESSIONS[i % SESSIONS.length]?.when ?? '', lead: html.leadFor({ running: i === 1, attention: i === 2, current: i === 0 }), current: i === 0 })).join('');

const rowTypical = stage(['typical', 'variant'], ({ root }) => {
  list(root, rowsOf(5));
  list(root, html.row({ title: 'nina', sub: 'deploys · needs you', lead: html.orb({ id: 'nina', name: 'nina', shape: 'triangle', color: '#f23b5a', state: 'needs' }, { size: 20, still: true }), end: 'needs you', endTone: 'attention' }) +
    html.row({ title: 'audit log export', end: 'yesterday', acts: html.iconButton({ icon: 'archive', label: 'Archive' }) + html.iconButton({ icon: 'more', label: 'More' }) }) +
    html.row({ title: 'ledger', sub: 'archived yesterday', archived: true, end: html.button({ label: 'Restore', size: 's', variant: 'ghost' }) }));
});
const row: Story = {
  id: 'components/row', title: 'List row', area: 'components', kind: 'component', covers: ['ui.row', 'html.leadFor', 'html.stateWord'], mock: LISTS,
  states: {
    typical: rowTypical, ...forced(rowTypical, '.ui-row'),
    single: stage(['single'], ({ root }) => { list(root, rowsOf(1)); }),
    many: stage(['many', 'scroll'], ({ root }) => { const ul = list(root, rowsOf(120)); ul.style.maxHeight = '420px'; ul.style.overflowY = 'auto'; }),
    long: stage(['long'], ({ root }) => { list(root, html.row({ title: LONG_TITLE, end: 'yesterday' }) + html.row({ title: UNBROKEN, sub: LONG_NAME + ' · ' + LONG_TITLE, end: '3 min' }) + html.row({ title: LONG_NAME, end: 'needs you', endTone: 'attention', acts: html.iconButton({ icon: 'archive', label: 'Archive' }) })); }),
    empty: stage(['empty'], ({ root }) => { list(root, ''); }, { note: 'no rows: the list draws nothing' }),
    rtl: stage(['rtl'], ({ root }) => { list(root, html.row({ title: RTL, end: 'yesterday' })); }, { dir: 'rtl' })
  }
};

const group: Story = {
  id: 'components/group', title: 'Group', area: 'components', kind: 'component', covers: ['ui.group'], mock: LISTS,
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { put(root, ui.group({ label: 'Today', rows: rowsOf(3) }), ui.group({ label: 'Archived (2)', collapsible: true, expanded: false, rows: rowsOf(2) }), ui.group({ label: 'Earlier', collapsible: true, expanded: true, rows: rowsOf(2) })); }, { width: 280 }),
    empty: stage(['empty'], ({ root }) => { put(root, ui.group({ label: 'Today', rows: '' })); }, { width: 280 }),
    many: stage(['many'], ({ root }) => { put(root, ui.group({ label: 'All', rows: rowsOf(100) })); }, { width: 280 }),
    long: stage(['long'], ({ root }) => { put(root, ui.group({ label: LONG_TITLE, collapsible: true, rows: rowsOf(1) })); }, { width: 280 })
  }
};

const secTypical = stage(['typical', 'variant'], ({ root }) => {
  put(root, ui.section({ label: 'Context', meta: '38%', open: true, body: html.measure({ used: 76000, total: 200000 }) }), ui.section({ label: 'Changes', meta: '4 files', open: false, body: '' }));
  line(root, ui.disclosure({ label: '6 steps', expanded: false }), ui.disclosure({ label: '6 steps', expanded: true }));
}, { width: 320, ground: 'frame' });
const section: Story = {
  id: 'components/section', title: 'Section and disclosure', area: 'components', kind: 'component', covers: ['ui.section', 'ui.disclosure'], mock: { url: '/v6/design-system/index.html#c-panel', crop: '#c-panel' },
  states: {
    typical: secTypical, ...forced(secTypical, '.ui-sec__head, .ui-disclosure'),
    empty: stage(['empty'], ({ root }) => { put(root, ui.section({ label: 'Output', open: true, body: '' })); }, { width: 320, ground: 'frame' }),
    long: stage(['long'], ({ root }) => { put(root, ui.section({ label: LONG_TITLE, meta: UNBROKEN, open: true, body: '<p>' + UNBROKEN + '</p>' })); line(root, ui.disclosure({ label: LONG_TITLE })); }, { width: 320, ground: 'frame' })
  }
};

const setTypical = stage(['typical', 'variant'], ({ root }) => {
  put(root, html.setRow({ label: 'Smart', hint: 'Picks the model for each message', control: html.switch({ label: 'Smart', checked: true }) }) +
    html.setRow({ label: 'When the sidebar collapses', control: html.segmented({ mode: 'radio', size: 's', label: 'When the sidebar collapses', value: 'rail', options: [{ value: 'rail', label: 'Rail' }, { value: 'closed', label: 'Hide' }] }) }) +
    html.setRow({ label: 'Graphics', hint: 'Which GPU draws the window', control: html.segmented({ mode: 'radio', size: 's', label: 'Graphics', value: 'auto', options: [{ value: 'auto', label: 'Auto' }, { value: 'integrated', label: 'Integrated' }, { value: 'dedicated', label: 'Dedicated' }] }) }));
  ui.hydrate(root);
}, { width: 560, ground: 'frame' });
const setRow: Story = {
  id: 'components/set-row', title: 'Settings row', area: 'components', kind: 'component', covers: ['html.setRow'], mock: { url: '/v6/design-system/index.html#c-fields', crop: '#c-fields' },
  states: {
    typical: setTypical, ...forced(setTypical, '.ui-seg__opt, .ui-switch'),
    long: stage(['long'], ({ root }) => { put(root, html.setRow({ label: LONG_TITLE, hint: UNBROKEN, control: html.switch({ label: 'x' }) })); ui.hydrate(root); }, { width: 560, ground: 'frame' }),
    narrow: stage(['variant'], ({ root }) => { put(root, html.setRow({ label: 'When the sidebar collapses', hint: 'Rail keeps the icons', control: html.segmented({ mode: 'radio', size: 's', label: 'x', value: 'rail', options: [{ value: 'rail', label: 'Rail' }, { value: 'closed', label: 'Hide' }] }) })); ui.hydrate(root); }, { width: 300, ground: 'frame' })
  }
};

export default [row, group, section, setRow];
