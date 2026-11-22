/* 9. One store for every source (bars 32 to 34). Unnamed sources gather from the edges into one store: search,
   Recommended, the tier words; "changelog" is searched, and an install ends on the one-second hold. */
import { ui } from '@boopis/ui';
import type { SceneDef } from '../engine/stage';
import { el, line, kinetic, put } from '../engine/stage';
import { EASE, SPRING, EASE_IO, step, clamp, lerp, noise } from '../engine/motion';
import { bar, sfx, pointer } from '../engine/common';

const T0 = bar(32), T_MERGE = T0 + 1.2, T_SEARCH = T0 + 3.4, T_PICK = T0 + 4.4, T_PRESS = T0 + 5.0, T_DONE = T_PRESS + 1.0, T_END = bar(35);
const GLYPHS = ['folder', 'fork', 'archive', 'mod', 'spark', 'file', 'slash', 'gear', 'copy', 'sliders', 'folder', 'fork', 'spark', 'mod'];
const NAMES = ['your folder', 'a repository', 'a registry', 'a marketplace', 'a skills hub', 'a link', '', 'a catalogue', '', '', '', 'a repository', '', 'a plugin store'];
const ITEMS = [
  ['spark', 'changelog-writer', 'Drafts release notes from merged work', 'Skill', 'Recommended by boopis'],
  ['mod', 'coverage-band', 'Coverage in the band above the composer', 'Mod', 'Recommended by boopis'],
  ['archive', 'sql-explain', 'Reads query plans, suggests indexes', 'Connector', 'Verified by its source'],
  ['spark', 'license-check', 'Flags dependencies with new licences', 'Skill', 'Verified by its source'],
  ['slash', 'release-commands', 'Tag, notes and publish as commands', 'Plugin', 'Not reviewed'],
  ['file', 'screenshot-diff', 'Compares screens before and after', 'Skill', 'Not reviewed']
];
const K = 1.3;

