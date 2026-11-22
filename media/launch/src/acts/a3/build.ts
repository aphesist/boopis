/* Act 3's stage, built once: every part comes from the art director's key frames (engine/look keyFrame(), fresh copies
   so no other act's use of the cached ones can move them) or from the same builders they use (look/src/scenes/parts.ts),
   placed in three plates (rig.ts groups):

     window   appWindow() at 2.6x: its frame, title bar and sidebar (session rows; the Bots rows waiting), and on it B09's
              session plate (its main area), B10's log (six steps) at B09's place, B09's Governance (in B09's right panel
              in 16:9, under the steps in 9:16), the composer, B09's film line, the dock, and the open room (its old
              thread as the look's bars, the run's entries for B13) in a viewport on the main area
     terminal B13's terminal, its body rebuilt as lines that the act types and prints
     app      B11's nameless app

   Nothing is shown before the act's first frame: the groups are hidden until 20.000 (a set on the timeline). */
import type { ActCtx } from '../context';
import { keyFrame, swapOrbs, BOTS } from '../../engine/look';
import { appWindow, barRoom, botEntry, huddle, sessionComposer, youEntry } from '../../../look/src/scenes/parts';
import type { GroupText } from '@ui/src/data/types';
import { filmUI, h } from '../../../look/src/stage';
import { LANDSCAPE, VERTICAL, X, type Layout } from './layout';
import { rig, type Group, type Rig, type Rect } from './rig';
import { lineWords, type Line } from './text';
import { A3_CSS } from './css';

export interface Stage3 {
  L: Layout; v: boolean; rig: Rig;
  gw: Group; gt: Group; ga: Group;
  /* the window */
  win: HTMLElement; tabs: HTMLElement; thumb: HTMLElement; sideSession: HTMLElement[]; sideBots: HTMLElement[];
  plate: HTMLElement; dock: HTMLElement;
  panelWrap: HTMLElement | null; panel: HTMLElement | null; gov: HTMLElement; ladder: HTMLElement;
  sessionClip: HTMLElement; log: HTMLElement; composer: HTMLElement; input: HTMLElement; send: HTMLElement;
  line9: Line;
  /* the open room on the main area */
  viewport: HTMLElement; scroll: HTMLElement; oldRoom: HTMLElement; roomComp: HTMLElement; room: HTMLElement; voxEntry: HTMLElement;
  /* the terminal */
  term: HTMLElement; termBody: HTMLElement; termLines: HTMLElement[];
  /* the app */
  app: HTMLElement;
  /* B12's film line, in screen space */
  line12: Line;
  /** the act's first frame */
  t0: number; t1: number;
}

/** the command, as docs/CLI.md writes it */
export const CMD = 'boopis run --group release "write the release notes"';
/** the run as the CLI prints it (apps/desktop/src-tauri/src/cli/groups.rs: "[HH:MM:SS] who", "  text", "-- done: ...") */
export const OUT: [string, string][] = [
  ['[14:07:41]', 'kai'], ['', '  @vox draft them from the merged changes.'],
  ['[14:07:58]', 'vox'], ['', '  The draft is in CHANGELOG.md.'],
  ['[14:08:16]', 'kai'], ['', '  Read it. Tightened the fixes section.'],
  ['', '-- done: the bots stopped handing off after 3 rounds']
];

