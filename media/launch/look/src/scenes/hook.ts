/* B01 to B03: the hook, the promise, the cast (SC/script/script.md). */
import { ui } from '@boopis/ui';
import { BOTS, ROOM, filmUI, h, labSvg, orb } from '../stage';
import type { FilmBot } from '../stage';
import { filmLine, inStage } from './parts';

const pool = (s: HTMLElement, x: string, y: string, w: string, hh: string, c?: string): void => {
  s.style.setProperty('--pool-x', x); s.style.setProperty('--pool-y', y); s.style.setProperty('--pool-w', w); s.style.setProperty('--pool-h', hh);
  if (c) s.style.setProperty('--pool', c);
};

/** B01 at 1.0 s: the claim set and landed, kai under "Claude" and nina under "GPT", looking at each other. 9:16: the two
    lines in the upper band, the orbs larger and lower so the frame's weight sits on the band's centre (look.md 7) */
export function b01(s: HTMLElement, v: boolean): void {
  pool(s, '50%', v ? '64%' : '70%', v ? '96%' : '60%', v ? '50%' : '72%');
  const l1 = filmLine('<span data-w="claude">[claude]Claude</span> and <span data-w="gpt">[chatgpt]GPT</span>', { y: v ? 420 : 236, hook: true });
  const l2 = filmLine('{Same} group chat', { y: v ? 545 : 366, hook: true });
  s.append(l1, l2);
  const y = v ? 1200 : 704, size = v ? 360 : 260;
  const at = (w: string): number => { const r = inStage(s, l1.querySelector<HTMLElement>('[data-w="' + w + '"]')!); return r.left + r.width / 2; };
  const kx = v ? 540 - 215 : at('claude'), nx = v ? 540 + 215 : at('gpt');
  s.append(orb(BOTS.kai, { size, x: kx, y, reaction: 'idle', gaze: [20, -2], still: true }));
  s.append(orb(BOTS.nina, { size, x: nx, y, reaction: 'idle', gaze: [-20, -2], still: true }));
}

/** B02 at 4.4 s: the app's four sign-in buttons settled in their column, the promise above them. 9:16: the column at
    2.6x (822 px, inside the rails), centred on y 1150 so it fills the band's lower half */
export function b02(s: HTMLElement, v: boolean): void {
  pool(s, '50%', v ? '58%' : '62%', v ? '100%' : '60%', v ? '60%' : '80%', 'var(--lamp-ui)');
  s.append(filmLine(v ? 'Bring the plans<br>you {already} pay for' : 'Bring the plans you {already} pay for', { y: v ? 380 : 216 }));
  const X = v ? 2.6 : 2.4;
  const col = h('div', '', '', { display: 'flex', 'flex-direction': 'column', gap: v ? '16px' : '10px', width: '316px' });
  for (const brand of ['chatgpt', 'github', 'claude', 'xai'] as const) col.insertAdjacentHTML('beforeend', ui.html.signinButton({ brand }));
  const f = filmUI(col, { x: 0, y: v ? 0 : 404, scale: X });
  s.append(f.outer);
  f.outer.style.left = Math.round((v ? 540 : 960) - 316 * X / 2) + 'px';
  if (v) f.outer.style.top = Math.round(1150 - inStage(s, f.outer).height / 2) + 'px';
}

/** B03 at 6.0 s: the buttons have become the four cast cards; the eyes are opening card by card (two awake, one waking,
    one still asleep) */
export function b03(s: HTMLElement, v: boolean): void {
  pool(s, '50%', v ? '50%' : '60%', v ? '100%' : '64%', v ? '60%' : '86%', 'var(--lamp-ui)');
  s.append(h('style', '', `
    .castcard { position: absolute; width: 820px; display: grid; grid-template-columns: 96px 1fr; align-items: center; gap: 32px; padding: 0 36px; border-radius: 24px;
      background: var(--bg-3); box-shadow: inset 0 0 0 1px var(--hair), var(--card-shadow); }
    .castcard .nm { font: 600 38px/1.15 var(--sans); color: var(--text-strong); letter-spacing: -.01em; }
    .castcard .rl { font: 400 29px/1.3 var(--sans); color: var(--text-quiet); }
    .castcard .pl { display: flex; align-items: center; gap: 12px; margin-top: 4px; font: 400 29px/1.3 var(--mono); color: var(--text-dim); }
    .castcard .pl span { display: inline-flex; width: 29px; height: 29px; } .castcard .pl svg { width: 100%; height: 100%; }
  `));
  s.append(filmLine(v ? 'Make each one<br>a {bot} in boopis' : 'Make each one a {bot} in boopis', { y: v ? 330 : 96 }));
  const order: FilmBot[] = [BOTS.nina, BOTS.moss, BOTS.kai, BOTS.vox];
  const faces = ['idle', 'idle', 'sleeping', 'sleeping'];
  /* the cards are 820 px, their content's width (critique A1-21); in 9:16 taller and lower, down to y 1484 */
  const H = v ? 190 : 150, gap = v ? 28 : 18, top = v ? 640 : 300;
  order.forEach((b, i) => {
    const y = top + i * (H + gap);
    const card = h('div', 'castcard', '<span class="slot"></span><span><div class="nm">' + b.name + '</div><div class="rl">' + b.role + '</div><div class="pl"><span>' + labSvg(b.lab) + '</span>' + b.plan + '</div></span>', {
      left: Math.round((v ? 540 : 960) - 410) + 'px', top: y + 'px', height: H + 'px'
    });
    s.append(card);
    const o = orb(b, { size: 96, reaction: faces[i], gaze: i === 1 ? [0, -14] : i === 0 ? [0, 14] : [0, 0], still: true, shadow: false });
    o.style.position = 'relative';
    card.querySelector('.slot')!.replaceWith(o);
  });
  void ROOM;
}
