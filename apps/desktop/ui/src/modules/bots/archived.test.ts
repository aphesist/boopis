// @vitest-environment jsdom
/* The owner's two decisions about which profiles are bots (19 November 2026): a profile boopis did not make carries a small
   "made outside boopis" mark, and archived bots live in a collapsed "Archived" group under the roster, from which they are restored
   (the palette's "Restore bot…" is the same action: `shell/palette.test.ts`). Over the mock provider, which has two archived bots
   (ledger, and a second nina whose name is in use) and, with `fixtures: ['outside']`, a bot made outside boopis. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kit } from '@boopis/ui';
import { data, setProvider } from '../../data';
import type { ArchivedBot, Bot, BotsEvent, DataProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { emitter, store } from '../../data/store';
import { KEYS } from '../../core/settings';
import { registered } from '../../core/registry';
import '../cards';
import './index';
import { S } from './model';
import { openBot } from './room';
import { OUTSIDE_LABEL, OUTSIDE_WORDS } from './outside';

const q = <T extends HTMLElement>(sel: string): T => { const n = document.querySelector<T>(sel); if (!n) throw new Error('missing ' + sel); return n; };
const qa = <T extends HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const tick = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const flush = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(20); await tick(); };

function mount(provider: DataProvider): void {
  setProvider(provider);
  S.bots = []; S.rows.clear(); S.draftRow = null; S.view = 'bot'; S.sel = null; S.sheetOpen = false; S.sheetFor = null;
  document.body.replaceChildren();
  const list = document.createElement('div'), root = document.createElement('div');
  document.body.append(list, root);
  Element.prototype.scrollIntoView = (): void => undefined;
  registered('bots-list')?.mount(list); registered('bots')?.mount(root);
}
const mock = (fixtures: string[] = []): DataProvider => createMockProvider({ simulate: false, fixtures });
beforeEach(() => {
    kit.notifyReset();
  vi.stubGlobal('ResizeObserver', class { observe(): void { /* no layout */ } unobserve(): void { /* no layout */ } disconnect(): void { /* no layout */ } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0));
  localStorage.clear();
  document.querySelector('.k7-notify .k7-notice__text')?.remove();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the "made outside boopis" mark', () => {
  it('a bot with no record of boopis’s own carries it in the roster, with its words in the row’s name and description', () => {
    mount(mock(['outside']));
    const row = q('.bt-rows [data-kit~="ListRow"][data-value="sage"]');
    expect(row.querySelector('[data-outside]')?.textContent).toBe('outside');
    expect(row.getAttribute('aria-label')).toBe('sage, reads release notes, outside');
    const desc = row.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(desc)?.textContent).toBe(OUTSIDE_WORDS);
    expect(row.querySelector('[data-outside]')?.getAttribute('data-tip')).toBe(OUTSIDE_WORDS);
  });
  it('a bot boopis made carries nothing, and its name is only its own words', () => {
    mount(mock(['outside']));
    const row = q('.bt-rows [data-kit~="ListRow"][data-value="atlas"]');
    expect(row.querySelector('[data-outside]')).toBeNull();
    expect(row.getAttribute('aria-label')).toMatch(/^atlas, /);   /* its name, then its line (its last words) */
    expect(row.getAttribute('aria-label')).not.toMatch(/outside/i);
    expect(row.hasAttribute('aria-describedby')).toBe(false);
    expect(qa('[data-outside]')).toHaveLength(1);
  });
  it('the room of such a bot shows it too, on the line over the thread, reachable by keyboard, with the same sentence as its tooltip and its description', () => {
    mount(mock(['outside']));
    openBot('sage');
    const mark = q('.bt-topline [data-outside]');
    expect(mark.textContent).toBe(OUTSIDE_LABEL);
    expect(mark.getAttribute('data-tip')).toBe(OUTSIDE_WORDS);
    expect(mark.tabIndex).toBe(0);
    expect(document.getElementById(mark.getAttribute('aria-describedby') ?? '')?.textContent).toBe(OUTSIDE_WORDS);
    openBot('atlas');
    expect(document.querySelector('.bt-topline [data-outside]')).toBeNull();
  });
  it('saving any boopis setting for it creates the store, and the mark goes, in the roster and in the header', () => {
    mount(mock(['outside']));
    openBot('sage');
    expect(qa('[data-outside]')).toHaveLength(2);
    data().bots.update('sage', { cfg: { cap: '1.00' } });
    expect(document.querySelector('[data-outside]')).toBeNull();
    expect(q('.bt-rows [data-kit~="ListRow"][data-value="sage"]').getAttribute('aria-label')).toBe('sage, reads release notes');
  });
  it('a setting that is Hermes’s own, such as the role, is not a store of boopis’s and keeps the mark', () => {
    mount(mock(['outside']));
    data().bots.update('sage', { role: 'reads changelogs' });
    expect(qa('[data-outside]')).toHaveLength(1);
  });
  it('a plugin that did not say is not read as "made outside": nothing is marked', () => {
    const p = mock(['outside']);
    const events = emitter<BotsEvent>();
    const sage: Bot = { ...p.bots.snapshot().bots.find((b) => b.id === 'sage') as Bot };
    delete (sage as { madeOutside?: true }).madeOutside;
    mount({ ...p, bots: { ...p.bots, snapshot: () => ({ bots: [sage], threads: { sage: [] } }), subscribe: (fn) => events.subscribe(fn) } });
    expect(document.querySelector('[data-outside]')).toBeNull();
  });
});

