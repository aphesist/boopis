/* 4. Feedforward, the word reading (bars 12 to 15). The session composer, large: as the request is typed, the words
   boopis will act on get their dashed underline and the "Will assume" row fills in. A click on "refactor" opens its
   readings and "fix" is chosen (solid underline, the assumption rewrites); then alt+down on "open a PR". The reading
   is the app's own (modules/session/feedforward.ts over the mock catalogue), not a re-drawing of it. */
import { ui } from '@boopis/ui';
import type { SceneDef } from '../engine/stage';
import { el, line, kinetic } from '../engine/stage';
import { EASE, SPRING, step, clamp, lerp } from '../engine/motion';
import { bar, sfx, pointer } from '../engine/common';
import { makeReader, optionsFor } from '@ui/modules/session/feedforward';
import { data } from '@ui/data';

const K = 1.9, X = (1920 - 720 * K) / 2, Y = 520;
const TEXT = 'refactor the proration helpers in src/billing to integer cents, run the tests, then open a PR.';
const T_TYPE = bar(12) + 0.6, CPS = 24;
const T_M1 = bar(14) + 0.6, T_FIX = T_M1 + 0.6, T_PICK1 = T_M1 + 0.9;      /* 31.8, 32.4, 32.7 */
const T_KEYS = bar(15), T_M2 = T_KEYS + 0.3, T_READY = T_M2 + 0.4, T_PICK2 = T_M2 + 0.6;
const T_END = bar(16);

type Comp = HTMLElement & { setValue(s: string): void; refresh(): void; flashHint(ms?: number): void };

