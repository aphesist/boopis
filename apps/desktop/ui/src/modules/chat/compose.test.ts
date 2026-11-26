// @vitest-environment jsdom
/* A composer's own controls do their jobs (modules/chat/compose.ts over the kit's Composer): "+" asks the host for files and writes
   each into the text as an "@" reference, the mic dictates through the provider until it is switched off, the voice circle is always
   there and either talks (a voice model is set up) or says what it needs and leads to Settings, Models; send and stop are said as events. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kit } from '@boopis/ui';
import { on } from '../../core/bus';
import { setProvider } from '../../data';
import type { DataProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { composeTools, voiceNeedsSetup } from './compose';

const tick = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
let slot: HTMLElement, heard: ((t: string) => void) | null, cancelled: number, started: Array<string | null>, provider: DataProvider;
function mount(running = false): HTMLElement {
  slot.replaceChildren(kit.composer({ kind: 'bot', placeholder: 'Message kai', voiceSetup: voiceNeedsSetup(), running }));
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
