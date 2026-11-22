/* 6. Governed models (bars 19 to 23). Frontier models only, on a ladder; a failed gate climbs one rung, the diff rolls
   back; heavy models only on your word; nothing ships until you hold for one second; every step on the record. */
import { ui } from '@boopis/ui';
import type { SceneDef } from '../engine/stage';
import { el, line, kinetic } from '../engine/stage';
import { EASE, SPRING, EASE_IO, step, clamp, lerp } from '../engine/motion';
import { bar, BEAT, sfx, pointer, crispOrbs } from '../engine/common';

const T0 = bar(19), T_RUN = bar(20), T_HEAVY = bar(21), T_HOLD = bar(22), T_REC = bar(23), T_END = bar(24);
const T_PRESS = T_HOLD + 0.6, T_DONE = T_PRESS + 1.0;
const KL = 2.25;   /* the ladder's scale */
const LADDER = [['gemini-4-hydrogen', 'first try'], ['gpt-6.2-sol', 'after 1 fail'], ['claude-opus-5-5', 'after 2 fails']];
const STEPS = [
  { at: T_RUN + 0.05, s: { title: 'Read 9 files in src/billing', meta: ['Gemini 4 Hydrogen'], time: '0:18' } },
  { at: T_RUN + 0.35, s: { title: 'Moved the proration helpers to integer cents', meta: ['Gemini 4 Hydrogen'], time: '0:52' } },
  { at: T_RUN + 0.7, s: { title: 'npm test', mono: true, meta: ['1 failed', 'invoice.test.ts, rounds per line item'], time: '0:21', kind: 'fail' } },
  { at: T_RUN + 1.3, s: { title: 'Rolled back invoice.ts and climbed to GPT-6.2 Sol', meta: ['Governance, after a failed gate'], time: '0:09', kind: 'escalate' } },
  { at: T_RUN + 1.7, s: { title: 'Rounded once per invoice and added the property test', meta: ['GPT-6.2 Sol'], time: '1:58' } },
  { at: T_RUN + 2.1, s: { title: 'npm test', mono: true, meta: ['142 passed'], time: '0:04' } }
] as const;
const T_FAIL = T_RUN + 0.9, T_CLIMB = T_RUN + 1.5;
const REC = ['session.opened', 'route.decided', 'tool.called', 'ship.applied', 'gate.decided', 'ship.restored', 'route.decided', 'gate.decided', 'approval.decided', 'checkpoint.committed'];
const hex = (i: number): string => { let h = 0x9e3779b9 ^ (i * 0x85ebca6b); let s = ''; for (let k = 0; k < 8; k++) { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); s += ((h >>> 28) & 15).toString(16); } return s; };

