// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capLook, gentleFollow } from './orbs';

type Look = [number, number] | [];
function fakeOrb(width = 128): HTMLElement & { _hover?: boolean; looks: Look[] } {
  const o = Object.assign(document.createElement('div'), { looks: [] as Look[], lookAt: (_x?: number, _y?: number): void => { /* replaced below */ } }) as HTMLElement & { _hover?: boolean; looks: Look[] };
  (o as unknown as { lookAt: (x?: number, y?: number) => void }).lookAt = (x?: number, y?: number) => { o.looks.push(x === undefined || y === undefined ? [] : [x, y]); };
  o.getBoundingClientRect = () => ({ left: 100, top: 100, width, height: width, right: 100 + width, bottom: 100 + width, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
  document.body.append(o);
  return o;
}
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('the gaze is capped (the preview\'s eyes never leave its body)', () => {
  it('leaves a small look alone and pulls a long one to the same direction at the cap', () => {
    expect(capLook(10, 5, 128)).toEqual({ x: 10, y: 5 });
    const far = capLook(0, 400, 128);
    expect(far.x).toBe(0);
    expect(far.y).toBeCloseTo(0.3 * 250);                    // about 20 degrees of a 250px reference
    const diag = capLook(300, 400, 128);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(75);
    expect(diag.y / diag.x).toBeCloseTo(4 / 3);
  });
  it('a big orb gets a proportionally bigger cap', () => {
    expect(Math.hypot(...Object.values(capLook(0, 900, 400)) as [number, number])).toBeCloseTo(0.3 * 400 * 1.65);
  });
  it('a look at a control far below the orb is capped when it holds', () => {
    const o = fakeOrb(128);
    const f = gentleFollow(() => o, 0.55);
    f.hold(164, 164 + 400);                                  // a tile 400px below the centre
    const [x, y] = o.looks[0] as [number, number];
    expect(x).toBeCloseTo(164);
    expect(y - 164).toBeCloseTo(75);
    f.dispose();
  });
});

describe('one pointer listener serves every follower', () => {
  it('adds the listener once however many followers there are, and each follower looks on the next frame', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn));
    const a = fakeOrb(), b = fakeOrb();
    const fa = gentleFollow(() => a, 0.5), fb = gentleFollow(() => b, 0.5);
    const fc = gentleFollow(() => a, 0.5);
    expect(add.mock.calls.filter((c) => c[0] === 'pointermove').length).toBeLessThanOrEqual(1);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 180, clientY: 180 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 181, clientY: 181 }));
    expect(frames).toHaveLength(1);                           // coalesced into one frame
    frames[0]?.(0);
    expect(a.looks.length).toBeGreaterThan(0);
    expect(b.looks.length).toBeGreaterThan(0);
    fa.dispose(); fb.dispose(); fc.dispose();
    vi.unstubAllGlobals();
  });
  it('a disposed follower no longer looks, and one whose orb is gone is skipped', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn));
    const a = fakeOrb(), b = fakeOrb();
    const fa = gentleFollow(() => a, 0.5), fb = gentleFollow(() => b, 0.5);
    fa.dispose();
    b.remove();
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 300 }));
    frames.forEach((f) => f(0));
    expect(a.looks).toEqual([]);
    expect(b.looks).toEqual([]);
    fb.dispose();
    vi.unstubAllGlobals();
  });
});

describe('face-on while the shape morphs', () => {
  it('looks straight at the viewer, ignores the pointer and holds until the time is up', () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn));
    const o = fakeOrb(128);
    const f = gentleFollow(() => o, 0.55);
    f.faceOn(560);
    expect(o.looks[0]).toEqual([164, 164]);                   // the orb's own centre
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 400 }));
    frames.forEach((fr) => fr(0));
    f.hold(400, 400); f.glance(400, 400);
    expect(o.looks).toHaveLength(1);                          // nothing pulled the face away
    vi.advanceTimersByTime(561);
    expect(o.looks[1]).toEqual([]);                           // released: the orb looks where it likes again
    f.hold(300, 164);
    expect(o.looks).toHaveLength(3);
    f.dispose();
    vi.unstubAllGlobals();
  });
});
