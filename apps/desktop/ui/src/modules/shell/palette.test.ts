import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data, setProvider } from '../../data';
import type { ArchivedBot, DataProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { store } from '../../data/store';
import { sh } from './ctx';
import type { Els } from './ctx';
import { closePalette, openPalette, renderPalette, runPal, score } from './palette';

describe('palette scoring', () => {
  const item = { label: 'Hide sidebar', meta: 'layout', keys: 'sidebar left' };
  it('an empty query matches everything', () => { expect(score(item, '')).toBe(1); });
  it('every word must match somewhere, or the item is out', () => {
    expect(score(item, 'hide sidebar')).toBeGreaterThan(0);
    expect(score(item, 'hide zebra')).toBe(0);
  });
  it('a match at the start of the label beats one in the middle, and the label beats the keywords', () => {
    expect(score(item, 'hide')).toBeGreaterThan(score(item, 'sidebar'));
    expect(score(item, 'sidebar')).toBeGreaterThan(score(item, 'left'));
  });
  it('is case-insensitive through the caller (queries are lower-cased before scoring)', () => {
    expect(score({ label: 'Settings' }, 'set')).toBeGreaterThan(0);
  });
});


describe('"Restore bot…" in the palette', () => {
  const input = (): HTMLInputElement => document.getElementById('hx-palette-input') as HTMLInputElement;
  const list = (): HTMLElement => document.getElementById('hx-palette-list') as HTMLElement;
  const rows = (): string[] => [...list().querySelectorAll('.hx-pal-row')].map((r) => r.querySelector('.hx-pal-row__label')?.textContent ?? '');
  const heads = (): string[] => [...list().querySelectorAll('.hx-pal-group')].map((r) => r.textContent ?? '');
  const toast = (): string => document.querySelector('.ui-toast')?.textContent ?? '';
  const flush = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(20); for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const type = (text: string): void => { input().value = text; renderPalette(); };
  const run = (label: string): void => { runPal([...list().querySelectorAll('.hx-pal-row')].findIndex((r) => r.querySelector('.hx-pal-row__label')?.textContent === label)); };
  function mount(provider: DataProvider): void {
    setProvider(provider);
    document.body.innerHTML = '<div id="hx-palette" hidden><input id="hx-palette-input"><div id="hx-palette-list"></div></div><button id="hx-btn-search"></button>';
    sh.el = { palette: document.getElementById('hx-palette'), palInput: input(), palList: list(), btnSearch: document.getElementById('hx-btn-search'), settings: { open: false } } as unknown as Els;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0));
    Element.prototype.scrollIntoView = (): void => undefined;
  });
  afterEach(() => { closePalette(true); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('is a command while there are archived bots, and is not offered when there are none', () => {
    mount(createMockProvider({ simulate: false }));
    openPalette({}); type('restore');
    expect(rows()).toEqual(['Restore bot…']);
    const arch = store<readonly ArchivedBot[]>([]);
    const p = createMockProvider({ simulate: false });
    mount({ ...p, bots: { ...p.bots, archived: arch } });
    openPalette({}); type('restore');
    expect(rows()).toEqual([]);
  });
  it('its archived bots are not in the palette until it is asked', () => {
    mount(createMockProvider({ simulate: false }));
    openPalette({}); type('ledger');
    expect(rows()).toEqual([]);
  });
  it('running it lists the archived bots alone, by the name they return to, with when they were archived', () => {
    mount(createMockProvider({ simulate: false }));
    openPalette({}); type('restore'); run('Restore bot…');
    expect(document.getElementById('hx-palette')?.hidden).toBe(false);
    expect(input().placeholder).toBe('Restore which bot');
    expect(heads()).toEqual(['Archived bots']);
    expect(rows()).toEqual(['ledger', 'nina']);
    expect([...list().querySelectorAll('.hx-pal-row__meta')].map((n) => n.textContent)).toEqual(['Archived yesterday', 'Archived mon']);
    type('led');
    expect(rows()).toEqual(['ledger']);
  });
  it('choosing one restores it and says so', async () => {
    mount(createMockProvider({ simulate: false }));
    openPalette({}); type('restore'); run('Restore bot…');
    run('ledger');
    await flush();
    expect(toast()).toBe('Restored ledger');
    expect(data().bots.snapshot().bots.some((b) => b.id === 'ledger')).toBe(true);
    expect(data().bots.archived.get().map((a) => a.was)).toEqual(['nina']);
    expect(document.getElementById('hx-palette')?.hidden).toBe(true);
  });
  it('a name that is in use is refused with the same words, and the bot stays archived', async () => {
    mount(createMockProvider({ simulate: false }));
    openPalette({}); type('restore'); run('Restore bot…');
    run('nina');
    await flush();
    expect(toast()).toBe('Could not restore nina: there is a teammate called nina already; archive or delete it, then restore');
    expect(data().bots.archived.get().map((a) => a.was)).toEqual(['ledger', 'nina']);
  });
  it('stays while one is still archived after another is restored', async () => {
    mount(createMockProvider({ simulate: false }));
    openPalette({}); type('restore'); run('Restore bot…'); run('ledger');
    await flush();
    openPalette({}); type('restore');
    expect(rows()).toEqual(['Restore bot…']);   // nina is still archived
  });
});
