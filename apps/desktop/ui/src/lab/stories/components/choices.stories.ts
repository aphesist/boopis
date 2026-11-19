/* Segmented controls (tabs and radio, the Rail/Hide and Auto/Integrated/Dedicated choices), chips and chip groups,
   and the field (14.3, 14.17, 14.25). */
import { ui } from '../../kit';
import { forced, line, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, RTL, UNBROKEN } from '../../fixtures';

const CHOICES = { url: '/v6/design-system/index.html#c-choices', crop: '#c-choices' };

const segTypical = stage(['typical', 'variant', 'size'], ({ root }) => {
  line(root, ui.segmented({ label: 'View', fill: true, value: 'session', options: [{ value: 'session', label: 'Session', tip: 'Sessions', keys: 'alt+1' }, { value: 'bots', label: 'Bots', dot: true, tip: 'Bots', keys: 'alt+2' }] }));
  line(root, ui.segmented({ mode: 'radio', size: 's', label: 'When the sidebar collapses', value: 'rail', options: [{ value: 'rail', label: 'Rail' }, { value: 'closed', label: 'Hide' }] }));
  line(root, ui.segmented({ mode: 'radio', size: 's', label: 'Graphics', value: 'auto', options: [{ value: 'auto', label: 'Auto' }, { value: 'integrated', label: 'Integrated' }, { value: 'dedicated', label: 'Dedicated' }] }));
  line(root, ui.segmented({ vertical: true, label: 'View', value: 'session', options: [{ value: 'session', icon: 'session', ariaLabel: 'Session' }, { value: 'bots', icon: 'bots', ariaLabel: 'Bots' }] }));
});
const segmented: Story = {
  id: 'components/segmented', title: 'Segmented control', area: 'components', kind: 'component', covers: ['ui.segmented'], mock: CHOICES,
  states: {
    typical: segTypical, ...forced(segTypical, '.ui-seg__opt'),
    single: stage(['single'], ({ root }) => { line(root, ui.segmented({ mode: 'radio', size: 's', label: 'One', value: 'a', options: [{ value: 'a', label: 'Only' }] })); }),
    long: stage(['long'], ({ root }) => { line(root, ui.segmented({ mode: 'radio', size: 's', label: 'Long', value: 'a', options: [{ value: 'a', label: LONG_TITLE }, { value: 'b', label: UNBROKEN }] })); }, { width: 360 }),
    'no value': stage(['empty'], ({ root }) => { line(root, ui.segmented({ mode: 'radio', label: 'Unset', value: null, options: [{ value: 'a', label: 'Auto' }, { value: 'b', label: 'Integrated' }] })); }),
    rtl: stage(['rtl'], ({ root }) => { line(root, ui.segmented({ mode: 'radio', size: 's', label: 'RTL', value: 'a', options: [{ value: 'a', label: RTL.slice(0, 12) }, { value: 'b', label: 'Hide' }] })); }, { dir: 'rtl' })
  }
};

const chipTypical = stage(['typical', 'variant'], ({ root }) => {
  line(root, ui.chip({ label: 'Smart', pressed: true, tip: 'Picks the model for each message' }), ui.chip({ model: 'sonnet 5.5', haspopup: 'menu' }), ui.chip({ model: 'anthropic/claude-opus-5-5', modelColor: 'brand' }),
    ui.chip({ label: 'src/billing', icon: 'folder', mono: true }), ui.chip({ label: 'Option', option: true, checked: true }), ui.chip({ label: 'Option', option: true }));
});
const chip: Story = {
  id: 'components/chip', title: 'Chip', area: 'components', kind: 'component', covers: ['ui.chip'], mock: { url: '/v6/design-system/index.html#c-marks', crop: '#c-marks' },
  states: {
    typical: chipTypical, ...forced(chipTypical, '.ui-chip'),
    long: stage(['long'], ({ root }) => { line(root, ui.chip({ label: LONG_TITLE }), ui.chip({ label: UNBROKEN, mono: true }), ui.chip({ model: 'claude-sonnet-5-5-20261101-extended-context-preview' })); }, { width: 420 }),
    'unknown model': stage(['error'], ({ root }) => { line(root, ui.chip({ model: 'mystery-model-9' })); }, { note: 'an unknown family gets the neutral mark' })
  }
};

const cgTypical = stage(['typical'], ({ root }) => { line(root, ui.chipGroup({ label: 'Rounding', value: 'half-away', options: [{ label: 'Half away from zero', value: 'half-away' }, { label: 'Half to even', value: 'half-even' }, { label: 'None', value: 'none' }] })); });
const chipGroup: Story = {
  id: 'components/chip-group', title: 'Chip group', area: 'components', kind: 'component', covers: ['ui.chipGroup'], mock: CHOICES,
  states: {
    typical: cgTypical, ...forced(cgTypical, '.ui-chip'),
    empty: stage(['empty'], ({ root }) => { line(root, ui.chipGroup({ label: 'Nothing', options: [] })); }),
    many: stage(['many'], ({ root }) => { line(root, ui.chipGroup({ label: 'Many', value: 'o7', options: Array.from({ length: 40 }, (_, i) => ({ label: 'option ' + i, value: 'o' + i })) })); }, { width: 600 }),
    long: stage(['long'], ({ root }) => { line(root, ui.chipGroup({ label: 'Long', value: 'a', options: [{ label: LONG_TITLE, value: 'a' }, { label: UNBROKEN, value: 'b' }] })); }, { width: 420 })
  }
};

const fieldTypical = stage(['typical', 'variant'], ({ root }) => {
  line(root, ui.field({ label: 'Gate command', value: 'npm test', mono: true, hint: 'Runs at the end of every ship.' }));
  line(root, ui.field({ label: 'Note for nina', kind: 'textarea', placeholder: 'Anything she should know' }));
  line(root, ui.field({ label: 'Filter', placeholder: 'Filter shortcuts', raised: true }));
}, { width: 420 });
const field: Story = {
  id: 'components/field', title: 'Field', area: 'components', kind: 'component', covers: ['ui.field'], mock: { url: '/v6/design-system/index.html#c-fields', crop: '#c-fields' },
  states: {
    typical: fieldTypical, ...forced(fieldTypical, '.ui-input'),
    empty: stage(['empty'], ({ root }) => { line(root, ui.field({ label: 'Name', placeholder: 'nina' })); }, { width: 420 }),
    error: stage(['error'], ({ root }) => { line(root, ui.field({ label: 'OpenAI API key', value: 'sk-short', error: 'That doesn’t look like an OpenAI key: it starts with sk- and is at least 23 characters' })); }, { width: 420 }),
    disabled: stage(['disabled'], ({ root }) => { line(root, ui.field({ label: 'Folder', value: '~/code/billing-api', disabled: true })); }, { width: 420 }),
    long: stage(['long'], ({ root }) => { line(root, ui.field({ label: LONG_TITLE, value: UNBROKEN, hint: LONG_TITLE })); }, { width: 420 }),
    select: stage(['variant'], ({ root }) => { line(root, ui.field({ label: 'Interface font', kind: 'select', value: 'Geist', options: ['Libre Franklin', 'Geist', 'IBM Plex Sans'] })); }, { width: 420, note: 'a native select: the UI-controls agent replaces it' }),
    rtl: stage(['rtl'], ({ root }) => { line(root, ui.field({ label: 'Name', value: RTL })); }, { width: 420, dir: 'rtl' })
  }
};

export default [segmented, chip, chipGroup, field];