describe('the Archived group', () => {
  /* the kit's folding SectionHead with its count, over ListRow items */
  const head = (): HTMLElement => q('.bt-archived .k7-shead__btn');
  const count = (): string => q('.bt-archived .k7-shead__count').textContent ?? '';
  const names = (): string[] => qa('.bt-archived .k7-lrow__title').map((n) => n.textContent ?? '');
  const shown = (): string => document.querySelector('.k7-notify .k7-notice__text')?.textContent ?? '';
  const restoreBtn = (name: string): HTMLButtonElement => q<HTMLButtonElement>('.bt-archived [data-act="restore"][aria-label="Restore ' + name + '"]');

  it('sits under the roster with a count, collapsed by default', () => {
    mount(mock());
    expect(q('.bt-archived .k7-shead__title').textContent).toBe('Archived');
    expect(count()).toBe('2');
    expect(head().getAttribute('aria-expanded')).toBe('false');
    expect(q<HTMLElement>('.bt-archived-rows').hidden).toBe(true);
    expect(q('.bt-list').lastElementChild?.previousElementSibling?.classList.contains('bt-archived')).toBe(true);
  });
  it('shows each archived bot by the name it returns to, when it was archived, and Restore', () => {
    mount(mock());
    expect(names()).toEqual(['ledger', 'nina']);
    expect(qa('.bt-archived .k7-lrow__sub').map((n) => n.textContent)).toEqual(['Archived yesterday', 'Archived mon']);
    expect(qa('.bt-archived [data-kit~="ListRow"]').every((r) => r.hasAttribute('data-archived-bot') && r.dataset['variant'] === 'item')).toBe(true);
    expect(qa('.bt-archived [data-kit~="ListRow"]').map((r) => r.getAttribute('aria-label'))).toEqual(['ledger, archived yesterday', 'nina, archived mon']);
    expect(restoreBtn('ledger').getAttribute('data-id')).toBe('archived--ledger');
  });
  it('archived bots are not in the roster', () => {
    mount(mock());
    expect(qa('.bt-rows > [data-kit~="ListRow"]').some((r) => r.getAttribute('aria-label')?.startsWith('ledger'))).toBe(false);
  });
  it('opens and closes, and remembers which, per user, the way the layout does (through core/settings)', () => {
    mount(mock());
    head().click();
    expect(head().getAttribute('aria-expanded')).toBe('true');
    expect(JSON.parse(localStorage.getItem(KEYS.bots) ?? '{}')).toMatchObject({ archivedOpen: true });
    mount(mock());
    expect(head().getAttribute('aria-expanded')).toBe('true');   // the next window opens it as it was left
    head().click();
    expect(JSON.parse(localStorage.getItem(KEYS.bots) ?? '{}')).toMatchObject({ archivedOpen: false });
    mount(mock());
    expect(head().getAttribute('aria-expanded')).toBe('false');
  });
  it('works when storage is blocked: it renders, collapsed', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    mount(mock());
    expect(head().getAttribute('aria-expanded')).toBe('false');
    head().click();
    expect(head().getAttribute('aria-expanded')).toBe('true');
  });
  it('Restore brings the bot back under its old name, into the roster, and says so; the group counts one fewer', async () => {
    mount(mock());
    head().click();
    restoreBtn('ledger').click();
    await flush();
    expect(shown()).toBe('Restored ledger');
    expect(q('.bt-rows [data-kit~="ListRow"][data-value="ledger"]')).toBeTruthy();
    expect(data().bots.snapshot().bots.some((b) => b.id === 'ledger')).toBe(true);
    expect(names()).toEqual(['nina']);
    expect(count()).toBe('1');
    expect(head().getAttribute('aria-expanded')).toBe('true');   // the redraw keeps it as the user left it
    expect(document.activeElement).toBe(q('.bt-rows [data-kit~="ListRow"][data-value="ledger"]'));
  });
  it('a name that is in use is refused with the same words, and the archived bot stays where it is', async () => {
    mount(mock());
    head().click();
    restoreBtn('nina').click();
    await flush();
    expect(shown()).toBe('Could not restore nina: there is a teammate called nina already; archive or delete it, then restore');
    expect(names()).toEqual(['ledger', 'nina']);
    expect(data().bots.snapshot().bots.filter((b) => b.id === 'nina')).toHaveLength(1);
  });
  it('the group goes when the last one is restored, and returns when one is archived', async () => {
    const arch = store<readonly ArchivedBot[]>([{ id: 'archived--a', name: 'archived--a', was: 'a', at: '', when: '' }]);
    const p = mock();
    mount({ ...p, bots: { ...p.bots, archived: arch, restore: () => { arch.set([]); return Promise.resolve(); } } });
    expect(qa('.bt-archived .k7-lrow__sub').map((n) => n.textContent)).toEqual(['Archived']);   // no date known: says only that
    restoreBtn('a').click();
    await flush();
    expect(q('.bt-archived').hidden).toBe(true);
    arch.set([{ id: 'archived--b', name: 'archived--b', was: 'b', at: '', when: '5m' }]);
    expect(q('.bt-archived').hidden).toBe(false);
    expect(qa('.bt-archived .k7-lrow__sub').map((n) => n.textContent)).toEqual(['Archived 5m ago']);
  });
  it('asks the provider once while a restore is under way', async () => {
    const p = mock();
    const restore = vi.fn(() => new Promise<void>(() => undefined));
    mount({ ...p, bots: { ...p.bots, restore } });
    restoreBtn('ledger').click(); restoreBtn('ledger').click();
    await flush();
    expect(restore).toHaveBeenCalledTimes(1);
  });
});
