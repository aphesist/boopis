import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { holdOutsideDock, installOrbRuntime, releaseOutsideDock } from './orb-runtime';

/** a stand-in for orb2 with the members the patch reads, recording what reaches the real `_update` */
class Fake extends HTMLElement {
  _cw = 0; _static = false; target = 0;
  _sig: unknown = [1]; _tp = 1; _btp = 1; _jx = [0, 0, 0, 0, 0, 0]; _jv = [0, 0, 0, 0, 0, 0];
  _blinkAt = -9; _dblBlinkAt = -9; _spinAt = -9; _pokeAt = -9;
  _target: unknown = null; _override: unknown = null; _customSeq: unknown = null;
  calls: string[] = []; dts: number[] = [];
  _fit(): void { this.calls.push('fit'); this._cw = this.target; }
  _update(dt: number): void { this.calls.push('draw' + dt); this.dts.push(+dt.toFixed(4)); }
}
const place = (inDock: boolean): Fake => {
  const o = document.createElement('orb-avatar') as unknown as Fake;
  if (inDock) { const d = document.createElement('div'); d.id = 'hx-dock'; d.append(o); document.body.append(d); } else document.body.append(o);
  return o;
};
/** one frame of orb2's loop: every orb is called with the same timestamp */
const frame = (n: number, orbs: Fake[], dt = 1 / 60): void => { for (const o of orbs) (o._update as (d: number, t: number) => void)(dt, 100 + n / 60); };

beforeAll(() => { customElements.define('orb-avatar', Fake); expect(installOrbRuntime()).toBe(true); });

describe('the orb runtime patch', () => {
  it('relies only on members the vendored orb2 build has', () => {
    const src = readFileSync(join(process.cwd(), 'vendor', 'orb-avatar.min.js'), 'utf8');
    expect(src).toMatch(/_fit\(\)\{[^}]*this\._canvas\.width=this\._canvas\.height=/);
    expect(src).toMatch(/_resized\([a-z]\)\{[^}]*this\._fit\(\)/);
    expect(src).toContain('_update(');
    expect(src).toContain('customElements.define("orb-avatar"');
    for (const f of ['_sig', '_slot', '_target', '_override', '_customSeq', '_tp', '_btp', '_jx', '_jv', '_blinkAt', '_dblBlinkAt', '_spinAt', '_pokeAt']) expect(src, f).toContain('this.' + f + '=');
    expect(src).toMatch(/Qt\+t\._slot&1/);   /* the ladder's own frame skip, keyed on the slot */
  });

  it('repaints a canvas in the same task that resized it, and only then', () => {
    const o = place(false);
    o.target = 100; o._fit();
    expect(o.calls).toEqual(['fit', 'draw0']);
    o.calls.length = 0;
    o._fit();                                   /* same size: nothing was cleared, nothing to repaint */
    expect(o.calls).toEqual(['fit']);
    o.calls.length = 0;
    o.target = 0; o._fit();                     /* hidden: width 0, nothing to draw */
    expect(o.calls).toEqual(['fit']);
    o.calls.length = 0;
    o._static = true; o.target = 50; o._fit();  /* a still orb is outside orb2's loop: nothing else would redraw it */
    expect(o.calls).toEqual(['fit', 'draw0']);
    expect(installOrbRuntime()).toBe(true);     /* idempotent */
  });
});

describe('ambient orbs update on alternate frames, by group', () => {
  it('gives the dock and the rest opposite frames, and a held-back orb the time it missed', () => {
    const dock = place(true), side = place(false);
    for (let f = 1; f <= 6; f++) frame(f, [dock, side]);
    expect(dock.dts.length).toBe(3);
    expect(side.dts.length).toBe(3);
    expect(dock.dts.every((d) => Math.abs(d - 2 / 60) < 1e-3)).toBe(true);   /* two frames of time per update */
    /* never both on the same frame: that is the point */
    const a = place(true), b = place(false);
    for (let f = 1; f <= 8; f++) { frame(f, [a, b]); expect(a.dts.length + b.dts.length).toBe(f); }
  });

  it('never holds back an orb that is doing something quick, or one that owes a redraw', () => {
    const quick: Array<(o: Fake) => void> = [
      (o) => { o._target = { x: 1, y: 1 }; }, (o) => { o._override = 'giggle'; }, (o) => { o._customSeq = {}; },
      (o) => { o._tp = 0.4; }, (o) => { o._btp = 0.4; }, (o) => { o._jv = [3, 0, 0, 0, 0, 0]; }, (o) => { o._sig = null; },
      (o) => { o._blinkAt = 100.01; }, (o) => { o._spinAt = 100.01; }, (o) => { o._pokeAt = 100.01; }
    ];
    for (const make of quick) {
      const o = place(false); make(o);
      for (let f = 1; f <= 4; f++) frame(f, [o]);
      expect(o.dts.length).toBe(4);
    }
  });

  it('holds the ambient orbs outside the dock while the dock moves, and never the dock\'s own', () => {
    const dock = place(true), side = place(false);
    holdOutsideDock();
    for (let f = 1; f <= 4; f++) { holdOutsideDock(); frame(f, [dock, side]); }
    expect(side.dts.length).toBe(0);
    expect(dock.dts.length).toBe(2);               /* the dock's group keeps its alternate frames */
    const busy = place(false); busy._override = 'giggle';
    for (let f = 5; f <= 6; f++) { holdOutsideDock(); frame(f, [busy]); }
    expect(busy.dts.length).toBe(2);               /* an orb being poked is not ambient: it is never held */
    releaseOutsideDock();
    const after = place(false);
    frame(7, [after]); frame(8, [after]);
    expect(after.dts.length).toBeGreaterThan(0);   /* released at once when the dock settles */
  });

  it('does nothing to an orb whose internals it cannot read, and passes a zero step straight through', () => {
    const o = place(false);
    delete (o as unknown as { _tp?: number })._tp;
    for (let f = 1; f <= 4; f++) frame(f, [o]);
    expect(o.dts.length).toBe(4);
    const z = place(false); (z._update as (d: number, t: number) => void)(0, 5); (z._update as (d: number, t: number) => void)(0, 5);
    expect(z.dts).toEqual([0, 0]);
  });

  it('leaves the ladder at its slowest level to its own frame skip, keyed to the group', () => {
    (window as unknown as { OrbAvatar: { qualityLevel: number } }).OrbAvatar = { qualityLevel: 2 };
    const dock = place(true), side = place(false);
    for (let f = 1; f <= 4; f++) frame(f, [dock, side]);
    expect(dock.dts.length + side.dts.length).toBe(8);   /* every call goes through: the library skips, not this */
    expect((dock as unknown as { _slot: number })._slot).toBe(0);
    expect((side as unknown as { _slot: number })._slot).toBe(1);
    delete (window as unknown as { OrbAvatar?: unknown }).OrbAvatar;
  });
});
