/* 06 Close-up: the presence pill. The room's jump button, grown with the bots at work in front of its words, as the kit
   draws it (ui.presence.pill), at 4.5x. It sits where the product puts it, centred just above the room's composer; the
   conversation it stands for is behind it, two layers out of focus, drawn as bars. The cursor is on its way in. */
import { ui } from '@boopis/ui';
import '@ui/src/modules/bots/bots.css';
import { BOTS, filmUI, frame, h } from '../stage';
import { SCENE_CSS as ROOM_CSS, like, roomComposer } from '../scenes/parts';

const CURSOR = '<svg viewBox="0 0 26 32" aria-hidden="true"><path d="M2 2 L2 25 L8.2 19.4 L12.4 29 L16.6 27.2 L12.5 17.8 L21 17.6 Z" fill="var(--selected)" stroke="var(--text-on-light)" stroke-width="1.6" stroke-linejoin="round"/></svg>';

frame((s) => {
  s.style.setProperty('--pool-x', '50%');
  s.style.setProperty('--pool-y', '70%');
  s.style.setProperty('--pool-w', '76%');
  s.style.setProperty('--pool-h', '80%');
  s.style.setProperty('--pool', 'var(--bg-3)');
  s.append(h('style', '', ROOM_CSS + `
    .far-room { position: absolute; left: 260px; top: -40px; width: 1400px; display: flex; flex-direction: column; gap: 56px; filter: blur(14px) brightness(.8); }
    .far-row { display: grid; grid-template-columns: 96px 1fr; gap: 0 56px; align-items: start; }
    .far-row .dot { width: 72px; height: 72px; border-radius: 50%; }
    .far-row .lines { display: flex; flex-direction: column; gap: 30px; padding-top: 14px; }
    .far-row .bar { font-size: 64px; }
    .cursor { width: 96px; height: 118px; }
  `));

  /* the room behind: the plate and the conversation as bars, two layers out of focus */
  s.append(h('div', 'plate plate--room', '', { left: '150px', top: '-80px', width: '1620px', height: '1260px' }));
  const far = h('div', 'far-room');
  const rows: Array<[string, number[]]> = [[BOTS.kai.color, [88, 62]], [BOTS.nina.color, [94, 80, 40]], [BOTS.moss.color, [70]], [BOTS.vox.color, [84, 52]]];
  for (const [c, lines] of rows) far.append(h('div', 'far-row', '<span class="dot" style="background:' + c + '"></span><span class="lines">' + lines.map((w) => '<span class="bar bar--dim" style="width:' + w + '%"></span>').join('') + '</span>'));
  s.append(far);

  /* the composer the pill stands on, running off the bottom of the frame */
  const r = { like };
  const comp = roomComposer();
  const CW = 372, X = 4.5, CY = 650;
  const c = filmUI(comp, { x: Math.round(960 - CW * X / 2), y: CY, scale: X, width: CW });
  s.append(c.outer);

  /* the pill: four at work, the words the kit writes for them */
  const pill = ui.presence.pill({ size: 16 });
  pill.paint([
    { id: 'kai', bot: r.like(BOTS.kai), status: 'thinking' },
    { id: 'nina', bot: r.like(BOTS.nina), status: 'tool', doing: 'reading a file' },
    { id: 'moss', bot: r.like(BOTS.moss), status: 'tool', compute: true },
    { id: 'vox', bot: r.like(BOTS.vox), status: 'replying' }
  ]);
  const p = filmUI(pill, { x: 0, y: 0, scale: X });
  s.append(p.outer);
  const w = p.outer.getBoundingClientRect().width;
  p.outer.style.left = Math.round(960 - w / 2) + 'px';
  p.outer.style.top = Math.round(CY - 12 * X - 28 * X) + 'px';   /* 12px above the composer (bots.css .bt-jump), a 28px pill */

  /* the cursor, arriving from the lower right on its arc, sized with the close-up */
  s.append(h('div', 'cursor', CURSOR, { left: Math.round(960 + w / 2 - 92) + 'px', top: Math.round(CY - 40 * X + 92) + 'px' }));
}, { settle: 2200 });
