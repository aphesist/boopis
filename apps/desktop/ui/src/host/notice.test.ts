// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showStartupFailure } from './notice';
import { createWindowControls } from './window-controls';
import type { WindowAction } from './bindings';

beforeEach(() => { document.body.replaceChildren(); });

describe('the startup notice', () => {
  it('covers the window with the window\'s own title bar, says what failed with its code, and retries', async () => {
    const calls: WindowAction[] = [];
    const host = { info: () => Promise.resolve({ platform: 'windows' as const, desktop: 'Windows', tiling: false, maximized: false, fullscreen: false }), control: (a: WindowAction) => { calls.push(a); return Promise.resolve(); }, onState: () => Promise.resolve(() => undefined) };
    const retry = vi.fn();
    const err = Object.assign(new Error('The engine did not answer.'), { code: 'hx.gateway.unreachable' });
    const root = showStartupFailure(err, { windowControls: createWindowControls({ host, notify: () => undefined }), retry });
    expect(root.firstElementChild?.getAttribute('data-tauri-drag-region')).toBe('deep');
    const close = root.querySelector<HTMLElement>('.hx-win [data-win="close"]');
    expect(close?.hidden).toBe(false);
    close?.click();
    expect(calls).toEqual(['close']);
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('boopis could not reach its engine');
    expect(root.querySelector('[data-reason]')?.textContent).toContain('The engine did not answer.');
    expect(alert?.getAttribute('data-kit')).toBe('Notice');
    expect(root.querySelector('[data-kit~="InlineChip"][data-kind="code"]')?.textContent).toBe('hx.gateway.unreachable');
    expect(alert?.contains(close as Node), 'the alert is the message, not the window\'s buttons').toBe(false);
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    expect(button?.disabled).toBe(false);
    button?.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
