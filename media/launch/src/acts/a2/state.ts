/* What act 2's four beats share: the room taken at S1 (room.ts), its log (thread.ts), the layer the film lines live in
   (pinned to the frame: the camera follows the thread under them), and what each beat leaves for the next. */
import type { ActCtx } from '../context';
import type { SwappedOrb } from '../../engine/look';
import { h } from '../../../look/src/stage';
import { takeRoom, type Layout, type Room } from './room';
import { Thread } from './thread';
import type { Line } from './lines';
import type { KfCursor } from './cursor';
import { actEnd } from './util';

export interface Placed { el: HTMLElement; orbs: Map<string, SwappedOrb>; h: number }
export interface A2State {
  room: Room;
  lay: Layout;
  thread: Thread;
  /** the film lines' layer: drawn in frame px whatever the camera does */
  lines: HTMLElement;
  lineA?: Line; lineB?: Line;
  cursor?: KfCursor;
  /** the presence entry's three states (B05, B06), stacked in one item */
  pres?: { box: HTMLElement; p2: Placed; p3: Placed; p4: Placed; show3: number; show4: number };
  kaiReply?: Placed;
  huddle?: { box: HTMLElement; nina: Placed; h2: Placed; h3: Placed; Hf: number };
  /** the act's last frame in this edit */
  end: number;
  /** the hand-off at S2 */
  out?: { el: HTMLElement; session?: HTMLElement };
}

const states = new WeakMap<ActCtx, A2State>();

export async function a2state(ctx: ActCtx): Promise<A2State> {
  const have = states.get(ctx);
  if (have) return have;
  const room = await takeRoom(ctx);
  const lay = room.lay;
  const thread = new Thread(ctx.film, ctx.cam, room.scroller, room.top0, lay.gap, lay.fade, room.s1);
  /* the lines' layer sits just above the stage layer; its one child undoes the camera, so a line is placed in frame px */
  const layer = ctx.stage.layer('a2-lines', 1);
  const lines = h('div', 'a2-lines', '', { position: 'absolute', left: '0', top: '0', width: ctx.film.width + 'px', height: ctx.film.height + 'px', 'transform-origin': '0 0' });
  layer.appendChild(lines);
  const W = ctx.film.width, H = ctx.film.height, cam = ctx.cam;
  ctx.film.onRender(() => {
    const s = cam.state, z = Math.exp(s.lz);
    lines.style.transform = 'translate(' + (s.x - W / (2 * z)).toFixed(3) + 'px,' + (s.y - H / (2 * z)).toFixed(3) + 'px) scale(' + (1 / z).toFixed(6) + ')';
  });
  /* the act's last frame in this edit (S2 in the master): nothing of act 2 is drawn after it */
  const end = actEnd(ctx);
  /* small things move fast all through the act (the cursor, the orbs that fly, the words that travel): every frame
     takes all its sub-frames (the renderer would keep only the shutter's two ends where few pixels change, and draw
     them twice) */
  ctx.film.motion(room.s1, end, 8);
  const st: A2State = { room, lay, thread, lines, end };
  states.set(ctx, st);
  return st;
}
