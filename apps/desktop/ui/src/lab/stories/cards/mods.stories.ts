/* Mods (14.29): the mod view (`ui.modView`) on its three surfaces, and the places a mod draws in the app, over the
   recording of real mod events (tests/fixtures/frames/mods.frames.json, the frames the smoke test plays): the band and
   the status line, panes in the details panel (from 1200px) or inline (below it), toasts, the theme card, a placed row. */
import { html, ui } from '../../kit';
import { fill, frames } from '../../story';
import type { AppCtx, Render, State, Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';

const { Box, Text, Button, Input, Markdown, Code } = ui.modView.h;
const TREE = Box({ flexDirection: 'column', gap: 1, padding: 1 },
  Text({ bold: true }, 'test-runner'), Text({ dimColor: true }, '1 failing · 141 passing'),
  Box({ progress: 70 }), Box({ gap: 1 }, Button({ onPress: { $handler: 'r' } }, 'Rerun'), Button({ variant: 'ghost', onPress: { $handler: 's' } }, 'Skip')),
  Input({ placeholder: 'Filter tests', onSubmit: { $handler: 'f' } }), Markdown({}, 'Failing: `invoice.test.ts` **rounds per line item**'),
  Code({ language: 'ts' }, 'expect(roundCents(100.5)).toBe(101)'));
const LONGTREE = Box({ flexDirection: 'column', gap: 1 }, Text({}, LONG_TITLE + ' ' + UNBROKEN), Code({}, UNBROKEN + UNBROKEN), Box({ gap: 1 }, ...Array.from({ length: 12 }, (_, i) => Button({ onPress: { $handler: 'b' + i } }, 'Action ' + i))));
const view = (tree: unknown, surface: 'frame' | 'ground' | 'inset'): Render => async ({ root }) => { const v = ui.modView(tree, { surface, label: 'test-runner mod' }); if (v) fill(root, v); await frames(2); };

const modView: Story = {
  id: 'cards/mod-view', title: 'Mod view', area: 'cards', kind: 'component', covers: ['ui.modView', 'html.mod'], mock: { url: '/v6/design-system/index.html#c-cards', crop: '#c-cards' },
  states: {
    'pane (frame)': { tags: ['typical'], width: 340, ground: 'frame', render: view(TREE, 'frame') },
    'placed row (ground)': { tags: ['variant'], width: 608, render: view(TREE, 'ground') },
    'band (inset)': { tags: ['variant'], width: 608, render: view(Box({ gap: 1 }, Text({}, 'Tests idle'), Box({ progress: null })), 'inset') },
    'button hover': { tags: ['hover'], width: 340, ground: 'frame', render: view(TREE, 'frame'), force: [{ sel: '.mv-root .ui-btn', state: 'hover' }] },
    'input focus': { tags: ['focus'], width: 340, ground: 'frame', render: view(TREE, 'frame'), force: [{ sel: '.mv-root .ui-input', state: 'focus' }] },
    long: { tags: ['long', 'many'], width: 340, ground: 'frame', render: view(LONGTREE, 'frame') },
    empty: { tags: ['empty'], width: 340, ground: 'frame', render: view(Box({}), 'frame') },
    'refused tree': { tags: ['error'], width: 340, ground: 'frame', async render({ root }) { const v = ui.modView({ type: 'Client', props: {}, children: [] }, { onInvalid: () => {} }); fill(root, v ?? html.empty({ title: 'The mod\'s drawing was refused', text: 'Its log says why.' })); await frames(2); } },
    'byline': { tags: ['typical', 'long'], render({ root }) { fill(root, html.mod('test-runner'), html.mod('a-mod-with-a-name-long-enough-to-need-cutting-' + UNBROKEN)); } }
  }
};

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
const app = (tags: State['tags'], scope: string | undefined, setup?: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, ...(scope ? { scope } : {}), app: { provider: REPLAY, async setup(c) { await send(c); await setup?.(c); } }, allow: { 'stability.render': 'the recording replays with live timing' }, ...extra });

const surfaces: Story = {
  id: 'cards/mod-surfaces', title: 'Mod surfaces in the app', area: 'cards', kind: 'surface', covers: ['mod:band', 'mod:status', 'mod:pane', 'mod:toast', 'mod:theme-card', 'mod:placed-row', 'mod:log'],
  mock: { url: '/v6/__index.html' },
  states: {
    'band and status': app(['typical', 'owner'], '.ss-composer'),
    'pane in the details panel': app(['variant'], '#hx-right-shell', async (c) => { c.hx.setState({ right: 'open' }); await c.wait(500); }),
    'toast with +N': app(['many'], '.ui-toast'),
    'the conversation with placed rows': app(['typical'], '#hx-view-session'),
    'whole window': app(['typical'], undefined),
    'theme card hover': app(['hover'], '#hx-view-session', undefined, { force: [{ sel: 'hx-card[data-kind="form"] .ui-btn', state: 'hover' }] })
  }
};

export default [modView, surfaces];
