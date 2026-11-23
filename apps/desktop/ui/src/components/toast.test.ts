/* The toast's wait for the shell (toast.whenReady): a notice the host hands over while the app is still booting (the bots'
   repair, the watchdog) is not drawn before the shell has laid out the centre line it sits on, and is drawn once when it has.
   The owner's recording of 0.1.9: the governance notice appeared half off the window's top-left edge during the start, then
   moved under the bot's header. Where the toast sits without a centre line is toast-place.test.ts (a real engine). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emit } from '../core/bus';
import type { AppState } from '../core/types';
import { toast } from './toast';

const NOTICE = 'Governed mode now really applies to a bot when you turn it on.';
const shown = (): string[] => [...document.querySelectorAll('.ui-toast > span')].map((s) => s.textContent ?? '');
const ready = (): void => { document.getElementById('hx-app')?.classList.remove('is-booting'); emit('hx:ready', { state: {} as AppState }); };

describe('toast.whenReady', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="hx-app" class="hx ui-root is-booting"></div>'; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('draws nothing while the shell boots, then the notice once the shell is ready, and only once', () => {
    toast.whenReady(NOTICE);
    expect(document.querySelector('.ui-toast')).toBeNull();
    ready();
    expect(shown()).toEqual([NOTICE]);
    expect(document.querySelector('.ui-toast')?.parentElement?.id).toBe('hx-app');
    emit('hx:ready', { state: {} as AppState });
    expect(document.querySelectorAll('.ui-toast')).toHaveLength(1);
    expect(shown()).toEqual([NOTICE]);
  });

  it('draws at once when the shell has already booted', () => {
    ready();
    toast.whenReady(NOTICE);
    expect(shown()).toEqual([NOTICE]);
  });

  it('draws at once where there is no app root to wait for', () => {
    document.body.innerHTML = '';
    toast.whenReady(NOTICE);
    expect(shown()).toEqual([NOTICE]);
    expect(document.querySelector('.ui-toast')?.parentElement).toBe(document.body);
  });

  it('a plain toast is not held: a layer over the whole window before the shell boots (first run) shows its own at once', () => {
    toast('Finish signing in to Claude in your browser.');
    expect(shown()).toEqual(['Finish signing in to Claude in your browser.']);
  });
});
