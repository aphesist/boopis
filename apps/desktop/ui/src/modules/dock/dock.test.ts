// @vitest-environment jsdom
/* The dock as a component that works (boards dock/K01 to K08; DESIGN-SYSTEM.md v7 21.4): what each of its controls does, on the mock
   provider. Where things land on the screen is the lab's (`lab:board K01` to `K08`, `v7/dock`), the motion the smoke's
   (`dock-motion`, `dock-presence`), the real WebKitGTK `tests/e2e/dock_webkit.py`. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { on, resetBus } from '../../core/bus';
import { getDockApi, registered } from '../../core/registry';
import { setState, state } from '../../core/state';
import { setProvider } from '../../data';
import type { DataProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import type { Bot, Wait } from '../../data/types';
import { forgetDock } from './index';

const q = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => { const n = root.querySelector<T>(sel); if (!n) throw new Error('missing ' + sel); return n; };
const all = <T extends HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const dock = (): NonNullable<ReturnType<typeof getDockApi>> => getDockApi() as NonNullable<ReturnType<typeof getDockApi>>;
const orb = (id: string): HTMLButtonElement => q('#hx-dock .k7-dock__orb[data-bot="' + id + '"]');
const shownIds = (): string[] => all('#hx-dock .k7-dock__orb:not([data-out])').sort((a, b) => +a.style.order - +b.style.order).map((b) => b.dataset['bot'] ?? '');
const key = (el: Element, k: string, more: KeyboardEventInit = {}): void => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...more })); };
/** an answer's words, without its key chip */
const label = (c: Element): string => { const n = c.cloneNode(true) as Element; n.querySelector('.k7-keys')?.remove(); return (n.textContent ?? '').trim(); };
const tick = async (ms = 0): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };

let provider: DataProvider, bots: Bot[], waits: Wait[], sent: Array<[string, string]>, decided: Array<[string, string]>, stopped: string[];
const ask = (bot: string, id = 'w-' + bot): Wait => ({ id, kind: 'approval', bot, who: bot, title: 'Deploy 0.2.0 to staging?', data: { id, title: 'Deploy 0.2.0 to staging?', item: ['boopis deploy staging --tag 0.2.0'], from: bot } });

/** mount the dock on `ids` (the mock's looks), `needs` asking through an approval, `working` at work */
function mount(o: { ids?: string[]; needs?: string[]; working?: string[]; later?: string[] } = {}): void {
  const p = createMockProvider({ simulate: false });
  const tpl = p.bots.snapshot().bots;
  const ids = o.ids ?? ['nina', 'kai', 'moss', 'iris'];
  bots = ids.map((id, i) => ({ ...(tpl.find((b) => b.id === id) ?? tpl[i % tpl.length] as Bot), id, name: id, state: o.working?.includes(id) ? 'working' : o.needs?.includes(id) ? 'needs' : 'idle', attention: o.needs?.includes(id) ? 'approval' : null }));
  waits = (o.needs ?? []).map((id) => ask(id));
  sent = []; decided = []; stopped = [];
  const botSubs = new Set<(e: never) => void>(), waitSubs = new Set<(e: never) => void>();
  provider = {
    ...p, info: { ...p.info, later: new Set(o.later ?? []) as never },
    bots: { ...p.bots, snapshot: () => ({ bots, threads: Object.fromEntries(bots.map((b) => [b.id, b.id === 'nina' ? [{ kind: 'text', id: 't1', who: 'you', t: '', text: 'Ship 0.2.0 when the notes are in.' }, { kind: 'text', id: 't2', who: 'nina', t: '', text: 'The notes are in. Staging is ready.' }] : []])) as never }),
      subscribe: (fn: (e: never) => void) => { botSubs.add(fn); return () => botSubs.delete(fn); },
      send: (id: string, text: string) => { sent.push([id, text]); }, stop: (id: string) => { stopped.push(id); return true; } } as never,
    waits: { ...p.waits, snapshot: () => waits, subscribe: (fn: (e: never) => void) => { waitSubs.add(fn); return () => waitSubs.delete(fn); },
      resolve: (id: string, how: string) => { decided.push([id, how]); waits = waits.filter((w) => w.id !== id); for (const fn of waitSubs) fn({ type: 'resolved', id } as never); } } as never
  };
  (provider as unknown as { __emitBots(e: unknown): void; __emitWaits(e: unknown): void }).__emitBots = (e) => { for (const fn of botSubs) fn(e as never); };
  (provider as unknown as { __emitWaits(e: unknown): void }).__emitWaits = (e) => { for (const fn of waitSubs) fn(e as never); };
  setProvider(provider);
  forgetDock();
  document.body.innerHTML = '<div id="hx-app" class="hx"><div id="hx-dock"></div></div>';
  registered('dock')?.mount(q('#hx-dock'));
}
const emitBots = (e: unknown): void => { (provider as unknown as { __emitBots(e: unknown): void }).__emitBots(e); };
const emitWaits = (e: unknown): void => { (provider as unknown as { __emitWaits(e: unknown): void }).__emitWaits(e); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe(): void { /* no layout */ } unobserve(): void { /* no layout */ } disconnect(): void { /* no layout */ } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  (Element.prototype as unknown as { animate: () => unknown }).animate = () => ({ addEventListener: () => undefined });
  Element.prototype.scrollIntoView = (): void => undefined;
  setState({ tab: 'session', dock: 'on', dockCentred: false, dockCompact: false, orbGrow: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); resetBus(); });

