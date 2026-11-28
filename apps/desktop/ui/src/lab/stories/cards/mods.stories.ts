/* Mods in the app (2b, the lead's decisions for conflict 32), over the recording of real mod events (tests/fixtures/frames/mods.frames.json,
   the frames the smoke test plays): the band in the held or queued strip's slot over the composer, a mod's status on the composer's own
   line, a pane as a tab of the tools after their fixed tabs, notices (the kit's), the theme card, a log line and a placed row. What a mod
   draws is the kit's ModView (kit/mod-view). */
import type { AppCtx, State, Story } from '../../types';

/* the app over the recorded mod events: a message is sent, the mods speak */
async function send(c: AppCtx): Promise<void> {
  const input = c.$('.ss-composer [role="textbox"], .ss-composer [contenteditable="true"]');
  input.focus();
  input.textContent = 'run the tests';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'run the tests' }));
  await c.key('Enter');
  await c.wait(2400);
}
const REPLAY = { replay: 'mods' } as const;
const app = (tags: State['tags'], scope: string | undefined, setup?: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, ...(scope ? { scope } : {}), app: { provider: REPLAY, async setup(c) { await send(c); await setup?.(c); } }, allow: { 'stability.render': 'the recording replays with live timing', 'geometry.target': 'the recording replays with live timing: run after a wider width, the composer\'s line was measured once while it folded (one at a time it passes)' }, ...extra });

const surfaces: Story = {
  id: 'cards/mod-surfaces', title: 'Mod surfaces in the app', area: 'cards', kind: 'surface', covers: ['mod:band', 'mod:status', 'mod:pane', 'mod:notice', 'mod:theme-card', 'mod:placed-row', 'mod:log'],
  mock: { url: '/v6/__index.html' },
  states: {
    'band and status': app(['typical', 'owner'], '.ss-composer'),
    'the band open': app(['open'], '.ss-composer', async (c) => { await c.click('.ss-strip [data-queue="fold"]'); await c.wait(400); }),
    'pane, a tab of the tools': app(['variant', 'owner'], '#hx-right-shell', async (c) => { c.hx.emit('hx:open-panel', { panel: 'changes', from: 'lab' }); await c.wait(700); await c.click('#hx-right .k7-pane__tabs [data-value="tests"]'); await c.wait(500); }),
    'a notice with +N': app(['many'], '#hx-notify .k7-notify'),
    'the conversation with placed rows': app(['typical'], '#hx-view-session'),
    'whole window': app(['typical'], undefined),
    'whole window, narrow: the band and the line fold': app(['size'], undefined, undefined, { width: 390 }),
    'theme card hover': app(['hover'], '#hx-view-session', undefined, { force: [{ sel: 'hx-card[data-kind="form"] [data-kit~="Button"]', state: 'hover' }] })
  }
};

export default [surfaces];