export async function build3(ctx: ActCtx): Promise<Stage3> {
  const film = ctx.film, v = ctx.variant === 'vertical', L = v ? VERTICAL : LANDSCAPE;
  const t0 = ctx.win('B09').start, t1 = ctx.win('B13').end;
  if (!document.getElementById('a3-css')) { const s = document.createElement('style'); s.id = 'a3-css'; s.textContent = A3_CSS; document.head.appendChild(s); }

  /* fresh copies of the key frames, built into a hidden holder, then taken apart */
  const holder = h('div', 'a3-holder', '', { position: 'absolute', left: '0', top: '0', visibility: 'hidden' });
  ctx.world.appendChild(holder);
  const kf = async (id: string): Promise<HTMLElement> => keyFrame(film, ctx.stage, id, { layer: holder, vertical: v });
  const k9 = await kf('b09'), k10 = await kf('b10'), k11 = await kf('b11'), k12 = await kf('b12'), k13 = await kf('b13');

  const R = rig(film, ctx.stage, [t0, t1]);
  const plateGroup = (cls: string): HTMLElement => { const e = h('div', 'a3 a3-group ' + cls); ctx.world.appendChild(e); return e; };
  /* z-order: the terminal behind the window (B11), the app in front; B12 swaps the terminal forward */
  const gtEl = plateGroup('a3-term'), gwEl = plateGroup('a3-win'), gaEl = plateGroup('a3-app');
  const screenEl = plateGroup('a3-screen');
  const gw = R.group(gwEl), gt = R.group(gtEl), ga = R.group(gaEl);
  for (const e of [gtEl, gwEl, gaEl, screenEl]) e.style.visibility = 'hidden';
  film.tl.set([gtEl, gwEl, gaEl, screenEl], { immediateRender: false, visibility: 'visible' }, t0);

  /* ───── the window ───── */
  const win = appWindow({ x: L.win[0], y: L.win[1], w: 3328, h: L.win[3], tab: 'session' });
  win.style.width = L.win[2] + 'px';
  win.classList.add('a3-window');
  gwEl.appendChild(win);
  const winMain = win.querySelector<HTMLElement>('.win__main');
  if (winMain) winMain.style.display = 'none';      /* the session plate is the main area's surface */
  const side = win.querySelector<HTMLElement>('.win__side')!;
  const sideKids = [...side.children] as HTMLElement[];
  const tabs = side.querySelector<HTMLElement>('.tabs')!;
  const sideSession = sideKids.slice(2, sideKids.length - 1);
  /* the Bots rows, from the same builder with tab 'bots', waiting in the session sidebar */
  const winB = appWindow({ x: 0, y: 0, w: 3328, h: L.win[3], tab: 'bots' });
  const sideB = [...winB.querySelector<HTMLElement>('.win__side')!.children] as HTMLElement[];
  const sideBots = sideB.slice(2, sideB.length - 1);
  const foot = sideKids[sideKids.length - 1]!;
  for (const r of sideBots) side.insertBefore(r, foot);
  /* the tabs pill: the thumb is its own element so it can slide (the product's --dur-slide); the labels' bars stay */
  for (const s of tabs.querySelectorAll<HTMLElement>(':scope > span')) s.removeAttribute('data-on');
  const thumb = h('i', 'a3-thumb');
  tabs.prepend(thumb);
  const seg0 = tabs.querySelector<HTMLElement>(':scope > span')!;
  Object.assign(thumb.style, { left: seg0.offsetLeft + 'px', top: seg0.offsetTop + 'px', width: seg0.offsetWidth + 'px', height: seg0.offsetHeight + 'px', borderRadius: seg0.style.borderRadius });
  const dockEl = win.querySelector<HTMLElement>('.dock')!;

  /* B09's session plate: the main area, its gradient pinned in px to the key frame's own so the seam frame matches */
  const plate = k9.querySelector<HTMLElement>('.plate--room')!;
  const pr = rectOf(plate);
  plate.style.background = 'radial-gradient(' + (pr[2] * 0.7).toFixed(1) + 'px ' + (pr[3] * 0.8).toFixed(1) + 'px at ' + (pr[0] + pr[2] * 0.3 - L.main[0]).toFixed(1) + 'px ' + (pr[1] + pr[3] * 0.45 - L.main[1]).toFixed(1) + 'px, color-mix(in oklab, var(--bg-2) 72%, var(--bg-3)), var(--bg-2) 70%)';
  setRect(plate, L.main);
  gwEl.appendChild(plate);

  /* the open room on the main area (Bots): its old thread as bars, its composer as bars, the run's entries (B13) */
  const viewport = h('div', 'a3-viewport', '', { position: 'absolute', overflow: 'hidden' });
  setRect(viewport, L.main);          /* the main area's width in the session view; it grows with the main area on Bots */
  viewport.style.borderRadius = '30px';
  const scroll = h('div', 'a3-scroll', '', { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' });
  viewport.appendChild(scroll);
  const oldRoom = h('div', 'a3-oldroom', '', { position: 'absolute', left: '0', top: '0', width: L.mainBots[2] + 'px', height: L.mainBots[3] + 'px' });
  barRoom(oldRoom, L.mainBots[2], X, [['you', [44]], [BOTS.kai, [92, 58]], ['huddle', [70]], ['you', [36]], [BOTS.nina, [80]]]);
  scroll.appendChild(oldRoom);
  const roomComp = roomComposerBars(L.mainBots[2], L.mainBots[3]);
  viewport.appendChild(roomComp);
  gwEl.appendChild(viewport);

  /* the run's entries in the room (B13), from the look's own builders (the key frame's room, plus vox's reply before the
     huddle gathers it) */
  const msgs: GroupText[] = [
    { kind: 'text', id: 'r1', who: 'vox', t: '14:07', round: 1, to: ['kai'], text: 'The draft is in CHANGELOG.md.' },
    { kind: 'text', id: 'r2', who: 'kai', t: '14:08', round: 2, to: ['vox'], text: 'Read it. Tightened the fixes section.' }
  ];
  const roomLog = h('div', 'room-log');
  if (v) roomLog.dataset['margin'] = 'off';
  roomLog.insertAdjacentHTML('beforeend', youEntry('write the release notes', '14:07') + botEntry(BOTS.kai, '@vox draft them from the merged changes.', '14:07', ['vox']));
  roomLog.append(huddle(msgs, true));
  const roomF = filmUI(roomLog, { x: L.b13.room[0] - L.mainBots[0], y: 0, width: v ? 360 : 560, scale: X });
  roomF.outer.classList.add('a3-room');
  scroll.appendChild(roomF.outer);
  const voxLog = h('div', 'room-log');
  if (v) voxLog.dataset['margin'] = 'off';
  voxLog.insertAdjacentHTML('beforeend', botEntry(BOTS.vox, 'The draft is in CHANGELOG.md.', '14:07', ['kai']));
  const voxF = filmUI(voxLog, { x: L.b13.room[0] - L.mainBots[0], y: 0, width: v ? 360 : 560, scale: X });
  voxF.outer.classList.add('a3-vox');
  scroll.appendChild(voxF.outer);

  /* the session's view: a clip at the main area holds it (the B11 tab change pushes it out of that clip) */
  const sessionClip = h('div', 'a3-sessionclip', '', { position: 'absolute', overflow: 'hidden' });
  setRect(sessionClip, L.main);
  const intoClip = (e: HTMLElement): void => { e.style.left = (parseFloat(e.style.left) - L.main[0]) + 'px'; e.style.top = (parseFloat(e.style.top) - L.main[1]) + 'px'; sessionClip.appendChild(e); };
  gwEl.appendChild(sessionClip);
  /* the session: B10's log at B09's place, the composer, Governance, the film line */
  const log9 = [...k9.querySelectorAll<HTMLElement>('.ui-place')].find((e) => e.querySelector('.room-log'))!;
  const log = [...k10.querySelectorAll<HTMLElement>('.ui-place')].find((e) => e.querySelector('.room-log'))!;
  log.style.left = log9.style.left; log.style.top = log9.style.top;
  log.classList.add('a3-log');
  let composer: HTMLElement;
  if (v) {
    const f = filmUI(sessionComposer(), { x: L.composer[0], y: L.composer[1], width: Math.round(L.composer[2] / X), scale: X });
    composer = f.outer;
  } else {
    composer = [...k9.querySelectorAll<HTMLElement>('.ui-place')].find((e) => e.querySelector('.ui-composer'))!;
  }
  composer.classList.add('a3-composer');
  intoClip(composer);
  intoClip(log);                      /* above the composer: the request card lifts out of it */
  const input = composer.querySelector<HTMLElement>('.ui-composer__input')!;
  const send = composer.querySelector<HTMLElement>('.ui-send')!;
  const gov = [...k9.querySelectorAll<HTMLElement>('.ui-place')].find((e) => e.querySelector('.ui-ladder'))!;
  gov.classList.add('a3-gov');
  let panelWrap: HTMLElement | null = null, panel: HTMLElement | null = null;
  if (!v && L.panel) {
    panel = k9.querySelector<HTMLElement>('.plate--frame')!;
    panelWrap = h('div', 'a3-panelwrap', '', { position: 'absolute', overflow: 'hidden' });
    setRect(panelWrap, [L.panel[0], L.panel[1] - 40, L.panel[2], L.panel[3] + 120]);
    panel.style.left = '0px'; panel.style.top = '40px';
    gov.style.left = (parseFloat(gov.style.left) - L.panel[0]) + 'px';
    gov.style.top = (parseFloat(gov.style.top) - L.panel[1] + 40) + 'px';
    panelWrap.append(panel, gov);
    gwEl.appendChild(panelWrap);
  } else {
    intoClip(gov);
  }
  const ladder = gov.querySelector<HTMLElement>('.ui-ladder')!;
  const line9el = k9.querySelector<HTMLElement>('.film-line')!;
  gwEl.appendChild(line9el);
  frameWide(line9el, L.W);
  const line9 = lineWords(line9el);

  /* the dock: above the main area, at its foot, centred on it */
  gwEl.appendChild(dockEl);
  dockEl.style.bottom = '';
  placeDock(dockEl, L.main, L.win);

  /* ───── the terminal (B13's), its body as lines ───── */
  const term = k13.querySelector<HTMLElement>('.term')!;
  gtEl.appendChild(term);
  const termBody = term.querySelector<HTMLElement>('.term__body')!;
  termBody.innerHTML = '';
  termBody.style.whiteSpace = 'pre-wrap';
  termBody.style.paddingLeft = (v ? 44 : 50) + 'px';
  const termLines: HTMLElement[] = [];
  const addLine = (html: string): void => { const d = h('div', 'a3-tl', html); termBody.appendChild(d); termLines.push(d); };
  addLine('<span class="p">$</span> <span class="a3-cmd"></span>');
  termLines[0]!.style.whiteSpace = 'pre';
  for (const [q, txt] of OUT) addLine(q ? '<span class="q">' + q + '</span> ' + txt : txt.startsWith('--') ? '<span class="q">' + txt + '</span>' : txt);
  addLine('<span class="p">$</span> ');

  /* ───── the app (B11's), waiting where it is laid out ───── */
  const app = k11.querySelector<HTMLElement>('.app2')!;
  gaEl.appendChild(app);
  setRect(app, L.app);

  /* ───── B12's film line, fixed to the frame ───── */
  const l12 = k12.querySelector<HTMLElement>('.film-line')!;
  screenEl.appendChild(l12);
  frameWide(l12, L.W);
  const line12 = lineWords(l12);

  /* film orbs everywhere a kit orb is drawn (the window's sidebar and dock, the room) */
  swapOrbs(film, gwEl);
  holder.remove();
  return {
    L, v, rig: R, gw, gt, ga, win, tabs, thumb, sideSession, sideBots, plate, dock: dockEl, panelWrap, panel, gov, ladder,
    sessionClip, log, composer, input, send, line9, viewport, scroll, oldRoom, roomComp, room: roomF.outer, voxEntry: voxF.outer,
    term, termBody, termLines, app, line12, t0, t1
  };
}

/** the room's composer at the main area's foot, as the look draws it in a window (look/src/scenes/session.ts roomBars) */
function roomComposerBars(w: number, hh: number): HTMLElement {
  const k = X;
  const comp = h('div', 'wcomp', '', { left: Math.round(w / 2 - 300 * k) + 'px', width: Math.round(600 * k) + 'px', top: Math.round(hh - 84 * k - 80 * k) + 'px', height: Math.round(80 * k) + 'px', 'border-radius': Math.round(12 * k) + 'px' });
  comp.appendChild(h('span', 'wbar wbar--q', '', { position: 'absolute', left: Math.round(16 * k) + 'px', top: Math.round(16 * k) + 'px', width: Math.round(180 * k) + 'px', height: Math.round(7 * k) + 'px' }));
  const chips = h('div', '', '', { position: 'absolute', left: Math.round(14 * k) + 'px', bottom: Math.round(12 * k) + 'px', display: 'flex', gap: Math.round(6 * k) + 'px' });
  for (let i = 0; i < 4; i++) chips.append(h('span', 'wchip', '', { width: Math.round(46 * k) + 'px', height: Math.round(20 * k) + 'px' }));
  comp.appendChild(chips);
  return comp;
}

/** the dock at the foot of a main area rect, centred on it (the window's own geometry, appWindow: 330 x 66 at k) */
export function placeDock(dock: HTMLElement, main: Rect, win: Rect): void {
  const dw = 330 * X, dh = 66 * X;
  dock.style.position = 'absolute';
  dock.style.left = (main[0] + main[2] / 2 - dw / 2) + 'px';
  dock.style.top = (win[1] + win[3] - dh) + 'px';
  dock.style.width = dw + 'px'; dock.style.height = dh + 'px';
}

/** a centred film line (the look's data-align="center": left 0, right 0 of its stage) keeps the frame's width when it
    leaves the key frame's box */
function frameWide(line: HTMLElement, w: number): void {
  if (line.dataset['align'] !== 'center') return;
  line.style.left = '0px'; line.style.right = 'auto'; line.style.width = w + 'px';
}

export function setRect(el: HTMLElement, r: Rect): void {
  el.style.left = r[0] + 'px'; el.style.top = r[1] + 'px'; el.style.width = r[2] + 'px'; el.style.height = r[3] + 'px';
}
function rectOf(el: HTMLElement): Rect {
  return [parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0, parseFloat(el.style.width) || el.offsetWidth, parseFloat(el.style.height) || el.offsetHeight];
}
