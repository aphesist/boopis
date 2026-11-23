/* 05 Needs you. The one red in the film's grammar: a bot turns to you. nina, close, her needs face and the attention flag
   (the product's 8px dot with its ring of the surface, scaled with the orb); the rest of the team out of focus behind,
   looking at it. Beside it the product's own words for it, at 3x: its name, the stamp, the ask, and the hold button
   caught mid-hold. Red marks only what is owed (the stamp rule); the light under nina warms toward it. nina's own colour is
   rose, so the flag's ring is cut through her body to the ground, and the stamp says it in words. */
import { ui } from '@boopis/ui';
import { BOTS, filmUI, frame, h, orb } from '../stage';
import { holdAt } from '../scenes/parts';

frame((s) => {
  s.style.setProperty('--pool-x', '34%');
  s.style.setProperty('--pool-y', '62%');
  s.style.setProperty('--pool-w', '64%');
  s.style.setProperty('--pool-h', '80%');
  s.style.setProperty('--pool', 'var(--lamp-red)');
  s.append(h('style', '', `
    .ask { position: absolute; left: 1120px; top: 300px; width: 700px; display: flex; flex-direction: column; align-items: flex-start; }
    .ask__who { display: flex; align-items: baseline; gap: 26px; }
    .ask .t--head { margin-top: 30px; font-size: 76px; }
  `));

  /* the team, a layer back and out of focus, turned toward nina */
  const far: Array<[keyof typeof BOTS, number, number, [number, number]]> = [['kai', 1300, 176, [-30, -6]], ['moss', 1560, 158, [-32, -6]], ['vox', 1800, 196, [-34, -6]]];
  for (const [id, x, y, gaze] of far) {
    const o = orb(BOTS[id], { size: 128, x, y, reaction: 'listening', gaze, still: true, shadow: false });
    o.style.filter = 'blur(9px) var(--haze)';   /* two layers back: out of focus, and out of the lamp's reach */
    s.append(o);
  }

  /* nina, close */
  s.append(orb(BOTS.nina, { size: 540, x: 620, y: 560, reaction: 'needs', gaze: [0, 2], flag: true, still: true, ring: 'var(--bg-2)' }));

  /* its words, anchored beside it */
  const ask = h('div', 'ask');
  ask.innerHTML = '<div class="ask__who"><span class="t t--name" style="font-size:64px">nina</span></div>';
  const stamp = filmUI(ui.html.stamp('needs you'), { x: 0, y: 0, scale: 3.4 });
  stamp.outer.style.position = 'relative';
  ask.querySelector('.ask__who')!.append(stamp.outer);
  ask.append(h('p', 't t--head', 'nina wants to deploy to staging'));
  const hold = filmUI(ui.html.hold({ label: 'Hold to approve' }), { x: 0, y: 0, scale: 3.4, cls: 'hold-mid' });
  hold.outer.style.position = 'relative';
  hold.outer.style.marginTop = '56px';
  ask.append(hold.outer);
  s.append(ask);
  holdAt(hold.outer.querySelector<HTMLElement>('.ui-hold')!, 0.55, 3.4);
}, { settle: 2000 });
