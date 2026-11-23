/* The calm pass's pieces (docs/UI-COMPONENTS.md "Calm"; owner decision 23 November 2026, R-calm-*): the status line, the danger zone and
   overflow, the long-text editor, and the quiet forms of the row, the section and the empty state. */
import { html, ui } from '@boopis/ui';
import { line, put, stage, forced } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';

const SOUL = '# hex\n\nA video maker for Paper Past. Cuts a script into scenes, picks the footage, writes the captions and hands over a draft.\n\n## How it works\nIt asks for the brief first. It never publishes. It keeps the cut under ninety seconds unless told otherwise.\n\n## Voice\nPlain, dry, short sentences.';

const statusTypical = stage(['typical'], ({ root }) => {
  put(root, ui.statusLine({ text: 'Reading sources', count: '0 of 1' }), ui.statusLine({ text: 'Ready', tone: 'idle' }), ui.statusLine({ text: 'Could not read 1 source', tone: 'attention' }));
}, { width: 320, ground: 'frame' });
const statusLine: Story = {
  id: 'components/status-line', title: 'Status line', area: 'components', kind: 'component', covers: ['ui.statusLine', 'ui.setStatus'],
  states: {
    typical: statusTypical,
    empty: stage(['empty'], ({ root }) => { put(root, ui.statusLine({ text: 'Idle', tone: 'idle' })); }, { width: 320, ground: 'frame' }),
    long: stage(['long'], ({ root }) => { put(root, ui.statusLine({ text: LONG_TITLE, count: '12 of 4000' }), ui.statusLine({ text: UNBROKEN })); }, { width: 320, ground: 'frame' }),
    error: stage(['error'], ({ root }) => { put(root, ui.statusLine({ text: 'Could not read 1 source', tone: 'attention' })); }, { width: 320, ground: 'frame' }),
    changing: stage(['variant'], ({ root }) => {
      const s = ui.statusLine({ text: 'Reading sources', count: '0 of 3' }); put(root, s);
      requestAnimationFrame(() => { ui.setStatus(s, { text: 'Reading sources', count: '1 of 3' }); });
    }, { width: 320, ground: 'frame', note: 'the count ticks in place; a new phrase cross-fades (R-calm-6)' })
  }
};

const dangerTypical = stage(['typical'], ({ root }) => {
  put(root, ui.dangerZone({ actions: [{ label: 'Archive bot', name: 'Archive', action: 'archive' }, { label: 'Delete bot', name: 'Delete', action: 'delete' }] }));
}, { width: 360, ground: 'frame' });
const dangerZone: Story = {
  id: 'components/danger-zone', title: 'Danger zone and overflow', area: 'components', kind: 'component', covers: ['ui.dangerZone', 'ui.overflow'],
  states: {
    typical: dangerTypical, ...forced(dangerTypical, '.ui-sec__head'),
    empty: stage(['empty'], ({ root }) => { put(root, ui.dangerZone({ actions: [] })); }, { width: 360, ground: 'frame' }),
    open: stage(['open', 'variant'], ({ root }) => { put(root, ui.dangerZone({ open: true, actions: [{ label: 'Archive bot', name: 'Archive', action: 'archive' }, { label: 'Delete bot', name: 'Delete', action: 'delete' }] })); }, { width: 360, ground: 'frame' }),
    long: stage(['long'], ({ root }) => { put(root, ui.dangerZone({ open: true, actions: [{ label: LONG_TITLE, name: LONG_TITLE, action: 'x' }] })); }, { width: 360, ground: 'frame' }),
    overflow: stage(['variant'], ({ root }) => { line(root, ui.overflow({ label: 'More', items: [{ label: 'Archive', value: 'archive' }, { label: 'Delete…', value: 'delete' }], onSelect: () => { /* the lab only draws it */ } })); }, { ground: 'frame' })
  }
};

const longText: Story = {
  id: 'components/long-text', title: 'Long text and its editor', area: 'components', kind: 'component', covers: ['ui.longText', 'ui.setLongText', 'ui.editLong'],
  states: {
    typical: stage(['typical'], ({ root }) => { put(root, ui.longText({ label: 'Instructions', value: SOUL })); }, { width: 320, ground: 'frame' }),
    empty: stage(['empty'], ({ root }) => { put(root, ui.longText({ label: 'Instructions', value: '', empty: 'None yet' })); }, { width: 320, ground: 'frame' }),
    long: stage(['long'], ({ root }) => { put(root, ui.longText({ label: LONG_TITLE, value: UNBROKEN + ' ' + SOUL })); }, { width: 320, ground: 'frame' }),
    editor: stage(['open', 'variant'], ({ root }) => {
      const host = document.createElement('div'); host.style.cssText = 'position:relative;height:420px;width:640px'; put(root, host);
      void ui.editLong({ title: 'Instructions for hex', value: SOUL, host, inline: true });
      const d = host.querySelector<HTMLElement>('dialog'); if (d) { d.style.cssText = 'position:relative;inset:auto;margin:0;width:100%;height:100%'; }
    }, { width: 680, ground: 'frame', note: 'the editor: its own header, the text taking the room, Save only once the text changed' })
  }
};

