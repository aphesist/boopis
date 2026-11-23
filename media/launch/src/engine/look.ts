/* The art director's look and key frames, on the engine. Nothing here redraws them: the look (look/src/stage.ts, its
   film.css and tokens.ts) and the storyboard's beat builders (look/src/scenes/, one per beat) are imported as they
   are, and the engine puts them on its stage, under its camera and clock.

     lookGround(film, stage)                      the look's ground (its light pool, its grain) behind the camera
     const kf = await keyFrame(film, stage, 'b03', { x: 1920 })   the beat's key frame, built by the art director's
                                                  builder into a 1920x1080 (or 1080x1920) box in a world layer
     const orbs = swapOrbs(film, kf)              its <orb-avatar>s replaced by film orbs in the same look and place,
                                                  so they can blink, glance and morph from the timeline

   A key frame is the beat's composition at its key moment: a scene animator builds the beat from it (moves its parts,
   carries them across, morphs them) on the timeline. Its kit orbs are frozen (`static`) the moment it is built; the
   look's per-stage grain is replaced in a render by the same grain changing every frame (tools/lib/grain.mjs).

   Importing this module loads the look's stylesheets for the whole page (its film.css sets box-sizing on everything,
   as the style frames have it), so only scenes that use the look import it. */
import { BOTS, ROOM, botById, grain as lookGrain } from '../../look/src/stage';
import { FILM_THEME, GRAIN } from '../../look/src/theme';
import { BEATS as KEY_FRAMES } from '../../look/src/scenes/beats';
import { SCENE_CSS } from '../../look/src/scenes/parts';
import { neutralise } from './kit';
import { FilmOrb, type OrbPose } from './orb';
import type { Film } from './film';
import type { Stage } from './stage';

export { BOTS, ROOM, botById, KEY_FRAMES };
export const keyFrameIds = (): string[] => Object.keys(KEY_FRAMES);

/** the look's ground in the engine's ground layer (it moves with the camera at the ground's depth) */
export function lookGround(film: Film, stage: Stage, o: { seed?: number } = {}): void {
  filmFormat(film);
  stage.ground.dataset['depth'] = '0.25';
  stage.ground.innerHTML = '';
  const g = document.createElement('div');
  g.className = 'ground';
  g.style.inset = '-40%';
  stage.ground.appendChild(g);
  const seed = o.seed ?? 7;
  /* the look's grain: mid-grey noise in soft-light at 55%, wider on the light ground (soft-light barely moves values near
     white; look/src/theme.ts GRAIN). The renderer adds it to every finished frame, changing per frame; a preview shows
     the look's own (still) grain canvas, drawn with the same amplitude */
  film.grain = { kind: 'look', seed, ...GRAIN[FILM_THEME] };
  if (!new URLSearchParams(location.search).has('nograin')) {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;inset:0;width:' + stage.width + 'px;height:' + stage.height + 'px';
    stage.screen.appendChild(holder);
    lookGrain(holder, seed);
  }
}

/** a vertical film says so on <html>, so the look's 9:16 tokens (film line size, the line's top) reach every line an act
    draws, inside a key frame or not (look/src/film.css) */
function filmFormat(film: Film): void {
  if (film.variant === 'vertical') document.documentElement.dataset['filmFormat'] = 'vertical';
}

let cssIn = false;
/** build a beat's key frame with the art director's builder into a box in a world layer; returns the box (`.stage`) */
export async function keyFrame(film: Film, stage: Stage, id: string, o: { x?: number; y?: number; layer?: HTMLElement; vertical?: boolean; ownGround?: boolean } = {}): Promise<HTMLElement> {
  const build = KEY_FRAMES[id.toLowerCase()];
  if (!build) throw new Error('keyFrame: no key frame "' + id + '" (have ' + keyFrameIds().join(', ') + ')');
  if (!cssIn) { const s = document.createElement('style'); s.textContent = SCENE_CSS; document.head.appendChild(s); cssIn = true; }
  filmFormat(film);
  const vertical = o.vertical ?? film.variant === 'vertical';
  const box = document.createElement('div');
  box.className = 'stage film-keyframe';
  box.dataset['beat'] = id;
  if (vertical) box.dataset['format'] = 'vertical';
  box.style.position = 'absolute';
  box.style.left = (o.x ?? 0) + 'px';
  box.style.top = (o.y ?? 0) + 'px';
  /* the look's frame() gives every stage its own .ground, and builders may restyle it (b16 hides it inside the dock):
     it is there, but hidden unless `ownGround`, because the film's ground (lookGround) lives behind the camera */
  const own = document.createElement('div');
  own.className = 'ground';
  if (!o.ownGround) own.style.visibility = 'hidden';
  box.appendChild(own);
  (o.layer ?? stage.layer('stage', 1)).appendChild(box);
  await build(box, vertical);
  neutralise(box);
  return box;
}

