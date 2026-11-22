/* 11. The eyes go home (bars 39 to 42, and a tail). The eleven bots return in a ring and converge into one pair of
   eyes; the wordmark opens out of them, and the logo has its one big moment: the playful letters. Then the line. */
import type { SceneDef } from '../engine/stage';
import { el, line, kinetic, put } from '../engine/stage';
import { EASE, SPRING, EASE_IO, step, clamp, lerp } from '../engine/motion';
import { bar, sfx, orb, ROSTER, call } from '../engine/common';

export const T_TOTAL = bar(43) + 1.0;
const T0 = bar(39), T_EYES = T0 + 1.8, T_WORD = bar(40), T_PLAY = T_WORD + 0.6, T_LINE = bar(41), T_FADE = T_TOTAL - 0.4;
const F = 250;                       /* the wordmark's type size */
const MARK_W = 1.13 * F;             /* about the wordmark's own eyes: a mark of width W has a type size of W / 1.156 (brand/logo/README.md) */
const EYE_DX = 0.401 * F;            /* the eyes' midpoint sits left of the wordmark's centre by this much (measured) */
type Logo = HTMLElement & { blink(): void; look(x?: number, y?: number): void; play(s: unknown, o?: unknown): Promise<unknown>; morph(s: unknown): void };

export const finale: SceneDef = {
  id: 'finale', start: T0, end: T_TOTAL,
  setup(root, ctx) {
    const orbs = ROSTER.map((id) => { const o = orb(id, 180); o.wrap.classList.add('abs'); root.append(o.wrap); return o; });
    const mark = el('boopis-logo' as 'div', 'abs', root) as Logo;
    mark.setAttribute('mark', ''); mark.setAttribute('blink', 'off'); mark.setAttribute('gaze', 'off');
    mark.style.width = MARK_W + 'px'; mark.style.color = 'var(--text-strong)';
    const word = el('boopis-logo' as 'div', 'abs', root) as Logo;
    word.setAttribute('letters', 'play'); word.setAttribute('blink', 'off'); word.setAttribute('gaze', 'off');
    word.style.fontSize = F + 'px'; word.style.color = 'var(--text-strong)';
    const tag = line('AI coding agents. you stay in charge.', 'h3 dim', root);
    tag.dataset['v'] = 'bottom';
    const black = el('div', 'abs fin__black', root);

    ROSTER.forEach((_, i) => sfx(T0 + 0.05 * i, 'shimmer', { n: i, soft: true }));
    sfx(T_EYES - 0.5, 'suck'); sfx(T_EYES, 'stop');
    sfx(T_WORD, 'boop'); sfx(T_PLAY, 'blip', { n: 0 }); sfx(T_PLAY + 0.9, 'blip', { n: 1 }); sfx(T_PLAY + 2.1, 'blip', { n: 2 }); sfx(T_PLAY + 3.5, 'blip', { n: 3 });
    sfx(T_LINE, 'final');
    ctx.at(T0 + 0.6, () => orbs.forEach((o) => call(o.orb, 'react', 'happy')));
    ctx.at(T_EYES + 0.25, () => mark.blink());
    ctx.at(T_PLAY, () => { void word.play([{ state: 'listening', hold: 0.9 }, { state: 'thinking', hold: 1.2 }, { state: 'happy', hold: 1.4, blink: 1.0 }, { state: 'idle', hold: 0.6 }], { morphDuration: 0.38 }); });
    ctx.at(T_LINE + 1.6, () => word.blink());
    ctx.at(T_LINE + 2.2, () => { word.removeAttribute('gaze'); word.removeAttribute('blink'); });

    return (t) => {
      /* the ring: in from beyond the frame, a turn, then into the centre */
      const come = step(t, T0, 1.0, SPRING), conv = step(t, T0 + 1.1, 0.75, EASE_IO);
      orbs.forEach((o, i) => {
        const a = (i / orbs.length) * Math.PI * 2 - Math.PI / 2 + lerp(0.9, 0, come) + conv * 0.8;
        const r = lerp(980, 390, come) * (1 - conv);
        put(o.wrap, 960 + Math.cos(a) * r * 1.25, 540 + Math.sin(a) * r * 0.82, lerp(0.75, 0.62, come) * lerp(1, 0.08, conv), 1 - clamp((conv - 0.75) / 0.25));
        o.wrap.style.visibility = conv < 1 ? 'visible' : 'hidden';
      });
      /* the eyes, then the wordmark grows out of them */
      const mIn = step(t, T_EYES - 0.25, 0.35, EASE), mOut = step(t, T_WORD, 0.18, EASE);
      put(mark, 960, 540, 1, mIn * (1 - mOut));
      mark.style.visibility = t >= T_EYES - 0.3 && t < T_WORD + 0.3 ? 'visible' : 'hidden';
      const rev = step(t, T_WORD, 0.7, SPRING), slide = step(t, T_WORD + 0.1, 0.9, SPRING);
      put(word, 960 + EYE_DX * (1 - slide), 534, 1, clamp((t - T_WORD) / 0.12));
      word.style.visibility = t >= T_WORD ? 'visible' : 'hidden';
      const l = lerp(19, -8, rev), r = lerp(45, -8, rev);
      word.style.clipPath = rev < 1 ? `inset(-30% ${r}% -30% ${l}%)` : 'none';
      /* the line, far below, on its own beat */
      kinetic(tag, t, T_LINE, T_TOTAL + 1, { stagger: 0.07 });
      tag.style.left = '50%'; tag.style.translate = '-50% 0'; tag.style.top = '820px';
      black.style.opacity = String(step(t, T_FADE, 0.4, EASE));
    };
  }
};
