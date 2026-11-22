/* 2. The team, and the dock (bars 5 to 8). Ten bots pop in around noct; every face changes state on the beat with its
   word; then the team flies into the pitch-black dock of an app window, and a click on nina opens her session in the
   dock. */
import { ui } from '@boopis/ui';
import type { SceneDef } from '../engine/stage';
import { el, line, kinetic, put } from '../engine/stage';
import { EASE, SPRING, step, clamp, lerp, damped } from '../engine/motion';
import { bar, BEAT, BOTS, orb, call, sfx, pointer, type Orb } from '../engine/common';
import { appWindow, slab } from '../engine/app';

const TOP = ['atlas', 'nina', 'kai', 'iris', 'hex', 'sol'], BOTTOM = ['terra', 'nimbus', 'noct', 'vox', 'moss'];
const ORDER = [...TOP, 'terra', 'nimbus', 'vox', 'moss'];
const R = 200; /* orbs are rendered at 200 and scaled */
const STATES: Array<[number, string, string]> = [[bar(6), 'listening', 'listening'], [bar(6) + BEAT, 'thinking', 'thinking'], [bar(6) + 2 * BEAT, 'working', 'working'], [bar(6) + 3 * BEAT, 'needs', 'needs you'], [bar(7), 'done', 'done']];
const T_DOCK = bar(7) + BEAT;          /* 15.0: the team flies into the dock */
const T_CLICK = bar(8) + BEAT;         /* 17.4: the click on nina */
/* the window and the dock, in stage pixels */
const WIN = { x: 320, y: 215, w: 1280, h: 730 };
const DOCK_X = 1092, DOCK_B = WIN.y + WIN.h, SLOT = 54, SLOTS = 12, DOCK_W = SLOTS * SLOT + 28, DOCK_H = 76;
const SES_W = 440, SES_H = 486;

