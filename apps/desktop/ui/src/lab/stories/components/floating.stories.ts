/* Floating surfaces: menus (still and open against an anchor, with overflow), popovers, the layer, tooltips, toasts
   (14.18, 14.19, 14.22, 14.23). */
import { html, ui, type MenuEntry } from '@boopis/ui';
import { line, put, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';
import { governedUnavailableEntries } from '../../../modules/session/model-menu';

const FLOAT = { url: '/v6/design-system/index.html#c-float', crop: '#c-float' };
const ITEMS: MenuEntry[] = [
  { title: 'Session' }, { label: 'Rename', icon: 'edit', keys: 'F2' }, { label: 'Fork', icon: 'fork' }, { label: 'Archive', icon: 'archive', keys: 'mod+backspace' }, '-',
  { label: 'Copy link', icon: 'copy', desc: 'boopis://session/s1' }, { label: 'Delete', icon: 'trash', disabled: true }, { foot: 'Archived sessions stay searchable.' }
];
const MODELS: MenuEntry[] = [{ label: 'Smart', desc: 'Picks the model for each message', checked: true }, '-', ...['opus 5.5', 'sonnet 5.5', 'haiku 4.5', 'qwen3-coder'].map((m) => ({ model: m, label: m, checked: false }))];
const NO_FRONTIER = { available: false, why: 'Governed mode cannot run: the saved ladder has no frontier model (tier \'free\' runs nous/nous/welcome).', sentence: 'Claude Opus 5.5 or later, Claude Fable 5.2 or later, GPT-6.1 Terra or later, GPT-6.2 Astra or later, GPT-6.2 Sol or later, Gemini 4 Carbon or later, Gemini 4 Neon or later, Gemini 4 Hydrogen or later and Grok 4.7 or later', allowed: ['Claude Opus 5.5', 'Claude Fable 5.2', 'GPT-6.1 Terra', 'GPT-6.2 Astra', 'GPT-6.2 Sol', 'Gemini 4 Carbon', 'Gemini 4 Neon', 'Gemini 4 Hydrogen', 'Grok 4.7'] };
const many = (n: number): MenuEntry[] => Array.from({ length: n }, (_, i) => ({ label: 'Item ' + i, keys: i < 9 ? 'mod+' + (i + 1) : undefined } as MenuEntry));

async function openMenu(root: HTMLElement, items: readonly MenuEntry[], o: { place?: 'above' | 'below'; align?: 'start' | 'end' | 'center' } = {}, wait?: (ms: number) => Promise<void>): Promise<void> {
  const a = ui.button({ label: 'Open menu', attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
  line(root, a);
  ui.menu.open(a, items, { label: 'Session', ...o });
  await wait?.(260);
}

export default [
  {
    id: 'components/menu', title: 'Menu', area: 'components', kind: 'component', covers: ['ui.menu', 'html.menuItems'], mock: FLOAT,
    states: {
      typical: stage(['typical', 'variant'], ({ root }) => { line(root, ui.menu.still(ITEMS, { label: 'Session' }), ui.menu.still(MODELS, { label: 'Model' })); }),
      hover: stage(['hover'], ({ root }) => { line(root, ui.menu.still(ITEMS, { label: 'Session' })); }, { force: [{ sel: '.ui-menu__item:nth-of-type(2)', state: 'hover' }] }),
      focus: stage(['focus'], ({ root }) => { line(root, ui.menu.still(ITEMS, { label: 'Session' })); }, { force: [{ sel: '.ui-menu__item:nth-of-type(2)', state: 'focus' }] }),
      open: stage(['open'], ({ root, wait }) => openMenu(root, ITEMS, {}, wait), { overlay: { anchor: '.ui-btn', layer: '.ui-menu' } }),
      'open, end aligned': stage(['open', 'variant'], async ({ root, wait }) => { root.style.alignItems = 'flex-end'; root.style.width = '100%'; await openMenu(root, MODELS, { align: 'end' }, wait); }, { overlay: { anchor: '.ui-btn', layer: '.ui-menu' } }),
      'many, scrolling': stage(['many', 'scroll', 'open'], ({ root, wait }) => openMenu(root, many(80), {}, wait), { overlay: { anchor: '.ui-btn', layer: '.ui-menu' } }),
      empty: stage(['empty'], ({ root }) => { line(root, ui.menu.still([], { label: 'Nothing' })); }),
      'governed mode unavailable (the Governed chip)': stage(['open', 'error'], ({ root, wait }) => openMenu(root, governedUnavailableEntries(NO_FRONTIER), { place: 'above' }, wait), { overlay: { anchor: '.ui-btn', layer: '.ui-menu' } }),
      'governed mode unavailable, at rest': stage(['variant'], ({ root }) => { line(root, ui.menu.still(governedUnavailableEntries(NO_FRONTIER), { label: 'Governed mode is unavailable' })); }, { width: 360 }),
      long: stage(['long'], ({ root }) => { line(root, ui.menu.still([{ label: LONG_TITLE, desc: UNBROKEN, keys: 'mod+shift+alt+K' }, { label: UNBROKEN, stamp: 'needs you' }], { label: 'Long' })); })
    }
  },
  {
    id: 'components/popover', title: 'Popover and layer', area: 'components', kind: 'component', covers: ['ui.popover', 'ui.layer'], mock: FLOAT,
    states: {
      typical: stage(['typical', 'open'], async ({ root, wait }) => {
        const a = ui.button({ label: 'Edit', attrs: { 'aria-haspopup': 'dialog' } }); line(root, a);
        const body = document.createElement('div'); body.innerHTML = html.field({ label: 'Title', value: 'proration drift' }) + html.button({ label: 'Save', variant: 'primary', size: 's' });
        ui.popover.open(a, body, { label: 'Rename' }); await wait(260);
      }, { overlay: { anchor: '.ui-btn', layer: '.ui-pop' } }),
      above: stage(['variant', 'open'], async ({ root, wait }) => {
        root.style.minHeight = 'calc(100vh - 48px)'; root.style.justifyContent = 'flex-end';
        const a = ui.button({ label: 'Edit' }); line(root, a);
        const body = document.createElement('div'); body.innerHTML = html.field({ label: 'Title', value: 'proration drift' });
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
  },
  {
    id: 'components/toast', title: 'Toast', area: 'components', kind: 'component', covers: ['ui.toast', 'html.toast'], mock: FLOAT,
    states: {
      typical: stage(['typical', 'variant'], ({ root }) => { put(root, html.toast('Archived audit log export'), html.toast('Archived audit log export', 'Undo')); }),
      live: stage(['success'], async ({ wait }) => { ui.toast('Archived audit log export', { action: { label: 'Undo' }, ms: 60000 }); await wait(300); }, { scope: '.ui-toast', note: 'the real toast, placed at the top of the work' }),
      long: stage(['long'], ({ root }) => { put(root, html.toast(LONG_TITLE + ' ' + UNBROKEN, 'Undo')); }, { width: 480 })
    }
  }
] satisfies Story[];
