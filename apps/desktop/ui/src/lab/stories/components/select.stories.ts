/* The themed select and the listbox it opens (design system 14.32, R-select-*), which replace every native select:
   closed and open, grouped models with their marks, a long list that scrolls, long labels, invalid and disabled. */
import { ui } from '../../kit';
import { forced, line, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';

const FONTS = ['Libre Franklin', 'Geist', 'IBM Plex Sans', 'Instrument Sans', 'Public Sans', 'Geist Mono', 'IBM Plex Mono', 'System'];
const MODELS = ['opus 5.5', 'sonnet 5.5', 'haiku 4.5', 'qwen3-coder', 'gpt-5', 'gemini-3-pro'];
const MOCK = { url: '/v6/design-system/index.html#c-fields', crop: '#c-fields' };
const sel = (o: Partial<Parameters<typeof ui.select>[0]> = {}) => ui.select({ label: 'Interface font', entries: FONTS.map((f) => ({ value: f })), value: 'Geist', ...o });

const typical = stage(['typical', 'variant'], ({ root }) => {
  line(root, sel(), sel({ mono: true, value: 'IBM Plex Mono', label: 'Code font' }), sel({ raised: true }));
  line(root, ui.select({ label: 'Model', entries: ui.modelEntries(MODELS), value: 'sonnet 5.5' }));
}, { width: 640 });
async function openIt(root: HTMLElement, s: HTMLElement, wait: (ms: number) => Promise<void>): Promise<void> {
  line(root, s);
  s.click();
  await wait(260);
}

export default [
  {
    id: 'components/select', title: 'Select', area: 'components', kind: 'component', covers: ['ui.select', 'ui.wireSelect', 'ui.modelEntries'], mock: MOCK,
    states: {
      typical, ...forced(typical, '.ui-select, [role="combobox"]'),
      'no value': stage(['empty'], ({ root }) => { line(root, sel({ value: null, placeholder: 'Pick a font' })); }),
      invalid: stage(['error'], ({ root }) => { line(root, sel({ invalid: true, value: null, placeholder: 'Pick a font' })); }),
      disabled: stage(['disabled'], ({ root }) => { line(root, sel({ disabled: true })); }),
      long: stage(['long'], ({ root }) => { line(root, ui.select({ label: 'Long', entries: [{ value: 'a', label: LONG_TITLE }, { value: 'b', label: UNBROKEN }], value: 'a' })); }, { width: 360 }),
      open: stage(['open'], ({ root, wait }) => openIt(root, sel(), wait), { overlay: { anchor: '.ui-select, [role="combobox"]', layer: '.ui-listbox' } }),
      'open, models grouped': stage(['open', 'variant'], ({ root, wait }) => openIt(root, ui.select({ label: 'Model', entries: ui.modelEntries(MODELS), value: 'sonnet 5.5' }), wait), { overlay: { anchor: '.ui-select, [role="combobox"]', layer: '.ui-listbox' } }),
      'open, 120 options scrolling': stage(['many', 'scroll', 'open'], ({ root, wait }) => openIt(root, ui.select({ label: 'Many', entries: Array.from({ length: 120 }, (_, i) => ({ value: 'o' + i, label: 'Option ' + i })), value: 'o3' }), wait), { overlay: { anchor: '.ui-select, [role="combobox"]', layer: '.ui-listbox' } }),
      'open near the bottom (flips above)': stage(['open', 'variant'], async ({ root, wait }) => { root.style.minHeight = 'calc(100vh - 48px)'; root.style.justifyContent = 'flex-end'; await openIt(root, sel(), wait); }, { overlay: { anchor: '.ui-select, [role="combobox"]', layer: '.ui-listbox' } })
    }
  },
  {
    id: 'components/listbox', title: 'Listbox (a chip\'s picker)', area: 'components', kind: 'component', covers: ['ui.listbox'], mock: MOCK,
    states: {
      typical: stage(['typical', 'open'], async ({ root, wait }) => { const c = ui.chip({ model: 'sonnet 5.5', haspopup: 'listbox' }); line(root, c); ui.listbox.open(c, ui.modelEntries(MODELS), { value: 'sonnet 5.5', label: 'Model' }); await wait(260); }, { overlay: { anchor: '.ui-chip', layer: '.ui-listbox' } }),
      long: stage(['long', 'open'], async ({ root, wait }) => { const c = ui.chip({ label: 'Pick', haspopup: 'listbox' }); line(root, c); ui.listbox.open(c, [{ value: 'a', label: LONG_TITLE, desc: UNBROKEN }, { value: 'b', label: UNBROKEN }], { value: 'a', label: 'Long' }); await wait(260); }, { overlay: { anchor: '.ui-chip', layer: '.ui-listbox' } }),
      empty: stage(['empty', 'open'], async ({ root, wait }) => { const c = ui.chip({ label: 'Pick', haspopup: 'listbox' }); line(root, c); ui.listbox.open(c, [], { label: 'Nothing' }); await wait(260); })
    }
  }
] satisfies Story[];
