/* Settings (14.21): every tab of the dialog, its tab bar and segmented controls (Rail/Hide, Auto/Integrated/Dedicated)
   at rest, hovered and focused, the dialog scrolled (the scrollbar), the Appearance customizer stepped aside; and first
   run: its welcome, the checklist in every step state, a question, a block with the install command, and the receipt.
   First run is drawn by host/first-run.ts against a scripted setup bridge (the host is not in the lab). */
import { runFirstRun } from '../../../host/first-run';
import type { SetupBridge, SetupStatus } from '../../../host/setup-bridge';
import type { AppCtx, Render, State, Story } from '../../types';

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

/* ───────── first run ───────── */
const step = (id: string, title: string, state: SetupStatus['steps'][number]['state'], detail = '', code: string | null = null) => ({ id, title, state, detail, code });
const STEPS = (s: Record<string, SetupStatus['steps'][number]['state']>, detail: Record<string, string> = {}): SetupStatus['steps'] => [
  step('hermes', 'The agent runtime', s['hermes'] ?? 'pending', detail['hermes']), step('plugin', 'The boopis plugin', s['plugin'] ?? 'pending', detail['plugin']),
  step('hx', 'The fast tools', s['hx'] ?? 'pending', detail['hx']), step('config', 'Settings', s['config'] ?? 'pending', detail['config']),
  step('models', 'Models', s['models'] ?? 'pending', detail['models']), step('restart', 'Restart', s['restart'] ?? 'pending', detail['restart'])
];
const status = (over: Partial<SetupStatus>): SetupStatus => ({ steps: [], form: null, done: false, install_command: null, receipt: null, ...over });
function bridge(script: SetupStatus[]): SetupBridge {
  const q = [...script];
  return {
    check: () => Promise.resolve({ hermes_installed: true, needed: true, reason: 'lab' }),
    source: () => Promise.resolve({ saved: null, from_env: null, next: 'bundled', running: 'bundled', carries_runtime: true } as never),
    onProgress: () => Promise.resolve(() => {}),
    advance: () => Promise.resolve(q.length > 1 ? (q.shift() as SetupStatus) : (q[0] as SetupStatus))
  };
}
const firstRun = (script: SetupStatus[] | null): Render => async ({ root, wait }) => {
  void runFirstRun(bridge(script ?? [status({})]), root);
  await wait(300);
  if (script) { root.querySelector<HTMLButtonElement>('.hx-first-run button')?.click(); await wait(500); }
};
const FR = (tags: State['tags'], script: SetupStatus[] | null, extra: Partial<State> = {}): State => ({ tags, render: firstRun(script), scope: '.hx-first-run', allow: { 'stability.render': 'the welcome logo plays once' }, ...extra });
const ASK = { form_id: 'f-key', kind: 'credential', title: 'Add a key for your models', body: 'boopis needs one provider key to start. It goes to your keychain.', schema: { properties: { key: { type: 'string', title: 'Anthropic API key', 'x-secret': true } }, required: ['key'] }, submit: { label: 'Save key' }, cancel: { label: 'Skip' }, sensitive: true, origin: 'host', diff: [] };

const first: Story = {
  id: 'settings/first-run', title: 'First run', area: 'settings', kind: 'surface', covers: ['surface:first-run'], mock: { url: '/v6/__index.html', note: 'the mock has no first run' },
  states: {
    welcome: FR(['typical'], null),
    'steps running': FR(['loading'], [status({ steps: STEPS({ hermes: 'done', plugin: 'done', hx: 'pending' }) })]),
    'a question (a key)': FR(['variant'], [status({ steps: STEPS({ hermes: 'done', plugin: 'done', hx: 'done', config: 'done', models: 'needs_input' }), form: ASK as never })]),
    blocked: FR(['error'], [status({ steps: STEPS({ hermes: 'blocked' }, { hermes: 'The engine is not on this computer yet.' }), install_command: 'curl -fsSL https://example.invalid/install.sh | sh' })]),
    'declined and skipped': FR(['disabled'], [status({ steps: STEPS({ hermes: 'done', plugin: 'declined', hx: 'skipped', config: 'done', models: 'done', restart: 'done' }), done: true, receipt: { lines: ['The plugin was declined: boopis runs without its tools.'] } })]),
    done: FR(['success'], [status({ steps: STEPS({ hermes: 'done', plugin: 'done', hx: 'done', config: 'done', models: 'done', restart: 'done' }), done: true, receipt: { lines: ['Installed the boopis plugin 0.1.1', 'Saved one key to your keychain', 'Models: sonnet 5.5, then opus 5.5 on a failed gate'] } })]),
    'long details': FR(['long'], [status({ steps: STEPS({ hermes: 'done', plugin: 'blocked' }, { plugin: 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded_idempotency_guard_v2_final.ts could not be written: permission denied (EACCES) while unpacking' }) })])
  }
};

export default [settings, first];
