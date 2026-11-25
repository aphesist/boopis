/* Settings on the v7 kit: every page of the large Dialog, its nav and Segmented controls (Rail/Hide, the interface size) at rest,
   hovered and focused, the dialog scrolled (the scrollbar), the Appearance choices, an explanation open. First run has its
   own file (first-run.stories.ts). */
import type { AppCtx, State, Story } from '../../types';

const MOCK = { url: '/v6/__index.html', note: 'Settings on the v7 kit (wave C): the large Dialog and its settings Pages; the approved board (ds-v7 screen 14) is not in this repository' };
const open = async (c: AppCtx): Promise<void> => { document.body.focus(); await c.key(',', { ctrlKey: true }); await c.wait(500); };
const tab = (id: string) => async (c: AppCtx): Promise<void> => { await open(c); await c.click('#hx-dtab-' + id); await c.wait(500); };
const st = (tags: State['tags'], setup: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, app: { setup }, ...extra });
const scrollEnd = async (c: AppCtx): Promise<void> => { for (const n of document.querySelectorAll<HTMLElement>('#hx-settings *')) if (n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY)) n.scrollTop = n.scrollHeight; await c.wait(200); };

/* the window behind the dialog is still the v6 shell (wave C's shell-bots moves it, and the dock with it): its dock is not the kit's yet */
const SHELL = { 'same-component': { reason: 'the v6 dock behind the dialog: the shell and the dock move to the v7 kit on their own branches (wave C)', el: 'hx-dock-slot' } } as const;
const stv = (tags: State['tags'], setup: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => st(tags, setup, { allow: SHELL, ...extra });
const seg = (id: string, which: string): string => '#' + id + ' [data-kit-part~="SegmentedItem"]' + which;

const settings: Story = {
  id: 'settings/dialog', title: 'Settings', area: 'settings', kind: 'surface', v7: true, covers: ['surface:settings', 'surface:settings-general', 'surface:settings-models', 'surface:settings-connectors', 'surface:settings-appearance', 'surface:settings-keys'],
  scope: '#hx-settings', mock: MOCK,
  states: {
    general: stv(['typical'], open),
    'general, scrolled (the scrollbar)': stv(['scroll', 'owner'], async (c) => { await open(c); await scrollEnd(c); }),
    models: stv(['variant'], tab('models')),
    connectors: stv(['variant'], tab('connectors')),
    appearance: stv(['variant'], tab('appearance')),
    'appearance, a larger interface chosen': stv(['variant'], async (c) => { await tab('appearance')(c); await c.click(seg('hx-ui-size', ':nth-of-type(2)')); await c.wait(300); }),
    'appearance, rounder corners': stv(['variant'], async (c) => { await tab('appearance')(c); await c.click(seg('hx-set-radii', '[data-value="c"]')); await c.wait(300); }),
    'appearance, a custom accent': stv(['variant'], async (c) => { await tab('appearance')(c); const i = c.$('#hx-set-accent') as HTMLInputElement; i.value = '#2b72e5'; i.dispatchEvent(new Event('input', { bubbles: true })); await c.wait(300); }),
    'appearance, an accent that is not a colour': stv(['error'], async (c) => { await tab('appearance')(c); const i = c.$('#hx-set-accent') as HTMLInputElement; i.value = '#zzzzzz'; i.dispatchEvent(new Event('input', { bubbles: true })); await c.wait(300); }),
    'interface size focus': stv(['focus'], tab('appearance'), { force: [{ sel: seg('hx-ui-size', '[aria-checked="true"]'), state: 'focus' }] }),
    'appearance, scrolled': stv(['scroll'], async (c) => { await tab('appearance')(c); await scrollEnd(c); }),
    keyboard: stv(['variant', 'scroll'], tab('keys')),
    'nav hover': stv(['hover', 'owner'], open, { force: [{ sel: '#hx-dtab-models', state: 'hover' }] }),
    'nav focus': stv(['focus', 'owner'], open, { force: [{ sel: '#hx-dtab-general', state: 'focus' }] }),
    'segmented hover': stv(['hover', 'owner'], open, { force: [{ sel: seg('hx-set-collapse', ':not([aria-checked="true"])'), state: 'hover' }] }),
    'segmented focus': stv(['focus', 'owner'], open, { force: [{ sel: seg('hx-set-collapse', '[aria-checked="true"]'), state: 'focus' }] }),
    'segmented pressed': stv(['active', 'owner'], open, { force: [{ sel: seg('hx-set-collapse', ''), state: 'active' }] }),
    'an explanation open': stv(['open'], async (c) => { await open(c); const b = c.$('#hx-set-layout .k7-info'); b.click(); await c.wait(250); }, { overlay: { anchor: '#hx-set-layout .k7-info', layer: '.k7-pop' } }),
    'close tooltip': stv(['tooltip'], async (c) => { await open(c); const b = c.$('#hx-settings-close'); b.focus(); c.hx.ui.tooltip.show(b); await c.wait(250); }, { overlay: { anchor: '#hx-settings-close', layer: '.ui-tip' } })
  }
};

export default settings;
