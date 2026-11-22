/* The engine's test scene (7.47 s, 14 beats at 112.5 BPM). Not a film scene: it proves the engine.

   beat 0-2   a line rises word by word behind masks ("the AI you already pay for"), the last word landing on beat 2;
              the orb below glances up at the words as they arrive
   beat 2-5   the orb's body splits into the boopis mark's two eyes (lands on beat 3), holds a beat, and joins back
              into the orb (lands on beat 5); one opaque shape at every frame
   beat 6-7   a whip pan to the right (18 f, snap, motion blur); the orb is the shared element: it flies from the middle
              of scene A into its place beside scene B's composer, shrinking from 300 to 104 px, landing 8 f after the
              camera (follow-through). No cross-fade: scene A leaves by the camera's move, the orb carries across
   beat 7-14  the real composer (@boopis/ui) types a request (K2), the camera pushes in on it (4 beats, travel) and keeps
              drifting; the orb reads along, its eyes turn happy; a cursor arrives on an arc and presses send

   Landscape and vertical are two layouts of the same timeline. */
import { mount, ui } from '../engine/kit';
import { FilmOrb } from '../engine/orb';
import { markGeometry } from '../engine/logo';
import { ground } from '../engine/ground';
import { el, place, type Stage } from '../engine/stage';
import type { Film } from '../engine/film';
import { attach, blink, camera, carryOrb, cursor, eyes, glance, grid, orbMark, rise, setType, split, travel, typeOn, snap, arrive } from '../motion';
import type { Scene } from './types';

interface Layout {
  W: number; H: number;
  headline: { x: number; y: number; size: number; width: number };
  orb: { x: number; y: number; size: number };
  markWidth: number;
  /** scene B is laid out one frame to the right */
  composer: { x: number; y: number; zoom: number; width: number };
  push: { x: number; y: number; zoom: number };
}

const LANDSCAPE: Layout = {
  W: 1920, H: 1080,
  headline: { x: 960, y: 330, size: 96, width: 1600 },
  orb: { x: 960, y: 690, size: 300 },
  markWidth: 330,
  composer: { x: 1920 + 1010, y: 640, zoom: 2.5, width: 540 },
  push: { x: 1920 + 1010, y: 600, zoom: 1.3 }
};
const VERTICAL: Layout = {
  W: 1080, H: 1920,
  headline: { x: 540, y: 640, size: 104, width: 900 },
  orb: { x: 540, y: 1180, size: 340 },
  markWidth: 380,
  composer: { x: 1080 + 560, y: 1080, zoom: 2.25, width: 400 },
  push: { x: 1080 + 560, y: 1040, zoom: 1.12 }
};

const KAI = { shape: 'circle', color: '#4fc9a8' };   /* the house bot "kai" (the app's demo data) */

