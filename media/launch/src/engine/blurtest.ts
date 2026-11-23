/* The motion-blur self-test's scene (tools/render-selftest.mjs), index.html?scene=blurtest: the moves that printed
   double images before the blur was planned from the motion, each tagged data-case for the test to find.

     orb-run   a small orb (80 px) crossing the frame at 30 px a frame, constant speed
     eyes      a 280 px orb whose eyes dart left and right on snap (6 frames a dart)
     cursor    the oversized cursor arcing fast between two points and back
     whip      a word crossing at 240 px a frame (the sub-frame cap: the shutter closes down, never a strobe)
     overlap   an orb with two glances that overlap on one property (yaw): a backward seek used to let the earlier one
               win, so the same frame drew two poses; the determinism check seeks it from both sides
     set       a box that jumps 300 px in one zero-duration set on a frame time (an instant change: it must cut cleanly)

   No grain, a plain ground: the test reads pixels. */
import type { Scene } from '../scenes/types';
import { FilmOrb } from './orb';
import { el, place } from './stage';
import { cursor } from '../motion/cursor';
import { linear, snap, travel } from '../motion/ease';

const F = (n: number): number => n / 60;

export const BLURTEST = {
  orbRun: { y: 230, x0: 160, speed: 30, from: F(6), frames: 54, size: 80 },
  eyes: { x: 420, y: 700, size: 280, from: F(6), dart: 6, darts: 8 },
  cursor: { a: [1180, 960] as [number, number], b: [1760, 520] as [number, number], from: F(10), dur: 14 },
  whip: { y: 470, x0: -700, speed: 240, from: F(20), frames: 14 },
  overlap: { x: 1500, y: 230, size: 220, a: F(30), b: F(40) },
  set: { x: 1200, y: 850, at: F(60), jump: 300 }
};

const scene: Scene = {
  config: { name: 'blurtest', duration: 1.5, fps: 60, bpm: 112.5 },
  build(film, stage) {
    stage.root.style.background = 'var(--bg-1)';
    const world = stage.layer('stage', 1), front = stage.layer('front', 1.25);
    const C = BLURTEST;

    /* orb-run: 30 px a frame, constant (a constant move across the frame: linear is allowed and tagged) */
    const run = new FilmOrb({ shape: 'circle', color: '#4fc9a8' }, C.orbRun.size, { eyes: 'pill', yaw: 10, pitch: 4 });
    const runHolder = place(el('div', 'blurtest-orb'), C.orbRun.x0, C.orbRun.y, { w: C.orbRun.size, h: C.orbRun.size });
    runHolder.dataset['case'] = 'orb-run';
    runHolder.appendChild(run.el);
    world.appendChild(runHolder);
    film.tl.fromTo(runHolder, { x: 0 }, { x: C.orbRun.speed * C.orbRun.frames, duration: F(C.orbRun.frames), ease: linear, data: { linear: true, role: 'test' } }, C.orbRun.from);

    /* eyes: darts between -30 and +30 degrees of yaw, 6 frames each on snap */
    const big = new FilmOrb({ shape: 'triangle', color: '#f23b5a' }, C.eyes.size, { eyes: 'pill', yaw: -30, pitch: 2 });
    const bigHolder = place(el('div', 'blurtest-eyes'), C.eyes.x, C.eyes.y, { w: C.eyes.size, h: C.eyes.size });
    bigHolder.dataset['case'] = 'eyes';
    bigHolder.appendChild(big.el);
    world.appendChild(bigHolder);
    for (let i = 0; i < C.eyes.darts; i++) film.tl.to(big.pose, { yaw: i % 2 ? -30 : 30, duration: F(C.eyes.dart), ease: snap, immediateRender: false, data: { role: 'test' } }, C.eyes.from + i * F(C.eyes.dart + 4));
    film.onRender(() => { run.render(); big.render(); });

    /* cursor: there and back on an arc */
    const c = cursor(film, front, { x: C.cursor.a[0], y: C.cursor.a[1] }, { size: 56 });
    c.el.dataset['case'] = 'cursor';
    c.move(C.cursor.b[0], C.cursor.b[1], { at: C.cursor.from, dur: F(C.cursor.dur), arc: 0.18, ease: travel });
    c.move(C.cursor.a[0], C.cursor.a[1], { at: C.cursor.from + F(C.cursor.dur + 8), dur: F(C.cursor.dur), arc: 0.18, ease: travel });

    /* overlap: a long glance and a later short one on the same property, overlapping */
    const ov = new FilmOrb({ shape: 'squircle', color: '#2fd26a' }, C.overlap.size, { eyes: 'pill', yaw: -20, pitch: 0 });
    const ovHolder = place(el('div', 'blurtest-overlap'), C.overlap.x, C.overlap.y, { w: C.overlap.size, h: C.overlap.size });
    ovHolder.dataset['case'] = 'overlap';
    ovHolder.appendChild(ov.el);
    world.appendChild(ovHolder);
    film.tl.to(ov.pose, { yaw: 30, roll: 8, duration: F(30), ease: travel, immediateRender: false, data: { role: 'test' } }, C.overlap.a);
    film.tl.to(ov.pose, { yaw: -25, roll: -6, duration: F(12), ease: snap, immediateRender: false, data: { role: 'test' } }, C.overlap.b);
    film.onRender(() => ov.render());

    /* set: an instant change on a frame time */
    const box = place(el('div', 'blurtest-set'), C.set.x, C.set.y, { w: 120, h: 120 });
    box.style.background = 'var(--brass)';
    box.style.borderRadius = '24px';
    box.dataset['case'] = 'set';
    world.appendChild(box);
    film.tl.set(box, { x: C.set.jump }, C.set.at);

    /* whip: a word at 240 px a frame */
    const word = place(el('div', 'blurtest-whip', 'smear'), C.whip.x0, C.whip.y, { anchor: 'topleft' });
    word.style.cssText += ';font:600 120px/1 var(--sans);color:var(--text-strong);white-space:nowrap';
    word.dataset['case'] = 'whip';
    world.appendChild(word);
    film.tl.fromTo(word, { x: 0 }, { x: C.whip.speed * C.whip.frames, duration: F(C.whip.frames), ease: linear, data: { linear: true, role: 'test' } }, C.whip.from);
  }
};
export default scene;
