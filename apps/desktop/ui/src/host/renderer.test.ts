import { describe, expect, it } from 'vitest';
import { describeFrames, hz, reportText, summarizeFrames } from './renderer';
import type { RendererReport } from './bindings';

const base: RendererReport = {
  session: 'wayland', hyprland: true, policy: 'auto', rule: 'nvidia_wayland_untouched', set: [], environment: [['XDG_SESSION_TYPE', 'wayland']],
  gpus: [{ card: 'card0', vendor: '0x8086', driver: 'i915', boot_display: true }, { card: 'card1', vendor: '0x10de', driver: 'nvidia', boot_display: false }],
  choices: [['shm', 'WEBKIT_DISABLE_DMABUF_RENDERER=1']],
  webkit: { version: '2.54.2', origin: 'system', library: '/usr/lib/libwebkit2gtk-4.1.so.0.18.5' },
  frame_rate: { policy: 'auto', rule: 'faster_than_sixty', refresh_millihertz: 120000, monitor: 'eDP', preference_off: true, refusal: null, power_profile: 'balanced', platform_profile: 'balanced' },
  note: null,
  errors: [],
  gpu: { policy: 'auto', policy_source: 'default', rule: 'auto_dedicated', set: [['__NV_PRIME_RENDER_OFFLOAD', '1']], env_source: 'nvidia_documented', warning: null, power: 'ac', restart_advice: null, display_gpu: 'card1 0x8086 i915', dedicated_gpu: 'card0 0x10de nvidia' }
};
const display = { devicePixelRatio: 2, innerWidth: 1800, innerHeight: 1125, userAgent: 'ua' };

describe('the renderer report', () => {
  it('says what the page sees and what the host decided', () => {
    const t = reportText(base, display);
    expect(t).toContain('session: wayland (Hyprland)');
    expect(t).toContain('1800x1125 CSS px at devicePixelRatio 2 (3600x2250 buffer px)');
    expect(t).toContain('card1  vendor 0x10de  driver nvidia');
    expect(t).toContain('renderer rule: nvidia_wayland_untouched');
    expect(t).toContain('set by the host: nothing');
  });
  it('says which WebKitGTK it is, the display rate, the preference, the power profile and the GPU', () => {
    const t = reportText(base, { ...display, glRenderer: 'NVIDIA GeForce RTX 4070 Laptop GPU/PCIe/SSE2', glVendor: 'NVIDIA Corporation' });
    expect(t).toContain('WebKitGTK: 2.54.2, the system\'s (/usr/lib/libwebkit2gtk-4.1.so.0.18.5)');
    expect(t).toContain('display refresh (GDK): 120 Hz (eDP)');
    expect(t).toContain('60 fps preference (BOOPIS_FPS=auto): off');
    expect(t).toContain('rule faster_than_sixty');
    expect(t).toContain('power profile: balanced (platform_profile balanced)');
    expect(t).toContain('GPU choice (BOOPIS_GPU, from default): auto; rule auto_dedicated; set by the host: __NV_PRIME_RENDER_OFFLOAD=1 (nvidia_documented)');
    expect(t).toContain('power source: ac');
    expect(t).toContain('GL renderer in the page: NVIDIA GeForce RTX 4070 Laptop GPU/PCIe/SSE2 (vendor NVIDIA Corporation)');
  });
  it('says plainly what limits the rate', () => {
    const t = reportText({ ...base, webkit: { version: '2.52.6', origin: 'bundled', library: null }, note: 'WEBKIT_DISABLE_DMABUF_RENDERER is set, so WebKitGTK paints on the CPU.',
      frame_rate: { ...base.frame_rate, preference_off: false, refusal: 'too_old', power_profile: 'power_saver', refresh_millihertz: null },
      gpu: { ...base.gpu, set: [], rule: 'policy_dedicated', warning: 'may_crash_on_wayland', restart_advice: 'to_integrated' } }, display);
    expect(t).toContain('2.52.6, bundled (AppImage)');
    expect(t).toContain('display refresh (GDK): unknown');
    expect(t).toContain('60 fps preference (BOOPIS_FPS=auto): on (WebKit keeps near 60 fps; too_old)');
    expect(t).toContain('WebKit halves its frame rate in power-saver');
    expect(t).toContain('may crash or stay blank');
    expect(t).toContain('restart would switch to the integrated GPU');
    expect(t).toContain('note: WEBKIT_DISABLE_DMABUF_RENDERER is set');
    expect(t).toContain('GL renderer in the page: not available');
    expect(reportText({ ...base, frame_rate: { ...base.frame_rate, preference_off: null, refusal: 'no_webview' } }, display)).toContain('preference (BOOPIS_FPS=auto): unknown (no_webview)');
  });
  it('names the variables the host set and copes with no GPU', () => {
    const t = reportText({ ...base, gpus: [], set: [['WEBKIT_DISABLE_DMABUF_RENDERER', '1']], rule: 'nvidia_x11' }, display);
    expect(t).toContain('\nset by the host: WEBKIT_DISABLE_DMABUF_RENDERER=1');
    expect(t).toContain('none found in /sys/class/drm');
  });
});

describe('the frame meter', () => {
  it('summarizes frame deltas', () => {
    const f = summarizeFrames([16.7, 16.7, 16.7, 16.7, 50, 16.7, 16.7, 16.7, 16.7, 100]);
    expect(f.frames).toBe(10);
    expect(f.p50).toBe(16.7);
    expect(f.max).toBe(100);
    expect(f.over33).toBe(2);
    expect(f.p99).toBe(100);
    expect(f.fps).toBeCloseTo(35.3, 1);
    expect(summarizeFrames([])).toEqual({ seconds: 0, frames: 0, fps: 0, p50: 0, p95: 0, p99: 0, max: 0, over33: 0 });
  });
  it('reports the measured rate against the display rate', () => {
    // 590 frames in 5 s: 118 fps on a 120 Hz panel, with 1 percent of frames slower
    const deltas = [...Array<number>(580).fill(8.47), ...Array<number>(10).fill(9.1)];
    const f = summarizeFrames(deltas);
    expect(describeFrames(f, 120)).toMatch(/^118 of 120 fps, p99 9\.1 ms$/);
    expect(describeFrames(f, null)).toMatch(/^118 fps, p99 9\.1 ms$/);
    expect(describeFrames(summarizeFrames([16.7, 16.7, 16.7]), 60)).toBe('60 of 60 fps, p99 16.7 ms');
    expect(hz(120000)).toBe(120);
    expect(hz(59940)).toBe(59.9);
    expect(hz(0)).toBeNull();
    expect(hz(null)).toBeNull();
  });
  it('goes in the report when there is one', () => {
    const t = reportText(base, display, summarizeFrames([16.7, 16.7, 40]));
    expect(t).toContain('frames over');
    expect(t).toContain('1 over 33 ms');
    expect(t).toContain('of 120 fps, p99 40 ms');
    expect(reportText(base, display)).not.toContain('frames over');
  });
});
