/* The composer where it lives: the session view and the dock's card (app states). The component's own states (every kind, its
   buttons at rest, hovered, focused and pressed, their tooltips, long and tall drafts, right-to-left text, narrow) are the kit's:
   `kit/composer`. */
import type { State, Story } from '../../types';

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
    'dock session, send hover': { tags: ['hover', 'owner'], scope: '#hx-dock [data-hx-composer]', force: [{ sel: '#hx-dock [data-send]', state: 'hover' }], app: { setup: async (c) => { c.hx.dock()?.openSession('nina'); await c.wait(900); } } }
  }
};
for (const s of Object.values(inApp.states)) (s as { app?: State['app'] }).app ??= {};
/* the mock's draft is two lines long */
for (const [name, s] of Object.entries(inApp.states)) if (name.startsWith('session') && name !== 'session, empty') (s as { allow?: State['allow'] }).allow = { 'geometry.center': { reason: 'the mock\'s draft runs to a second line: the kit composer keeps its buttons on the last line (thread.css `.k7-composer__box`: align-items flex-end), as its multi-line story draws', el: 'k7-composer__box' } };

export default [inApp];
