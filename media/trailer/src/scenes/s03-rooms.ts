/* 3. Group chats with bots, governed bot by bot (bars 9 to 11). A room of three bots: you ask, terra plans, terra hands
   the review to atlas, atlas reviews, nina is ready. Then nina's settings: Governed, and what she asks before. */
import { ui } from '@boopis/ui';
import type { SceneDef } from '../engine/stage';
import { el, line, kinetic } from '../engine/stage';
import { EASE, SPRING, step, clamp, lerp } from '../engine/motion';
import { bar, BEAT, sfx, crispOrbs, whoHTML } from '../engine/common';

const K = 1.42;                         /* the plates' scale */
const T0 = bar(9), T_HAND = bar(10), T_GOV = bar(11);

interface Msg { at: number; el: HTMLElement; h: number }

export const rooms: SceneDef = {
  id: 'rooms', start: T0, end: bar(12),
  setup(root, ctx) {
    /* the room */
    const room = el('div', 'plate room', root);
    room.style.width = '720px'; room.style.height = '600px'; room.style.transformOrigin = '0 0';
    room.innerHTML = `<div class="room__head"><span class="room__stack"></span><b>billing crew</b><span class="room__n">3 bots</span></div><div class="room__view"><div class="room__log"></div></div>`;
    const stack = room.querySelector('.room__stack') as HTMLElement;
    stack.innerHTML = ['terra', 'atlas', 'nina'].map((id) => whoHTML(id, 24).replace(/<span class="bt-who-name">.*<\/span>$/, '')).join('');
    const log = room.querySelector('.room__log') as HTMLElement;
    const msgs: Msg[] = [];
    const add = (at: number, node: HTMLElement): HTMLElement => { log.append(node); msgs.push({ at, el: node, h: 0 }); return node; };
    const botMsg = (id: string, time: string, text: string): HTMLElement => {
      const e = ui.entry({ kind: 'bot', who: whoHTML(id), callno: [time], body: '<p>' + ui.html.inline(text) + '</p>' });
      return e;
    };
    add(T0 + 0.6, ui.entry({ kind: 'user', who: 'You', callno: ['14:10'], body: ui.html.request('@terra plan the cents migration. @atlas, review it when it’s up.') }));
    add(T0 + 1.5, botMsg('terra', '14:11', 'Plan is up: three steps, one migration. Nothing writes until you approve.'));
    const hand = ui.card('teammate', { from: 'terra', title: 'hands atlas the review', quote: 'Migration 0042: invoices to integer cents, in three steps.', item: ['cents/migration-0042', 'plan.md, 3 steps, 1 migration'], meta: 'just now' }, { size: 'inline', enter: false });
    const handWrap = el('div', 'room__card'); handWrap.append(hand);
    add(T_HAND + 0.15, handWrap);
    add(T_HAND + 0.9, botMsg('atlas', '14:12', 'Reviewed. One nit, fixed in `9f3c1a2`. 142 tests pass.'));
    add(T_HAND + 1.8, botMsg('nina', '14:12', 'Ready for staging when you are.'));
    crispOrbs(room, K);

    /* nina's settings */
    const set = el('div', 'plate setplate', root);
    set.style.width = '620px'; set.style.transformOrigin = '0 0';
    const seg = ui.segmented({ mode: 'radio', label: 'Governance', value: 'ungoverned', options: [{ value: 'governed', label: 'Governed' }, { value: 'ungoverned', label: 'Ungoverned' }], fill: true });
    const APPR = [['deploys', 'Deploying anywhere'], ['push', 'Pushing to protected branches'], ['network', 'Reaching the network'], ['spend', 'Spending past the run cap']];
    set.innerHTML = `<div class="setplate__who">${whoHTML('nina', 28).replace('bt-who-name', 'setplate__name')}<span class="setplate__role">deploys</span></div>
      <section class="ui-set"><h3 class="ui-set__head">Model</h3><p class="ui-field__hint">Only frontier models, and every write ends at the gate.</p><div class="setplate__seg"></div></section>
      <section class="ui-set"><h3 class="ui-set__head">Ask me before</h3><p class="ui-field__hint">It pauses and sends you an approval card.</p>
      ${APPR.map(([id, name]) => ui.html.setRow({ label: name!, for: 'ap-' + id, control: ui.html.switch({ id: 'ap-' + id, checked: false }) })).join('')}</section>
      <section class="ui-set"><h3 class="ui-set__head">Workspace</h3><div class="setplate__ws"></div><p class="ui-field__hint">An isolated sandbox with the network off; nothing leaves it without approval.</p></section>`;
    set.querySelector('.setplate__seg')!.append(seg);
    set.querySelector('.setplate__ws')!.append(ui.segmented({ mode: 'radio', label: 'Workspace', value: 'sandbox', options: [{ value: 'worktree', label: 'Worktree' }, { value: 'sandbox', label: 'Sandbox' }], fill: true }));
    crispOrbs(set, K);
    const switches = [...set.querySelectorAll<HTMLInputElement>('.ui-switch')];
    const segTo = (s: HTMLElement, i: number): void => {
      s.style.setProperty('--i', String(i));
      s.querySelectorAll('.ui-seg__opt').forEach((b, j) => b.setAttribute('aria-checked', String(j === i)));
    };

    /* headlines, two lines each, on the left */
    const L = [['group chats.', 'with bots.', T0 + 0.2, T_HAND - 0.25], ['they hand work', 'to each other.', T_HAND, T_GOV - 0.25], ['governed,', 'bot by bot.', T_GOV, bar(12) - 0.25]] as const;
    const lines = L.map(([a, b]) => [line(a, 'h2', root), line(b, 'h2', root)] as const);

    msgs.forEach((m, i) => sfx(m.at, i === 2 ? 'handoff' : 'pop'));
    ctx.at(T_HAND + 0.6, () => (hand as unknown as { setState(s: string): void }).setState('accepted'));
    sfx(T_HAND + 0.6, 'click');
    ctx.at(T_GOV + 0.6, () => segTo(seg, 0)); sfx(T_GOV + 0.6, 'switch');
    switches.forEach((s, i) => { const at = T_GOV + 0.9 + i * BEAT / 4; ctx.at(at, () => { s.checked = true; }); sfx(at, 'switch', { n: i }); });

    let measured = false;
    return (t) => {
      if (!measured) { msgs.forEach((m) => { m.h = m.el.getBoundingClientRect().height / K + 22; }); measured = true; }
      /* the room: in, the log rising as each message arrives, out to the left when the settings come */
      const inP = step(t, T0 - 0.05, 0.6, SPRING), out = step(t, T_GOV - 0.1, 0.6, SPRING);
      const rx = lerp(800, 740, inP) - out * 260, ry = 118;
      room.style.transform = `translate(${rx}px, ${ry}px) scale(${K * lerp(0.96, 1, inP)})`;
      room.style.opacity = String(inP * (1 - out));
      room.style.visibility = out < 1 ? 'visible' : 'hidden';
      let total = 0;
      msgs.forEach((m) => { total += m.h * step(t, m.at, 0.45, SPRING); });
      log.style.transform = `translateY(${-Math.max(0, total - 480)}px)`;
      msgs.forEach((m) => { const p = step(t, m.at, 0.45, SPRING); m.el.style.opacity = String(clamp(p * 1.4)); m.el.style.transform = `translateY(${(1 - p) * 10}px)`; m.el.style.visibility = t >= m.at ? 'visible' : 'hidden'; });
      /* the settings, in from the right */
      const sp = step(t, T_GOV, 0.7, SPRING);
      set.style.transform = `translate(${lerp(1200, 860, sp)}px, 110px) scale(${K})`;
      set.style.opacity = String(sp);
      set.style.visibility = t >= T_GOV ? 'visible' : 'hidden';
      lines.forEach(([a, b], i) => {
        const [, , tin, tout] = L[i]!;
        kinetic(a, t, tin, tout); kinetic(b, t, tin + 0.18, tout);
        a.style.left = b.style.left = '110px'; a.style.top = '392px'; b.style.top = '490px';
      });
      void EASE;
    };
  }
};