describe('the row', () => {
  it('orders the bots: needs you, then working, then the rest in the roster\'s order; boopis is one of them', () => {
    mount({ ids: ['boopis', 'kai', 'moss', 'nina', 'iris'], needs: ['nina'], working: ['moss'] });
    expect(shownIds()).toEqual(['nina', 'moss', 'boopis', 'kai', 'iris']);
    expect(orb('nina').getAttribute('aria-label')).toContain('needs you');
    expect(orb('nina').querySelector('.k7-flag')).not.toBeNull();
    expect(orb('kai').querySelector('.k7-flag')).toBeNull();
  });
  it('has no "+": new bots are made in the Bots tab', () => {
    mount();
    expect(all('#hx-dock [aria-label*="New bot"], #hx-dock [data-act="add"]')).toHaveLength(0);
  });
  it('draws each bot at the size it shows and lets it fill its button (never a larger picture scaled down)', () => {
    mount();
    for (const b of all('#hx-dock .k7-dock__orb')) {
      expect(b.style.getPropertyValue('--s')).toBe('40px');
      expect(b.querySelector('orb-avatar')?.getAttribute('size')).toBe('40');
      expect(b.querySelector('.ui-orb')?.hasAttribute('data-render')).toBe(false);
      expect(b.querySelector('.ui-orb')?.hasAttribute('data-orb-rest')).toBe(true);
    }
  });
  it('a hovered bot grows to 52 and its neighbours to 46; the end slot names it and its state; "Grow bots on hover" off keeps 40', () => {
    mount({ needs: ['nina'] });
    dock().hover(null);
    orb('kai').dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    expect(['nina', 'kai', 'moss', 'iris'].map((id) => orb(id).style.getPropertyValue('--s'))).toEqual(['46px', '52px', '46px', '40px']);
    expect(q('#hx-dock .k7-dock__cap').textContent).toBe('kai' + 'idle');
    expect(document.querySelector('#hx-dock .k7-dock__ask')).toBeNull();
    q('#hx-dock .k7-dock__row').dispatchEvent(new MouseEvent('pointerleave'));
    expect(orb('kai').style.getPropertyValue('--s')).toBe('40px');
    expect(q('#hx-dock .k7-dock__ask').textContent).toBe('nina needs you');
    setState({ orbGrow: false });
    orb('kai').dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    expect(orb('kai').style.getPropertyValue('--s')).toBe('40px');
    expect(q('#hx-dock .k7-dock__cap').textContent).toBe('kai' + 'idle');
  });
  it('the ask pill says who needs you, or how many', () => {
    mount({ needs: ['nina', 'moss'] });
    expect(q('#hx-dock .k7-dock__ask').textContent).toBe('2 need you');
    emitWaits({ type: 'resolved', id: 'w-moss' }); waits = waits.filter((w) => w.id !== 'w-moss');
    expect(q('#hx-dock .k7-dock__ask').textContent).toBe('nina needs you');
  });
  it('the arrows walk the row, bots first, then the ask pill; Home and End reach its ends; 1 to 9 pick a bot', () => {
    mount({ needs: ['nina'] });
    orb('nina').focus();
    key(orb('nina'), 'ArrowRight');
    expect(document.activeElement).toBe(orb('kai'));
    key(orb('kai'), 'End');
    expect(document.activeElement).toBe(q('#hx-dock .k7-dock__ask'));
    key(q('#hx-dock .k7-dock__ask'), 'ArrowLeft');
    expect((document.activeElement as HTMLElement).dataset['bot']).toBe('iris');
    key(orb('iris'), 'Home');
    expect(document.activeElement).toBe(orb('nina'));
    key(orb('nina'), '3');
    expect(document.activeElement).toBe(orb('moss'));
  });
});

