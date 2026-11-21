/* Settings (14.21): every tab of the dialog, its tab bar and segmented controls (Rail/Hide, Auto/Integrated/Dedicated)
   at rest, hovered and focused, the dialog scrolled (the scrollbar), the Appearance customizer stepped aside. First run has its
   own file (first-run.stories.ts). */
import type { AppCtx, State, Story } from '../../types';

const MOCK = { url: '/v6/__index.html', note: 'Settings is mod+, in the mock' };
const open = async (c: AppCtx): Promise<void> => { document.body.focus(); await c.key(',', { ctrlKey: true }); await c.wait(500); };
const tab = (id: string) => async (c: AppCtx): Promise<void> => { await open(c); await c.click('#hx-dtab-' + id); await c.wait(500); };
const st = (tags: State['tags'], setup: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, app: { setup }, ...extra });
const scrollEnd = async (c: AppCtx): Promise<void> => { for (const n of document.querySelectorAll<HTMLElement>('#hx-settings *')) if (n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY)) n.scrollTop = n.scrollHeight; await c.wait(200); };

const settings: Story = {
  id: 'settings/dialog', title: 'Settings', area: 'settings', kind: 'surface', covers: ['surface:settings', 'surface:settings-general', 'surface:settings-models', 'surface:settings-connectors', 'surface:settings-appearance', 'surface:settings-keys'],
  scope: '#hx-settings', mock: MOCK,
  states: {
    general: st(['typical'], open),
    'general, scrolled (the scrollbar)': st(['scroll', 'owner'], async (c) => { await open(c); await scrollEnd(c); }),
    models: st(['variant'], tab('models')),
    connectors: st(['variant'], tab('connectors')),
    appearance: st(['variant'], tab('appearance'), { scope: '#hx-settings, .hxt, [class*="hxt-"]' }),
    'appearance, scrolled': st(['scroll'], async (c) => { await tab('appearance')(c); await scrollEnd(c); }),
    keyboard: st(['variant', 'scroll'], tab('keys')),
    'tab bar hover': st(['hover', 'owner'], open, { force: [{ sel: '#hx-settings .hx-dtab:nth-of-type(2)', state: 'hover' }] }),
    'tab bar focus': st(['focus', 'owner'], open, { force: [{ sel: '#hx-settings .hx-dtab[aria-selected="true"]', state: 'focus' }] }),
    'segmented hover': st(['hover', 'owner'], open, { force: [{ sel: '#hx-settings .ui-seg__opt:not([aria-checked="true"])', state: 'hover' }] }),
    'segmented focus': st(['focus', 'owner'], open, { force: [{ sel: '#hx-settings .ui-seg__opt[aria-checked="true"]', state: 'focus' }] }),
    'segmented pressed': st(['active', 'owner'], open, { force: [{ sel: '#hx-settings .ui-seg__opt', state: 'active' }] }),
    'close tooltip': st(['tooltip'], async (c) => { await open(c); const b = c.$('#hx-settings-close'); b.focus(); c.hx.ui.tooltip.show(b); await c.wait(250); }, { overlay: { anchor: '#hx-settings-close', layer: '.ui-tip' } })
  }
};

export default settings;
