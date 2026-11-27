import { describe, expect, it } from 'vitest';
import { KEYGROUPS, classifyKey, keysTableHTML } from './keymap';
import type { KeyCtx, KeyLike } from './keymap';

const key = (o: Partial<KeyLike> & { code: string }): KeyLike => ({ key: o.code.replace(/^Key|^Digit/, ''), ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, isComposing: false, ...o });
const linux: KeyCtx = { isMac: false, typing: false, layerOpen: false };
const mac: KeyCtx = { isMac: true, typing: false, layerOpen: false };
const typing: KeyCtx = { isMac: false, typing: true, layerOpen: false };
const type = (k: KeyLike, c: KeyCtx = linux): string | null => { const r = classifyKey(k, c); return r ? r.command.type : null; };

describe('the global keys (KEYMAP.md section 1)', () => {
  it.each([
    ['KeyK', {}, 'palette-toggle'], ['KeyP', {}, 'palette-items'], ['KeyO', { shiftKey: true }, 'new'], ['KeyB', {}, 'sidebar-toggle'], ['KeyB', { shiftKey: true }, 'sidebar-hide-toggle'],
    ['KeyI', {}, 'details'], ['KeyJ', {}, 'dock-toggle'], ['KeyJ', { shiftKey: true }, 'dock-expand'], ['BracketLeft', {}, 'back'], ['BracketRight', {}, 'forward'],
    ['Comma', {}, 'settings'], ['KeyL', { shiftKey: true }, 'light-dark'], ['KeyS', { shiftKey: true }, 'store'], ['Slash', {}, 'keys'], ['KeyG', {}, 'leader'], ['KeyF', {}, 'find'], ['Period', {}, 'stop']
  ])('mod+%s %j is %s', (code, extra, expected) => { expect(type(key({ code, ctrlKey: true, ...extra }))).toBe(expected); });
  it('mod is Command on a Mac and Control elsewhere, and the other one is not mod', () => {
    expect(type(key({ code: 'KeyK', metaKey: true }), mac)).toBe('palette-toggle');
    expect(type(key({ code: 'KeyK', ctrlKey: true }), mac)).toBeNull();
    expect(type(key({ code: 'KeyK', metaKey: true }), linux)).toBeNull();
  });
  it('mod+shift+, opens the Appearance section, mod+, the General one', () => {
    expect(classifyKey(key({ code: 'Comma', ctrlKey: true, shiftKey: true }), linux)?.command).toEqual({ type: 'settings', section: 'appearance' });
    expect(classifyKey(key({ code: 'Comma', ctrlKey: true }), linux)?.command).toEqual({ type: 'settings', section: 'general' });
  });
  it('alt+1 and alt+2 pick the tabs, matched by code so Option on a Mac works', () => {
    expect(classifyKey(key({ code: 'Digit1', altKey: true, key: '¡' }), mac)?.command).toEqual({ type: 'tab', tab: 'session' });
    expect(classifyKey(key({ code: 'Digit2', altKey: true }), linux)?.command).toEqual({ type: 'tab', tab: 'bots' });
  });
  it('F6 and F8 move between regions and things that need you, shift reverses', () => {
    expect(classifyKey(key({ code: 'F6', key: 'F6' }), linux)?.command).toEqual({ type: 'region', dir: 1 });
    expect(classifyKey(key({ code: 'F6', key: 'F6', shiftKey: true }), linux)?.command).toEqual({ type: 'region', dir: -1 });
    expect(classifyKey(key({ code: 'F8', key: 'F8', shiftKey: true }), linux)?.command).toEqual({ type: 'attention', dir: -1 });
  });
  it('modifier keys work while typing', () => {
    expect(type(key({ code: 'KeyK', ctrlKey: true }), typing)).toBe('palette-toggle');
    expect(type(key({ code: 'F6', key: 'F6' }), typing)).toBe('region');
  });
  it('find and stop are only taken from the browser if a module answers: the shell decides', () => {
    expect(classifyKey(key({ code: 'KeyF', ctrlKey: true }), linux)?.preventDefault).toBe(false);
    expect(classifyKey(key({ code: 'Period', ctrlKey: true }), linux)?.preventDefault).toBe(false);
    expect(classifyKey(key({ code: 'KeyK', ctrlKey: true }), linux)?.preventDefault).toBe(true);
  });
  it('Esc is always reported, never prevented here (what it closes depends on what is open)', () => {
    const r = classifyKey(key({ code: 'Escape', key: 'Escape' }), linux);
    expect(r).toEqual({ command: { type: 'escape' }, preventDefault: false });
  });
});

