/* The composer (14.10): the owner's cases first. The send button must sit inside the box's corner, concentric with
   it; the attach button's hover and focus must not cross the corner; its tooltip must not cover the text. Every
   action (attach, mic, send) at rest, hovered, focused and pressed, with text, empty and multi-line, with the
   tooltip open, compact (the Bots tab and the dock's session) and in the app (the session and the dock). */
import { ui, type ComposerOpts } from '@boopis/ui';
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
    'with a folder and a picture': { tags: ['variant'], width: SESSION_W, async render(ctx) { await withText(ctx); const c = ctx.root.querySelector<HTMLElement & { addFile(n: string, o?: { kind: string }): void }>('.ui-composer'); c?.addFile('src/billing', { kind: 'folder' }); c?.addFile('screenshot.png', { kind: 'image' }); await frames(2); } },
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
    session: { tags: ['typical', 'owner'], scope: '#hx-view-session .ss-composer' },
    'session, empty': { tags: ['empty'], scope: '#hx-view-session .ss-composer', app: { setup: async (c) => { const t = c.$('#hx-view-session .k7-composer__text'); t.textContent = ''; t.dispatchEvent(new Event('input', { bubbles: true })); await c.wait(300); } } },
    'session, add hover': { tags: ['hover', 'owner'], scope: '#hx-view-session .ss-composer', force: [{ sel: '#hx-view-session [data-plus]', state: 'hover' }] },
    'session, send hover': { tags: ['hover', 'owner'], scope: '#hx-view-session .ss-composer', force: [{ sel: '#hx-view-session [data-send]', state: 'hover' }] },
    'session, the add menu': { tags: ['open', 'owner'], scope: '#hx-view-session .ss-composer', overlay: { anchor: '#hx-view-session .k7-composer__box', layer: '.k7-menu[data-floating]' }, app: { setup: async (c) => { await c.click('#hx-view-session [data-plus]'); await c.wait(300); } } },
    'session, who answers next': { tags: ['open', 'owner'], scope: '#hx-view-session .ss-composer', overlay: { anchor: '#hx-view-session .k7-composer__box', layer: '.k7-menu[data-floating]' }, app: { setup: async (c) => { await c.click('#hx-view-session [data-line="model"]'); await c.wait(300); } } },
    'session, the quick menu': { tags: ['open', 'owner'], scope: '#hx-view-session .ss-composer', overlay: { anchor: '#hx-view-session .k7-composer__box', layer: '.k7-menu[data-floating]' }, app: { setup: async (c) => { await c.click('#hx-view-session .k7-composer__line .k7-grow'); await c.wait(300); } } },
    'dock session': { tags: ['typical', 'owner'], scope: '#hx-dock [data-hx-composer]', app: { setup: async (c) => { c.hx.dock()?.openSession('nina'); await c.wait(900); } } },
    'dock session, send hover': { tags: ['hover', 'owner'], scope: '#hx-dock [data-hx-composer]', force: [{ sel: '#hx-dock .ui-send', state: 'hover' }], app: { setup: async (c) => { c.hx.dock()?.openSession('nina'); await c.wait(900); } } }
  }
};
for (const s of Object.values(inApp.states)) (s as { app?: State['app'] }).app ??= {};
/* the mock's draft is two lines long */
for (const [name, s] of Object.entries(inApp.states)) if (name.startsWith('session') && name !== 'session, empty') (s as { allow?: State['allow'] }).allow = { 'geometry.center': { reason: 'the mock\'s draft runs to a second line: the kit composer keeps its buttons on the last line (thread.css `.k7-composer__box`: align-items flex-end), as its multi-line story draws', el: 'k7-composer__box' } };

export default [composer, inApp];
