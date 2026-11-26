/* Settings on the kit (step 7a; boards 14 and S39, and the derived pages): the app booted on the mock with the provider's rules and
   speech scripted (settings-fixtures.ts), the dialog opened at each page in each state. The boards' own states are `boards/settings`.
   Desktop-only parts (Diagnostics, the Local API) are drawn over a scripted host (`setSettingsHost`). */
import type { AppCtx, State, Story } from '../../types';
import { DEFAULT_RULES, DRAFT, EXCEPTION, MODEL, fakeDiagnostics, fakeRules, fakeSpeech, withSettings } from '../../settings-fixtures';
import type { FakeRules } from '../../settings-fixtures';
import { setSettingsHost } from '../../../modules/settings/host';
import type { DataProvider, RulesSource, SpeechSource } from '../../../data';
import type { LocalApiStatus } from '../../../host/local-api';
import { boardS20 } from '../../board-fixtures';

const ON: LocalApiStatus = { enabled: true, running: true, url: 'http://127.0.0.1:47821', token_file: '/home/you/.local/share/dev.aphesist.boopis/client-token', streams: 1, version: 1, problem: null };
const desktop = (): void => {
  setSettingsHost({ desktop: () => false, diagnostics: fakeDiagnostics, localApi: () => ({ status: () => Promise.resolve(ON), setEnabled: () => Promise.resolve(ON), rotate: () => Promise.resolve(ON) }) });
};
const open = (section: string, focus?: string, then?: (c: AppCtx) => Promise<void>) => async (c: AppCtx): Promise<void> => {
  desktop();
  c.hx.setState({ tab: 'bots', left: 'rail', right: 'closed' });
  await c.wait(300);
  c.hx.emit('hx:open-settings', { section, from: 'lab', ...(focus ? { focus } : {}) });
  await c.wait(700);
  if (then) { await then(c); await c.wait(400); }
};
const scrollEnd = async (c: AppCtx): Promise<void> => { const p = c.$('#hx-settings .k7-dialog__page'); p.scrollTop = p.scrollHeight; await c.wait(200); };
const st = (tags: State['tags'], section: string, o: { rules?: RulesSource | null; speech?: SpeechSource | null; focus?: string; then?: (c: AppCtx) => Promise<void>; patch?: (p: DataProvider) => DataProvider; note?: string } = {}, extra: Partial<State> = {}): State => ({
  tags, ...(o.note ? { note: o.note } : {}),
  app: { provider: { patch: (p) => withSettings(o.patch ? o.patch(p) : p, { rules: o.rules === undefined ? fakeRules() : o.rules, speech: o.speech === undefined ? fakeSpeech() : o.speech }) }, setup: open(section, o.focus, o.then) },
  ...extra
});
const click = (sel: string) => async (c: AppCtx): Promise<void> => { await c.click(sel); };
const rules = (o: Parameters<typeof fakeRules>[0] = {}): FakeRules => fakeRules(o);
/** the Session tab's launch controls, as the live provider has them (the mock has none): Sessions' How careful shows */
const launch = (p: DataProvider): DataProvider => { const b = boardS20(p); return { ...p, ...(b.sessionControls ? { sessionControls: b.sessionControls } : {}) }; };

