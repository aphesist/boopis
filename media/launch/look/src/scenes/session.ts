/* B08 to B11: the window, your own session (governed), the breath (SC/script/script.md). The session's pieces are the kit's
   (ui.html.entry with its model route, ui.html.steps, ui.html.ladder in a ui.html.section, the composer's Governed chip). */
import { BOTS, filmUI, h } from '../stage';
import { agentEntry, appWindow, barRoom, cursor, filmLine, governance, otherApp, sessionComposer, terminal, youEntry } from './parts';
import type { Step } from './parts';

const pool = (s: HTMLElement, x: string, y: string, w = '86%', hh = '90%', c = 'var(--lamp-ui)'): void => {
  s.style.setProperty('--pool-x', x); s.style.setProperty('--pool-y', y); s.style.setProperty('--pool-w', w); s.style.setProperty('--pool-h', hh);
  s.style.setProperty('--pool', c);
};
/** the escalation's light (film.css --lamp-cool): on the light ground the least warm of Bone's whites, on the dark one the
    lamp cooled toward the text's own ink */
const COOL = 'var(--lamp-cool)';

const roomBars = (main: HTMLElement, w: number, hh: number, k: number): void => {
  barRoom(main, w, k, [['you', [44]], [BOTS.kai, [92, 58]], ['huddle', [70]], ['you', [36]], [BOTS.nina, [80]]]);
  const comp = h('div', 'wcomp', '<span style="position:absolute;left:' + Math.round(16 * k) + 'px;top:' + Math.round(16 * k) + 'px" class="wbar wbar--q"></span>', {
    left: Math.round(w / 2 - 300 * k) + 'px', width: Math.round(600 * k) + 'px', bottom: Math.round(84 * k) + 'px', height: Math.round(80 * k) + 'px', 'border-radius': Math.round(12 * k) + 'px'
  });
  (comp.firstElementChild as HTMLElement).style.width = Math.round(180 * k) + 'px';
  (comp.firstElementChild as HTMLElement).style.height = Math.round(7 * k) + 'px';
  const chips = h('div', '', '', { position: 'absolute', left: Math.round(14 * k) + 'px', bottom: Math.round(12 * k) + 'px', display: 'flex', gap: Math.round(6 * k) + 'px' });
  for (let i = 0; i < 4; i++) chips.append(h('span', 'wchip', '', { width: Math.round(46 * k) + 'px', height: Math.round(20 * k) + 'px' }));
  comp.append(chips);
  main.append(comp);
  void hh;
};

/** B08 at 18.5 s: pulled back to the whole boopis window (Bots tab, the room), the cursor arriving at the tabs pill */
export function b08(s: HTMLElement, v: boolean): void {
  pool(s, '50%', '50%', '100%', '100%');
  if (v) {
    const w = 1900, k = w / 1280;
    s.append(appWindow({ x: 24, y: 300, w, h: 1360, tab: 'bots', main: (m, mw, mh) => roomBars(m, mw, mh, k) }));
    s.append(cursor(Math.round(24 + 190 * k), Math.round(300 + 40 * k + 32 * k)));
    return;
  }
  const w = 1650, k = w / 1280, hh = Math.round(w * 0.5625);
  const x = Math.round(960 - w / 2), y = Math.round(540 - hh / 2);
  s.append(appWindow({ x, y, w, h: hh, tab: 'bots', main: (m, mw, mh) => roomBars(m, mw, mh, k) }));
  s.append(cursor(Math.round(x + 90 * k), Math.round(y + 40 * k + 34 * k)));
}

const S1: Step[] = [{ title: 'Read the files in src/billing' }, { title: 'Moved the proration helpers to integer cents' }];
const S2: Step[] = [...S1,
  { title: 'npm test', mono: true, meta: ['failed', 'invoice.test.ts'], kind: 'fail' },
  { title: 'Rolled back invoice.ts and escalated to GPT-6.2 Astra', meta: ['Governance, after a failed gate'], kind: 'escalate' },
  { title: 'Rounded once per invoice' },
  { title: 'npm test', mono: true, meta: ['passed'] }];