export const feedforward: SceneDef = {
  id: 'feedforward', start: bar(12), end: T_END,
  setup(root, ctx) {
    const wrap = el('div', 'abs', root); wrap.style.width = '720px'; wrap.style.transformOrigin = '0 0';
    const reader = makeReader(() => ({ governed: true, smart: false, model: 'claude-opus-5-5' }));
    const comp = ui.composer({ placeholder: 'Describe the change', spend: { spent: '$0.00', cap: '$0.60' }, chips: [{ label: 'Governed', pressed: true }, { label: 'Smart', pressed: false }],
      feedforward: (t) => reader.marks(t), hint: (t) => reader.items(t) as never }) as Comp;
    wrap.append(comp);
    const catalog = data().feedforward.catalog();
    const kindOf = (id: string) => catalog.find((k) => k.id === id)!;
    /* the two readings menus, drawn by the kit's menu markup, placed above their word */
    const menu = (kind: string, text: string, hl: string[]): HTMLElement => {
      const k = kindOf(kind), r = reader.reading(kind, text);
      const items = [{ title: k.title + ' "' + text + '"' }, ...optionsFor(k, text).map((o) => ({ label: o.label, value: o.value, desc: o.desc, mono: !!o.mono, checked: o.value === r.value })), { foot: 'Dashed: my guess. Solid: your choice.' }];
      const m = el('div', 'ui-menu tr-menu', wrap, '<div class="ui-menu__list">' + ui.html.menuItems(items as never) + '</div>');
      m.setAttribute('data-static', ''); m.setAttribute('data-place', 'above');
      void hl;
      return m;
    };
    const m1 = menu('verb', 'refactor', []), m2 = menu('pr', 'open a PR', []);
    const keyc = el('div', 'abs tr-keys', wrap, ui.html.keys('alt+down'));
    const caret = el('div', 'abs tr-caret', wrap);
    const input = comp.querySelector('.ui-composer__input') as HTMLElement;
    const ptr = pointer(root);
    const heads = [line('say what you want.', 'h2', root), line('it shows how it read you.', 'h2', root), line('one click changes it.', 'h2', root)];

    /* sound: a key per character, a tick as each reading lands */
    for (let i = 0; i < TEXT.length; i++) if (TEXT[i] !== ' ') sfx(T_TYPE + i / CPS, 'key', { n: i });
    const seenMarks = new Set<string>();
    for (let i = 1; i <= TEXT.length; i++) for (const m of reader.marks(TEXT.slice(0, i))) if (!seenMarks.has(m.text) && TEXT.slice(0, i).endsWith(m.text)) { seenMarks.add(m.text); sfx(T_TYPE + i / CPS + 0.05, 'tick', { soft: true }); }
    reader.clear();
    sfx(T_M1 - 0.02, 'click'); sfx(T_M1, 'menu'); sfx(T_PICK1, 'select');
    sfx(T_KEYS, 'key', { hard: true }); sfx(T_KEYS + 0.12, 'key', { hard: true }); sfx(T_M2, 'menu'); sfx(T_READY, 'tick'); sfx(T_PICK2, 'select');
    sfx(T_END - 0.6, 'riser', { len: 0.6 });

    ctx.at(T_PICK1, () => { const r = reader.reading('verb', 'refactor'); r.value = 'fix'; r.confirmed = true; comp.refresh(); comp.flashHint(); });
    ctx.at(T_PICK2, () => { const r = reader.reading('pr', 'open a PR'); r.value = 'ready'; r.confirmed = true; comp.refresh(); comp.flashHint(); });

    let typed = -1;
    const markBox = (kind: string): { x: number; y: number; w: number } | null => {
      const e = comp.querySelector<HTMLElement>(`.ui-ff[data-kind="${kind}"]`);
      if (!e) return null;
      const a = e.getBoundingClientRect(), b = wrap.getBoundingClientRect();
      return { x: (a.left - b.left) / K, y: (a.top - b.top) / K, w: a.width / K };
    };
    const hlItem = (m: HTMLElement, value: string | null): void => m.querySelectorAll<HTMLElement>('.ui-menu__item').forEach((it) => it.classList.toggle('tr-hl', it.dataset['value'] === value));
    return (t) => {
      const n = clamp(Math.floor((t - T_TYPE) * CPS), 0, TEXT.length);
      if (n !== typed) { typed = n; comp.setValue(TEXT.slice(0, n)); comp.toggleAttribute('data-hinting', n > 0); }
      const push = lerp(1, 1.035, step(t, bar(12), T_END - bar(12), (x) => x));
      const inP = step(t, bar(12), 0.6, SPRING), out = step(t, T_END - 0.35, 0.3, EASE);
      wrap.style.transform = `translate(${960 - (960 - X) * push}px, ${Y + (1 - inP) * 30}px) scale(${K * push})`;
      wrap.style.opacity = String(inP * (1 - out));
      /* the menus: above their word, in with a 6px rise (the menus' own entrance), out on the pick */
      const place = (m: HTMLElement, kind: string, tin: number, tout: number, hl: Array<[number, string]>): void => {
        const on = t >= tin && t < tout + 0.12;
        m.style.visibility = on ? 'visible' : 'hidden';
        if (!on) return;
        const box = markBox(kind);
        if (box) { m.style.left = Math.max(0, Math.min(720 - 300, box.x - 12)) + 'px'; m.style.top = (box.y - m.offsetHeight - 14) + 'px'; }
        const p = step(t, tin, 0.2, EASE), q = 1 - step(t, tout, 0.12, EASE);
        m.style.opacity = String(p * q); m.style.translate = `0 ${(1 - p) * 6}px`;
        let cur: string | null = null; for (const [at, v] of hl) if (t >= at) cur = v;
        hlItem(m, cur);
      };
      place(m1, 'verb', T_M1, T_PICK1 + 0.1, [[T_M1 + 0.15, 'refactor'], [T_FIX, 'fix']]);
      place(m2, 'pr', T_M2, T_PICK2 + 0.1, [[T_M2 + 0.1, 'draft'], [T_READY, 'ready']]);
      /* alt + down, by the word */
      const kb = markBox('pr');
      const kOn = t >= T_KEYS - 0.05 && t < T_PICK2 + 0.3;
      keyc.style.visibility = kOn ? 'visible' : 'hidden';
      if (kb && kOn) { const p = step(t, T_KEYS - 0.05, 0.25, SPRING) * (1 - step(t, T_PICK2 + 0.1, 0.2, EASE)); keyc.style.transform = `translate(${kb.x + kb.w / 2}px, ${kb.y + 30 + (1 - p) * 6}px) translate(-50%, 0) scale(1.5)`; keyc.style.transformOrigin = '50% 0'; keyc.style.opacity = String(p); }
      /* the caret: brass, after the last character while typing, blinking at rest */
      const r = document.createRange(); r.selectNodeContents(input); r.collapse(false);
      const cr = r.getClientRects()[0] ?? null, wr0 = wrap.getBoundingClientRect();
      const typing = t >= T_TYPE - 0.4 && t < T_M1 - 0.3;
      const blink = t < T_TYPE || t > T_TYPE + TEXT.length / CPS ? (Math.floor((t - T_TYPE) / 0.53) % 2 === 0 ? 1 : 0) : 1;
      caret.style.visibility = typing && cr ? 'visible' : 'hidden';
      if (cr) { caret.style.transform = `translate(${(cr.left - wr0.left) / (K * push) + 1}px, ${(cr.top - wr0.top) / (K * push)}px)`; caret.style.height = (cr.height / (K * push)) + 'px'; caret.style.opacity = String(blink); }
      /* the send takes the ring at the end */
      comp.querySelector('.ui-send')?.classList.toggle('tr-ring', t >= T_END - 0.6);
      /* the hand */
      const vb = markBox('verb'); const wb = wrap.getBoundingClientRect();
      const sx = (x: number): number => wb.left + x * K * push, sy = (y: number): number => wb.top + y * K * push;
      if (vb) {
        const fixItem = m1.querySelector<HTMLElement>('.ui-menu__item[data-value="fix"]');
        const fr = fixItem && m1.style.visibility === 'visible' ? fixItem.getBoundingClientRect() : null;
        ptr.update(t, [{ t: T_M1 - 0.6, x: 1500, y: 980 }, { t: T_M1 - 0.06, x: sx(vb.x + vb.w / 2), y: sy(vb.y + 10) }, { t: T_FIX, x: fr ? fr.left + 60 : sx(vb.x), y: fr ? fr.top + fr.height / 2 : sy(vb.y - 60) }, { t: T_PICK1 + 0.7, x: 1560, y: 1000 }], [T_M1, T_PICK1], [T_M1 - 0.6, T_PICK1 + 0.7]);
      }
      const hs = [[bar(12) + 0.1, T_TYPE + TEXT.length / CPS - 0.1], [bar(14), T_KEYS - 0.25], [T_KEYS, T_END - 0.3]] as const;
      heads.forEach((h, i) => { kinetic(h, t, hs[i]![0], hs[i]![1]); h.style.left = '50%'; h.style.top = '860px'; h.style.translate = '-50% 0'; });
    };
  }
};
