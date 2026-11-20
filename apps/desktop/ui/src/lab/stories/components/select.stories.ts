/* The themed select and the listbox it opens (design system 14.32, R-select-*), which replace every native select:
   closed and open, grouped models with their marks, a long list that scrolls, long labels, invalid and disabled. */
import { ui } from '@boopis/ui';
import { forced, line, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';
import { FOOT_GOVERNED, FOOT_UNGOVERNED, SMART_VALUE, modelEntries } from '../../../modules/session/model-menu';
import type { ModelChoice } from '../../../data';

/* the "who answers next" menu: the Claude subscription's ladder (a tier each), the ChatGPT subscription, and a model nobody listed */
const P = 'claude-subscription-directsdk-experimental';
const CHOICES: ModelChoice[] = [
  { value: P + '/haiku', provider: P, model: 'haiku', providerName: 'Claude subscription', tier: 0, tierName: 'haiku' },
  { value: P + '/sonnet', provider: P, model: 'sonnet', providerName: 'Claude subscription', tier: 1, tierName: 'sonnet' },
  { value: P + '/opus', provider: P, model: 'opus', providerName: 'Claude subscription', tier: 2, tierName: 'opus' },
  { value: 'openai-codex/gpt-6-luna', provider: 'openai-codex', model: 'gpt-6-luna', providerName: 'ChatGPT subscription' },
  { value: 'openai-codex/gpt-5.1-codex-mini', provider: 'openai-codex', model: 'gpt-5.1-codex-mini', providerName: 'ChatGPT subscription' },
  { value: 'gemini/gemini-3.8-flash', provider: 'gemini', model: 'gemini-3.8-flash', providerName: 'Gemini' }
];
const nextMenu = (o: { governed: boolean; value: string; current: string; label: string; model?: string }) => stage(['open', 'owner'], async ({ root, wait }) => {
  const c = ui.chip(o.value === SMART_VALUE ? { label: 'Smart', icon: 'spark', haspopup: 'menu' } : { model: o.model ?? o.value, haspopup: 'menu' });
  line(root, c);
  ui.listbox.open(c, modelEntries(CHOICES, { current: o.current, governed: o.governed }), { value: o.value, label: 'Who answers next', foot: o.governed ? FOOT_GOVERNED : FOOT_UNGOVERNED });
  await wait(260);
}, { overlay: { anchor: '.ui-chip', layer: '.ui-listbox' } });

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
      'who answers next, Smart on': nextMenu({ governed: false, value: SMART_VALUE, current: P + '/haiku', label: 'Smart' }),
      'who answers next, a model chosen': nextMenu({ governed: false, value: P + '/sonnet', current: P + '/sonnet', label: 'Claude Sonnet' }),
      'who answers next, governed (off-ladder models disabled)': nextMenu({ governed: true, value: P + '/sonnet', current: P + '/sonnet', label: 'Claude Sonnet' }),
      'who answers next, the answering model is not listed': nextMenu({ governed: false, value: 'ollama/qwen3-coder:30b', current: 'ollama/qwen3-coder:30b', label: 'Qwen3 Coder 30B' }),
      empty: stage(['empty', 'open'], async ({ root, wait }) => { const c = ui.chip({ label: 'Pick', haspopup: 'listbox' }); line(root, c); ui.listbox.open(c, [], { label: 'Nothing' }); await wait(260); }, { overlay: { anchor: '.ui-chip', layer: '.ui-listbox' } })
    }
  }
] satisfies Story[];
