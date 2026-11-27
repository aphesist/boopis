/* The first run's setup (modules/onboarding/setup.ts; boards O-P01 to O-P04): every step of the whole-window pages, drawn by the module
   itself against a scripted setup host and a providers host with the boards' content (lab/onboarding-fixtures.ts). The lab has no host,
   so the window's three glyphs show. */
import { runFirstRun } from '../../../modules/onboarding/setup';
import type { FirstRunOptions } from '../../../modules/onboarding/setup';
import type { LaterFeature } from '../../../data/types';
import type { ProviderState } from '../../../host/providers-bridge';
import type { SetupStatus } from '../../../host/setup-bridge';
import { AT_CONSENT, AT_MODELS, BLOCKED, DECLINED, DONE, FOUND, NOT_SIGNED_IN, OLLAMA, providerStates, providersHost, ScriptedSetup, signinsFor } from '../../onboarding-fixtures';
import { emit } from '../../../core/bus';
import { frames } from '../../story';
import type { Render, State, Story } from '../../types';

interface Run { script: SetupStatus[]; hang?: boolean; list?: ProviderState[]; probe?: ProviderState[]; opts?: Partial<FirstRunOptions>; start?: boolean; then?: (root: HTMLElement) => Promise<void> | void; layout?: 'close' | 'mac' }
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const press = async (root: HTMLElement, sel: string, ms = 500): Promise<void> => { root.querySelector<HTMLElement>(sel)?.click(); await wait(ms); };
export const drawSetup = (r: Run): Render => async ({ root }) => {
  void runFirstRun(new ScriptedSetup(r.script, r.hang), root, { providers: providersHost(r.list ?? providerStates(), r.probe ?? []), signins: signinsFor(), ...r.opts });
  await wait(200);
  if (r.layout) { emit('hx:window-controls', { layout: r.layout }); await frames(2); }
  if (r.start !== false) await press(root, '[data-setup="start"]', 600);
  if (r.then) await r.then(root);
  (document.activeElement as HTMLElement | null)?.blur();   /* the boards draw the page at rest */
  await frames(3);
};
const S = (tags: State['tags'], r: Run, extra: Partial<State> = {}): State => ({ tags, render: drawSetup(r), scope: '.hx-first-run', ...extra });
const DRAFTS: ReadonlySet<LaterFeature> = new Set(['drafts']);
const found = (): ProviderState[] => providerStates(FOUND);
const ollama = (): ProviderState[] => providerStates({ 'ollama.local': OLLAMA }).filter((s) => s.way === 'ollama.local');
const apply = (root: HTMLElement): Promise<void> => press(root, '[data-setup="apply"]', 700);
const onTry = async (root: HTMLElement): Promise<void> => { await press(root, '[data-setup="use"]', 700); };

export const SETUP_STATES = {
  'O-P01 hello': S(['typical', 'owner'], { script: [AT_CONSENT], start: false }, { note: 'board O-P01: the hero logomark, "Let’s start", Skip setup' }),
  'O-P01b the engine getting ready': S(['loading', 'owner'], { script: [AT_CONSENT], hang: true }, { note: 'board O-P01b: the unpack’s figure from the host' }),
  'O-P02 the settings boopis needs': S(['variant', 'owner'], { script: [AT_CONSENT] }, { note: 'board O-P02: the three settings, Apply the changes, Not now; no way out' }),
  'O-P03 a model found': S(['variant', 'owner'], { script: [AT_CONSENT, AT_MODELS], list: found(), probe: ollama(), then: apply }, { note: 'board O-P03: what this computer has, Claude chosen' }),
  'O-P03b nothing found': S(['empty', 'owner'], { script: [AT_CONSENT, AT_MODELS], then: apply }, { note: 'board O-P03b: two plans and a free key' }),
  'O-P03c signing in': S(['loading', 'owner'], { script: [AT_CONSENT, AT_MODELS], then: async (root) => { await apply(root); await onTry(root); } }, { note: 'board O-P03c: Claude’s sign-in waits in the browser' }),
  'O-P03d the sign-in did not finish': S(['error', 'owner'], { script: [AT_CONSENT, AT_MODELS], opts: { signins: signinsFor(() => Promise.resolve(NOT_SIGNED_IN)) }, then: async (root) => { await apply(root); await onTry(root); } }, { note: 'board O-P03d: Claude Code is here and not signed in; the line to run' }),
  'O-P03e offline': S(['error', 'owner'], { script: [AT_CONSENT, AT_MODELS], list: found(), probe: ollama(), opts: { online: () => false }, then: apply }, { note: 'board O-P03e: the Notice over the models' }),
  'more ways (Add another)': S(['open'], { script: [AT_CONSENT, AT_MODELS], list: found(), probe: ollama(), then: async (root) => { await apply(root); await press(root, '[data-setup="more"]'); } }),
  'a key in place': S(['open'], { script: [AT_CONSENT, AT_MODELS], then: async (root) => { await apply(root); await press(root, '[data-value="google.key"]'); } }),
  'O-P04b Try it, a mark open (recorded)': S(['variant', 'owner'], { script: [AT_CONSENT, AT_MODELS, DONE], list: found(), opts: { later: DRAFTS }, then: async (root) => { await apply(root); await onTry(root); } }, { note: 'board O-P04d: the recorded example, its reading open above the mark' }),
  'O-P04c keep reading your drafts': S(['variant', 'owner'], { script: [AT_CONSENT, AT_MODELS, DONE], list: found(), opts: { later: DRAFTS }, then: async (root) => { await apply(root); await onTry(root); await press(root, '[data-fr-reading] [data-kit~="MenuRow"]'); } }, { note: 'board O-P04c' }),
  'a step stopped': S(['error'], { script: [BLOCKED] }),
  'the settings declined': S(['disabled'], { script: [DECLINED] }),
  'close only (a tiling desktop)': S(['variant'], { script: [AT_CONSENT], start: false, layout: 'close' }),
  'close, minimize, zoom (macOS)': S(['variant'], { script: [AT_CONSENT], start: false, layout: 'mac' }),
  'Change models (autostart)': S(['variant'], { script: [AT_MODELS], start: false, list: found(), opts: { autostart: true, title: 'Change models' }, then: () => wait(600) }),
  'Let’s start hovered': S(['hover'], { script: [AT_CONSENT], start: false }, { force: [{ sel: '[data-setup="start"]', state: 'hover' }] }),
  'Let’s start focused': S(['focus'], { script: [AT_CONSENT], start: false }, { force: [{ sel: '[data-setup="start"]', state: 'focus' }] }),
  'a model row focused': S(['focus'], { script: [AT_CONSENT, AT_MODELS], list: found(), then: apply }, { force: [{ sel: '[data-fr-models] [aria-checked="true"]', state: 'focus' }] }),
  'the close glyph hovered': S(['hover'], { script: [AT_CONSENT], start: false }, { force: [{ sel: '.hx-first-run [data-win="close"]', state: 'hover' }] })
} satisfies Record<string, State>;

export default {
  id: 'v7/first-run', title: 'First run: setup', area: 'settings', kind: 'surface', covers: ['surface:first-run'], states: SETUP_STATES
} satisfies Story;
