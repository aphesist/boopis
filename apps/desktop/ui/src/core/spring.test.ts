import { describe, expect, it } from 'vitest';
import { evalLinear, sampleSprings, settleTime, springAt, springKeyframes, springLinear } from './spring';
import { K_FLIP, K_SLAB, K_SLIDE, K_DOT, spring, stepS } from '../modules/dock/ctx';

/** the dock's own integrator (what runs live), advanced to `t` seconds in 0.2 ms steps (the dock's frame uses at most 8 ms; the closed form is the limit of it) */
function integrate(k: number, z: number, x0: number, v0: number, t: number): { x: number; v: number } {
  const s = spring(x0, k, z); s.t = 0; s.v = v0;
  for (let i = 0; i < Math.round(t * 5000); i++) stepS(s, 0.0002);
  return { x: s.x, v: s.v };
}
/** parse the points of a `linear()` string back (value, optional position) as an engine reads them */
function parseLinear(css: string): Array<[number, number]> {
  const body = /^linear\((.*)\)$/.exec(css)![1]!.split(',').map((s) => s.trim());
  const out: Array<{ v: number; t?: number }> = body.map((s) => { const m = s.split(/\s+/); return { v: +m[0]!, ...(m[1] ? { t: parseFloat(m[1]) / 100 } : {}) }; });
  out[0]!.t = 0; out[out.length - 1]!.t = 1;
  /* positions left out sit evenly between the ones given */
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i]!.t !== undefined) continue;
    let j = i; while (out[j]!.t === undefined) j++;
    const a = out[i - 1]!.t!, b = out[j]!.t!;
    for (let q = i; q < j; q++) out[q]!.t = a + (b - a) * (q - i + 1) / (j - i + 1);
  }
  return out.map((p) => [p.v, p.t!]);
}

const SPRINGS = [{ name: 'flip', k: K_FLIP }, { name: 'slab', k: K_SLAB }, { name: 'slide', k: K_SLIDE }, { name: 'dot', k: K_DOT }];

describe('springAt: the closed form of the spring the dock integrates', () => {
  for (const s of SPRINGS) {
    for (const [x0, v0] of [[100, 0], [-37, 0], [12, 400], [60, -900]] as const) {
      it(`${s.name} from ${x0} at ${v0}/s agrees with the integrator`, () => {
        for (const t of [0.05, 0.15, 0.3, 0.5]) {
          const a = springAt({ k: s.k }, x0, v0, t), b = integrate(s.k, 1, x0, v0, t);
          expect(Math.abs(a.x - b.x)).toBeLessThan(0.02 * Math.max(Math.abs(x0), 10));
          expect(Math.abs(a.v - b.v)).toBeLessThan(0.03 * Math.max(Math.abs(x0) * Math.sqrt(s.k), Math.abs(v0), 50));
        }
      });
    }
  }
  it('is continuous in damping through the critical case', () => {
    const a = springAt({ k: 480, z: 1 }, 50, 0, 0.1), b = springAt({ k: 480, z: 0.9999 }, 50, 0, 0.1), c = springAt({ k: 480, z: 1.0001 }, 50, 0, 0.1);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.01); expect(Math.abs(a.x - c.x)).toBeLessThan(0.01);
  });
  it('underdamped and overdamped springs also match their integrator', () => {
    for (const z of [0.6, 2]) {
      const a = springAt({ k: 480, z }, 80, 100, 0.2), b = integrate(480, z, 80, 100, 0.2);
      expect(Math.abs(a.x - b.x)).toBeLessThan(0.5);
    }
  });
  it('never overshoots when critically damped from rest (no curve passes its mark)', () => {
    for (let t = 0; t < 1; t += 0.01) expect(springAt({ k: 480 }, 100, 0, t).x).toBeGreaterThanOrEqual(-1e-9);
  });
});

describe('settleTime', () => {
  it('a 480 spring settles in about half a second to 0.05px and a 300 ms visual settle', () => {
    const t = settleTime({ k: 480 }, 100);
    expect(t).toBeGreaterThan(0.25); expect(t).toBeLessThan(0.6);
    expect(Math.abs(springAt({ k: 480 }, 100, 0, 0.3).x)).toBeLessThan(2.5);   /* about 300 ms: within a couple of px of 100 */
  });
});

describe('springLinear: the curve as a linear() easing', () => {
  for (const s of SPRINGS) {
    it(`${s.name}: the string matches the spring within a small error`, () => {
      const l = springLinear({ k: s.k });
      expect(l.easing).toMatch(/^linear\(0, .*, 1\)$/);
      const pts = parseLinear(l.easing);
      let worst = 0;
      for (let i = 0; i <= 2000; i++) {
        const u = i / 2000, exact = 1 - springAt({ k: s.k }, 1, 0, u * l.duration / 1000).x;
        worst = Math.max(worst, Math.abs(evalLinear(pts, u) - exact));
      }
      expect(worst).toBeLessThan(0.003);
      expect(pts.length).toBeLessThan(120);
    });
  }
  it('is monotonic and never passes its mark for the critically damped spring', () => {
    const pts = parseLinear(springLinear({ k: 480 }).easing);
    for (let i = 1; i < pts.length; i++) { expect(pts[i]![0]).toBeGreaterThanOrEqual(pts[i - 1]![0] - 1e-9); expect(pts[i]![0]).toBeLessThanOrEqual(1 + 1e-9); }
  });
  it('the points the string carries are the points we sampled (rounding to 4 places stays inside the error)', () => {
    const l = springLinear({ k: 480 }), pts = parseLinear(l.easing);
    for (let i = 0; i < pts.length; i++) expect(Math.abs(pts[i]![0] - l.stops[i]![0])).toBeLessThan(1e-4);
  });
});

describe('springKeyframes: channels with their own offsets and velocities', () => {
  it('each channel follows its own exact curve, an interrupted one included', () => {
    const chans = [{ x0: 120 }, { x0: -8, v0: 300 }, { x0: 0.4, v0: -2 }];
    const play = springKeyframes({ k: 480 }, chans, ([x, y, s]) => ({ transform: `translate(${x}px,${y}px) scale(${1 + s!})` }));
    const sm = sampleSprings({ k: 480 }, chans);
    expect(play.keyframes.length).toBe(sm.offsets.length);
    expect(play.keyframes[0]!.offset).toBe(0); expect(play.keyframes[play.keyframes.length - 1]!.offset).toBe(1);
    for (let c = 0; c < chans.length; c++) {
      const scale = Math.max(Math.abs(chans[c]!.x0), Math.abs(chans[c]!.v0 ?? 0) / Math.sqrt(480), 0.05);
      let worst = 0;
      for (let i = 0; i <= 1000; i++) {
        const u = i / 1000, exact = springAt({ k: 480 }, chans[c]!.x0, chans[c]!.v0 ?? 0, u * sm.duration).x;
        let j = 1; while (sm.offsets[j]! < u && j < sm.offsets.length - 1) j++;
        const a = sm.offsets[j - 1]!, b = sm.offsets[j]!, va = sm.values[c]![j - 1]!, vb = sm.values[c]![j]!;
        worst = Math.max(worst, Math.abs(va + (vb - va) * (b === a ? 0 : (u - a) / (b - a)) - exact) / scale);
      }
      expect(worst).toBeLessThan(0.003);
      expect(sm.values[c]![sm.values[c]!.length - 1]).toBe(0);
    }
  });
  it('a spring already at rest has nothing to play', () => { expect(sampleSprings({ k: 480 }, [{ x0: 0 }]).duration).toBe(0); });
});
