/* The shell: the title bar, the sidebar (open, rail, closed) and its session list, the command palette, the menus
   (account, attach, model picker, the blank's popover), the app's toast, the details panel and the keyboard sheet. */
import type { AppCtx, ProviderSpec, State, Story } from '../../types';

const MOCK = { url: '/v6/__index.html' };
const st = (tags: State['tags'], setup?: (c: AppCtx) => Promise<void>, provider: ProviderSpec = {}, extra: Partial<State> = {}): State => ({ tags, app: { provider, ...(setup ? { setup } : {}) }, ...extra });
const key = (k: string, init: KeyboardEventInit = {}) => async (c: AppCtx): Promise<void> => { document.body.focus(); await c.key(k, init); await c.wait(450); };
const palette = async (c: AppCtx): Promise<void> => { await key('k', { ctrlKey: true })(c); };
const typeIn = (sel: string, text: string) => async (c: AppCtx): Promise<void> => { const i = c.$(sel) as HTMLInputElement; i.focus(); i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); await c.wait(300); };

const sidebar: Story = {
  id: 'shell/sidebar', title: 'Sidebar and session list', area: 'shell', kind: 'surface', covers: ['surface:sidebar', 'surface:title-bar'], scope: '#hx-side', mock: MOCK,
  states: {
    open: st(['typical'], undefined, {}, { interact: [{ name: 'collapse to a rail and back', watch: '#hx-app', steps: [{ do: 'call', js: '__lab.hx.setState({ left: "rail" })', ms: 700 }, { do: 'call', js: '__lab.hx.setState({ left: "open" })' }], sample: 800 }] }),
    rail: st(['variant'], async (c) => { c.hx.setState({ left: 'rail' }); await c.wait(500); }),
    'no sessions': st(['empty'], undefined, { sessions: 'none' }),
    '150 sessions, scrolling': st(['many', 'scroll'], undefined, { sessions: 150 }),
    'one session': st(['single'], undefined, { sessions: 1 }),
    'row hover': st(['hover'], undefined, {}, { force: [{ sel: '#hx-list-session li:nth-of-type(2) .ui-row', state: 'hover' }] }),
    'row focus': st(['focus'], undefined, {}, { force: [{ sel: '#hx-list-session li:nth-of-type(2) .ui-row', state: 'focus' }] }),
    'tabs pill hover': st(['hover'], undefined, {}, { force: [{ sel: '#hx-seg .ui-seg__opt:last-of-type', state: 'hover' }] }),
    'tabs pill focus': st(['focus'], undefined, {}, { force: [{ sel: '#hx-seg .ui-seg__opt', state: 'focus' }] }),
    'long names': st(['long'], async (c) => { for (const r of document.querySelectorAll<HTMLElement>('#hx-list-session .ui-row__title')) r.textContent = 'Reconcile the invoices_v2 backfill against the ledger before the quarterly close ' + r.textContent; await c.wait(200); }, {}, { note: 'titles lengthened in place' })
  }
};
const titleBar: Story = {
  id: 'shell/title-bar', title: 'Title bar', area: 'shell', kind: 'surface', covers: ['surface:title-bar'], scope: '.hx-bar', mock: MOCK,
  states: {
    typical: st(['typical']),
    'command field hover': st(['hover'], undefined, {}, { force: [{ sel: '#hx-btn-search', state: 'hover' }] }),
    'command field focus': st(['focus'], undefined, {}, { force: [{ sel: '#hx-btn-search', state: 'focus' }] }),
    'sidebar button tooltip': st(['tooltip'], async (c) => { const b = c.$('#hx-btn-left'); b.focus(); c.hx.ui.tooltip.show(b); await c.wait(250); }, {}, { overlay: { anchor: '#hx-btn-left', layer: '.ui-tip' } }),
    'a long session title': st(['long'], async (c) => { c.$('#hx-where-title').textContent = 'Reconcile the invoices_v2 backfill against the ledger before the quarterly close and the auditors'; await c.wait(100); })
  }
};
const pal: Story = {
  id: 'shell/palette', title: 'Command palette', area: 'shell', kind: 'surface', covers: ['surface:palette'], scope: '.hx-palette__box', mock: MOCK,
  states: {
    open: st(['typical', 'open'], palette, {}, { interact: [{ name: 'type, then close', watch: '#hx-app', steps: [{ do: 'press', key: 'p', ms: 200 }, { do: 'press', key: 'r', ms: 300 }, { do: 'press', key: 'Escape' }], sample: 700 }] }),
    'typed query': st(['variant'], async (c) => { await palette(c); await typeIn('#hx-palette-input', 'pro')(c); }),
    'no matches': st(['empty'], async (c) => { await palette(c); await typeIn('#hx-palette-input', 'zzqxv')(c); }),
    'a long query': st(['long'], async (c) => { await palette(c); await typeIn('#hx-palette-input', 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded_idempotency_guard')(c); }),
    'many results, scrolling': st(['many', 'scroll'], palette, { sessions: 150 }),
    'field focus (the esc key chip)': st(['focus', 'owner'], palette, {}, { force: [{ sel: '.hx-palette__field, #hx-palette-input', state: 'focus' }] }),
    'row hover': st(['hover'], palette, {}, { force: [{ sel: '.hx-pal-row:nth-of-type(2)', state: 'hover' }] })
  }
};
const menus: Story = {
  id: 'shell/menus', title: 'Menus in the app', area: 'shell', kind: 'surface', covers: ['surface:menus', 'surface:popover'], mock: MOCK,
  states: {
    'account menu': st(['typical', 'open'], async (c) => { await c.click('#hx-btn-account'); await c.wait(300); }, {}, { overlay: { anchor: '#hx-btn-account', layer: '.ui-menu' } }),
    'attach menu': st(['open', 'owner'], async (c) => { await c.click('#hx-view-session .ui-composer__attach'); await c.wait(300); }, {}, { overlay: { anchor: '#hx-view-session .ui-composer__attach', layer: '.ui-menu' } }),
    'model picker': st(['open'], async (c) => { c.$('#hx-view-session [role="textbox"]').focus(); await c.key('m', { altKey: true }); await c.wait(400); }),
    'the blank popover': st(['open'], async (c) => { await c.click('#hx-view-session .ui-blank'); await c.wait(400); }),
    'account menu, rail': st(['open', 'variant'], async (c) => { c.hx.setState({ left: 'rail' }); await c.wait(500); await c.click('#hx-btn-account'); await c.wait(300); }),
    'a menu item hover': st(['hover'], async (c) => { await c.click('#hx-btn-account'); await c.wait(300); }, {}, { force: [{ sel: '.ui-menu .ui-menu__item:nth-of-type(2)', state: 'hover' }] })
  }
};
const toast: Story = {
  id: 'shell/toast', title: 'Toast in the app', area: 'shell', kind: 'surface', covers: ['surface:toasts'], scope: '.ui-toast', mock: MOCK,
  states: {
    typical: st(['typical', 'success'], async (c) => { c.hx.ui.toast('Archived audit log export', { ms: 60000 }); await c.wait(400); }),
    'with an action': st(['variant'], async (c) => { c.hx.ui.toast('Archived audit log export', { action: { label: 'Undo' }, ms: 60000 }); await c.wait(400); }),
    long: st(['long'], async (c) => { c.hx.ui.toast('Archived Reconcile the invoices_v2 backfill against the ledger before the quarterly close and the auditors arrive', { action: { label: 'Undo' }, ms: 60000 }); await c.wait(400); })
  }
};
const details: Story = {
  id: 'shell/details-panel', title: 'Details panel', area: 'composer', kind: 'surface', covers: ['surface:details-panel'], scope: '#hx-right-shell', mock: MOCK,
  states: {
    open: st(['typical'], async (c) => { c.hx.setState({ right: 'open' }); await c.wait(600); }),
    'every section open': st(['long', 'scroll'], async (c) => { c.hx.setState({ right: 'open' }); await c.wait(600); for (const h of document.querySelectorAll<HTMLElement>('#hx-right-shell .ui-sec__head[aria-expanded="false"]')) h.click(); await c.wait(400); }),
    closed: st(['variant'], async (c) => { c.hx.setState({ right: 'closed' }); await c.wait(400); }),
    'section head hover': st(['hover'], async (c) => { c.hx.setState({ right: 'open' }); await c.wait(600); }, {}, { force: [{ sel: '#hx-right-shell .ui-sec__head', state: 'hover' }] }),
    'from recorded frames (live)': st(['typical'], async (c) => { c.hx.setState({ right: 'open' }); await c.wait(900); }, { replay: 'session' }, { allow: { 'stability.render': 'the recording replays with live timing' } })
  }
};
const keysSheet: Story = {
  id: 'shell/keys-sheet', title: 'Keyboard sheet', area: 'shell', kind: 'surface', covers: ['surface:keys-sheet'], scope: '#hx-keys-sheet', mock: MOCK,
  states: {
    open: st(['typical', 'scroll'], key('/', { ctrlKey: true })),
    filtered: st(['variant'], async (c) => { await key('/', { ctrlKey: true })(c); await typeIn('#hx-keys-filter', 'dock')(c); }),
    'no matches': st(['empty'], async (c) => { await key('/', { ctrlKey: true })(c); await typeIn('#hx-keys-filter', 'zzqxv')(c); })
  }
};

export default [sidebar, titleBar, pal, menus, toast, details, keysSheet];