const story: Story = {
  id: 'v7/settings', title: 'Settings (7a, on the kit)', area: 'settings', kind: 'surface', scope: '#hx-settings',
  covers: ['surface:settings', 'surface:settings-general', 'surface:settings-models', 'surface:settings-connectors', 'surface:settings-appearance', 'surface:settings-keys'],
  states: {
    general: st(['typical'], 'general'),
    'general, scrolled to Dock, Window and the Local API': st(['scroll'], 'general', { then: scrollEnd }),
    'general, a nav row hovered': st(['hover'], 'general', {}, { force: [{ sel: '#hx-settings .k7-dialog__navrow:not([aria-current])', state: 'hover' }] }),
    'general, the nav focused': st(['focus'], 'general', {}, { force: [{ sel: '#hx-settings .k7-dialog__navrow[aria-current]', state: 'focus' }] }),
    'general, a check focused': st(['focus'], 'general', {}, { force: [{ sel: '#hx-settings [data-check]', state: 'focus' }] }),
    'general, search shows as: its menu open': st(['open'], 'general', { then: click('#hx-settings [data-select="search-as"]') }, { overlay: { anchor: '#hx-settings [data-select="search-as"]', layer: '[data-kit~="Menu"]' } }),
    'sessions, this device': st(['typical'], 'sessions', { patch: launch }),
    'sessions, this project': st(['variant'], 'sessions', { patch: launch, then: click('#hx-settings [data-scope] [data-value="project"]') }),
    'sessions, how careful: its menu open': st(['open'], 'sessions', { patch: launch, then: click('#hx-settings [data-select="careful"]') }, { overlay: { anchor: '#hx-settings [data-select="careful"]', layer: '[data-kit~="Menu"]' } }),
    bots: st(['typical', 'many'], 'bots'),
    'bots, none': st(['empty'], 'bots', { patch: (p) => ({ ...p, bots: { ...p.bots, snapshot: () => ({ ...p.bots.snapshot(), bots: [] }) } }) }),
    'models (the page build), voice not chosen, the model ready': st(['typical'], 'models', { focus: 'voice' }),
    'models, the speech model not downloaded': st(['empty'], 'models', { focus: 'voice', speech: fakeSpeech({ model: MODEL({ state: 'absent', done: 0 }) }) }),
    'models, the speech model downloading': st(['loading'], 'models', { focus: 'voice', speech: fakeSpeech({ model: MODEL({ state: 'fetching', done: 12_000_000 }) }) }),
    'models, the speech model failed to download': st(['error'], 'models', { focus: 'voice', speech: fakeSpeech({ model: MODEL({ state: 'absent', done: 0, failed: 'boopis could not get its speech model, which it fetches once. Check the connection and press the mic again: it goes on from where it stopped.' }) }) }),
    'models, ElevenLabs with its key kept': st(['success'], 'models', { focus: 'voice', speech: fakeSpeech({ voice: { provider: 'elevenlabs', localUrl: null }, keys: ['elevenlabs'] }) }),
    'models, Fish Audio waiting for its key': st(['variant'], 'models', { focus: 'voice', speech: fakeSpeech({ voice: { provider: 'fish_audio', localUrl: null } }) }),
    'models, a server on this computer': st(['variant', 'long'], 'models', { focus: 'voice', speech: fakeSpeech({ voice: { provider: 'local', localUrl: 'http://127.0.0.1:8880/v1/audio/speech' } }) }),
    'models, the voice menu open': st(['open'], 'models', { focus: 'voice', then: click('#hx-settings [data-select="voice"]') }, { overlay: { anchor: '#hx-settings [data-select="voice"]', layer: '[data-kit~="Menu"]' } }),
    'models, no speech in this build': st(['empty'], 'models', { speech: null }),
    approvals: st(['typical'], 'approvals', { rules: rules({ rules: [...DEFAULT_RULES, EXCEPTION] }) }),
    'approvals, a draft from Always allow (opened at it)': st(['variant'], 'approvals', { focus: 'drafts', rules: rules({ rules: [...DEFAULT_RULES, DRAFT] }) }),
    'approvals, the file changed outside boopis': st(['variant'], 'approvals', { rules: rules({ changedOutside: true }) }),
    'approvals, the rules cannot be read': st(['error'], 'approvals', { rules: rules({ unreadable: true }) }),
    'approvals, nothing asks': st(['empty'], 'approvals', { rules: rules({ rules: [] }) }),
    'approvals, a rule opened to edit': st(['open'], 'approvals', { then: click('#hx-settings [data-rule-edit="default.messages"]') }),
    'approvals, adding a rule': st(['open'], 'approvals', { then: click('#hx-settings [data-rule-add]') }),
    'approvals, after a change (Undo)': st(['success'], 'approvals', { then: click('#hx-settings [data-rule-switch="default.purchases"]') }),
    'approvals, restore defaults asks first': st(['variant'], 'approvals', { then: async (c) => { await scrollEnd(c); await c.click('#hx-settings [data-restore="ask"]'); } }),
    'approvals, a row hovered (Edit and Remove)': st(['hover'], 'approvals', {}, { force: [{ sel: '#hx-settings [data-rule="default.secrets"]', state: 'hover' }] }),
    'approvals, the reviewer failing': st(['error'], 'approvals', { rules: rules({ reviewerStatus: 'failing' }), then: scrollEnd }),
    connectors: st(['empty'], 'connectors', {}, { note: 'the page build: connectors are added in the desktop app (the desktop page is v7/settings-connectors)' }),
    appearance: st(['typical'], 'appearance'),
    'appearance, the accent menu open': st(['open'], 'appearance', { then: click('#hx-settings [data-select="accent"]') }, { overlay: { anchor: '#hx-settings [data-select="accent"]', layer: '[data-kit~="Menu"]' } }),
    'appearance, rounder corners chosen': st(['variant'], 'appearance', { then: click('#hx-settings [data-set="corners"] [data-value="rounder"]') }),
    keyboard: st(['typical', 'long'], 'keys'),
    'keyboard, scrolled': st(['scroll'], 'keys', { then: scrollEnd }),
    diagnostics: st(['typical'], 'diagnostics'),
    'diagnostics, the dedicated GPU chosen (restart to switch)': st(['variant'], 'diagnostics', { then: click('#hx-settings [data-set="gpu"] [data-value="dedicated"]') })
  }
};

export default story;