describe('a bot\'s card', () => {
  it('a press opens it: the head, the last messages (yours in the bot\'s fill), its ask, its composer; the row keeps no pill and marks the bot', () => {
    mount({ needs: ['nina'] });
    orb('nina').click();
    expect(dock().state.open).toBe('card');
    expect(dock().state.card).toBe('nina');
    const p = q('#hx-dock .k7-dock__panel[data-open="card"]');
    expect(q('.k7-dock__name', p).textContent).toBe('nina');
    expect(all('#hx-dock .k7-dock__log [data-kit~="Bubble"]').map((b) => b.textContent)).toEqual(['Ship 0.2.0 when the notes are in.', 'The notes are in. Staging is ready.']);
    expect(q('[data-kit~="AskCard"]', p).getAttribute('data-wait')).toBe('w-nina');
    expect(q('[data-kit~="Composer"]', p).getAttribute('data-kind')).toBe('dock');
    expect(document.querySelector('#hx-dock .k7-dock__ask')).toBeNull();
    expect(orb('nina').getAttribute('aria-current')).toBe('true');
    expect(q('#hx-app').getAttribute('data-dock-open')).toBe('card');   /* the session's composer steps aside (dock.css) */
    expect(q('#hx-dock .k7-dock').getAttribute('data-geom')).toBe('640,432,30,30');
  });
  it('the same bot again, the close button or Esc fold it, and the focus returns to its orb', () => {
    mount();
    orb('kai').click();
    orb('kai').click();
    expect(dock().state.open).toBeNull();
    orb('kai').click();
    q('#hx-dock .k7-dock__head [data-act="close"]').click();
    expect(dock().state.open).toBeNull();
    orb('kai').click();
    key(q('#hx-dock .k7-composer__text'), 'Escape');
    expect(dock().state.open).toBeNull();
    expect(document.activeElement).toBe(orb('kai'));
    expect(q('#hx-app').hasAttribute('data-dock-open')).toBe(false);
  });
  it('another bot\'s orb changes the card in place', () => {
    mount();
    orb('kai').click(); orb('moss').click();
    expect(dock().state.card).toBe('moss');
    expect(all('#hx-dock .k7-dock__panel:not([inert])')).toHaveLength(1);
  });
  it('its composer sends to the bot and keeps a draft while the card is closed; Stop stops the bot\'s run', () => {
    mount();
    orb('kai').click();
    const text = (): HTMLElement => q('#hx-dock .k7-composer__text');
    text().textContent = 'half a thought'; text().dispatchEvent(new Event('input', { bubbles: true }));
    q('#hx-dock .k7-dock__head [data-act="close"]').click();
    orb('kai').click();
    expect(text().textContent).toBe('half a thought');
    key(text(), 'Enter');
    expect(sent).toEqual([['kai', 'half a thought']]);
    expect(text().textContent).toBe('');
    emitBots({ type: 'run', botId: 'kai', running: true });
    expect(q('#hx-dock .k7-composer').hasAttribute('data-running')).toBe(true);
    q('#hx-dock .k7-composer [data-stop]').click();
    expect(stopped).toEqual(['kai']);
  });
  it('the voice circle is there and its primary circle is the dock\'s own, not the bot\'s fill (K04)', () => {
    mount();
    orb('kai').click();
    const send = q('#hx-dock .k7-composer [data-send]');
    expect(send.hidden).toBe(false);
    expect(send.hasAttribute('data-bot-colour')).toBe(false);
  });
  it('"Open in Bots", mod+Enter on its orb, or a double click go to the bot\'s chat', () => {
    mount();
    const picked: string[] = [];
    on('hx:bot-select', (d) => { picked.push(d.id); });
    orb('kai').click();
    q('#hx-dock .k7-dock__head [data-act="open-chat"]').click();
    expect(picked).toEqual(['kai']);
    expect(state.tab).toBe('bots');
    expect(dock().state.open).toBeNull();
    setState({ tab: 'session' });
    key(orb('moss'), 'Enter', { ctrlKey: true });
    expect(picked).toEqual(['kai', 'moss']);
    expect(state.tab).toBe('bots');
  });
});