/* orb2 reactions as the eye shapes a film orb draws (the reactions' faces are orb2's own; these are their resting
   eyes; a reaction with motion of its own is played from the timeline with orb-moves.ts) */
const REACTION_EYES: Record<string, string> = {
  idle: 'pill', listening: 'tall', thinking: 'squint', compute: 'grid', working: 'bars', speaking: 'pill', happy: 'arc',
  done: 'arc', needs: 'wide', sleeping: 'rest', error: 'plus', wink: 'pill arc', skeptic: 'pill squint', love: 'heart', sad: 'slant', dizzy: 'plus'
};

export interface SwappedOrb { orb: FilmOrb; holder: HTMLElement; was: Element; name: string }
/** replace every frozen kit orb under `root` with a film orb in the same look, size and place (its pose from the
    orb's gaze and reaction); returns them by bot name (the orb's label) for the timeline */
export function swapOrbs(film: Film, root: ParentNode, o: { pose?: Partial<OrbPose> } = {}): Map<string, SwappedOrb> {
  const out = new Map<string, SwappedOrb>();
  for (const a of [...root.querySelectorAll<HTMLElement>('orb-avatar')]) {
    const r = a.getBoundingClientRect();
    if (!r.width) continue;
    /* the look draws small orbs at a multiple of their size and zooms them back (sharpenOrbs): keep both */
    const size = Number(a.getAttribute('size') || r.width);
    const gaze = (a.getAttribute('gaze') ?? '').split(/[\s,]+/).map(Number);
    const reaction = a.getAttribute('reaction') ?? 'idle';
    const eyes = a.getAttribute('eye-shape') ?? REACTION_EYES[reaction] ?? 'pill';
    const orb = new FilmOrb({ shape: a.getAttribute('shape') ?? 'circle', color: a.getAttribute('color') ?? '#f1efe9', eyeColor: a.getAttribute('eye-color') }, size,
      { eyes, yaw: Number.isFinite(gaze[0]) ? gaze[0]! : 8, pitch: Number.isFinite(gaze[1]) ? gaze[1]! : 5, ...o.pose });
    /* the holder takes the orb's own box: its display, position and alignment as the kit's CSS computed them. Inside the
       kit's .ui-orb the orb is display:block (components.css), so the .ui-orb keeps no line box and its baseline stays
       at its bottom edge, which is what the mention chip, the bylines and the rows align to. An inline-block holder with
       vertical-align:middle there made a line box inside the .ui-orb, moved its baseline and dropped the chip 13.7 px
       below the text at 3x (the owner's act 1 frame). Bare orbs keep their :host box (inline-block, middle). */
    const cs = getComputedStyle(a);
    const holder = document.createElement('span');
    holder.className = 'film-orb-holder';
    holder.style.cssText = 'display:' + (cs.display === 'inline' ? 'inline-block' : cs.display) + ';position:' + (cs.position === 'static' ? 'relative' : cs.position) +
      ';width:' + size + 'px;height:' + size + 'px;line-height:0;vertical-align:' + cs.verticalAlign + ';flex:none';
    if (cs.position === 'absolute') { holder.style.left = a.style.left || '0'; holder.style.top = a.style.top || '0'; }
    if (cs.transform !== 'none') { holder.style.transform = cs.transform; holder.style.transformOrigin = cs.transformOrigin; }
    if (a.style.zoom) holder.style.zoom = a.style.zoom;
    holder.appendChild(orb.el);
    a.replaceWith(holder);
    film.onRender(() => orb.render());
    const name = a.getAttribute('label') ?? 'orb' + out.size;
    out.set(out.has(name) ? name + '#' + out.size : name, { orb, holder, was: a, name });
  }
  return out;
}
