/* The kit's newer pieces: tabs (the Settings tab bar, a mod pane's strip), the search field (the palette's, with its key
   chips; the title bar's command field), scroll areas (the one scrollbar, R-scroll-*), the quiet badge, the bare input,
   settings sections and heads, and key combos. */
import { html, ui } from '@boopis/ui';
import { forced, line, put, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';

const SETTINGS_TABS = [{ value: 'general', label: 'General' }, { value: 'models', label: 'Models' }, { value: 'connectors', label: 'Connectors' }, { value: 'appearance', label: 'Appearance' }, { value: 'keys', label: 'Keyboard' }];
const LINES = Array.from({ length: 60 }, (_, i) => '<p>Line ' + (i + 1) + ' of a long body that scrolls inside its area.</p>').join('');

const tabsTypical = stage(['typical', 'variant'], ({ root }) => {
  line(root, ui.tabs({ label: 'Settings sections', tabs: SETTINGS_TABS, value: 'general' }));
  line(root, ui.tabs({ label: 'Mod panes', scroll: true, tabs: Array.from({ length: 9 }, (_, i) => ({ value: 'p' + i, label: 'pane ' + i })), value: 'p2' }));
}, { width: 560, ground: 'frame' });
const searchTypical = stage(['typical', 'variant', 'size'], ({ root }) => {
  for (const size of ['s', 'm', 'l'] as const) line(root, ui.search({ label: 'Search sessions, bots and commands', placeholder: 'Search sessions, bots and commands', keys: 'esc', size }));
  line(root, ui.search({ as: 'button', label: 'Search and commands, billing-api proration drift', textHTML: '<span>billing-api</span> <span>proration drift in src/billing</span>', keys: 'mod+K' }));
}, { width: 600, ground: 'frame' });

export default [
  {
    id: 'components/tabs', title: 'Tabs', area: 'components', kind: 'component', covers: ['ui.tabs', 'html.tabs'], mock: { url: '/v6/design-system/index.html#c-shell', crop: '#c-shell' },
    states: {
      typical: tabsTypical, ...forced(tabsTypical, '.ui-tabs [role="tab"]'),
      single: stage(['single'], ({ root }) => { line(root, ui.tabs({ label: 'One', tabs: [{ value: 'a', label: 'General' }], value: 'a' })); }, { ground: 'frame' }),
      long: stage(['long'], ({ root }) => { line(root, ui.tabs({ label: 'Long', scroll: true, tabs: [{ value: 'a', label: LONG_TITLE }, { value: 'b', label: UNBROKEN }], value: 'b' })); }, { width: 420, ground: 'frame' }),
      'in the dialog head (the owner\'s tab bar)': stage(['owner', 'variant'], ({ root }) => { line(root, ui.tabs({ label: 'Settings sections', tabs: SETTINGS_TABS, value: 'appearance' })); }, { width: 600, ground: 'frame', force: [{ sel: '.ui-tabs [role="tab"]:nth-of-type(2)', state: 'hover' }] })
    }
  },
  {
    id: 'components/search', title: 'Search field', area: 'components', kind: 'component', covers: ['ui.search', 'html.search'], mock: { url: '/v6/design-system/index.html#c-shell', crop: '#c-shell' },
    states: {
      typical: searchTypical, ...forced(searchTypical, '.ui-search, .ui-search input'),
      'with a query': stage(['variant'], ({ root }) => { line(root, ui.search({ label: 'Search', value: 'proration', keys: 'esc' })); }, { width: 600, ground: 'frame' }),
      empty: stage(['empty'], ({ root }) => { line(root, ui.search({ label: 'Search' })); }, { width: 600, ground: 'frame' }),
      long: stage(['long'], ({ root }) => { line(root, ui.search({ label: 'Search', value: UNBROKEN, keys: 'mod+shift+K' }), ui.search({ as: 'button', label: LONG_TITLE, textHTML: '<span>' + UNBROKEN + '</span>', keys: 'mod+K' })); }, { width: 420, ground: 'frame' })
    }
  },
  {
    id: 'components/scroll', title: 'Scroll area', area: 'components', kind: 'component', covers: ['ui.scroll', 'html.scroll', 'ui.scrollClass'], mock: { url: '/v6/design-system/index.html#c-panel', crop: '#c-panel' },
    states: {
      typical: stage(['typical', 'scroll'], ({ root }) => { const s = ui.scroll({ label: 'A long body', body: LINES }); s.style.height = '240px'; s.style.width = '320px'; put(root, s); }, { ground: 'frame' }),
      'sideways (bare)': stage(['variant', 'scroll'], ({ root }) => { const s = ui.scroll({ axis: 'x', bare: true, body: '<div style="width:1200px">' + LONG_TITLE + ' ' + UNBROKEN + '</div>' }); s.style.width = '320px'; put(root, s); }, { ground: 'frame' }),
      'both axes': stage(['variant', 'scroll'], ({ root }) => { const s = ui.scroll({ axis: 'both', label: 'Wide and long', body: '<div style="width:900px">' + LINES + '</div>' }); s.style.height = '200px'; s.style.width = '320px'; put(root, s); }, { ground: 'frame' }),
      'on the dock': stage(['variant', 'scroll'], ({ root }) => { const s = ui.scroll({ label: 'Dock log', body: LINES }); s.style.height = '200px'; s.style.width = '320px'; put(root, s); }, { ground: 'dock' }),
      empty: stage(['empty'], ({ root }) => { const s = ui.scroll({ body: '' }); s.style.height = '120px'; s.style.width = '320px'; put(root, s); }, { ground: 'frame' }),
      long: stage(['long'], ({ root }) => { const s = ui.scroll({ label: 'Unbroken', body: '<p>' + UNBROKEN + UNBROKEN + '</p>' }); s.style.height = '120px'; s.style.width = '320px'; put(root, s); }, { ground: 'frame' })
    }
  },
  {
    id: 'components/badge', title: 'Badge', area: 'components', kind: 'component', covers: ['html.badge'], mock: { url: '/v6/design-system/index.html#c-marks', crop: '#c-marks' },
    states: {
      typical: stage(['typical'], ({ root }) => { line(root, html.badge({ label: 'outside', tip: 'Made outside boopis' }), html.badge({ label: 'made outside boopis', focusable: true, tip: 'Made outside boopis' })); }),
      long: stage(['long'], ({ root }) => { line(root, html.badge({ label: LONG_TITLE })); }, { width: 300 })
    }
  },
  {
    id: 'components/input', title: 'Input', area: 'components', kind: 'component', covers: ['html.input'], mock: { url: '/v6/design-system/index.html#c-fields', crop: '#c-fields' },
    states: {
      typical: stage(['typical', 'variant'], ({ root }) => { line(root, html.input({ label: 'Name', value: 'nina' }), html.input({ label: 'Gate', value: 'npm test', mono: true }), html.input({ label: 'Filter', placeholder: 'Filter', raised: true })); line(root, html.input({ label: 'Theme JSON', rows: 3, value: '{ "preset": "catalog" }', mono: true })); }, { width: 640, ground: 'frame' }),
      empty: stage(['empty'], ({ root }) => { line(root, html.input({ label: 'Name', placeholder: 'nina' })); }, { ground: 'frame' }),
      disabled: stage(['disabled'], ({ root }) => { line(root, html.input({ label: 'Name', value: 'nina', disabled: true })); }, { ground: 'frame' }),
      long: stage(['long'], ({ root }) => { line(root, html.input({ label: 'Path', value: UNBROKEN })); }, { width: 360, ground: 'frame' }),
      focus: stage(['focus'], ({ root }) => { line(root, html.input({ label: 'Name', value: 'nina' })); }, { ground: 'frame', force: [{ sel: '.ui-input', state: 'focus' }] }),
      error: stage(['error'], ({ root }) => { line(root, html.input({ label: 'Key', value: 'sk-short', attrs: { 'aria-invalid': 'true' } })); }, { ground: 'frame' })
    }
  },
  {
    id: 'components/set-section', title: 'Settings section and head', area: 'components', kind: 'component', covers: ['html.setSection', 'html.setHead'], mock: { url: '/v6/design-system/index.html#c-fields', crop: '#c-fields' },
    states: {
      typical: stage(['typical'], ({ root }) => { put(root, html.setSection({ id: 'lab-s1', label: 'Layout', body: html.setRow({ label: 'Show the dock', hint: 'Bots and widgets at the bottom edge', control: html.switch({ label: 'Show the dock', checked: true }) }) })); ui.hydrate(root); }, { width: 560, ground: 'frame' }),
      long: stage(['long'], ({ root }) => { put(root, html.setHead({ id: 'lab-h', label: LONG_TITLE })); }, { width: 360, ground: 'frame' }),
      empty: stage(['empty'], ({ root }) => { put(root, html.setSection({ id: 'lab-s2', label: 'Nothing here yet' })); }, { width: 560, ground: 'frame' })
    }
  },
  {
    id: 'components/key-combos', title: 'Key combos and tooltip body', area: 'components', kind: 'component', covers: ['html.combo', 'html.comboKbds', 'html.tipBody'], mock: { url: '/v6/design-system/index.html#c-marks', crop: '#c-marks' },
    states: {
      typical: stage(['typical', 'variant'], ({ root }) => { line(root, html.combo('mod+shift+O'), html.combo('alt+V'), '<span>' + html.comboKbds('mod+K') + '</span>', html.tip('Hide sidebar', 'mod+B'), '<span>' + html.tipBody('Hide sidebar', 'mod+B') + '</span>'); }),
      long: stage(['long'], ({ root }) => { line(root, html.combo('mod+shift+alt+ctrl+enter'), html.tip(LONG_TITLE, 'mod+shift+K', { text: 'needs you', tone: 'attention' })); }, { width: 420 })
    }
  }
] satisfies Story[];
