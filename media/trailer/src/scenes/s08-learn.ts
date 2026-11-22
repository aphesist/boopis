/* 8. They learn (bars 29 to 31). moss finishes a flaky test hunt and writes down how, as a skill of its own; later it
   refines the skill; what you told it stays as memory. */
import { ui } from '@boopis/ui';
import type { SceneDef } from '../engine/stage';
import { el, line, kinetic, put } from '../engine/stage';
import { EASE, SPRING, step, clamp, lerp } from '../engine/motion';
import { bar, sfx, orb, call } from '../engine/common';

const T0 = bar(29), T_DONE = T0 + 1.2, T_SKILL = T0 + 1.3, T_SAVED = T0 + 3.0, T_REFINE = T0 + 3.6, T_MEM = bar(31), T_END = bar(32);
const LINES = ['When a test fails only sometimes:', '1. Rerun it 20 times.', '2. Pin the clock and the seed.', '3. Then touch the code.'];
const MEM = ['you prefer draft PRs', 'invoices round once', 'staging before production'];

export const learn: SceneDef = {
  id: 'learn', start: T0, end: T_END,
  setup(root, ctx) {
    const m = orb('moss', 320, { state: 'working' });
    root.append(m.wrap); m.wrap.classList.add('abs');
    const who = el('div', 'abs ln__who', root, `<b>moss</b><span>flaky test hunter</span>`);
    const task = el('div', 'abs ln__task', root, `<span class="ln__t">invoice.test.ts fails only after midnight UTC</span><span class="ln__st">working</span>`);
    const st = task.querySelector('.ln__st') as HTMLElement;
    const card = el('div', 'plate ln__card', root); card.style.transformOrigin = '0 0';
    card.innerHTML = `<div class="ln__path">skills/flaky-tests/SKILL.md</div><div class="ln__title">Flaky tests</div><div class="ln__body"></div><div class="ln__foot"><span class="ui-badge ln__saved">saved to moss’s skills</span><span class="ui-badge ln__ref">refined</span></div>`;
    const body = card.querySelector('.ln__body') as HTMLElement;
    const lineEls = LINES.map((s) => el('div', 'ln__line', body, ''));
    const add = el('div', 'ln__line ln__add', undefined, '+ Check the time zone first.');
    body.insertBefore(add, lineEls[1]!);
    const saved = card.querySelector('.ln__saved') as HTMLElement, ref = card.querySelector('.ln__ref') as HTMLElement;
    const mems = MEM.map((s) => el('div', 'abs ln__mem', root, `<span class="ln__memk">remembers</span><span>${s}</span>`));
    const heads = [line('they learn on the job.', 'h2', root), line('and they remember.', 'h2', root)];

    ctx.at(T_DONE, () => call(m.orb, 'react', 'done')); sfx(T_DONE, 'tick');
    ctx.at(T_SAVED, () => call(m.orb, 'react', 'happy'));
    ctx.at(T_MEM, () => call(m.orb, 'react', 'listening'));
    sfx(T0, 'arp', { soft: true });
    let chars = 0; LINES.forEach((s) => { for (let i = 0; i < s.length; i += 3) sfx(T_SKILL + (chars + i) / 52, 'pen'); chars += s.length; });
    sfx(T_SAVED, 'chime'); sfx(T_REFINE, 'chime', { bright: true });
    MEM.forEach((_, i) => sfx(T_MEM + 0.2 + i * 0.35, 'note', { n: i }));
    const total = LINES.reduce((a, s) => a + s.length, 0);
    void total;
    return (t) => {
      const inP = step(t, T0, 0.7, SPRING), out = step(t, T_END - 0.35, 0.3, EASE);
      put(m.wrap, lerp(460, 500, inP), 520, lerp(0.92, 1, inP), inP * (1 - out));
      put(who, 500, 720, 1, step(t, T0 + 0.2, 0.5, SPRING) * (1 - out));
      put(task, 500, 812, 1, step(t, T0 + 0.35, 0.5, SPRING) * (1 - out) * (1 - step(t, T_MEM - 0.3, 0.3, EASE)));
      st.textContent = t >= T_DONE ? 'done' : 'working'; st.classList.toggle('is-done', t >= T_DONE);
      /* the skill writes itself */
      const cp = step(t, T_SKILL - 0.2, 0.6, SPRING), up = step(t, T_MEM - 0.2, 0.6, SPRING);
      card.style.transform = `translate(${lerp(900, 860, cp)}px, ${lerp(230, 160, up)}px) scale(1.6)`;
      card.style.opacity = String(cp * (1 - out));
      let used = 0;
      LINES.forEach((s, i) => {
        const n = clamp(Math.floor((t - T_SKILL) * 52) - used, 0, s.length);
        lineEls[i]!.textContent = s.slice(0, n) || ' ';
        lineEls[i]!.style.opacity = n > 0 ? '1' : '0';
        used += s.length;
      });
      const sp = step(t, T_SAVED, 0.4, SPRING);
      saved.style.opacity = String(sp); saved.style.transform = `translateY(${(1 - sp) * 6}px)`;
      const rp = step(t, T_REFINE, 0.55, SPRING);
      add.style.height = (rp * 30) + 'px'; add.style.opacity = String(clamp((rp - 0.3) / 0.7));
      ref.style.opacity = String(step(t, T_REFINE + 0.2, 0.4, SPRING));
      /* memory */
      mems.forEach((e, i) => {
        const p = step(t, T_MEM + 0.2 + i * 0.35, 0.55, SPRING);
        put(e, 1308, 760 + i * 80 + (1 - p) * 16, 1, p * (1 - out));
        e.style.visibility = t >= T_MEM ? 'visible' : 'hidden';
      });
      kinetic(heads[0]!, t, T0 + 0.1, T_MEM - 0.25); kinetic(heads[1]!, t, T_MEM, T_END - 0.3);
      heads.forEach((h) => { h.style.left = '50%'; h.style.translate = '-50% 0'; h.style.top = '60px'; });
      void ui;
    };
  }
};
