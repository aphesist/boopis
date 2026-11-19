// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { installShim, orbClass, provideCanvas, setMedia } from './shim';
import { SHADOW_CSS, SHADOW_HTML } from './host';

const VENDOR = readFileSync(join(__dirname, '..', '..', '..', 'vendor', 'orb-avatar.min.js'), 'utf8');

/** a 2D context that records what the build draws, and a canvas around it */
function fakeCanvas(): { canvas: unknown; calls: string[] } {
  const calls: string[] = [];
  const ctx = new Proxy({ canvas: null as unknown }, {
    get(t, k: string) { if (k in t) return (t as Record<string, unknown>)[k]; return (...a: unknown[]) => { calls.push(k); void a; return k === 'createLinearGradient' || k === 'createRadialGradient' ? { addColorStop() { /* no-op */ } } : undefined; }; },
    set(t, k: string, v) { (t as Record<string, unknown>)[k] = v; return true; }
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  return { canvas, calls };
}

describe('orb2 in a worker, as the vendored file is', () => {
  beforeAll(async () => {
    installShim({ dpr: 2, reduced: false, dark: true });
    await import('../../../vendor/orb-avatar.min.js');
  });
  it('defines <orb-avatar> against the shim without touching the file', () => {
    expect(typeof orbClass()).toBe('function');
    expect((globalThis as unknown as { OrbAvatar: unknown }).OrbAvatar).toBe(orbClass());
  });
  it('an element made from state alone sizes its canvas and draws on it', () => {
    const { canvas, calls } = fakeCanvas();
    provideCanvas(canvas as OffscreenCanvas);
    const C = orbClass() as unknown as new () => Record<string, unknown> & { setAttribute(n: string, v: string): void; connectedCallback(): void; _resized(w: number): void; hostStyle: unknown };
    const o = new C();
    o.hostStyle = { color: 'rgb(200, 200, 200)', particle: '', spark: '' };
    for (const [k, v] of Object.entries({ size: '80', shape: 'star', color: 'rgb(59, 130, 246)', 'eye-color': 'rgb(20, 20, 24)', reaction: 'thinking', 'idle-motion': 'calm', mode: 'drift' })) o.setAttribute(k, v);
    (o as unknown as { isConnected: boolean }).isConnected = true;
    o.connectedCallback();
    o._resized(80);
    expect((canvas as { width: number }).width).toBeGreaterThan(80);     /* the build chose a backing size from its width and the dpr */
    const draw = o._update as (dt: number, now: number) => void;
    draw.call(o, 1 / 60, performance.now() / 1000 + 1);
    expect(calls.length).toBeGreaterThan(20);
    expect(calls).toContain('fill');
    const before = calls.length;
    draw.call(o, 1 / 60, performance.now() / 1000 + 1.02);
    expect(calls.length).toBeGreaterThan(before);
  });
  it('the page can change reduced motion and the colour scheme under it', () => {
    expect(() => setMedia({ reduced: true, dark: false })).not.toThrow();
    expect(() => setMedia({ reduced: false, dark: true })).not.toThrow();
  });
});

describe('the page element\'s copy of orb2\'s shadow template', () => {
  it('is the one the vendored build writes', () => {
    const m = /\.innerHTML=`(<style>.*?<\/slot>)`/s.exec(VENDOR);
    expect(m).not.toBeNull();
    const vendor = m![1]!.replace('${(100*le).toFixed(2)}', (100 * 3.2 / 2.08).toFixed(2)).replace('${(100*le).toFixed(2)}', (100 * 3.2 / 2.08).toFixed(2));
    expect(vendor).toBe(SHADOW_HTML);
    expect(SHADOW_HTML).toContain(SHADOW_CSS);
  });
  it('and the build still has the members the worker patches and the page forwards', () => {
    for (const k of ['_fit(', '_update(', '_resized(', 'attributeChangedCallback(', 'connectedCallback(', 'lookAt(', 'poke(', 'blink(', 'emote(']) expect(VENDOR).toContain(k);
  });
});
