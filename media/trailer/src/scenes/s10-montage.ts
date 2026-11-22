/* 10. Everything else, fast (bars 35 to 38): forms, mods, the four themes, keyboard first, local. Half-bar cuts. */
import { ui } from '@boopis/ui';
import type { SceneDef } from '../engine/stage';
import { el, line, kinetic, put } from '../engine/stage';
import { EASE, SPRING, EASE_IO, step, clamp, lerp } from '../engine/motion';
import { bar, BEAT, sfx, crispOrbs, orb } from '../engine/common';
import { appWindow, slab } from '../engine/app';

const T0 = bar(35), T_ANS = T0 + 1.2, T_MOD = T0 + 2.4, T_TH = T0 + 3.6, T_KEY = T0 + 6.0, T_LOCAL = T0 + 7.8, T_END = bar(39);
const PRESETS = ['catalog', 'graphite', 'bone', 'typewriter'];
const KEYS = [['ctrl+k', 'Command palette'], ['alt+m', 'Who answers next'], ['alt+c', 'Ask a council'], ['alt+g', 'Governed'], ['alt+v', 'Talk']];

export const montage: SceneDef = {
  id: 'montage', start: T0, end: T_END,
  setup(root, ctx) {
    /* forms */
    const fw = el('div', 'abs mo__form', root); fw.style.width = '560px'; fw.style.transformOrigin = '50% 0';
    const form = ui.card('form', { id: 'f-round', kind: 'question', origin: { kind: 'teammate', ids: ['atlas'] }, title: 'How should line items round?', why: 'invoice.ts:88 divides before rounding. Pick a rule and I will apply it to every line item.',
      schema: { properties: { rule: { type: 'string', title: 'Rounding rule', enum: ['half-away', 'half-even', 'none'], enumNames: ['Half away from zero', 'Half to even', 'Do not round line items'], 'x-other': true } }, required: ['rule'] } }, { size: 'inline', enter: false });
    fw.append(form); crispOrbs(fw, 1.9);
    /* mods: a composer that rises for a mod's status line */
    const mw = el('div', 'abs mo__mod', root); mw.style.width = '720px'; mw.style.transformOrigin = '0 0';
    const band = el('div', 'mo__band', mw, `${ui.html.mod('coverage')}<span class="mo__bt">coverage 91%, up 2 since main</span><span class="mo__dots"></span>`);
    const dots = band.querySelector('.mo__dots') as HTMLElement;
    for (let i = 0; i < 10; i++) el('i', 'mo__dot', dots);
    const mcomp = ui.composer({ placeholder: 'Describe the change', spend: { spent: '$0.12', cap: '$0.60' }, chips: [{ label: 'Governed', pressed: true }, { label: 'Smart', pressed: true }] });
    const mc = el('div', 'mo__mc', mw); mc.append(mcomp);
    /* themes: four copies of one window, each in its preset, wiped in on the beats */
    const th = el('div', 'abs mo__themes', root);
    const wins = PRESETS.map((p) => {
      const layer = el('div', 'mo__layer', th); layer.setAttribute('data-hx-preset', p);
      if (p === 'bone') layer.setAttribute('data-hx-theme', 'light');
      const a = appWindow(layer, 1280, 720, { title: 'proration drift in src/billing' });
      a.win.style.transform = 'translate(0, 0)';
      const d = slab(layer); d.set(560, 76); d.el.style.transform = `translate(${772 - 280}px, ${720 - 76}px)`;
      ['atlas', 'nina', 'kai', 'iris', 'hex', 'sol', 'noct', 'terra', 'nimbus', 'vox'].forEach((id, i) => {
        const o = orb(id, 40, { state: id === 'nina' ? 'needs' : undefined }); o.wrap.classList.add('abs');
        o.wrap.style.transform = `translate(${772 - 280 + 26 + i * 54 - 20}px, ${720 - 50 - 20}px)`;
        layer.append(o.wrap);
      });
      const name = el('div', 'mo__pname', layer, p === 'catalog' ? 'Card catalog' : p[0]!.toUpperCase() + p.slice(1));
      return { layer, a, name };
    });
    /* keyboard */
    const kb = el('div', 'abs mo__keys', root);
    const krows = KEYS.map(([k, label]) => el('div', 'mo__krow', kb, `<span class="mo__kc">${ui.html.keys(k!)}</span><span class="mo__kl">${label}</span>`));
    /* local */
    const loc = el('div', 'abs mo__local', root, `<svg width="900" height="560" viewBox="0 0 900 560"><rect class="mo__scr" x="90" y="10" width="720" height="460" rx="26" fill="none" stroke="var(--line-strong)" stroke-width="3"/><path class="mo__base" d="M 10 520 L 890 520 L 860 550 L 40 550 Z" fill="none" stroke="var(--line-strong)" stroke-width="3" stroke-linejoin="round"/></svg>`);
    const scr = loc.querySelector('.mo__scr') as SVGRectElement, base = loc.querySelector('.mo__base') as SVGPathElement;
    const mini = el('div', 'abs mo__mini', loc); const ma = appWindow(mini, 1280, 760); ma.win.style.transform = 'translate(0,0)';
    const keych = el('div', 'abs mo__note', root, 'its engine, your keys and your sessions stay on this computer');
    const heads = [line('one card for anything it needs.', 'h2', root), line('mods.', 'h2', root), line('four themes.', 'h2', root), line('keyboard first.', 'h2', root), line('runs on your machine.', 'h2', root)];
    const HS: Array<[number, number]> = [[T0 + 0.05, T_MOD - 0.2], [T_MOD, T_TH - 0.15], [T_TH, T_KEY - 0.2], [T_KEY, T_LOCAL - 0.2], [T_LOCAL, T_END - 0.2]];

    sfx(T0, 'flip'); sfx(T_ANS - 0.1, 'click');
    sfx(T_MOD, 'arp', { quick: true }); sfx(T_MOD + 0.35, 'tick');
    [0, 1, 2, 3].forEach((i) => sfx(T_TH + i * BEAT * (i ? 1 : 0), i ? 'swish' : 'cut', { n: i }));
    KEYS.forEach((_, i) => sfx(T_KEY + 0.1 + i * 0.3, 'thock', { n: i }));
    sfx(T_LOCAL, 'pad'); sfx(T_LOCAL + 0.1, 'draw');
    ctx.at(T_ANS - 0.1, () => { const o = [...form.querySelectorAll<HTMLElement>('[role="radio"], .ui-opt, button')].find((b) => /Half to even/.test(b.textContent ?? '')); o?.click(); });

    return (t) => {
      /* forms: a flip up into place */
      const fon = t >= T0 && t < T_MOD;
      fw.style.visibility = fon ? 'visible' : 'hidden';
      if (fon) {
        const f = step(t, T0, 0.5, SPRING);
        fw.style.transform = `translate(${960 - 280}px, 300px) perspective(1400px) rotateX(${(1 - f) * -70}deg) scale(1.9)`;
        fw.style.opacity = String(clamp(f * 2) * (1 - step(t, T_MOD - 0.15, 0.15, EASE)));
      }
      /* mods: the band appears, the composer rises 22px (a FLIP on transform, --dur-3 on --spring) */
      const mon = t >= T_MOD - 0.05 && t < T_TH;
      mw.style.visibility = mon ? 'visible' : 'hidden';
      if (mon) {
        const mi = step(t, T_MOD - 0.05, 0.4, SPRING), rise = step(t, T_MOD + 0.35, 0.3, SPRING);
        mw.style.transform = `translate(${960 - 360 * 2}px, ${520 + (1 - mi) * 20}px) scale(2)`;
        mw.style.opacity = String(mi * (1 - step(t, T_TH - 0.12, 0.12, EASE)));
        mc.style.transform = `translateY(${-22 * rise}px)`;
        band.style.opacity = String(step(t, T_MOD + 0.4, 0.2, EASE)); band.style.transform = `translateY(${-22 * rise + (1 - rise) * 6}px)`;
        const fillN = Math.round(10 * clamp((t - T_MOD - 0.5) / 0.6) * 0.91);
        dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < fillN));
      }
      /* themes: diagonal wipes on the beats */
      const ton = t >= T_TH - 0.05 && t < T_KEY;
      th.style.visibility = ton ? 'visible' : 'hidden';
      if (ton) {
        const ti = step(t, T_TH - 0.05, 0.45, SPRING), push = lerp(1, 1.05, clamp((t - T_TH) / 2.4));
        th.style.transform = `translate(960px, ${610 + (1 - ti) * 30}px) scale(${1.02 * push}) translate(-640px, -360px)`;
        th.style.opacity = String(ti * (1 - step(t, T_KEY - 0.15, 0.15, EASE)));
        wins.forEach((w, i) => {
          const at = T_TH + i * BEAT;
          const p = i === 0 ? 1 : step(t, at, 0.42, EASE_IO);
          const x = lerp(-30, 130, p);
          w.layer.style.clipPath = i === 0 ? 'none' : `polygon(0 0, ${x}% 0, ${x - 30}% 100%, 0 100%)`;
          w.layer.style.visibility = i === 0 || t >= at ? 'visible' : 'hidden';
          const np = step(t, at + 0.1, 0.3, SPRING) * (i < 3 ? 1 - step(t, at + BEAT, 0.15, EASE) : 1);
          w.name.style.opacity = String(np);
        });
      }
      /* keyboard */
      const kon = t >= T_KEY - 0.05 && t < T_LOCAL;
      kb.style.visibility = kon ? 'visible' : 'hidden';
      if (kon) {
        kb.style.opacity = String(1 - step(t, T_LOCAL - 0.12, 0.12, EASE));
        krows.forEach((r, i) => { const p = step(t, T_KEY + 0.1 + i * 0.3, 0.35, SPRING); r.style.opacity = String(p); r.style.transform = `translateX(${(1 - p) * -30}px) scale(${lerp(1.1, 1, p)})`; });
      }
      /* local */
      const lon = t >= T_LOCAL - 0.05;
      loc.style.visibility = lon ? 'visible' : 'hidden';
      keych.style.visibility = lon ? 'visible' : 'hidden';
      if (lon) {
        const d = step(t, T_LOCAL, 0.8, EASE_IO), out = step(t, T_END - 0.3, 0.3, EASE);
        scr.style.strokeDasharray = '2400'; scr.style.strokeDashoffset = String(2400 * (1 - d));
        base.style.strokeDasharray = '1900'; base.style.strokeDashoffset = String(1900 * (1 - step(t, T_LOCAL + 0.3, 0.6, EASE_IO)));
        put(loc, 960, 600, 1, 1 - out);
        const wi = step(t, T_LOCAL + 0.55, 0.5, SPRING);
        mini.style.transform = `translate(110px, ${30 + (1 - wi) * 30}px) scale(${0.53})`; mini.style.opacity = String(wi);
        put(keych, 960, 935, 1, step(t, T_LOCAL + 0.7, 0.4, SPRING) * (1 - out));
      }
      heads.forEach((h, i) => { kinetic(h, t, HS[i]![0], HS[i]![1], { outDur: 0.12 }); h.style.left = '50%'; h.style.translate = '-50% 0'; h.style.top = '110px'; });
    };
  }
};
