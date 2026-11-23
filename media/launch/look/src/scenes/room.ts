/* B04 to B07: the room "release" (SC/script/script.md). Every entry is the product's own (ui.html.entry, ui.markdown,
   ui.presence, the bots module's huddle), at film scale. */
import { ui } from '@boopis/ui';
import type { PresenceActor } from '@boopis/ui';
import { BOTS, filmUI, h } from '../stage';
import { T, bleedPlate, botEntry, cursor, filmLine, huddle, inStage, like, roomComposer, roomHead, youEntry } from './parts';

const pool = (s: HTMLElement, x: string, y: string, w = '80%', hh = '90%'): void => {
  s.style.setProperty('--pool-x', x); s.style.setProperty('--pool-y', y); s.style.setProperty('--pool-w', w); s.style.setProperty('--pool-h', hh);
  s.style.setProperty('--pool', 'var(--lamp-ui)');
};
/** the presence entry as the room draws it, its clock drawn as a short bar (no digits on screen) */
export function presence(actors: PresenceActor[]): HTMLElement {
  const p = ui.presence({ actors, announce: false, now: () => 0 });
  for (const c of p.querySelectorAll<HTMLElement>('.ui-presence__clock')) c.innerHTML = '<span class="wbar wbar--q" style="display:inline-block;width:22px;height:5px;vertical-align:middle"></span>';
  return p;
}
/** the room column at scale x: the product's 112px margin and its measure, placed in 1080p px; `narrow` is the app's own
    layout under its margin width (each call number above its message), used for 9:16 */
function column(parts: Array<string | Node>, o: { x: number; y: number; width: number; scale: number; narrow?: boolean }): HTMLElement {
  const log = h('div', 'room-log');
  if (o.narrow) log.dataset['margin'] = 'off';
  for (const p of parts) { if (typeof p === 'string') log.insertAdjacentHTML('beforeend', p); else log.append(p); }
  const f = filmUI(log, { x: o.x, y: o.y, scale: o.scale, width: o.width });
  return f.outer;
}
/** the room's plate: the camera is inside the room, so it bleeds past every edge of the frame (critique A1-13) */
const plate = (s: HTMLElement, v: boolean): void => { s.append(bleedPlate(v)); };
/* the column: 16:9 at 3x from x 130; 9:16 at 2.6x across the safe band, x 60 to 960 (346 real px) */
const COL = (v: boolean): { X: number; L: number; W: number } => (v ? { X: 2.6, L: 60, W: 346 } : { X: 3, L: 130, W: 556 });

/** B04 at 9.3 s: the room assembled around its stack, your ask sent and landed as your request, kai thinking, the composer
    with the four member chips; the cursor just left the send button */
export function b04(s: HTMLElement, v: boolean): void {
  pool(s, '50%', '50%');
  plate(s, v);
  const { X, L, W } = COL(v);
  const head = filmUI(roomHead(), { x: L, y: v ? 230 : 40, scale: X, width: W });
  if (v) head.inner.dataset['margin'] = 'off';
  s.append(head.outer);
  /* the thread starts where the head ends, as in the room (the head's own bottom padding is the gap) */
  const top = Math.round(inStage(s, head.outer).bottom);
  s.append(column([youEntry(...T.ask), presence([{ id: 'kai', bot: like(BOTS.kai), status: 'thinking' }])], { x: L, y: top, width: W, scale: X, narrow: v }));
  const comp = filmUI(roomComposer(), { x: L, y: v ? 1410 : 740, scale: X, width: W });
  s.append(comp.outer);
  const sendEl = comp.outer.querySelector<HTMLElement>('.ui-send'), send = sendEl ? inStage(s, sendEl) : null;
  if (send) s.append(cursor(Math.round(send.right + 30), Math.round(send.bottom - 20)));
}

/** B05 at 11.2 s: kai's reply has landed whole with two mention chips; the film line sits in the ground above it; the
    presence line under it names who took the work */
export function b05(s: HTMLElement, v: boolean): void {
  pool(s, '46%', '50%');
  plate(s, v);
  const { X, L, W } = COL(v);
  s.append(filmLine(v ? 'They {hand} work<br>to each other' : 'They {hand} work to each other', v ? { y: 300 } : { y: 110, align: 'left', x: L + 112 * X }));
  const pres = presence([
    { id: 'moss', bot: like(BOTS.moss), status: 'tool', doing: 'in the terminal' },
    { id: 'nina', bot: like(BOTS.nina), status: 'tool', doing: 'reading a file' }
  ]);
  s.append(column([botEntry(BOTS.kai, ...T.kai1.slice(0, 2) as [string, string], [...T.kai1[2]]), pres], { x: L, y: v ? 640 : 330, width: W, scale: X, narrow: v }));
  s.append(filmUI(roomComposer(), { x: L, y: v ? 1410 : 790, scale: X, width: W }).outer);
}

/** B06 at 14.5 s: nina's and moss's replies have gathered into the live huddle, open; kai's message has just landed in it
    and its head line reads three messages */
export function b06(s: HTMLElement, v: boolean): void {
  pool(s, '46%', '54%');
  plate(s, v);
  const { X, L, W } = COL(v);
  s.append(filmLine('They {work} it out', v ? { y: 300 } : { y: 84, align: 'left', x: L + 112 * X }));
  s.append(column([huddle(T.huddle, true)], { x: L, y: v ? 520 : 250, width: W, scale: X, narrow: v }));
  if (v) s.append(filmUI(roomComposer(), { x: L, y: 1410, scale: X, width: W }).outer);
}

/** B07 at 17.0 s: you wrote again, so the huddle folded; the camera has pushed in until its label is 44px tall in the
    central third; your new request sits under it */
export function b07(s: HTMLElement, v: boolean): void {
  pool(s, '50%', '50%', '70%', '80%');
  plate(s, v);
  const X = 3.4;
  const folded = huddle(T.huddle, false);
  /* 9:16: the column spans the safe band (x 60 to 960) and is centred on the band's middle, y 930 */
  const col = column([folded, youEntry(...T.next)], { x: v ? 60 : 120, y: v ? 640 : 300, width: v ? Math.floor(900 / X) : 500, scale: X, narrow: v });
  s.append(col);
  const r = inStage(s, col);
  if (!v) col.style.left = Math.round(960 - r.width / 2) + 'px';
  col.style.top = Math.round((v ? 930 : 540) - r.height / 2) + 'px';
}

export { cursor };
