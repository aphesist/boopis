/* Settings > Models on the v7 kit (ADR-0037): the governed-mode section and the ladder it marks, drawn from what the host reads,
   as SectionHeads over Cards of Rows (the explanations behind the labels' marks). Moved here from the v6 settings-row story. */
import { governedRows, ladderRows } from '../../../host/models-tab';
import { setSection } from '../../../host/plan-view';
import type { ModelsView } from '../../../host/setup-bridge';
import { stage } from '../../story';
import type { Story } from '../../types';

const SENTENCE = 'Claude Opus 5.5 or later, Claude Fable 5.2 or later, GPT-6.1 Terra or later, GPT-6.2 Astra or later, GPT-6.2 Sol or later, Gemini 4 Carbon or later, Gemini 4 Neon or later, Gemini 4 Hydrogen or later and Grok 4.7 or later';
const ALLOWED = ['Claude Opus 5.5', 'Claude Fable 5.2', 'GPT-6.1 Terra', 'GPT-6.2 Astra', 'GPT-6.2 Sol', 'Gemini 4 Carbon', 'Gemini 4 Neon', 'Gemini 4 Hydrogen', 'Grok 4.7'];
const HEAVY_NAMES = ['Claude Fable 5.2', 'Gemini 4 Carbon', 'Grok 4.7'];
const FABLE_CHOICE: ModelsView['heavy'][number] = { id: 'fable', label: 'Climb to Fable', applies: true, on: false, blocked: null, reason: 'Fable is token-heavy: Ramp\u2019s benchmark measured $3.79 a task against Opus\u2019s $1.53, and on a Claude Pro plan it bills usage credits from the first request. So boopis never adds it by itself. Off: governed work stays on Opus, and a failed gate retries there. On: Fable is the top tier, and a failed gate climbs to it.' };
const GROK_CHOICE: ModelsView['heavy'][number] = { id: 'grok', label: 'Use Grok', applies: false, on: false, blocked: null, reason: 'Grok 4.7 is token-heavy: Ramp\u2019s benchmark measured it at $4.32 a task, with the most tool calls of any model (161 a task). So boopis never adds it by itself. Off: boopis does not run governed work on it. On: Grok is the top tier of the ladder.' };
const CP = 'claude-subscription-directsdk-experimental';
const CARBON_CHOICE: ModelsView['heavy'][number] = { id: 'carbon', label: 'Use Gemini 4 Carbon', applies: true, on: false, blocked: null, reason: 'Gemini 4 Carbon is the costliest frontier model in Ramp\u2019s benchmark: $5.19 a task against Neon\u2019s $4.38 and Hydrogen\u2019s $3.24, and it solved 72.6% where Neon solved 76.2%. So boopis never adds it by itself. Off: governed work stays on Hydrogen and Neon. On: Carbon is the top tier of the ladder.' };
const GEMINI_TIERS = [{ name: 'hydrogen', model: 'gemini/gemini-4-hydrogen' }, { name: 'neon', model: 'gemini/gemini-4-neon' }];

