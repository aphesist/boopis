// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWindowControls, layoutGroup, maxLabel, windowBar, windowGroup } from './window-controls';
import type { WindowHost, WindowInfo } from './window';
import type { WindowAction } from './bindings';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const order = (g: HTMLElement): string[] => [...g.querySelectorAll<HTMLElement>('[data-win]')].map((b) => b.dataset['win'] ?? '');
const shown = (g: HTMLElement): string[] => [...g.querySelectorAll<HTMLElement>('[data-win]')].filter((b) => !b.hidden).map((b) => b.dataset['win'] ?? '');
const info = (over: Partial<WindowInfo>): WindowInfo => ({ platform: 'windows', desktop: 'Windows', tiling: false, maximized: false, fullscreen: false, ...over });

class FakeHost implements WindowHost {
  calls: WindowAction[] = [];
  state: ((s: { maximized: boolean; fullscreen: boolean }) => void) | null = null;
  asked = 0;
  constructor(private facts: WindowInfo | Error) {}
  info() { this.asked += 1; return this.facts instanceof Error ? Promise.reject(this.facts) : Promise.resolve(this.facts); }
  control(a: WindowAction) { this.calls.push(a); return Promise.resolve(); }
  onState(cb: (s: { maximized: boolean; fullscreen: boolean }) => void) { this.state = cb; return Promise.resolve(() => undefined); }
}

beforeEach(() => { document.body.replaceChildren(); });

