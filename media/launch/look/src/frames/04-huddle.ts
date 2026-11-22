/* 04 The huddle folds. The bots' talk among themselves files away into one line, the way cards go back into a drawer: the
   folded entry sits in the room (the real huddleEntry from modules/bots/huddle.ts, folded), and the three messages it holds
   (the real huddleMessage, each on a card) slide up under the room's edge, the last one still in view. The two ends are the
   product's own states, open and folded; the filing between them is the film's move (a T1 hand-off on travel). */
import { BOTS, filmUI, frame, h, sharpenOrbs } from '../stage';
import { SCENE_CSS, T, botEntry, huddle, huddleDeps, huddleMessage } from '../scenes/parts';

frame((s) => {
  s.style.setProperty('--pool-x', '50%');
  s.style.setProperty('--pool-y', '64%');
  s.style.setProperty('--pool-w', '70%');
  s.style.setProperty('--pool-h', '84%');
  s.style.setProperty('--pool', 'var(--bg-3)');
  s.append(h('style', '', SCENE_CSS + `
    .fold-card { position: absolute; left: 0; right: 0; border-radius: 30px; box-shadow: inset 0 1px 0 var(--plate-edge), 0 24px 60px rgba(0,0,0,.42), 0 2px 6px rgba(0,0,0,.35); overflow: hidden; }
    .fold-card .ui-film { padding: 10px 14px 12px; }
    .fold-card .bt-hmsg::after { display: none; }
    .fold-stack { position: absolute; z-index: 1; left: 330px; width: 1260px; top: 0; height: 1080px; }
    .room-slot { position: absolute; z-index: 2; }
  `));

  /* the room, holding the folded line: a plate whose lower edge is the drawer's slot */
  const slotY = 516;
  s.append(h('div', 'plate plate--room room-slot', '', { left: '250px', top: '-60px', width: '1420px', height: (slotY + 60) + 'px' }));
  /* the hand-off it came from, above, out of focus */
  const prev = filmUI(botEntry(BOTS.kai, T.kai1[0], T.kai1[1], [...T.kai1[2]]), { x: 330, y: -50, width: 446 });
  prev.outer.classList.add('dof-1'); prev.outer.style.zIndex = '3';
  s.append(prev.outer);
  const e = filmUI(huddle(T.huddle, false), { x: 330, y: 262, width: 446 });
  e.outer.style.zIndex = '3';
  s.append(e.outer);

  /* the three messages on cards, filing up under the slot: card edges only where a cut would fall through no text; the
     first shows its padding, the second its head, the last is whole */
  const stack = h('div', 'fold-stack');
  const H = 206;
  const shown = [{ top: slotY + 22 - H, inset: 36 }, { top: slotY + 22, inset: 18 }, { top: slotY + 124, inset: 0 }];
  T.huddle.forEach((m, i) => {
    const card = h('div', 'fold-card', '', { top: shown[i]!.top + 'px', height: H + 'px', left: shown[i]!.inset + 'px', right: shown[i]!.inset + 'px', 'z-index': String(i + 1),
      background: 'color-mix(in oklab, var(--bg-3) ' + [70, 85, 100][i] + '%, var(--bg-2))' });
    const inner = h('div', 'ui-film', '', { '--ui-x': '3' });
    inner.append(huddleMessage(m, huddleDeps));
    card.append(inner);
    sharpenOrbs(inner, 3);
    stack.append(card);
  });
  s.append(stack);
}, { settle: 2200 });
