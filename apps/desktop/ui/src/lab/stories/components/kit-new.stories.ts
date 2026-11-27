/* The kit's newer pieces: tabs (the Settings tab bar, a mod pane's strip), scroll areas (the one scrollbar, R-scroll-*), the quiet badge, the bare input,
   settings sections and heads, and key combos. */
import { html, ui } from '@boopis/ui';
import { line, put, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';

const SIDEWAYS = "a specimen of the primitive's sideways axis: the scroller scrolling sideways is what it draws (R-scroll-7 names code, a diff, terminal output, a wide table and a tab strip as its users)";
const LINES = Array.from({ length: 60 }, (_, i) => '<p>Line ' + (i + 1) + ' of a long body that scrolls inside its area.</p>').join('');

export default [
  {
    id: 'components/scroll', title: 'Scroll area', area: 'components', kind: 'component', covers: ['ui.scroll', 'html.scroll', 'ui.scrollClass'], mock: { url: '/v6/design-system/index.html#c-panel', crop: '#c-panel' },
    states: {
      typical: stage(['typical', 'scroll'], ({ root }) => { const s = ui.scroll({ label: 'A long body', body: LINES }); s.style.height = '240px'; s.style.width = '320px'; put(root, s); }, { ground: 'frame' }),
      'sideways (bare)': stage(['variant', 'scroll'], ({ root }) => { const s = ui.scroll({ axis: 'x', bare: true, label: 'Wide line', body: '<div style="width:1200px">' + LONG_TITLE + ' ' + UNBROKEN + '</div>' }); s.style.width = '320px'; put(root, s); }, { ground: 'frame', allow: { 'geometry.hscroll': SIDEWAYS } }),
      'both axes': stage(['variant', 'scroll'], ({ root }) => { const s = ui.scroll({ axis: 'both', label: 'Wide and long', body: '<div style="width:900px">' + LINES + '</div>' }); s.style.height = '200px'; s.style.width = '320px'; put(root, s); }, { ground: 'frame', allow: { 'geometry.hscroll': SIDEWAYS } }),
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
    id: 'components/key-combos', title: 'Key combos and tooltip body', area: 'components', kind: 'component', covers: ['html.combo', 'html.comboKbds', 'html.tipBody'], mock: { url: '/v6/design-system/index.html#c-marks', crop: '#c-marks' },
    states: {
      typical: stage(['typical', 'variant'], ({ root }) => { line(root, html.combo('mod+shift+O'), html.combo('alt+V'), '<span>' + html.comboKbds('mod+K') + '</span>', html.tip('Hide sidebar', 'mod+B'), '<span>' + html.tipBody('Hide sidebar', 'mod+B') + '</span>'); }),
      long: stage(['long'], ({ root }) => { line(root, html.combo('mod+shift+alt+ctrl+enter'), html.tip(LONG_TITLE, 'mod+shift+K', { text: 'needs you', tone: 'attention' })); }, { width: 420 })
    }
  }
] satisfies Story[];
