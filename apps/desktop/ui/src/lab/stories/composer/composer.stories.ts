/* The composer (14.10): the owner's cases first. The send button must sit inside the box's corner, concentric with
   it; the attach button's hover and focus must not cross the corner; its tooltip must not cover the text. Every
   action (attach, mic, send) at rest, hovered, focused and pressed, with text, empty and multi-line, with the
   tooltip open, compact (the Bots tab and the dock's session) and in the app (the session and the dock). */
import { ui } from '../../kit';
import type { ComposerOpts } from '../../../components';
import { fill, frames } from '../../story';
import type { Force, Render, State, Story } from '../../types';
import { BOT_LIKE, BOT_LONG, LONG_TITLE, MULTILINE, RTL, UNBROKEN } from '../../fixtures';
import { COMPOSER_DRAFT } from '../../../data/mock-data';

const MOCK = { url: '/v6/design-system/index.html#c-composer', crop: '#c-composer' };
const SESSION_W = 720;
const DOCK_W = 400;

async function draw(root: HTMLElement, o: ComposerOpts, text?: string): Promise<HTMLElement> {
  const c = ui.composer(o);
  fill(root, c);
  if (text != null) c.setValue(text);
  await frames(2);
  return c;
}
const full = (text?: string, o: ComposerOpts = {}): Render => async ({ root }) => { await draw(root, { placeholder: 'Describe the change', spend: { spent: '$0.37', cap: '$0.60' }, chips: [{ label: 'Smart', pressed: true }], ...o }, text); };
const compact = (text?: string, o: ComposerOpts = {}): Render => async ({ root }) => { await draw(root, { placeholder: 'Message nina', bot: BOT_LIKE, compact: true, ...o }, text); };

const ACTIONS: ReadonlyArray<readonly [string, string]> = [['attach', '.ui-composer__attach'], ['mic', '.ui-composer__mic'], ['send', '.ui-send']];
/** every action in every forced state, on one composer */
function actionStates(prefix: string, render: Render, width: number, ground?: State['ground']): Record<string, State> {
  const out: Record<string, State> = {};
  for (const [name, sel] of ACTIONS) for (const [word, f] of [['hover', 'hover'], ['focus', 'focus'], ['pressed', 'active']] as const) {
    const force: Force[] = [{ sel, state: f }];
    out[prefix + name + ' ' + word] = { tags: [f === 'active' ? 'active' : f, 'owner'], render, width, force, ...(ground ? { ground } : {}) };
  }
  return out;
}
function tooltipState(render: Render, sel: string, width: number, ground?: State['ground']): State {
  return {
    tags: ['tooltip', 'owner'], width, ...(ground ? { ground } : {}), overlay: { anchor: sel, layer: '.ui-tip' }, force: [{ sel, state: 'focus' }],
    async render(ctx) { await render(ctx); const b = ctx.root.querySelector<HTMLElement>(sel); if (b) { b.focus(); ui.tooltip.show(b); } await ctx.wait(250); }
  };
}

const withText = full(COMPOSER_DRAFT);
const compactText = compact('can you stage it first?');