export const store: SceneDef = {
  id: 'store', start: T0, end: T_END,
  setup(root, ctx) {
    const tiles = GLYPHS.map((g, i) => {
      const e = el('div', 'abs st__src', root, String(ui.icon(g, { size: 'l' })) + (NAMES[i] ? `<span class="st__srcn">${NAMES[i]}</span>` : ''));
      const a = (i / GLYPHS.length) * Math.PI * 2 + 0.3;
      return { e, x: 960 + Math.cos(a) * (760 + 70 * noise(i)), y: 590 + Math.sin(a) * (330 + 40 * noise(i + 9)), d: 0.25 * (0.5 + 0.5 * noise(i * 3.1)) };
    });
    const win = el('div', 'plate st', root); win.style.transformOrigin = '0 0';
    win.innerHTML = `<div class="st__head"><span class="st__title">Store</span><div class="st__search"></div></div><div class="st__chips"></div><div class="st__h">Recommended</div><div class="st__grid"></div>`;
    win.querySelector('.st__search')!.innerHTML = ui.html.search({ size: 'm', placeholder: 'Search skills, connectors, plugins and mods' } as never);
    const chips = win.querySelector('.st__chips') as HTMLElement;
    ['All', 'Skills', 'Connectors', 'Plugins', 'Mods'].forEach((c, i) => chips.insertAdjacentHTML('beforeend', ui.html.chip({ label: c, option: true, pressed: i === 0 } as never)));
    const grid = win.querySelector('.st__grid') as HTMLElement;
    const cards = ITEMS.map(([g, name, sum, kind, tier]) => el('div', 'st__item', grid, `<span class="st__ic">${ui.icon(g!, { size: 'm' })}</span><div class="st__txt"><b>${name}</b><span>${sum}</span><div class="st__meta"><span>${kind}</span><span class="st__tier" data-t="${tier!.startsWith('Rec') ? 'r' : tier!.startsWith('Ver') ? 'v' : 'n'}">${tier}</span></div></div>`));
    const input = win.querySelector('input') as HTMLInputElement | null;
    /* the install card */
    const inst = el('div', 'plate st__inst', root); inst.style.transformOrigin = '0 0';
    inst.innerHTML = `<div class="st__ititle">Install changelog-writer?</div><div class="st__isub">Skill, Recommended by boopis</div>
      <dl class="st__dl"><dt>Pinned to</dt><dd>a3f9c21</dd><dt>Runs code</dt><dd>yes, from your next session</dd><dt>Network</dt><dd>none</dd></dl><div class="st__ifoot"></div>`;
    const holdBtn = ui.hold({ label: 'Hold to install' } as never) as HTMLElement;
    const cancel = ui.button({ label: 'Not now', variant: 'ghost' });
    inst.querySelector('.st__ifoot')!.append(cancel, holdBtn);
    const doneMsg = el('div', 'st__done', inst, 'Installed. Your next session has it.');
    const foot = inst.querySelector('.st__ifoot') as HTMLElement;
    ctx.at(T_DONE + 0.3, () => { foot.innerHTML = `<span class="st__rec">${ui.icon('check', { size: 's' })}Installed at 14:31</span>`; });
    const ptr = pointer(root);
    const heads = [line('every source.', 'h2', root), line('one store.', 'h2', root)];

    tiles.forEach((tl, i) => sfx(T0 + 0.05 + i * 0.05, 'sparkle', { n: i }));
    sfx(T_MERGE - 0.1, 'whoosh', { dir: 'in' }); sfx(T_MERGE + 0.45, 'hit', { n: 1, low: true });
    'changelog'.split('').forEach((_, i) => sfx(T_SEARCH + i * 0.06, 'key', { n: i }));
    sfx(T_PICK, 'click'); sfx(T_PICK + 0.05, 'menu'); sfx(T_PRESS, 'hold', { len: 1.0 }); sfx(T_DONE, 'chime');
    const press = (type: string): void => { holdBtn.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, button: 0 })); };
    ctx.at(T_PRESS, () => press('pointerdown')); ctx.at(T_DONE + 0.05, () => press('pointerup'));
    return (t) => {
      /* the sources */
      tiles.forEach((tl, i) => {
        const pin = step(t, T0 + 0.05 + i * 0.05, 0.45, SPRING);
        const m = step(t, T_MERGE + tl.d, 0.55, EASE_IO);
        put(tl.e, lerp(tl.x, 960, m), lerp(tl.y, 560, m), lerp(1, 0.3, m) * lerp(0.7, 1, pin), pin * (1 - clamp((m - 0.7) / 0.3)));
        tl.e.style.visibility = m < 1 ? 'visible' : 'hidden';
      });
      /* the store window grows out of where they met */
      const wp = step(t, T_MERGE + 0.45, 0.7, SPRING), wout = step(t, T_END - 0.35, 0.3, EASE);
      const ws = K * lerp(0.5, 1, wp);
      win.style.transform = `translate(${960 - 490 * ws}px, ${lerp(560 - 150, 250, wp) - (1 - wp) * 0}px) scale(${ws})`;
      win.style.opacity = String(clamp(wp * 1.5) * (1 - wout));
      win.style.visibility = t >= T_MERGE + 0.45 ? 'visible' : 'hidden';
      /* the search, and the cards that answer it */
      const q = 'changelog'.slice(0, clamp(Math.floor((t - T_SEARCH) / 0.06) + 1, 0, 9));
      if (input && input.value !== (t >= T_SEARCH ? q : '')) input.value = t >= T_SEARCH ? q : '';
      const filt = step(t, T_SEARCH + 0.6, 0.45, SPRING);
      cards.forEach((c, i) => {
        const p = step(t, T_MERGE + 0.8 + i * 0.06, 0.45, SPRING);
        const keep = i === 0;
        c.style.opacity = String(p * (keep ? 1 : 1 - filt * 0.82));
        c.style.transform = `translateY(${(1 - p) * 14}px)`;
      });
      cards[0]!.classList.toggle('is-pick', t >= T_PICK - 0.15);
      /* the install card */
      const ip = step(t, T_PICK, 0.5, SPRING), iout = step(t, T_END - 0.35, 0.3, EASE);
      inst.style.transform = `translate(${960 - 230 * 1.6}px, ${lerp(560, 520, ip)}px) scale(1.6)`;
      inst.style.opacity = String(ip * (1 - iout));
      inst.style.visibility = t >= T_PICK ? 'visible' : 'hidden';
      win.style.filter = `brightness(${1 - ip * 0.45})`;
      doneMsg.style.opacity = String(step(t, T_DONE + 0.2, 0.4, EASE));
      const hb = holdBtn.getBoundingClientRect(), c0 = cards[0]!.getBoundingClientRect();
      ptr.update(t, [{ t: T_PICK - 0.6, x: 1600, y: 1000 }, { t: T_PICK - 0.05, x: c0.left + c0.width * 0.6, y: c0.top + c0.height * 0.5 }, { t: T_PRESS - 0.05, x: hb.left + hb.width * 0.6, y: hb.top + hb.height / 2 }, { t: T_DONE + 0.4, x: hb.left + hb.width * 0.6, y: hb.top + hb.height / 2 }, { t: T_END, x: 1650, y: 1040 }], [T_PICK], [T_PICK - 0.6, T_END]);
      if (t >= T_PRESS && t < T_DONE) (ptr.el.querySelector('svg') as SVGElement).style.transform = 'scale(0.88)';
      kinetic(heads[0]!, t, T0 + 0.1, T_MERGE + 0.7); kinetic(heads[1]!, t, T_MERGE + 0.9, T_PICK - 0.3);
      heads.forEach((h) => { h.style.left = '50%'; h.style.translate = '-50% 0'; h.style.top = '100px'; });
    };
  }
};
