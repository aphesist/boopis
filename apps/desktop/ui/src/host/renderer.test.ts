import { describe, expect, it } from 'vitest';
import { reportText, summarizeFrames } from './renderer';
import type { RendererReport } from './bindings';

const base: RendererReport = {
  session: 'wayland', hyprland: true, policy: 'auto', rule: 'nvidia_wayland_untouched', set: [], environment: [['XDG_SESSION_TYPE', 'wayland']],
  gpus: [{ card: 'card0', vendor: '0x8086', driver: 'i915', boot_display: true }, { card: 'card1', vendor: '0x10de', driver: 'nvidia', boot_display: false }],
  choices: [['shm', 'WEBKIT_DISABLE_DMABUF_RENDERER=1']]
};
const display = { devicePixelRatio: 2, innerWidth: 1800, innerHeight: 1125, userAgent: 'ua' };

describe('the renderer report', () => {
  it('says what the page sees and what the host decided', () => {
    const t = reportText(base, display);
    expect(t).toContain('session: wayland (Hyprland)');
    expect(t).toContain('1800x1125 CSS px at devicePixelRatio 2 (3600x2250 buffer px)');
    expect(t).toContain('card1  vendor 0x10de  driver nvidia');
    expect(t).toContain('rule: nvidia_wayland_untouched');
    expect(t).toContain('set by the host: nothing');
  });
  it('names the variables the host set and copes with no GPU', () => {
    const t = reportText({ ...base, gpus: [], set: [['WEBKIT_DISABLE_DMABUF_RENDERER', '1']], rule: 'nvidia_x11' }, display);
    expect(t).toContain('set by the host: WEBKIT_DISABLE_DMABUF_RENDERER=1');
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
    expect(f.fps).toBeCloseTo(35.3, 1);
    expect(summarizeFrames([])).toEqual({ seconds: 0, frames: 0, fps: 0, p50: 0, p95: 0, max: 0, over33: 0 });
  });
  it('goes in the report when there is one', () => {
    const t = reportText(base, display, summarizeFrames([16.7, 16.7, 40]));
    expect(t).toContain('frames over');
    expect(t).toContain('1 over 33 ms');
    expect(reportText(base, display)).not.toContain('frames over');
  });
});