const scene: Scene = {
  config: { name: 'test', duration: 448 / 60, fps: 60, bpm: 112.5 },
  build(film: Film, stage: Stage) {
    const L = film.variant === 'vertical' ? VERTICAL : LANDSCAPE;
    const g = grid(film);
    ground(film, stage);
    const world = stage.layer('stage', 1);
    const front = stage.layer('front', 1.25);
    const cam = camera(film, stage);

    /* ── scene A: the line ── */
    const line = place(el('div', 'test-headline'), L.headline.x, L.headline.y);
    line.style.cssText += ';width:' + L.headline.width + 'px;text-align:center;font-weight:600;letter-spacing:-0.018em;line-height:1.08;font-size:' + L.headline.size + 'px;color:var(--text-strong)';
    setType(line, 'the AI you already pay for', { accent: ['already'] });
    world.appendChild(line);
    const words = split(line, 'word');
    for (const a of line.querySelectorAll<HTMLElement>('.film-accent')) a.style.color = 'var(--brass)';
    /* the last word lands on beat 2: 32 f each, 4 f apart */
    const wordDur = g.f(32), stag = g.f(4);
    rise(film, words, { at: g.land(g.beat(2), 32 + 4 * (words.length - 1)), dur: wordDur, stagger: stag });

    /* ── the orb ── */
    const orb = attach(film, new FilmOrb(KAI, L.orb.size, { eyes: 'pill', yaw: 6, pitch: -4 }));
    const holder = el('div', 'test-orb');
    holder.appendChild(orb.el);
    world.appendChild(holder);
    glance(film, orb, g.f(18), -10, 14);             /* looks up at the words arriving */
    glance(film, orb, g.f(50), 0, 3);                /* back to the front for the morph */

    /* ── orb to mark and back (lands on beats 3 and 5) ── */
    const mark = markGeometry(L.markWidth);
    orbMark(film, orb, {
      mark, markColor: 'var(--text-strong)', pose: { yaw: 0, pitch: 3 },
      toMark: { at: g.land(g.beat(3), 30), dur: g.f(30) },
      toOrb: { at: g.land(g.beat(5), 30), dur: g.f(30) }
    });
    blink(film, orb, g.beat(5) + g.f(14));
    glance(film, orb, g.beat(5) + g.f(30), 18, -6);  /* looks toward where it is going */

    /* ── the whip: lands on beat 7 ── */
    const whipLand = g.beat(7);
    cam.drift({ zoom: 1.03 }, { at: 0, dur: g.land(whipLand, 18) });
    cam.to({ x: L.W + L.W / 2 }, { at: g.land(whipLand, 18), dur: g.f(18), ease: snap });
    /* then the push into scene B (every camera move is defined before the carry, which reads the camera): 4 beats on travel, then a slow drift (holds keep moving) */
    cam.to({ x: L.push.x, y: L.push.y, zoom: L.push.zoom }, { at: whipLand + g.f(6), dur: g.beats(4), ease: travel });
    cam.drift({ zoom: L.push.zoom * 1.025 }, { at: whipLand + g.f(6) + g.beats(4), dur: film.duration - (whipLand + g.f(6) + g.beats(4)) });

    /* ── scene B: the real composer ── */
    const composer = ui.composer({ placeholder: 'Message kai', chips: [], attach: true, label: 'Message' });
    const box = mount(composer, { zoom: L.composer.zoom, width: L.composer.width });
    world.appendChild(place(box, L.composer.x, L.composer.y));
    const input = composer.querySelector<HTMLElement>('.ui-composer__input')!;
    composer.setValue('plan the launch with nina');
    const send = composer.querySelector<HTMLButtonElement>('.ui-send')!;
    /* the orb's place: beside the composer's top-left corner, as a bot's orb sits by the thread */
    const cw = L.composer.width * L.composer.zoom;
    const slot = { x: L.composer.x - cw / 2 + 64, y: L.composer.y - 210, size: 104 };
    carryOrb(film, holder, orb, { from: { x: L.orb.x, y: L.orb.y, size: L.orb.size }, to: slot, at: whipLand - g.f(28), dur: g.f(36), ease: travel, arc: 0.12, camera: cam });

    /* typing starts once the orb has landed; the send button wakes with the first character */
    const typeAt = whipLand + g.f(20);
    const typed = typeOn(film, input, { at: typeAt, cps: 28 });
    /* the composer's own state follows the typing: its placeholder until the first character, then the send button wakes */
    film.onRender((t) => { send.disabled = t < typeAt; input.dataset['empty'] = t < typeAt ? 'true' : 'false'; });
    glance(film, orb, whipLand + g.f(14), 26, -10);   /* reads the words as they come */
    glance(film, orb, typed + g.f(4), 14, -4);
    eyes(film, orb, typed + g.f(10), 'arc', { dur: 0.38 });
    blink(film, orb, g.beat(12) + g.f(10));


    /* ── a cursor arrives on an arc and presses send on beat 13; the button answers on that frame ── */
    const pressAt = g.beat(13) - g.f(4);
    /* where the send button is on screen when the press lands, and the point of the front layer (depth 1.25) under it */
    const f = stage.root.getBoundingClientRect(), r = send.getBoundingClientRect(), k = f.width / stage.width;
    const bx = (r.left + r.width * 0.5 - f.left) / k, by = (r.top + r.height * 0.55 - f.top) / k;
    const camAt = cam.stateAt(pressAt);
    const [px, py] = cam.project(bx, by, 1, camAt);
    const [cx, cy] = cam.unproject(px, py, 1.25, camAt);
    const c = cursor(film, front, { x: cx + 520, y: cy + 460 }, { size: 56 });
    c.move(cx, cy, { at: pressAt - g.f(40), dur: g.f(34), arc: 0.14 });
    const hit = c.press(pressAt);
    film.tl.fromTo(send, { scale: 1 }, { scale: 0.96, duration: g.f(4), ease: arrive, immediateRender: false, data: { role: 'ui' } }, hit - g.f(4));
    film.tl.to(send, { scale: 1, duration: g.f(16), ease: arrive, immediateRender: false, data: { role: 'ui' } }, hit);
  }
};
export default scene;