const composer: Story = {
  id: 'composer/composer', title: 'Composer', area: 'composer', kind: 'component', covers: ['ui.composer'], mock: MOCK,
  states: {
    empty: { tags: ['empty', 'owner'], render: full(), width: SESSION_W },
    'with text': { tags: ['typical', 'owner'], render: withText, width: SESSION_W },
    'multi-line': { tags: ['long', 'owner'], render: full(MULTILINE), width: SESSION_W },
    'long unbroken': { tags: ['long'], render: full(UNBROKEN + ' ' + UNBROKEN), width: SESSION_W },
    'tall, scrolling': { tags: ['long', 'scroll'], render: full(Array.from({ length: 30 }, (_, i) => 'line ' + (i + 1) + ' ' + LONG_TITLE).join('\n')), width: SESSION_W },
    ...actionStates('', withText, SESSION_W),
    'attach tooltip': tooltipState(withText, '.ui-composer__attach', SESSION_W),
    'send tooltip': tooltipState(withText, '.ui-send', SESSION_W),
    'mic tooltip': tooltipState(withText, '.ui-composer__mic', SESSION_W),
    'empty, attach tooltip': tooltipState(full(), '.ui-composer__attach', SESSION_W),
    running: { tags: ['loading'], width: SESSION_W, async render(ctx) { await full('')(ctx); ctx.root.querySelector<HTMLElement & { setRunning(v: boolean): void }>('.ui-composer')?.setRunning(true); await frames(2); } },
    listening: { tags: ['variant'], width: SESSION_W, async render(ctx) { await full('', { bot: BOT_LIKE })(ctx); ctx.root.querySelector<HTMLElement & { setListening(v: boolean): void }>('.ui-composer')?.setListening(true); await frames(2); }, allow: { 'stability.render': 'the listening orb animates' } },
    'with files': { tags: ['variant'], width: SESSION_W, async render(ctx) { await withText(ctx); const c = ctx.root.querySelector<HTMLElement & { addFile(n: string): void }>('.ui-composer'); c?.addFile('invoices-sample.csv'); c?.addFile(UNBROKEN); await frames(2); } },
    rtl: { tags: ['rtl'], render: full(RTL), width: SESSION_W, dir: 'rtl' },
    'narrow (390)': { tags: ['variant', 'owner'], render: withText, width: 358 },
    /* compact: the Bots tab's and the dock session's composer */
    'compact, empty': { tags: ['empty', 'owner'], render: compact(), width: DOCK_W, ground: 'dock' },
    'compact, with text': { tags: ['typical', 'owner'], render: compactText, width: DOCK_W, ground: 'dock' },
    'compact, multi-line': { tags: ['long', 'owner'], render: compact(MULTILINE), width: DOCK_W, ground: 'dock' },
    'compact, long name': { tags: ['long'], render: compact('', { bot: BOT_LONG, placeholder: 'Message ' + BOT_LONG.name }), width: DOCK_W, ground: 'dock' },
    ...actionStates('compact, ', compactText, DOCK_W, 'dock'),
    'compact, send tooltip': tooltipState(compactText, '.ui-send', DOCK_W, 'dock'),
    'compact, attach tooltip': tooltipState(compactText, '.ui-composer__attach', DOCK_W, 'dock')
  }
};

/* the composer where it lives: the session view and the dock's session (app states) */
const inApp: Story = {
  id: 'composer/composer-in-app', title: 'Composer in the app', area: 'composer', kind: 'surface', covers: ['surface:composer'], scope: '[data-hx-composer]',
  mock: { url: '/v6/__index.html' },
  states: {
    session: { tags: ['typical', 'owner'], interact: [{ name: 'hover attach, mic and send', watch: '#hx-view-session [data-hx-composer]', steps: [{ do: 'hover', sel: '#hx-view-session .ui-composer__attach', ms: 600 }, { do: 'hover', sel: '#hx-view-session .ui-composer__mic', ms: 600 }, { do: 'hover', sel: '#hx-view-session .ui-send', ms: 600 }, { do: 'move-away' }], sample: 700 }] },
    'session, empty': { tags: ['empty'], app: { setup: (c) => { c.$('[data-hx-composer] .ui-composer__input').textContent = ''; c.$('[data-hx-composer] .ui-composer__input').dispatchEvent(new Event('input', { bubbles: true })); } } },
    'session, attach hover': { tags: ['hover', 'owner'], force: [{ sel: '#hx-view-session .ui-composer__attach', state: 'hover' }] },
    'session, send hover': { tags: ['hover', 'owner'], force: [{ sel: '#hx-view-session .ui-send', state: 'hover' }] },
    'session, attach tooltip': { tags: ['tooltip', 'owner'], overlay: { anchor: '#hx-view-session .ui-composer__attach', layer: '.ui-tip' }, app: { setup: async (c) => { const b = c.$('#hx-view-session .ui-composer__attach'); b.focus(); c.hx.ui.tooltip.show(b); await c.wait(250); } } },
    'dock session': { tags: ['typical', 'owner'], scope: '#hx-dock [data-hx-composer]', app: { setup: async (c) => { c.hx.dock()?.openSession('nina'); await c.wait(900); } } },
    'dock session, send hover': { tags: ['hover', 'owner'], scope: '#hx-dock [data-hx-composer]', force: [{ sel: '#hx-dock .ui-send', state: 'hover' }], app: { setup: async (c) => { c.hx.dock()?.openSession('nina'); await c.wait(900); } } }
  }
};
for (const s of Object.values(inApp.states)) (s as { app?: State['app'] }).app ??= {};

export default [composer, inApp];