describe('the asks', () => {
  it('the pill opens the stack: one approval per ask, never a question; holding approves, Deny denies; the last one decided folds it', () => {
    mount({ needs: ['nina', 'moss'] });
    q('#hx-dock .k7-dock__ask').click();
    expect(dock().state.open).toBe('stack');
    const cards = all('#hx-dock .k7-dock__panel [data-kit~="AskCard"]');
    expect(cards.map((c) => c.getAttribute('data-wait'))).toEqual(['w-nina', 'w-moss']);
    for (const c of cards) {
      expect(c.getAttribute('data-variant')).toBe('standalone');
      expect([...c.querySelectorAll('.k7-ask__answers .k7-chip')].map(label)).toEqual(['Hold to allow once', 'Deny']);
      expect(q('.k7-chip[data-value="deny"]', c).hasAttribute('data-end')).toBe(true);
      expect(q('.k7-well', c).textContent).toContain('boopis deploy staging --tag 0.2.0');
    }
    expect(q('#hx-dock .k7-dock__count').textContent).toBe('2');
    q('.k7-chip[data-value="deny"]', cards[1] as HTMLElement).click();
    expect(decided).toEqual([['w-moss', 'denied']]);
    expect(dock().state.open).toBe('stack');
    q('#hx-dock .k7-dock__panel [data-kit~="AskCard"]').dispatchEvent(new CustomEvent('ui:commit', { bubbles: true }));
    expect(decided).toEqual([['w-moss', 'denied'], ['w-nina', 'approved']]);
    expect(dock().state.open).toBeNull();
  });
  it('Esc on an ask is its Deny; from the head it folds the stack and decides nothing', () => {
    mount({ needs: ['nina'] });
    q('#hx-dock .k7-dock__ask').click();
    key(q('#hx-dock .k7-dock__head [data-act="close"]'), 'Escape');
    expect(dock().state.open).toBeNull();
    expect(decided).toEqual([]);
    q('#hx-dock .k7-dock__ask').click();
    key(q('#hx-dock [data-kit~="AskCard"] [data-hold]'), 'Escape');
    expect(decided).toEqual([['w-nina', 'denied']]);
  });
  it('the standing answer is built against the rules and not shown until they exist', () => {
    mount({ needs: ['nina'], later: ['approval-rules'] });
    q('#hx-dock .k7-dock__ask').click();
    expect(all('#hx-dock .k7-ask__answers .k7-chip').map(label)).toEqual(['Hold to allow once', 'Always allow', 'Deny']);
    q('#hx-dock .k7-chip[data-value="always"]').click();   /* not carried out yet: it decides nothing */
    expect(decided).toEqual([]);
  });
});

describe('when it shows', () => {
  it('not until you have a bot of your own (boopis alone does not count), in the Sessions tab alone, and "Show the dock" turns it off', () => {
    mount({ ids: ['boopis'] });
    expect(dock().state.shown).toBe(false);
    expect(q('#hx-dock .dk').hasAttribute('inert')).toBe(true);
    mount();
    expect(dock().state.shown).toBe(true);
    setState({ tab: 'bots' });
    expect(dock().state.shown).toBe(false);
    setState({ tab: 'session' });
    expect(dock().state.shown).toBe(true);
  });
  it('"N more" goes to the Bots tab', () => {
    mount();
    document.querySelector<HTMLElement>('#hx-dock .k7-dock__row')?.insertAdjacentHTML('beforeend', '<button data-act="more" id="more-probe"></button>');
    q('#more-probe').click();
    expect(state.tab).toBe('bots');
  });
});

describe('"Compact dock when idle" (K08)', () => {
  it('off by default: the row stays the row', async () => {
    mount({ needs: ['nina'] });
    await tick(30000);
    expect(dock().state.compact).toBe(false);
    expect(q('#hx-dock .k7-dock').getAttribute('data-dk')).toBe('row');
  });
  it('on: after ten idle seconds the row is compact (48 tall, bots of 24, the pill kept); a new ask, a pointer or the focus bring the row back', async () => {
    mount({ needs: ['nina'] });
    setState({ dockCompact: true });
    await tick(9000);
    expect(dock().state.compact).toBe(false);
    await tick(1500);
    expect(dock().state.compact).toBe(true);
    const k = q('#hx-dock .k7-dock');
    expect(k.getAttribute('data-dk')).toBe('compact');
    expect(k.getAttribute('data-geom')).toBe('fit,48,24,24');
    expect(orb('kai').style.getPropertyValue('--s')).toBe('24px');
    expect(q('#hx-dock .k7-dock__ask').textContent).toBe('nina needs you');
    /* a new ask */
    waits = [...waits, ask('moss')]; emitWaits({ type: 'added', wait: ask('moss') });
    expect(dock().state.compact).toBe(false);
    expect(orb('kai').style.getPropertyValue('--s')).toBe('40px');
    await tick(10500);
    expect(dock().state.compact).toBe(true);
    /* a pointer on the dock */
    q('#hx-dock .dk').dispatchEvent(new MouseEvent('pointerenter'));
    expect(dock().state.compact).toBe(false);
    await tick(10500);
    expect(dock().state.compact).toBe(true);
    /* the focus coming in */
    orb('nina').focus();
    expect(dock().state.compact).toBe(false);
  });
  it('an open card or stack is never compact, and the setting switched off returns the row at once', async () => {
    mount({ needs: ['nina'] });
    setState({ dockCompact: true });
    orb('kai').click();
    await tick(30000);
    expect(dock().state.compact).toBe(false);
    expect(dock().state.open).toBe('card');
    q('#hx-dock .k7-dock__head [data-act="close"]').click();
    (document.activeElement as HTMLElement | null)?.blur();
    await tick(10500);
    expect(dock().state.compact).toBe(true);
    setState({ dockCompact: false });
    expect(dock().state.compact).toBe(false);
  });
});
