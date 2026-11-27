/* Buttons, icon buttons, send, hold to approve and the switch (DESIGN-SYSTEM.md 14.14 to 14.16). */
import { ui } from '@boopis/ui';
import { forced, line, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, RTL, UNBROKEN } from '../../fixtures';

const SPEC = { url: '/v6/design-system/index.html#c-buttons', crop: '#c-buttons' };
const variants = ['primary', 'secondary', 'ghost'] as const;

const typical = stage(['typical', 'variant', 'size'], ({ root }) => {
  for (const size of ['m', 's'] as const) line(root, ...variants.map((variant) => ui.button({ label: variant === 'primary' ? 'Approve plan' : variant === 'ghost' ? 'Later' : 'Deny', variant, size })));
  line(root, ui.button({ label: 'New session', icon: 'plus', variant: 'ghost', keys: 'mod+shift+O', showKeys: true }), ui.button({ label: 'Copy', icon: 'copy', size: 's' }));
});

const button: Story = {
  id: 'components/button', title: 'Button', area: 'components', kind: 'component', covers: ['ui.button'], mock: SPEC,
  states: {
    typical,
    ...forced(typical, '.ui-btn'),
    disabled: stage(['disabled', 'variant'], ({ root }) => { line(root, ...variants.map((variant) => ui.button({ label: 'Approve', variant, disabled: true }))); }),
    long: stage(['long'], ({ root }) => { line(root, ui.button({ label: LONG_TITLE, variant: 'primary' })); line(root, ui.button({ label: UNBROKEN })); }, { width: 360 }),
    rtl: stage(['rtl'], ({ root }) => { line(root, ui.button({ label: RTL, variant: 'secondary' })); }, { dir: 'rtl', width: 360 }),
    'on the dock': stage(['variant'], ({ root }) => { line(root, ...variants.map((variant) => ui.button({ label: 'Deny', variant, size: 's' }))); }, { ground: 'dock' })
  }
};

const ibTypical = stage(['typical', 'variant', 'size'], ({ root }) => {
  line(root, ui.iconButton({ icon: 'sidebar-left', label: 'Hide sidebar', keys: 'mod+B' }), ui.iconButton({ icon: 'search', label: 'Search' }), ui.iconButton({ icon: 'gear', label: 'Settings', size: 's' }),
    ui.iconButton({ icon: 'mic', label: 'Dictate', pressed: false }), ui.iconButton({ icon: 'mic', label: 'Dictate', pressed: true }), ui.iconButton({ icon: 'plus', label: 'Attach', expanded: false, haspopup: 'menu' }));
  line(root, ui.iconButton({ icon: 'minimize', label: 'Minimize', window: true }), ui.iconButton({ icon: 'maximize', label: 'Full screen', window: true }), ui.iconButton({ icon: 'close', label: 'Close window', window: true }));
});
const iconButton: Story = {
  id: 'components/icon-button', title: 'Icon button', area: 'components', kind: 'component', covers: ['ui.iconButton', 'ui.icon'], mock: SPEC,
  states: {
    typical: ibTypical,
    ...forced(ibTypical, '.ui-ib'),
    disabled: stage(['disabled'], ({ root }) => { line(root, ui.iconButton({ icon: 'back', label: 'Back', disabled: true }), ui.iconButton({ icon: 'forward', label: 'Forward', disabled: true })); }),
    long: stage(['long'], ({ root }) => { line(root, ui.iconButton({ icon: 'gear', label: LONG_TITLE, keys: 'mod+shift+alt+K' })); }),
    'every icon': stage(['many', 'variant'], ({ root }) => { line(root, ...ui.icons.map((n) => ui.iconButton({ icon: n, label: n, tip: false }))); }, { width: 720 }),
    'tooltip open': stage(['tooltip'], async ({ root, wait }) => {
      const b = ui.iconButton({ icon: 'sidebar-left', label: 'Hide sidebar', keys: 'mod+B' }); line(root, b); b.focus(); ui.tooltip.show(b); await wait(250);
    }, { overlay: { anchor: '.ui-ib', layer: '.ui-tip' } })
  }
};


const holdTypical = stage(['typical', 'variant'], ({ root }) => { line(root, ui.hold({}), ui.hold({ fill: 'solid' }), ui.hold({ label: 'Hold to install' })); });
const hold: Story = {
  id: 'components/hold', title: 'Hold to approve', area: 'components', kind: 'component', covers: ['ui.hold'], mock: { url: '/v6/design-system/index.html#c-hold', crop: '#c-hold' },
  states: {
    typical: holdTypical, ...forced(holdTypical, '.ui-hold'),
    holding: stage(['active'], async ({ root, wait }) => {
      const h = ui.hold({}); line(root, h);
      const b = h.matches('.ui-hold') ? h : h.querySelector('.ui-hold') as HTMLElement;
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })); await wait(500);
    }, { note: 'half held', allow: { 'stability.render': 'the fill is time based' } }),
    long: stage(['long'], ({ root }) => { line(root, ui.hold({ label: 'Hold to approve the deploy of ' + UNBROKEN })); }, { width: 360 }),
    'on the dock': stage(['variant'], ({ root }) => { line(root, ui.hold({})); }, { ground: 'dock' })
  }
};

export default [button, iconButton, hold];
