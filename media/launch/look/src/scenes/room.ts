/* B04 to B07: the room "release" (SC/script/script.md). Every entry is the product's own (ui.html.entry, ui.markdown,
   ui.presence, the bots module's huddle), at film scale. */
import { ui } from '@boopis/ui';
import type { PresenceActor } from '@boopis/ui';
import { BOTS, filmUI, h } from '../stage';
import { T, botEntry, cursor, filmLine, huddle, like, roomComposer, roomHead, youEntry } from './parts';

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
const plate = (s: HTMLElement, v: boolean): void => {
  s.append(h('div', 'plate plate--room', '', v ? { left: '-40px', top: '120px', width: '1160px', height: '1580px' } : { left: '40px', top: '-80px', width: '1840px', height: '1240px' }));
};

/** B04 at 9.3 s: the room assembled around its stack, your ask sent and landed as your request, kai thinking, the composer
    with the four member chips; the cursor just left the send button */
export function b04(s: HTMLElement, v: boolean): void {
  pool(s, '50%', '50%');
  plate(s, v);
  const X = v ? 2.6 : 3, L = v ? 60 : 130, W = v ? 370 : 556;
  const head = filmUI(roomHead(), { x: L, y: v ? 230 : 40, scale: X, width: W });
  if (v) head.inner.dataset['margin'] = 'off';
  s.append(head.outer);
  /* the thread starts where the head ends, as in the room (the head's own bottom padding is the gap) */
  const top = Math.round(head.outer.getBoundingClientRect().bottom - s.getBoundingClientRect().top);
  s.append(column([youEntry(...T.ask), presence([{ id: 'kai', bot: like(BOTS.kai), status: 'thinking' }])], { x: L, y: top, width: W, scale: X, narrow: v }));
  const comp = filmUI(roomComposer(), { x: L, y: v ? 1330 : 740, scale: X, width: W });
  s.append(comp.outer);
  const send = comp.outer.querySelector<HTMLElement>('.ui-send')?.getBoundingClientRect();
  if (send) s.append(cursor(Math.round(send.right + 30), Math.round(send.bottom - 20)));
}

/** B05 at 11.2 s: kai's reply has landed whole with two mention chips; the film line sits in the ground above it; the
    presence line under it names who took the work */
export function b05(s: HTMLElement, v: boolean): void {
  pool(s, '46%', '50%');
  plate(s, v);
  const X = v ? 2.6 : 3, L = v ? 60 : 130, W = v ? 370 : 556;
  s.append(filmLine(v ? 'They {hand} work<br>to each other' : 'They {hand} work to each other', v ? { y: 300, size: 100 } : { y: 110, align: 'left', x: L + 112 * X, size: 88 }));
  const pres = presence([
    { id: 'moss', bot: like(BOTS.moss), status: 'tool', doing: 'in the terminal' },
    { id: 'nina', bot: like(BOTS.nina), status: 'tool', doing: 'reading a file' }
  ]);
  s.append(column([botEntry(BOTS.kai, ...T.kai1.slice(0, 2) as [string, string], [...T.kai1[2]]), pres], { x: L, y: v ? 640 : 330, width: W, scale: X, narrow: v }));
  s.append(filmUI(roomComposer(), { x: L, y: v ? 1360 : 790, scale: X, width: W }).outer);
}

/** B06 at 14.5 s: nina's and moss's replies have gathered into the live huddle, open; kai's message has just landed in it
    and its head line reads three messages */
export function b06(s: HTMLElement, v: boolean): void {
  pool(s, '46%', '54%');
  plate(s, v);
  const X = v ? 2.6 : 3, L = v ? 60 : 130, W = v ? 370 : 556;
  s.append(filmLine('They {work} it out', v ? { y: 300, size: 104 } : { y: 84, align: 'left', x: L + 112 * X, size: 88 }));
  s.append(column([huddle(T.huddle, true)], { x: L, y: v ? 520 : 250, width: W, scale: X, narrow: v }));
  if (v) s.append(filmUI(roomComposer(), { x: L, y: 1380, scale: X, width: W }).outer);
}

/** B07 at 17.0 s: you wrote again, so the huddle folded; the camera has pushed in until its label is 44px tall in the
    central third; your new request sits under it */
export function b07(s: HTMLElement, v: boolean): void {
  pool(s, '50%', '50%', '70%', '80%');
  plate(s, v);
  const X = v ? 3.6 : 3.4;
  const folded = huddle(T.huddle, false);
  const col = column([folded, youEntry(...T.next)], { x: v ? 40 : 120, y: v ? 640 : 300, width: v ? 280 : 500, scale: X, narrow: v });
  s.append(col);
  /* centre the folded line in the frame */
  const r = col.getBoundingClientRect();
  col.style.left = Math.round((v ? 540 : 960) - r.width / 2) + 'px';
  col.style.top = Math.round((v ? 900 : 540) - r.height / 2) + 'px';
}

export { cursor };
