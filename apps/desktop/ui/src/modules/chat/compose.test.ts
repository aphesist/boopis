// @vitest-environment jsdom
/* A composer's own controls do their jobs (modules/chat/compose.ts over the kit's Composer): "+" asks the host for files and writes
   each into the text as an "@" reference, the mic dictates through the provider until it is switched off, the voice button with no
   text is drawn and says why it does nothing, send and stop are said as events. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kit } from '@boopis/ui';
import { setProvider } from '../../data';
import type { DataProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { composeTools, VOICE_NOT_YET } from './compose';

const tick = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
let slot: HTMLElement, heard: ((t: string) => void) | null, cancelled: number, started: Array<string | null>;
function mount(running = false): HTMLElement {
  slot.replaceChildren(kit.composer({ kind: 'bot', placeholder: 'Message kai', voiceOff: VOICE_NOT_YET, running }));
  return slot.querySelector('.k7-composer') as HTMLElement;
}
const text = (): HTMLElement => slot.querySelector('.k7-composer__text') as HTMLElement;
beforeEach(() => {
  heard = null; cancelled = 0; started = [];
  const p = createMockProvider({ simulate: false });
  const provider: DataProvider = {
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
  it('the voice button with no text is drawn and does nothing, and its tip says why; with text it sends', () => {
    const c = mount();
    const end = slot.querySelector('[data-send]') as HTMLElement;
    const voice = vi.fn(), send = vi.fn();
    c.addEventListener('ui:voice', voice); c.addEventListener('ui:send', (e) => { send((e as CustomEvent<{ text: string }>).detail.text); });
    expect(end.getAttribute('aria-disabled')).toBe('true');
    expect(end.getAttribute('data-tip')).toBe(VOICE_NOT_YET);
    end.click();
    expect(voice).not.toHaveBeenCalled();
    kit.composerInsert(c, 'hello');
    expect(end.hasAttribute('aria-disabled')).toBe(false);
    expect(end.getAttribute('aria-label')).toBe('Send');
    end.click();
    expect(send).toHaveBeenCalledWith('hello');
    expect(text().textContent).toBe('');
  });
  it('while it runs, the end button with no text is Stop', () => {
    const c = mount(true);
    const stop = vi.fn();
    c.addEventListener('ui:stop', stop);
    (slot.querySelector('[data-send]') as HTMLElement).click();
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