/* the quiet forms of existing pieces: a row with a value and an (i), a section that collapsed because it is empty, an empty state of one line */
const quiet: Story = {
  id: 'components/calm-forms', title: 'Quiet row, empty section, one-line empty state', area: 'components', kind: 'component', covers: ['html.setRow', 'ui.section', 'ui.empty'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => {
      put(root, html.setRow({ label: 'Show the dock', control: html.switch({ label: 'Show the dock', checked: true }) }) +
        html.setRow({ label: 'Model', value: 'sonnet-5-5', info: 'The model this bot starts a session with' }) +
        html.setRow({ label: 'Context', value: 'unknown' }));
      ui.hydrate(root);
    }, { width: 360, ground: 'frame' }),
    'empty sections': stage(['empty', 'variant'], ({ root }) => {
      put(root, ui.section({ label: 'Context', meta: 'unknown', empty: true }), ui.section({ label: 'Tasks', meta: '0 of 0', empty: true }), ui.section({ label: 'Changes', meta: '+0 −0', empty: true }), html.section({ label: 'Output', meta: 'empty', empty: true, hideEmpty: true }),
        ui.section({ label: 'Governance', meta: 'governed', open: true, body: html.segmented({ mode: 'radio', size: 's', label: 'Governance', value: 'governed', options: [{ value: 'governed', label: 'Governed' }, { value: 'free', label: 'Ungoverned' }] }) }));
    }, { width: 320, ground: 'frame', note: 'an empty section is its heading and a muted value; the last one is hidden outright' }),
    'one-line empty': stage(['empty', 'variant'], ({ root }) => { put(root, ui.empty({ title: 'What should change?', line: true }), ui.empty({ title: 'No bots yet', line: true, action: html.button({ label: 'New bot', size: 's' }) })); }, { width: 480 }),
    long: stage(['long'], ({ root }) => { put(root, ui.empty({ title: LONG_TITLE + ' ' + UNBROKEN, line: true }), html.setRow({ label: LONG_TITLE, value: UNBROKEN, info: LONG_TITLE })); ui.hydrate(root); }, { width: 320, ground: 'frame' })
  }
};

/* THE OWNER'S PICK (invariant 8): where Part H leaves the look open, the options side by side, A first */
const options: Story = {
  id: 'components/calm-options', title: 'Options for the owner: status, danger zone, the (i)', area: 'components', kind: 'component', covers: [],
  states: {
    'status A: a dot, then the phrase': stage(['variant'], ({ root }) => { put(root, ui.statusLine({ text: 'Reading sources', count: '0 of 1', look: 'dot' })); }, { width: 320, ground: 'frame' }),
    'status B: the phrase alone, breathing': stage(['variant'], ({ root }) => { put(root, ui.statusLine({ text: 'Reading sources', count: '0 of 1', look: 'pulse' })); }, { width: 320, ground: 'frame', allow: { axe: { el: '.ui-status__text', reason: 'option B breathes the phrase\'s opacity; mid-breath it dips under 4.5:1, which is why A is the default' } } }),
    'danger A: a collapsed section at the end': stage(['variant'], ({ root }) => { put(root, ui.dangerZone({ actions: [{ label: 'Archive bot', name: 'Archive', action: 'archive' }, { label: 'Delete bot', name: 'Delete', action: 'delete' }] })); }, { width: 360, ground: 'frame' }),
    'danger B: the overflow menu in the header': stage(['variant'], ({ root }) => {
      const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:360px';
      head.append(Object.assign(document.createElement('span'), { textContent: 'hex' }), ui.overflow({ items: [{ label: 'Archive', value: 'archive' }, { label: 'Delete…', value: 'delete' }], onSelect: () => { /* drawn only */ } }));
      put(root, head);
    }, { ground: 'frame' }),
    'info (i) beside a label': stage(['variant'], ({ root }) => { put(root, html.setRow({ label: 'Autonomy', info: 'How far the bot goes before it asks you', control: html.segmented({ mode: 'radio', size: 's', label: 'Autonomy', value: 'ask', options: [{ value: 'ask', label: 'Ask' }, { value: 'go', label: 'Go' }] }) })); ui.hydrate(root); }, { width: 360, ground: 'frame' })
  }
};
export default [statusLine, dangerZone, longText, quiet, options];
