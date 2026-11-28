/* Floating surfaces: popovers, the layer, tooltips, notices (the v6 menu went at step 7b: the kit's Menu is `kit/menu`)
   (14.18, 14.19, 14.22, 14.23). */
import { html, ui } from '@boopis/ui';
import { line, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';

const FLOAT = { url: '/v6/design-system/index.html#c-float', crop: '#c-float' };
export default [
  {
    id: 'components/popover', title: 'Popover and layer', area: 'components', kind: 'component', covers: ['ui.popover', 'ui.layer'], mock: FLOAT,
    states: {
      typical: stage(['typical', 'open'], async ({ root, wait }) => {
        const a = ui.button({ label: 'Edit', attrs: { 'aria-haspopup': 'dialog' } }); line(root, a);
        const body = document.createElement('div'); body.innerHTML = '<p>proration drift</p>' + html.button({ label: 'Save', variant: 'primary', size: 's' });
        ui.popover.open(a, body, { label: 'Rename' }); await wait(260);
      }, { overlay: { anchor: '.ui-btn', layer: '.ui-pop' } }),
      above: stage(['variant', 'open'], async ({ root, wait }) => {
        root.style.minHeight = 'calc(100vh - 48px)'; root.style.justifyContent = 'flex-end';
        const a = ui.button({ label: 'Edit' }); line(root, a);
        const body = document.createElement('div'); body.innerHTML = '<p>proration drift</p>';
        ui.popover.open(a, body, { label: 'Rename', place: 'above' }); await wait(260);
      }, { overlay: { anchor: '.ui-btn', layer: '.ui-pop' } }),
      long: stage(['long', 'open'], async ({ root, wait }) => {
        const a = ui.button({ label: 'Edit' }); line(root, a);
        const body = document.createElement('div'); body.innerHTML = '<p>' + LONG_TITLE + ' ' + UNBROKEN + '</p>';
        ui.popover.open(a, body, { label: 'Long' }); await wait(260);
      }, { overlay: { anchor: '.ui-btn', layer: '.ui-pop' } })
    }
  },
  {
    id: 'components/tooltip', title: 'Tooltip', area: 'components', kind: 'component', covers: ['ui.tooltip', 'html.tip'], mock: FLOAT,
    states: {
      typical: stage(['typical', 'variant'], ({ root }) => { line(root, html.tip('Hide sidebar', 'mod+B'), html.tip('nina', undefined, { text: 'needs you', tone: 'attention' }), html.tip('Close')); }),
      'below the anchor': stage(['tooltip'], async ({ root, wait }) => { const b = ui.iconButton({ icon: 'gear', label: 'Settings', keys: 'mod+,' }); line(root, b); b.focus(); ui.tooltip.show(b); await wait(250); }, { overlay: { anchor: '.ui-ib', layer: '.ui-tip' } }),
      'near the bottom flips above': stage(['tooltip', 'variant'], async ({ root, wait }) => { root.style.minHeight = 'calc(100vh - 48px)'; root.style.justifyContent = 'flex-end'; const b = ui.iconButton({ icon: 'gear', label: 'Settings', keys: 'mod+,' }); line(root, b); b.focus(); ui.tooltip.show(b); await wait(250); }, { overlay: { anchor: '.ui-ib', layer: '.ui-tip' } }),
      'at the right edge': stage(['tooltip', 'variant'], async ({ root, wait }) => { root.style.alignItems = 'flex-end'; root.style.width = '100%'; const b = ui.iconButton({ icon: 'sidebar-right', label: 'Show session details', keys: 'mod+I' }); line(root, b); b.focus(); ui.tooltip.show(b); await wait(250); }, { overlay: { anchor: '.ui-ib', layer: '.ui-tip' } }),
      long: stage(['long'], ({ root }) => { line(root, html.tip(LONG_TITLE, 'mod+shift+alt+K')); line(root, html.tip(UNBROKEN)); }, { width: 420 })
    }
  }
] satisfies Story[];