const MODELS_VIEW = (governed: ModelsView['governed'], tiers: ModelsView['tiers']): ModelsView => ({
  state: 'set', tiers, governed, heavy: [FABLE_CHOICE, GROK_CHOICE], claude_plugin: true, chatgpt: null, gemini_key: false,
  claude: { state: 'signed_in', version: '2.1.328', plan: 'Claude Max', detail: '', aliases: [] }
});
const draw = (view: ModelsView) => ({ root }: { root: HTMLElement }): void => {
  root.append(setSection('lab-gov', 'Governed mode', governedRows(view)), setSection('lab-ladder', 'Model ladder', ladderRows(view)));
};
const OPUS_TIER = [{ name: 'opus', model: CP + '/opus' }];
const FABLE_TIERS = [...OPUS_TIER, { name: 'fable', model: CP + '/fable' }];
const OK_TIERS = OPUS_TIER;
const CHEAP_TIERS = [{ name: 'haiku', model: CP + '/haiku' }, { name: 'sonnet', model: CP + '/sonnet' }, { name: 'opus', model: CP + '/opus' }];
const govView = (tiers: ModelsView['tiers'], why: string | null): ModelsView => MODELS_VIEW({ allowed: ALLOWED, heavy: HEAVY_NAMES, sentence: SENTENCE, available: why === null, why, tiers: tiers.map((t) => ({ ...t, frontier: !/haiku|sonnet|welcome/.test(t.model), heavy: /fable|grok/.test(t.model) })) }, tiers);
const models: Story = {
  id: 'settings/models', title: 'Settings: Models', area: 'settings', kind: 'surface', v7: true, covers: ['surface:settings-models-governed'],
  states: {
    'governed mode, available': stage(['typical', 'variant'], draw(govView(OK_TIERS, null)), { width: 680 }),
    'governed mode, unavailable: no frontier model': stage(['variant', 'error'], draw(govView([{ name: 'free', model: 'nous/nous/welcome' }], 'tier \'free\' runs nous/nous/welcome, which is not a frontier model: it is not in a family on that list')), { width: 680 }),
    'governed mode, a ladder with cheap tiers marked': stage(['variant', 'long'], draw(govView(CHEAP_TIERS, 'tier \'haiku\' runs ' + CP + '/haiku, which is not a frontier model: it is not in a family on that list')), { width: 680 }),
    'governed mode, the heavy switches: Fable off, then on': stage(['variant'], ({ root }) => {
      for (const [on, tiers] of [[false, OPUS_TIER], [true, FABLE_TIERS]] as const) {
        const view: ModelsView = { ...govView(tiers, null), heavy: [{ ...FABLE_CHOICE, on }, GROK_CHOICE] };
        root.append(setSection('lab-gov-' + String(root.childElementCount), 'Governed mode', governedRows(view)));
      }
    }, { width: 680 }),
    'governed mode, the Carbon switch on a Gemini ladder, off then on': stage(['variant'], ({ root }) => {
      for (const on of [false, true]) {
        const tiers = on ? [...GEMINI_TIERS, { name: 'carbon', model: 'gemini/gemini-4-carbon' }] : GEMINI_TIERS;
        const view: ModelsView = { ...govView(tiers, null), heavy: [{ ...FABLE_CHOICE, applies: false }, { ...GROK_CHOICE }, { ...CARBON_CHOICE, on }] };
        root.append(setSection('lab-gov-' + String(root.childElementCount), 'Governed mode', governedRows(view)));
      }
    }, { width: 680 }),
    'governed mode, the Grok switch on and off beside Fable on': stage(['variant'], ({ root }) => {
      for (const grokOn of [false, true]) {
        const tiers = grokOn ? [...FABLE_TIERS, { name: 'grok', model: 'xai/grok-4.7' }] : FABLE_TIERS;
        const view: ModelsView = { ...govView(tiers, null), heavy: [{ ...FABLE_CHOICE, on: true }, { ...GROK_CHOICE, applies: true, on: grokOn }] };
        root.append(setSection('lab-gov-' + String(root.childElementCount), 'Governed mode', governedRows(view)));
      }
    }, { width: 680 }),
    'governed mode, an xAI key alone: unavailable until Grok is on': stage(['variant', 'error'], ({ root }) => {
      const view: ModelsView = { ...govView([], 'no ladder is saved, and the only frontier model an xAI key reaches is Grok 4.7 or later, a heavy model that governed mode runs only when you turn it on. Turn on Grok below'), state: 'default', heavy: [{ ...FABLE_CHOICE, applies: false }, { ...GROK_CHOICE, applies: true }] };
      root.append(setSection('lab-xai', 'Governed mode', governedRows(view)));
    }, { width: 680 }),
  }
};
export default models;
