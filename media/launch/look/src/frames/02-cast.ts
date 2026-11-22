/* 02 The cast (SC/script/cast.md): the plans you already pay for, seated at one table as four bots, each with its face, its
   name, the role the app ships it with, and its lab's own mark and name. No headline: the labels are the type, each anchored
   under its orb. The faces differ by state, so the four read as characters, not as icons in a row. */
import { BOTS, frame, h, labLine, orb } from '../stage';
import type { FilmBot } from '../stage';

frame((s) => {
  s.style.setProperty('--pool-x', '50%');
  s.style.setProperty('--pool-y', '58%');
  s.style.setProperty('--pool-w', '82%');
  s.style.setProperty('--pool-h', '74%');

  /* one table line, one size: kai and nina look at each other, moss is pleased, vox looks out at us */
  const cast: Array<[FilmBot, number, string, [number, number]]> = [
    [BOTS.kai, 330, 'idle', [16, -2]],
    [BOTS.nina, 750, 'listening', [-16, -2]],
    [BOTS.moss, 1170, 'happy', [0, 0]],
    [BOTS.vox, 1590, 'idle', [-4, 2]]
  ];
  const y = 440, size = 280;
  for (const [b, x, reaction, gaze] of cast) {
    s.append(orb(b, { size, x, y, reaction, gaze, still: true }));
    s.append(h('div', 'cast-label',
      '<span class="t t--name">' + b.name + '</span><span class="t t--label">' + b.role + '</span><span class="cast-lab">' + labLine(b) + '</span>', {
        position: 'absolute', left: (x - 210) + 'px', width: '420px', top: (y + size / 2 + 78) + 'px',
        display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '6px', 'text-align': 'center'
      }));
  }
  s.append(h('style', '', '.cast-lab { margin-top: 18px; } .cast-lab .lab { color: var(--text); }'));
});