export const team: SceneDef = {
  id: 'team', start: bar(5), end: bar(9),
  setup(root, ctx) {
    const cam = el('div', 'abs', root); cam.style.width = '1920px'; cam.style.height = '1080px'; cam.style.transformOrigin = '0 0';
    const app = appWindow(cam, WIN.w, WIN.h);
    const dock = slab(cam);
    const head = el('div', 'abs', cam);
    const plus = el('div', 'abs dockplus', cam, String(ui.icon('plus', { size: 'm' })));
    plus.style.color = 'var(--ink-on-dock)';
    const orbs: Record<string, { wrap: HTMLElement; orb: Orb; name: HTMLElement; gx: number; gy: number; slot: number }> = {};
    const all = [...TOP, ...BOTTOM];
    all.forEach((id) => {
      const o = orb(id, R, { state: BOTS[id]!.state === 'needs' ? 'idle' : BOTS[id]!.state });
      cam.append(o.wrap);
      const name = el('div', 'namecard', cam, `<b>${id}</b><span>${BOTS[id]!.role}</span>`);
      const ti = TOP.indexOf(id), bi = BOTTOM.indexOf(id);
      const gx = ti >= 0 ? 960 + (ti - 2.5) * 270 : 960 + (bi - 2) * 270, gy = ti >= 0 ? 318 : 640;
      orbs[id] = { ...o, name, gx, gy, slot: ['atlas', 'nina', 'kai', 'iris', 'hex', 'sol', 'noct', 'terra', 'nimbus', 'vox', 'moss'].indexOf(id) };
    });
    const flag = el('div', 'abs flagdot', cam);
    /* nina's session in the dock */
    const ses = el('div', 'abs dockses', cam);
    ses.setAttribute('data-ground', 'dock');
    ses.style.width = SES_W + 'px';
    ses.innerHTML = `<div class="dockses__head"><span class="dockses__orb"></span><b>nina</b><span>deploys</span></div>`;
    const entryEl = ui.entry({ kind: 'bot', who: 'nina', callno: ['14:08'], body: '<p>Tests are green on billing/cents. I can deploy it to staging and compare against 200 real invoices.</p>' });
    ses.append(entryEl);
    const card = ui.card('approval', { from: 'nina', title: 'deploy to staging', quote: 'billing/cents → staging, dry run first', item: ['staging, invoices-api', 'read-only on invoices, 1 migration'], meta: 'expires in 9 min' }, { size: 'compact', ground: 'dock', enter: false });
    ses.append(card);
    const comp = ui.composer({ placeholder: 'Message nina', compact: true, bot: { id: 'nina', name: 'nina', shape: 'triangle', color: '#f23b5a', state: 'needs' } as never });
    ses.append(comp);
    const words = STATES.map(([, , w]) => { const l = line(w, 'mono-xl', root); if (w === 'needs you') l.style.color = 'var(--red-text)'; return l; });
    const h = line('always one click away.', 'h2', root);
    const ptr = pointer(cam);

    /* cues */
    ORDER.forEach((id, i) => { if (id !== 'noct') sfx(bar(5) + i * 0.15, 'pluck', { n: i }); });
    STATES.forEach(([at, st], i) => {
      ctx.at(at, () => { for (const id of all) call(orbs[id]!.orb, 'react', st); });
      sfx(at, i === 3 ? 'alert' : i === 4 ? 'chord' : 'accent', { n: i });
    });
    ctx.at(T_DOCK, () => { for (const id of all) call(orbs[id]!.orb, 'react', id === 'nina' ? 'needs' : BOTS[id]!.state === 'needs' ? 'idle' : BOTS[id]!.state); });
    sfx(T_DOCK, 'whoosh', { dir: 'down' }); sfx(T_DOCK + 1.0, 'thud');
    ctx.at(T_CLICK, () => { call(orbs['nina']!.orb, 'poke', 0.6); });
    sfx(T_CLICK, 'click'); sfx(T_CLICK + 0.02, 'morph');

    return (t) => {
      /* camera: a push-in on the dock once it opens */
      const push = step(t, T_CLICK - 0.3, 1.8, SPRING);
      const cs = lerp(1, 1.42, push);
      const fx = DOCK_X, fy = DOCK_B, tx = lerp(DOCK_X, 960, push), ty = lerp(DOCK_B, 1040, push);
      cam.style.transform = `translate(${tx - fx * cs}px, ${ty - fy * cs}px) scale(${cs})`;
      cam.style.opacity = String(1 - step(t, bar(9) - 0.3, 0.3, EASE));
      /* the window rises in behind the team */
      const win = step(t, T_DOCK, 0.9, SPRING);
      app.win.style.transform = `translate(${WIN.x}px, ${WIN.y + (1 - win) * 140}px)`;
      app.win.style.opacity = String(win);
      app.win.style.visibility = t >= T_DOCK ? 'visible' : 'hidden';
      /* the slab: rises at rest size, then morphs into nina's session (critically damped, so no overshoot) */
      const rise = damped(t - (T_DOCK + 0.45), 16);
      const morph = damped(t - T_CLICK, 15);
      const dw = lerp(DOCK_W, SES_W, morph), dh = lerp(DOCK_H * rise, SES_H, morph);
      dock.set(dw, Math.max(0.01, dh));
      dock.el.style.transform = `translate(${DOCK_X - dw / 2}px, ${DOCK_B - dh}px)`;
      dock.el.style.visibility = t >= T_DOCK + 0.45 ? 'visible' : 'hidden';
      plus.style.transform = `translate(${DOCK_X + DOCK_W / 2 - 14 - SLOT / 2 - 9}px, ${DOCK_B - 50 - 9}px)`;
      plus.style.opacity = String(clamp((t - T_DOCK - 0.9) / 0.3) * (1 - clamp((t - T_CLICK) / 0.15)));
      /* the orbs: pop in, take states, fly into the dock */
      for (const id of all) {
        const o = orbs[id]!;
        const i = ORDER.indexOf(id);
        let x = o.gx, y = o.gy, s = 0.72, op = 1;
        if (id === 'noct') {
          const m = step(t, bar(5), 0.9, SPRING);
          x = lerp(960, o.gx, m); y = lerp(540, o.gy, m); s = lerp(1.17, 0.72, m);
        } else {
          const p = step(t, bar(5) + i * 0.15, 0.55, SPRING);
          s = lerp(0.42, 0.72, p); y = o.gy + (1 - p) * 24; op = clamp(p * 1.6);
        }
        const fly = step(t, T_DOCK + o.slot * 0.035, 1.0, SPRING);
        const dx = DOCK_X - DOCK_W / 2 + 14 + SLOT / 2 + o.slot * SLOT, dy = DOCK_B - 50;
        x = lerp(x, dx, fly); y = lerp(y, dy, fly); s = lerp(s, 40 / R, fly);
        /* after the click, nina travels to the session head; the others leave with the row */
        const open = step(t, T_CLICK, 0.5, SPRING);
        if (id === 'nina') {
          const hx = DOCK_X - SES_W / 2 + 16 + 20, hy = DOCK_B - SES_H + 16 + 20;
          x = lerp(x, hx, open); y = lerp(y, hy, open);
        } else op *= 1 - clamp((t - T_CLICK) / 0.18);
        put(o.wrap, x, y, s, op);
        o.wrap.style.visibility = (id === 'noct' || t >= bar(5) + i * 0.15) && op > 0.001 ? 'visible' : 'hidden';
        const nameOp = op * (1 - clamp((t - T_DOCK) / 0.2)) * clamp((t - (bar(5) + (id === 'noct' ? 0.3 : i * 0.15 + 0.1))) / 0.4);
        put(o.name, x, y + 132 * s / 0.72, 1, nameOp);
        o.name.style.visibility = nameOp > 0.001 ? 'visible' : 'hidden';
        if (id === 'nina') { put(flag, x + 15, y - 15, 1, clamp((t - T_DOCK - 1.0) / 0.2) * (1 - open)); }
      }
      /* the session's content fades up once the slab has room */
      const sesIn = step(t, T_CLICK + 0.18, 0.4, EASE);
      ses.style.transform = `translate(${DOCK_X - SES_W / 2}px, ${DOCK_B - SES_H + (1 - sesIn) * 8}px)`;
      ses.style.opacity = String(sesIn);
      ses.style.visibility = t >= T_CLICK ? 'visible' : 'hidden';
      /* the state words, one a beat */
      STATES.forEach(([at], i) => {
        const end = i < STATES.length - 1 ? STATES[i + 1]![0] - 0.04 : T_DOCK - 0.1;
        kinetic(words[i]!, t, at, end, { rise: 22, dur: 0.35, outDur: 0.1 });
        words[i]!.style.left = '50%'; words[i]!.style.top = '846px'; words[i]!.style.translate = '-50% 0';
      });
      kinetic(h, t, T_DOCK + 0.6, T_CLICK - 0.3);
      h.style.left = '50%'; h.style.top = '78px'; h.style.translate = '-50% 0';
      /* the hand: in from the right, onto nina, click */
      const nx = DOCK_X - DOCK_W / 2 + 14 + SLOT / 2 + 1 * SLOT, ny = DOCK_B - 50;
      ptr.update(t, [{ t: T_CLICK - 0.8, x: nx + 330, y: ny - 210 }, { t: T_CLICK - 0.08, x: nx + 2, y: ny + 2 }], [T_CLICK], [T_CLICK - 0.8, T_CLICK + 0.7]);
      ptr.el.style.transform += ` scale(${1 / cs})`;
    };
  }
};
