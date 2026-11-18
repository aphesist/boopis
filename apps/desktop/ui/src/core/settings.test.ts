import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEYS, SCHEMA_VERSION, clearAll, loadShell, readJSON, readText, writeJSON, writeText } from './settings';

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
