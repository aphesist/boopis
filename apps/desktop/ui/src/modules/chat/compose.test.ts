// @vitest-environment jsdom
/* A composer's own controls do their jobs (modules/chat/compose.ts over the kit's Composer): "+" asks the host for files and writes
   each into the text as an "@" reference, a file dropped on it or pasted into it becomes the same chip, the mic dictates through the
   provider until it is switched off (the bot's orbs listen meanwhile), the voice circle is always
   there and either talks (a voice model is set up) or says what it needs and leads to Settings, Models; send and stop are said as events. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kit, ui } from '@boopis/ui';
import { on } from '../../core/bus';
import { setProvider } from '../../data';
import type { DataProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import type { FileDrag } from '../../data/provider';
import { NO_PLACE, composeTools, micNeedsSetup, voiceNeedsSetup } from './compose';

const tick = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
let slot: HTMLElement, heard: ((t: string) => void) | null, cancelled: number, started: Array<string | null>, provider: DataProvider;
function mount(running = false): HTMLElement {
  slot.replaceChildren(kit.composer({ kind: 'bot', placeholder: 'Message kai', voiceSetup: voiceNeedsSetup(), micSetup: micNeedsSetup(), running }));
  return slot.querySelector('.k7-composer') as HTMLElement;
}
const notice = (): HTMLElement | null => document.querySelector<HTMLElement>('.k7-notice[data-floating]');
const text = (): HTMLElement => slot.querySelector('.k7-composer__text') as HTMLElement;
beforeEach(() => {
  heard = null; cancelled = 0; started = [];
  const p = createMockProvider({ simulate: false });
  provider = {
    ...p,
    files: { ...p.files, pick: () => Promise.resolve([{ name: 'notes.md', kind: 'file', path: '/work/notes.md' }, { name: 'plan.txt', kind: 'file' }]) },
    dictation: { start: (o, on) => { started.push(o.botId); heard = on; return () => { cancelled++; heard = null; }; } }
  };
  setProvider(provider);
  document.body.replaceChildren();
  slot = document.createElement('div');
  document.body.append(slot);
  composeTools(slot, { botId: () => 'kai' });
});

describe('a composer\'s controls', () => {
  it('"+" asks the host for files and writes each as an "@" reference (its path where the host gave one)', async () => {
    mount();
    (slot.querySelector('[data-plus]') as HTMLElement).click();
    await tick();
    expect(text().textContent).toBe('@/work/notes.md @plan.txt ');
    expect(slot.querySelector('.k7-composer')?.hasAttribute('data-typed')).toBe(true);
  });
  it('the mic dictates into the text for the open bot until it is switched off', () => {
    mount();
    const mic = slot.querySelector('[data-mic]') as HTMLElement;
    mic.click();
    expect(mic.getAttribute('aria-pressed')).toBe('true');
    expect(started).toEqual(['kai']);
    heard?.('ship it');
    expect(text().textContent).toBe('ship it');
    mic.click();
    expect(mic.getAttribute('aria-pressed')).toBe('false');
    expect(cancelled).toBe(1);
  });
  it('no voice model set up: the voice circle is there, says so, starts nothing, and opens a Notice whose one action is Settings at Models', () => {
    mount();
    const end = slot.querySelector('[data-send]') as HTMLElement, opened: string[] = [];
    const off = on('hx:open-settings', (d) => { opened.push(d.section); });
    expect(provider.voice).toBeUndefined();
    expect(end.hidden).toBe(false);
    expect(end.getAttribute('aria-label')).toBe('Talk: set up a voice model first');
    expect(end.getAttribute('data-tip')).toBe('Talk: set up a voice model first');
    end.click();
    const n = notice() as HTMLElement;
    expect(n).not.toBeNull();
    expect(n.getAttribute('data-kit')).toBe('Notice');
    expect(n.getAttribute('role')).toBe('dialog');
    expect(n.querySelector('.k7-notice__text')?.textContent).toBe('Voice needs a voice model');
    const acts = [...n.querySelectorAll<HTMLElement>('[data-kit~="Button"]')];
    expect(acts.map((b) => b.textContent?.trim())).toEqual(['Set up voice']);
    expect(document.activeElement).toBe(acts[0]);
    expect(end.getAttribute('aria-expanded')).toBe('true');
    expect(opened).toEqual([]);
    acts[0]!.click();
    expect(opened).toEqual(['models']);
    expect(end.getAttribute('aria-expanded')).toBe('false');
    /* Esc closes it and the focus is back on the circle; nothing was started */
    end.click();
    expect(end.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(end.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(end);
    expect(opened).toEqual(['models']);
    off();
  });
  it('no speech model (the provider has no dictation, as the desktop app\'s): the mic is there, says so, starts nothing, and opens a Notice whose one action is Settings at Models', () => {
    const { dictation: _none, ...rest } = provider;
    setProvider(rest);
    mount();
    const mic = slot.querySelector('[data-mic]') as HTMLElement, opened: string[] = [];
    const off = on('hx:open-settings', (d) => { opened.push(d.section); });
    expect(mic.hidden).toBe(false);
    expect(mic.getAttribute('aria-label')).toBe('Dictate: set up a speech model first');
    expect(mic.getAttribute('data-tip')).toBe('Dictate: set up a speech model first');
    mic.click();
    expect(mic.getAttribute('aria-pressed')).toBe('false');
    expect(started).toEqual([]);
    const n = notice() as HTMLElement;
    expect(n.getAttribute('data-kit')).toBe('Notice');
    expect(n.getAttribute('role')).toBe('dialog');
    expect(n.querySelector('.k7-notice__text')?.textContent).toBe('Dictation needs a speech model');
    const acts = [...n.querySelectorAll<HTMLElement>('[data-kit~="Button"]')];
    expect(acts.map((b) => b.textContent?.trim())).toEqual(['Set up voice']);
    expect(mic.getAttribute('aria-expanded')).toBe('true');
    acts[0]!.click();
    expect(opened).toEqual(['models']);
    expect(notice()?.classList.contains('is-in') ?? false).toBe(false);
    /* alt+V from the text asks the same; Esc closes it and the focus is back on the mic */
    text().dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', altKey: true, bubbles: true, cancelable: true }));
    expect(mic.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(mic.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(mic);
    expect(started).toEqual([]);
    off();
  });
  it('a voice model set up (the provider\'s voice): the circle is named Talk, a press starts talking with the open bot, another ends it; no Notice', () => {
    const talks: Array<string | null> = []; let ended = 0;
    setProvider({ ...provider, voice: { start: (o) => { talks.push(o.botId); return () => { ended++; }; } } });
    mount();
    const end = slot.querySelector('[data-send]') as HTMLElement;
    expect(end.getAttribute('aria-label')).toBe('Talk');
    expect(end.hasAttribute('aria-haspopup')).toBe(false);
    end.click();
    expect(talks).toEqual(['kai']);
    expect(notice()).toBeNull();
    end.click();
    expect(ended).toBe(1);
    expect(talks).toEqual(['kai']);
  });
  it('with text the circle is the send, and sends', () => {
    const c = mount();
    const end = slot.querySelector('[data-send]') as HTMLElement;
    const voice = vi.fn(), send = vi.fn();
    c.addEventListener('ui:voice', voice); c.addEventListener('ui:send', (e) => { send((e as CustomEvent<{ text: string }>).detail.text); });
    kit.composerInsert(c, 'hello');
    expect(end.hidden).toBe(false);
    expect(end.getAttribute('aria-label')).toBe('Send');
    end.click();
    expect(send).toHaveBeenCalledWith('hello');
    expect(voice).not.toHaveBeenCalled();
    expect(text().textContent).toBe('');
  });
  it('Stop is its own button while it runs (the primary circle never becomes it); idle, a press of it does nothing', () => {
    const c = mount(true);
    const stop = vi.fn();
    c.addEventListener('ui:stop', stop);
    const b = slot.querySelector('[data-stop]') as HTMLElement;
    expect(b.getAttribute('aria-label')).toBe('Stop');
    expect((slot.querySelector('[data-send]') as HTMLElement).getAttribute('aria-label')).toBe('Talk: set up a voice model first');
    b.click();
    expect(stop).toHaveBeenCalledTimes(1);
    kit.composerRunning(c, false);
    b.click();
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it('Enter sends, ctrl Enter is the second way (steer; a new session: start in the background), Shift Enter is a new line', () => {
    const c = mount();
    const send = vi.fn(), steer = vi.fn();
    c.addEventListener('ui:send', send); c.addEventListener('ui:steer', steer);
    kit.composerInsert(c, 'one');
    text().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    expect(send).not.toHaveBeenCalled();
    text().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(steer).toHaveBeenCalledTimes(1);
    kit.composerInsert(c, 'two');
    text().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('files dropped on a composer or pasted into it', () => {
  const files = (...names: string[]): File[] => names.map((n) => new File(['x'], n));
  const give = (list: File[], via: 'drop' | 'paste'): void => { slot.querySelector('.k7-composer')?.dispatchEvent(new CustomEvent('ui:files', { bubbles: true, detail: { files: list, via } })); };
  const chips = (): Array<[string | null, string | null]> => [...text().querySelectorAll<HTMLElement>('[data-kit~="InlineChip"]')].map((c) => [c.getAttribute('data-kind'), c.getAttribute('data-words')]);
  it('each becomes the chip "+" makes of a file: its name shows, its words are the "@" reference', () => {
    mount();
    give(files('notes.md', 'shot.png'), 'drop');
    expect(chips()).toEqual([['reference', '@notes.md'], ['reference', '@shot.png']]);
    give(files('plan.txt'), 'paste');
    expect(text().textContent).toBe('@notes.md @shot.png @plan.txt ');
  });
  it('in the live app a file with no place on disk is not attached, and the app says why', () => {
    setProvider({ ...provider, info: { ...provider.info, live: true } });
    mount();
    give(files('shot.png'), 'paste');
    expect(chips()).toEqual([]);
    expect(kit.notifyText()).toBe(NO_PLACE);
  });
  it('the desktop app: the host reports the drag and the drop with the files\' paths; the composer under the pointer shows it and takes them', () => {
    let emit: (e: FileDrag) => void = () => undefined;
    setProvider({ ...provider, files: { ...provider.files, drops: { subscribe: (fn) => { emit = fn; return () => undefined; } } } });
    const other = document.createElement('div');
    document.body.append(other);
    composeTools(other, { botId: () => 'nina' });
    other.replaceChildren(kit.composer({ kind: 'bot', placeholder: 'Message nina' }));
    mount();
    const at = (el: HTMLElement, top: number): void => { el.getBoundingClientRect = () => ({ left: 0, right: 600, top, bottom: top + 60, width: 600, height: 60, x: 0, y: top, toJSON: () => ({}) }); };
    at(slot, 100); at(other, 400);
    const dropping = (el: HTMLElement): boolean => !!el.querySelector('.k7-composer')?.hasAttribute('data-drop');
    emit({ phase: 'over', x: 50, y: 120, attachments: [] });
    expect([dropping(slot), dropping(other)]).toEqual([true, false]);
    emit({ phase: 'over', x: 50, y: 420, attachments: [] });
    expect([dropping(slot), dropping(other)]).toEqual([false, true]);
    emit({ phase: 'over', x: 50, y: 300, attachments: [] });   /* over neither */
    expect([dropping(slot), dropping(other)]).toEqual([false, false]);
    emit({ phase: 'over', x: 50, y: 120, attachments: [] });
    emit({ phase: 'drop', x: 50, y: 120, attachments: [{ name: 'notes.md', kind: 'file', path: '/work/notes.md' }] });
    expect(dropping(slot)).toBe(false);
    expect(chips()).toEqual([['reference', '@/work/notes.md']]);
    expect(other.querySelector('.k7-composer__text')?.textContent).toBe('');
    emit({ phase: 'drop', x: 50, y: 300, attachments: [{ name: 'lost.md', kind: 'file', path: '/work/lost.md' }] });   /* dropped elsewhere: nobody's */
    expect(chips()).toHaveLength(1);
  });
});

describe('the bot listens while you dictate', () => {
  it('its orbs on the page listen while the mic is on and go back to what they were: one at rest to its pose, one in a state to that state', () => {
    const KAI = { id: 'kai', name: 'kai', state: 'idle' as const };
    const row = document.createElement('div');
    row.innerHTML = ui.html.orb(KAI, { size: 28, rest: true }) + ui.html.orb({ ...KAI, state: 'working' as const }, { size: 20 }) + ui.html.orb({ id: 'nina', name: 'nina', state: 'idle' as const }, { size: 28, rest: true });
    document.body.append(row);
    const [rest, working, nina] = [...row.querySelectorAll('orb-avatar')] as unknown as [Element, Element, Element];
    const before = [rest.getAttribute('reaction'), working.getAttribute('reaction'), nina.getAttribute('reaction')];
    mount();
    const mic = slot.querySelector('[data-mic]') as HTMLElement;
    mic.click();
    expect([rest.getAttribute('reaction'), working.getAttribute('reaction'), nina.getAttribute('reaction')]).toEqual(['listening', 'listening', before[2]]);
    expect(rest.getAttribute('idle-motion')).not.toBe('off');   /* out of its pose, alive */
    mic.click();
    expect([rest.getAttribute('reaction'), working.getAttribute('reaction')]).toEqual(before.slice(0, 2));
    expect(rest.getAttribute('idle-motion')).toBe('off');
  });
});