export const governed: SceneDef = {
  id: 'governed', start: T0, end: T_END,
  setup(root, ctx) {
    const title = line('governed mode.', 'h1', root);
    const sub = line('frontier models only', 'mono-l dim', root);
    const heads = [line('a failed test climbs the ladder.', 'h2', root), line('heavy models wait for your word.', 'h2', root), line('nothing ships until you hold.', 'h2', root), line('every step on the record.', 'h2', root)];
    /* the ladder: the kit's list ladder with the labs' marks */
    const lad = el('div', 'abs gv__ladder', root); lad.style.transformOrigin = '0 0';
    const drawLadder = (cur: number, heavy: boolean): void => {
      const st = heavy ? [...LADDER, ['claude-fable-5-2', 'on because you chose it']] : LADDER;
      lad.innerHTML = ui.html.ladder({ variant: 'list', stations: st as never, current: cur, label: 'Governed ladder' });
      if (heavy) lad.querySelector('li:last-child')?.classList.add('gv__new');
    };
    drawLadder(-1, false);
    /* the run */
    const run = el('div', 'abs gv__run', root); run.style.transformOrigin = '0 0';
    run.innerHTML = ui.html.steps(STEPS.map((x) => x.s) as never);
    const items = [...run.querySelectorAll<HTMLElement>('.ui-steps > li')];
    const stamp = el('div', 'abs gv__stamp', root, ui.html.stamp('failed'));
    /* the heavy switches */
    const heavy = el('div', 'plate gv__heavy', root); heavy.style.transformOrigin = '0 0';
    heavy.innerHTML = `<section class="ui-set"><h3 class="ui-set__head">Heavy models</h3>` +
      [['claude-fable-5-2', 'Climb to Fable', 'hv-fable'], ['grok-4.7', 'Grok 4.7', 'hv-grok']].map(([m, label, id]) =>
        ui.html.setRow({ label: label!, hint: 'Token-heavy. Off until you turn it on.', for: id, control: ui.html.switch({ id, checked: false }) }).replace('<span>' + label + '</span>', '<span class="gv__lab">' + ui.html.modelMark(m as never, { size: 16 }) + label + '</span>')).join('') + '</section>';
    const fable = heavy.querySelector<HTMLInputElement>('#hv-fable')!;
    /* the hold */
    const cardWrap = el('div', 'abs gv__card', root); cardWrap.style.transformOrigin = '0 0'; cardWrap.style.width = '560px';
    const card = ui.card('approval', { from: 'nina', title: 'deploy to staging', quote: 'billing/cents → staging, dry run first', item: ['staging, invoices-api', 'read-only on invoices, 1 migration'], meta: 'expires in 9 min' }, { size: 'inline', enter: false });
    cardWrap.append(card);
    crispOrbs(cardWrap, 2);
    /* the record */
    const rec = el('div', 'abs gv__rec', root);
    const rows = REC.map((type, i) => el('div', 'gv__row', rec, `<span class="gv__seq">${i}</span><span class="gv__type">${type}</span><span class="gv__hash">${i === 0 ? '00000000' : hex(i - 1)}</span><span class="gv__arrow">→</span><span class="gv__hash is-own">${hex(i)}</span>`));
    const ptr = pointer(root);

    sfx(T0, 'impact'); sfx(T0 + 0.8, 'tick');
    LADDER.forEach((_, i) => sfx(T0 + 1.25 + i * 0.2, 'pluck', { n: 4 + i }));
    STEPS.forEach((x) => sfx(x.at, 'pop'));
    sfx(T_FAIL, 'thud'); sfx(T_CLIMB - 0.2, 'rewind'); sfx(T_CLIMB, 'step-up'); sfx(STEPS[5].at + 0.1, 'chime');
    sfx(T_HEAVY + 1.2, 'switch'); sfx(T_HEAVY + 1.3, 'heavy');
    sfx(T_HOLD, 'cut'); sfx(T_PRESS, 'hold', { len: 1.0 }); sfx(T_DONE, 'chime', { big: true });
    REC.forEach((_, i) => sfx(T_REC + 0.12 + i * 0.2, 'type'));

    ctx.at(T_RUN, () => drawLadder(0, false));
    ctx.at(T_CLIMB, () => drawLadder(1, false));
    ctx.at(T_HEAVY + 1.2, () => { fable.checked = true; });
    ctx.at(T_HEAVY + 1.35, () => drawLadder(1, true));
    const hold = (): HTMLElement => card.querySelector('.ui-hold') as HTMLElement;
    ctx.at(T_PRESS, () => hold().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true, button: 0 })));
    ctx.at(T_DONE + 0.05, () => hold().dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true, button: 0 })));
    ctx.at(T_DONE + 0.3, () => (card as unknown as { setState(s: string): void }).setState('approved'));

    let lastHb: DOMRect | null = null;
    return (t) => {
      /* title, then up and away */
      const up = step(t, T0 + 1.15, 0.6, SPRING);
      kinetic(title, t, T0, T_RUN - 0.25); kinetic(sub, t, T0 + 0.8, T_RUN - 0.25);
      title.style.left = sub.style.left = '50%';
      title.style.translate = `-50% 0`; sub.style.translate = '-50% 0';
      title.style.top = lerp(400, 140, up) + 'px'; title.style.scale = String(lerp(1, 0.72, up)); title.style.transformOrigin = '50% 0';
      sub.style.top = lerp(540, 250, up) + 'px';
      /* the ladder: left column */
      const lp = step(t, T0 + 1.15, 0.6, SPRING), lout = step(t, T_HOLD - 0.3, 0.3, EASE);
      lad.style.transform = `translate(130px, ${lerp(520, 470, lp)}px) scale(${KL})`;
      lad.style.opacity = String(lp * (1 - lout));
      lad.style.visibility = t >= T0 + 1.1 && t < T_HOLD ? 'visible' : 'hidden';
      lad.querySelectorAll<HTMLElement>('li').forEach((li, i) => {
        const p = li.classList.contains('gv__new') ? step(t, T_HEAVY + 1.35, 0.5, SPRING) : step(t, T0 + 1.25 + i * 0.2, 0.5, SPRING);
        li.style.opacity = String(p); li.style.transform = `translateX(${(1 - p) * -14}px)`;
      });
      /* the run: right column */
      const rin = step(t, T_RUN - 0.1, 0.5, SPRING), rout = step(t, T_HEAVY - 0.2, 0.35, EASE);
      run.style.transform = `translate(860px, 410px) scale(1.75)`;
      run.style.opacity = String(rin * (1 - rout));
      run.style.visibility = t >= T_RUN - 0.1 && t < T_HEAVY + 0.2 ? 'visible' : 'hidden';
      items.forEach((li, i) => { const p = step(t, STEPS[i]!.at, 0.4, SPRING); li.style.opacity = String(p); li.style.transform = `translateY(${(1 - p) * 10}px)`; });
      const sp = step(t, T_FAIL, 0.3, SPRING), sout = step(t, T_CLIMB, 0.25, EASE);
      const failRow = items[2]!.getBoundingClientRect();
      stamp.style.transform = `translate(${1760}px, ${failRow.top + failRow.height / 2}px) translate(-100%, -50%) scale(${lerp(2.6, 1.9, sp)})`;
      stamp.style.transformOrigin = '100% 50%';
      stamp.style.opacity = String(sp * (1 - sout) * (1 - rout));
      stamp.style.visibility = t >= T_FAIL && t < T_CLIMB + 0.3 ? 'visible' : 'hidden';
      /* the heavy switches */
      const hp = step(t, T_HEAVY, 0.6, SPRING), hout = step(t, T_HOLD - 0.3, 0.3, EASE);
      heavy.style.transform = `translate(${lerp(1010, 950, hp)}px, 450px) scale(1.75)`;
      heavy.style.opacity = String(hp * (1 - hout));
      heavy.style.visibility = t >= T_HEAVY && t < T_HOLD ? 'visible' : 'hidden';
      /* the card, centre */
      const cp = step(t, T_HOLD, 0.5, SPRING), cout = step(t, T_REC, 0.45, EASE_IO);
      const cs = 2 * lerp(0.96, 1, cp) * lerp(1, 0.32, cout);
      cardWrap.style.transform = `translate(${960 - 280 * cs}px, ${lerp(380, 820, cout) - (cout > 0 ? 0 : 0)}px) scale(${cs})`;
      cardWrap.style.opacity = String(cp * (1 - clamp((cout - 0.5) / 0.5)));
      cardWrap.style.visibility = t >= T_HOLD && t < T_REC + 0.5 ? 'visible' : 'hidden';
      /* the record builds upward */
      rec.style.visibility = t >= T_REC ? 'visible' : 'hidden';
      let shown = 0;
      rows.forEach((r, i) => {
        const at = T_REC + 0.12 + i * 0.2, p = step(t, at, 0.35, SPRING);
        if (t >= at) shown++;
        r.style.opacity = String(p);
        r.classList.toggle('is-key', i === 8);
      });
      rec.style.transform = `translate(960px, 985px) translate(-50%, -100%) translateY(${(1 - step(t, T_REC + 0.12 + (shown - 1) * 0.2, 0.35, SPRING)) * 62}px) scale(1.12)`;
      rec.style.transformOrigin = '50% 100%';
      rows.forEach((r, i) => { r.style.display = i < shown ? 'flex' : 'none'; });
      /* headlines */
      const hs: Array<[number, number]> = [[T_RUN, T_HEAVY - 0.25], [T_HEAVY, T_HOLD - 0.25], [T_HOLD, T_REC - 0.25], [T_REC, T_END - 0.3]];
      heads.forEach((h, i) => { kinetic(h, t, hs[i]![0], hs[i]![1]); h.style.left = '50%'; h.style.translate = '-50% 0'; h.style.top = (i === 2 ? 150 : 150) + 'px'; });
      /* the hand: the Fable switch, then the hold */
      const fr = fable.getBoundingClientRect(), hEl = card.querySelector('.ui-hold') as HTMLElement | null;
      if (hEl) lastHb = hEl.getBoundingClientRect();
      const hb = lastHb!;
      if (t < T_HOLD) ptr.update(t, [{ t: T_HEAVY + 0.5, x: 1700, y: 1000 }, { t: T_HEAVY + 1.12, x: fr.left + fr.width / 2, y: fr.top + fr.height / 2 }, { t: T_HOLD - 0.2, x: 1780, y: 1040 }], [T_HEAVY + 1.2], [T_HEAVY + 0.5, T_HOLD - 0.2]);
      else ptr.update(t, [{ t: T_HOLD + 0.1, x: 1500, y: 1010 }, { t: T_PRESS - 0.06, x: hb.left + hb.width * 0.55, y: hb.top + hb.height / 2 }, { t: T_DONE + 0.2, x: hb.left + hb.width * 0.55, y: hb.top + hb.height / 2 }, { t: T_REC, x: 1600, y: 1040 }], [], [T_HOLD + 0.1, T_REC]);
      /* the press: the hand stays down for the whole second */
      if (t >= T_PRESS && t < T_DONE) (ptr.el.querySelector('svg') as SVGElement).style.transform = 'scale(0.88)';
      void BEAT;
    };
  }
};
