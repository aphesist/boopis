/* 1. Cold open (bars 1 to 4): two eyes in the dark. The boopis mark fades in, blinks, glances, and becomes noct's face;
   noct rises and the first line arrives. */
import type { SceneDef } from '../engine/stage';
import { el, line, kinetic, put } from '../engine/stage';
import { EASE, SPRING, step, clamp, lerp } from '../engine/motion';
import { bar, orb, call, sfx } from '../engine/common';

type Logo = HTMLElement & { blink(): void; look(x?: number, y?: number): void; morph(s: string | null): void };

export const open: SceneDef = {
  id: 'open', start: 0, end: bar(5),
  setup(root, ctx) {
    const mark = el('boopis-logo' as 'div', 'abs', root) as Logo;
    mark.setAttribute('mark', ''); mark.setAttribute('blink', 'off'); mark.setAttribute('gaze', 'off');
    mark.style.width = '300px'; mark.style.color = 'var(--text-strong)';
    const n = orb('noct', 760, { state: 'idle', mode: 'fixed' });
    n.orb.setAttribute('gaze', '0 0');
    root.append(n.wrap); n.wrap.classList.add('abs');
    const h = line('meet your team.', 'h1', root);

    ctx.at(1.8, () => mark.blink()); sfx(1.8, 'tick');
    ctx.at(2.4, () => mark.look(-0.9, 0)); sfx(2.4, 'swish', { pan: -0.5 });
    ctx.at(3.3, () => mark.look(0.9, 0.25)); sfx(3.3, 'swish', { pan: 0.5 });
    ctx.at(4.2, () => mark.look(0, 0));
    ctx.at(4.45, () => mark.morph('tall'));
    ctx.at(6.0, () => call(n.orb, 'blink')); sfx(6.0, 'tick');
    ctx.at(6.3, () => call(n.orb, 'react', 'listening'));
    sfx(0, 'drone'); sfx(0.6, 'shimmer'); sfx(4.8, 'open');
    sfx(bar(4), 'hit', { chord: 0 });
    return (t) => {
      /* the mark: in at 0.6, then it hands over to noct's face from 4.8 */
      const markIn = step(t, 0.6, 0.6, EASE), fit = step(t, 4.4, 0.6, SPRING), hand = step(t, 5.05, 0.3, EASE);
      put(mark, 960, 540, lerp(1, 0.82, fit), markIn * (1 - hand));
      /* noct: its face lands where the mark was; the camera eases back while the body grows out of the dark */
            const rise = step(t, bar(4) - 0.2, 0.9, SPRING), away = step(t, bar(5) - 0.6, 0.8, SPRING);
      const s = lerp(0.737, 0.55, step(t, 5.4, 1.8, SPRING)) * lerp(1, 0.56, away);
      const y = 540 - rise * 150 + away * 150;
      put(n.wrap, 960, y + 0.015 * 760 * s, s, clamp((t - 4.8) / 0.6));
      n.wrap.style.visibility = t >= 4.75 ? 'visible' : 'hidden';
      kinetic(h, t, bar(4), bar(5) - 0.6);
      h.style.left = '50%'; h.style.top = '640px'; h.style.translate = '-50% 0';
    };
  }
};