function sessionScene(s: HTMLElement, v: boolean, climbed: boolean): void {
  pool(s, v ? '50%' : '40%', '50%', '90%', '96%', climbed ? COOL : 'var(--lamp-ui)');
  const X = 2.6;
  /* the ground and the panel, the panel's frame a step darker (bg-1), as the app's right panel */
  if (v) {
    s.append(h('div', 'plate plate--room', '', { left: '-40px', top: '520px', width: '1160px', height: '1500px' }));
  } else {
    s.append(h('div', 'plate plate--room', '', { left: '40px', top: '-80px', width: '1260px', height: '1240px' }));
    s.append(h('div', 'plate plate--frame', '', { left: '1300px', top: '400px', width: '700px', height: '760px' }));
  }
  s.append(filmLine(v ? 'The {cheaper} one<br>tries first' : 'The {cheaper}<br>one tries first', v ? { y: 280, size: 104 } : { y: 168, align: 'left', x: 1336, size: 80, width: 580 }));
  const steps = climbed ? S2 : S1;
  const models = climbed ? ['gpt-6.2-sol', 'gpt-6.2-astra'] : ['gpt-6.2-sol'];
  const log = h('div', 'room-log');
  if (v) log.dataset['margin'] = 'off';
  log.insertAdjacentHTML('beforeend', youEntry('fix the proration drift in src/billing', '14:06') + agentEntry(models, steps));
  s.append(filmUI(log, { x: v ? 50 : 80, y: v ? 600 : (climbed ? 44 : 140), width: v ? 360 : 460, scale: X }).outer);
  const gov = filmUI(governance(climbed ? 1 : 0), { x: v ? 50 : 1336, y: v ? (climbed ? 1440 : 1220) : 430, width: v ? 360 : 214, scale: X });
  if (v) { gov.outer.style.padding = '12px 0'; }
  s.append(gov.outer);
  if (!v) s.append(filmUI(sessionComposer(), { x: 80, y: climbed ? 880 : 790, width: 460, scale: X }).outer);
}
/** B09 at 22.5 s: your request sent; the answer starts on GPT-6.2 Sol, its first steps rising; the right panel's
    Governance section has slid in with the ladder, Sol current in brass; the film line anchored above it */
export const b09 = (s: HTMLElement, v: boolean): void => sessionScene(s, v, false);
/** B10 at 24.7 s: npm test failed, the change rolled back, the brass marker has moved down to Astra and the call number
    reads Sol to Astra; the next npm test passed */
export const b10 = (s: HTMLElement, v: boolean): void => sessionScene(s, v, true);

/** B11 at 27.0 s: the one slow move, pulled back past the window's edges: a terminal behind on the left, the boopis
    window, and the small nameless app in front at the lower right; the lamp cooling */
export function b11(s: HTMLElement, v: boolean): void {
  pool(s, '50%', '52%', '110%', '110%', COOL);
  if (v) {
    s.append(terminal({ x: 70, y: 280, w: 760, h: 420, lines: '<span class="p">$</span> ' }));
    const w = 940, k = w / 1280;
    s.append(appWindow({ x: 70, y: 640, w, h: 700, tab: 'bots', main: (m, mw, mh) => roomBars(m, mw, mh, k) }));
    s.append(otherApp({ x: 540, y: 1220, w: 470, h: 380, msgs: [{ bars: [60, 40] }, { bars: [44], you: true }] }));
    return;
  }
  const t = terminal({ x: 110, y: 170, w: 760, h: 520, lines: '<span class="p">$</span> ' });
  t.style.filter = 'var(--far-dim)';
  s.append(t);
  const w = 1120, k = w / 1280;
  s.append(appWindow({ x: 600, y: 250, w, h: Math.round(w * 0.5625), tab: 'bots', main: (m, mw, mh) => roomBars(m, mw, mh, k) }));
  s.append(otherApp({ x: 1380, y: 640, w: 440, h: 360, msgs: [{ bars: [60, 40] }, { bars: [44], you: true }] }));
}
