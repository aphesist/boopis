// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const zoom = vi.fn<(f: number) => Promise<void>>(() => Promise.resolve());
let desktop = true;
vi.mock('../../host/window', () => ({ setWebviewZoom: (f: number) => zoom(f) }));
vi.mock('../../host/bridge', () => ({ inTauri: () => desktop }));
vi.mock('./actions', () => ({ notify: vi.fn() }));

beforeEach(() => { zoom.mockClear(); localStorage.clear(); desktop = true; vi.resetModules(); });
afterEach(() => { localStorage.clear(); });

describe('the interface size', () => {
  it('asks the web view to zoom by the chosen step and keeps it', async () => {
    const m = await import('./ui-size');
    m.wireUiSize();
    expect(zoom).not.toHaveBeenCalled();               // default: nothing to apply at boot
    m.setUiSize('larger');
    expect(zoom).toHaveBeenLastCalledWith(1.12);
    m.setUiSize('largest');
    expect(zoom).toHaveBeenLastCalledWith(1.25);
    expect(JSON.parse(localStorage.getItem('hx.v6.size') ?? '{}').size).toBe('largest');
    expect(m.uiZoomPercent()).toBe(125);
  });
  it('applies the kept step at boot', async () => {
    localStorage.setItem('hx.v6.size', JSON.stringify({ v: 1, size: 'larger' }));
    const m = await import('./ui-size');
    m.wireUiSize();
    expect(zoom).toHaveBeenCalledWith(1.12);
  });
  it('on a page without the host it only remembers', async () => {
    desktop = false;
    const m = await import('./ui-size');
    m.wireUiSize();
    m.setUiSize('larger');
    expect(zoom).not.toHaveBeenCalled();
    expect(m.canZoom()).toBe(false);
    expect(m.uiSize()).toBe('larger');
  });
});