describe('the navigation layer: single keys (KEYMAP.md section 2)', () => {
  it('? opens the sheet, g starts a go-to, / and i focus the composer', () => {
    expect(type(key({ code: 'Slash', key: '?', shiftKey: true }))).toBe('keys');
    expect(classifyKey(key({ code: 'KeyG', key: 'g' }), linux)?.command).toEqual({ type: 'leader', withMod: false });
    expect(type(key({ code: 'Slash', key: '/' }))).toBe('composer');
    expect(type(key({ code: 'KeyI', key: 'i' }))).toBe('composer');
  });
  it('they never fire while typing in a field', () => {
    for (const k of [key({ code: 'Slash', key: '?', shiftKey: true }), key({ code: 'KeyG', key: 'g' }), key({ code: 'Slash', key: '/' }), key({ code: 'KeyI', key: 'i' })]) expect(type(k, typing)).toBeNull();
  });
  it('nor while a layer is open', () => {
    expect(type(key({ code: 'KeyG', key: 'g' }), { isMac: false, typing: false, layerOpen: true })).toBeNull();
  });
  it('nor with a modifier (alt+i is not a go-to)', () => {
    expect(type(key({ code: 'KeyI', key: 'i', altKey: true }))).toBeNull();
  });
  it('shift+G is not the go-to (it is "latest turn" in the conversation)', () => {
    expect(type(key({ code: 'KeyG', key: 'G', shiftKey: true }))).toBeNull();
  });
  it('a key that something else already handled, or that is mid-composition, is left alone', () => {
    expect(type(key({ code: 'KeyK', ctrlKey: true, defaultPrevented: true }))).toBeNull();
    expect(type(key({ code: 'KeyK', ctrlKey: true, isComposing: true }))).toBeNull();
  });
});

describe('the key table that feeds the sheet, Settings and the palette', () => {
  it('has every group of KEYMAP.md', () => {
    expect(KEYGROUPS.map(([g]) => g)).toEqual(['General', 'Layout', 'Move around', 'Lists', 'Conversation', 'Cards', 'Composer', 'Dock', 'Palette']);
  });
  it('lists the owner\'s decisions: hold to approve, talk, the model picker', () => {
    const all = JSON.stringify(KEYGROUPS);
    expect(all).toContain('hold:space | enter enter');
    expect(all).toContain('alt+V');
    expect(all).toContain('alt+M');
  });
  it('has the dock\'s regions of KEYMAP.md section 8: the row, the grid, the switcher, the queue and the page nub', () => {
    const dock = JSON.stringify(KEYGROUPS.find(([g]) => g === 'Dock'));
    for (const part of ['Bot row', 'Grid', 'Session switcher', 'Queue', 'Page nub', 'mod+enter', 'pageup']) expect(dock).toContain(part);
    expect(JSON.stringify(KEYGROUPS.find(([g]) => g === 'Cards'))).toContain('cut name');
  });
  it('filters by group, label or spec, and says so when nothing matches', () => {
    expect(keysTableHTML('dock')).toContain('k7-section');
    expect(keysTableHTML('zzzzzz')).toContain('No shortcut matches');
    expect(keysTableHTML('f6')).toContain('Next or previous region');
  });
  it('escapes what the filter echoes back', () => {
    expect(keysTableHTML('<img onerror=x>')).not.toContain('<img');
  });
});