describe('the window group', () => {
  it('is the kit\'s three window buttons, named for what they do', () => {
    const g = windowGroup();
    expect(g.getAttribute('role')).toBe('group');
    expect(g.getAttribute('aria-label')).toBe('Window');
    const buttons = [...g.querySelectorAll('button')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Minimize', 'Maximize', 'Close window']);
    for (const b of buttons) expect(b.className).toContain('ui-ib--window');
  });

  it('draws each layout: close alone, the three, the three in macOS\'s order', () => {
    const g = windowGroup();
    layoutGroup(g, 'close');
    expect(shown(g)).toEqual(['close']);
    layoutGroup(g, 'mac');
    expect(order(g)).toEqual(['close', 'min', 'max']);
    expect(shown(g)).toEqual(['close', 'min', 'max']);
    layoutGroup(g, 'all');
    expect(order(g)).toEqual(['min', 'max', 'close']);
    expect(g.dataset['layout']).toBe('all');
  });

  it('the maximise button says what a press does', () => {
    expect(maxLabel({ maximized: false, fullscreen: false }, 'all')).toEqual({ label: 'Maximize', icon: 'maximize' });
    expect(maxLabel({ maximized: true, fullscreen: false }, 'all')).toEqual({ label: 'Restore', icon: 'restore' });
    expect(maxLabel({ maximized: false, fullscreen: true }, 'mac').label).toBe('Exit full screen');
    expect(maxLabel({ maximized: false, fullscreen: false }, 'mac').label).toBe('Full screen');
    expect(maxLabel(null, 'all', true).label).toBe('Exit full screen');
  });
});

describe('one controller for every bar', () => {
  it('lays out the shell\'s group and a layer\'s by the same rule, and both follow what the host found', async () => {
    const host = new FakeHost(info({ platform: 'linux', desktop: 'Hyprland', tiling: true }));
    const c = createWindowControls({ host, toast: () => undefined });
    const shellGroup = windowGroup();
    const layer = windowGroup();
    c.attach(shellGroup);
    c.attach(layer);
    /* before the host answers, nothing is hidden on a guess */
    expect(shown(layer)).toEqual(['min', 'max', 'close']);
    await tick();
    expect(host.asked).toBe(1);
    expect(shown(shellGroup)).toEqual(['close']);
    expect(shown(layer)).toEqual(['close']);
  });

  it('Windows gets the three; macOS its order', async () => {
    const win = createWindowControls({ host: new FakeHost(info({})), toast: () => undefined });
    const a = windowGroup(); win.attach(a); await tick();
    expect(shown(a)).toEqual(['min', 'max', 'close']);
    const mac = createWindowControls({ host: new FakeHost(info({ platform: 'macos', desktop: 'macOS' })), toast: () => undefined });
    const b = windowGroup(); mac.attach(b); await tick();
    expect(order(b)).toEqual(['close', 'min', 'max']);
  });

  it('the Settings preference beats the guess on every bar, is saved, and tells the settings row', async () => {
    const saved: string[] = [];
    const c = createWindowControls({ host: new FakeHost(info({ platform: 'linux', tiling: true })), toast: () => undefined, loadPref: () => 'auto', savePref: (p) => { saved.push(p); } });
    const g = windowGroup(); c.attach(g); await tick();
    const told = vi.fn();
    c.onChange(told);
    c.setPref('all');
    expect(shown(g)).toEqual(['min', 'max', 'close']);
    expect(saved).toEqual(['all']);
    expect(told).toHaveBeenCalledTimes(1);
    expect(c.pref()).toBe('all');
  });

  it('a press on a layer\'s button drives the real window; a group let go no longer does', async () => {
    const host = new FakeHost(info({}));
    const c = createWindowControls({ host, toast: () => undefined });
    const g = windowGroup();
    document.body.append(g);
    const detach = c.attach(g);
    for (const w of ['min', 'max', 'close']) g.querySelector<HTMLElement>(`[data-win="${w}"]`)?.click();
    expect(host.calls).toEqual(['minimize', 'toggle_maximize', 'close']);
    detach();
    g.querySelector<HTMLElement>('[data-win="close"]')?.click();
    expect(host.calls).toHaveLength(3);
  });

  it('the maximise button follows the window\'s state on every bar', async () => {
    const host = new FakeHost(info({}));
    const c = createWindowControls({ host, toast: () => undefined });
    const g = windowGroup(); c.attach(g); await tick();
    host.state?.({ maximized: true, fullscreen: false });
    expect(g.querySelector('[data-win="max"]')?.getAttribute('aria-label')).toBe('Restore');
  });

  it('a host that cannot say keeps all three; a failed press says so', async () => {
    const toast = vi.fn();
    const host = new FakeHost(new Error('no window'));
    host.control = () => Promise.reject(new Error('The window did not close'));
    const c = createWindowControls({ host, toast });
    const g = windowGroup(); c.attach(g); await tick();
    expect(shown(g)).toEqual(['min', 'max', 'close']);
    g.querySelector<HTMLElement>('[data-win="close"]')?.click();
    await tick();
    expect(toast).toHaveBeenCalledWith('The window did not close');
  });

  it('without a host (the page) the buttons keep their stand-ins', () => {
    const toast = vi.fn();
    const c = createWindowControls({ host: null, toast });
    const g = windowGroup(); c.attach(g);
    g.querySelector<HTMLElement>('[data-win="min"]')?.click();
    expect(toast).toHaveBeenCalledWith('Minimize works in the desktop app');
  });

  it('the lab can draw a layout until the preference changes', () => {
    const c = createWindowControls({ host: null, toast: () => undefined });
    const g = windowGroup(); c.attach(g);
    c.force('mac');
    expect(order(g)).toEqual(['close', 'min', 'max']);
    c.setPref('close');
    expect(shown(g)).toEqual(['close']);
  });
});

describe('a layer\'s title bar', () => {
  it('is the shell\'s bar in the layer\'s flow: a drag area everywhere but the buttons, with the window group at its end', async () => {
    const host = new FakeHost(info({}));
    const c = createWindowControls({ host, toast: () => undefined });
    const bar = windowBar(c);
    expect(bar.node.classList.contains('hx-bar')).toBe(true);
    expect(bar.node.classList.contains('hx-bar--layer')).toBe(true);
    expect(bar.node.getAttribute('data-tauri-drag-region')).toBe('deep');
    const group = bar.node.querySelector<HTMLElement>('.hx-bar__end > .hx-win');
    expect(group).toBeTruthy();
    await tick();
    group?.querySelector<HTMLElement>('[data-win="min"]')?.click();
    expect(host.calls).toEqual(['minimize']);
    bar.detach();
    group?.querySelector<HTMLElement>('[data-win="min"]')?.click();
    expect(host.calls).toEqual(['minimize']);
  });
});
