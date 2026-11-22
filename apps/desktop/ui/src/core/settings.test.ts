import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEYS, SCHEMA_VERSION, UI_ZOOM, clearAll, loadBots, loadShell, loadUiSize, readJSON, readText, saveBots, saveUiSize, writeJSON, writeText } from './settings';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('settings persistence', () => {
  it('writes versioned JSON and reads it back', () => {
    expect(writeJSON(KEYS.shell, { tab: 'bots', left: 'rail' })).toBe(true);
    expect(readJSON(KEYS.shell)).toEqual({ v: SCHEMA_VERSION, tab: 'bots', left: 'rail' });
    expect(loadShell()).toMatchObject({ tab: 'bots', left: 'rail' });
  });
  it('reads data saved before there was a version', () => {
    localStorage.setItem(KEYS.shell, JSON.stringify({ tab: 'bots' }));
    expect(loadShell().tab).toBe('bots');
  });
  it('a corrupt value reads as nothing, never throws', () => {
    localStorage.setItem(KEYS.theme, '{not json');
    expect(readJSON(KEYS.theme)).toBeNull();
    expect(loadShell()).toEqual({});
  });
  it('blocked storage: reads are null and writes report false, nothing throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readText(KEYS.dock)).toBeNull();
    expect(writeText(KEYS.dock, 'x')).toBe(false);
    expect(writeJSON(KEYS.dock, { a: 1 })).toBe(false);
  });
  it('clearAll removes every key the UI owns', () => {
    for (const k of Object.values(KEYS)) localStorage.setItem(k, '1');
    clearAll();
    expect(Object.values(KEYS).every((k) => localStorage.getItem(k) === null)).toBe(true);
  });
});

describe('the Bots tab’s own setting: whether the Archived group is open', () => {
  it('is closed until the user opens it, and keeps what they chose', () => {
    expect(loadBots()).toEqual({ archivedOpen: false, archivedGroups: [] });
    expect(saveBots({ archivedOpen: true })).toBe(true);
    expect(loadBots()).toEqual({ archivedOpen: true, archivedGroups: [] });
    saveBots({ archivedOpen: false });
    expect(loadBots()).toEqual({ archivedOpen: false, archivedGroups: [] });
  });
  it('keeps the archived groups beside it: saving one leaves the other as it was', () => {
    saveBots({ archivedGroups: ['g1'] });
    saveBots({ archivedOpen: true });
    expect(loadBots()).toEqual({ archivedOpen: true, archivedGroups: ['g1'] });
    localStorage.setItem(KEYS.bots, JSON.stringify({ archivedGroups: [1, 'g2'] }));
    expect(loadBots().archivedGroups).toEqual(['g2']);
  });
  it('anything but a true is closed, and a corrupt value or blocked storage never throws', () => {
    localStorage.setItem(KEYS.bots, JSON.stringify({ archivedOpen: 'yes' }));
    expect(loadBots().archivedOpen).toBe(false);
    localStorage.setItem(KEYS.bots, '{not json');
    expect(loadBots().archivedOpen).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadBots().archivedOpen).toBe(false);
    expect(saveBots({ archivedOpen: true })).toBe(false);
  });
});

describe('the interface size', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  it('is the default until one is chosen, and remembers the choice', () => {
    expect(loadUiSize()).toBe('default');
    expect(saveUiSize('larger')).toBe(true);
    expect(loadUiSize()).toBe('larger');
    saveUiSize('largest');
    expect(loadUiSize()).toBe('largest');
  });
  it('ignores a value it does not know, and blocked storage', () => {
    localStorage.setItem(KEYS.size, JSON.stringify({ size: 'huge' }));
    expect(loadUiSize()).toBe('default');
    localStorage.setItem(KEYS.size, '{not json');
    expect(loadUiSize()).toBe('default');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadUiSize()).toBe('default');
  });
  it('zooms by 100%, 112% and 125%', () => {
    expect(UI_ZOOM).toEqual({ default: 1, larger: 1.12, largest: 1.25 });
  });
});
