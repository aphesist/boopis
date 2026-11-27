/* The disclosure (14.8). */
import { ui } from '@boopis/ui';
import { line, stage, forced } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE } from '../../fixtures';

/* the disclosure that is left of v6 (ui.disclosure: a turn's steps and the mods' lists draw it); the sections, rows and settings rows
   went at the repass's step 2a (the kit's SectionHead, ListRow and Card rows) */
const discTypical = stage(['typical', 'variant'], ({ root }) => { line(root, ui.disclosure({ label: '6 steps', expanded: false }), ui.disclosure({ label: '6 steps', expanded: true })); }, { width: 320, ground: 'frame' });
const disclosure: Story = {
  id: 'components/disclosure', title: 'Disclosure', area: 'components', kind: 'component', covers: ['ui.disclosure'], mock: { url: '/v6/design-system/index.html#c-panel', crop: '#c-panel' },
  states: {
    typical: discTypical, ...forced(discTypical, '.ui-disclosure'),
    long: stage(['long'], ({ root }) => { line(root, ui.disclosure({ label: LONG_TITLE })); }, { width: 320, ground: 'frame' })
  }
};

export default [disclosure];
