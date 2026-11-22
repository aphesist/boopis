/* 7. The plans you already pay for, many models (bars 24 to 28). The setup hub: the labs' own sign-in buttons as
   boopis draws them, a wall of key tiles, receipts, "Do it later". Then one conversation where a council of three
   answers and one combines them, "@" asks one model for one message, and every reply is signed by its model. */
import { ui, signinLogo } from '@boopis/ui';
import type { SceneDef } from '../engine/stage';
import { el, line, kinetic } from '../engine/stage';
import { EASE, SPRING, step, clamp, lerp } from '../engine/motion';
import { bar, sfx } from '../engine/common';

const T0 = bar(24), T_FREE = T0 + 1.9, T_COUNCIL = T0 + 3.6, T_AT = T_COUNCIL + 2.4, T_SIGNED = T_AT + 2.4, T_END = bar(29);
const BRANDS = [['claude', 'Claude subscription'], ['chatgpt', 'ChatGPT'], ['github', 'GitHub Copilot'], ['xai', 'SuperGrok']] as const;
const KEYS = [['gemini', 'Gemini'], ['deepseek', 'DeepSeek'], ['qwen', 'Qwen'], ['kimi', 'Kimi'], ['mistral', 'Mistral'], ['minimax', 'MiniMax'], ['glm', 'Z.ai'], ['llama', 'Llama']];
const KP = 1.38;   /* the conversation plate's scale */
const MENU = ['claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-6.2-astra', 'gpt-6.2-sol', 'gemini-4-neon', 'grok-4.7', 'deepseek-v3.2', 'qwen3-coder'];

export const models: SceneDef = {
  id: 'models', start: T0, end: T_END,
  setup(root, ctx) {
    /* a) the hub */
    const hub = el('div', 'abs mh', root); hub.style.transformOrigin = '0 0';
    hub.innerHTML = `<div class="mh__plates"></div><div class="mh__keys"></div><div class="mh__foot"></div>`;
    const plates = hub.querySelector('.mh__plates') as HTMLElement;
    const plateEls = BRANDS.map(([b, name]) => {
      const p = el('div', 'mh__plate', plates);
      p.innerHTML = `<div class="mh__btn">${ui.html.signinButton({ brand: b })}</div><div class="mh__rec"><span class="mh__logo">${signinLogo(b as never)}</span><b>${name}</b><span class="mh__ok">connected</span></div>`;
      return p;
    });
    const keys = hub.querySelector('.mh__keys') as HTMLElement;
    const tiles = KEYS.map(([m, name]) => el('div', 'mh__tile', keys, ui.html.modelMark(m as never, { size: 22, color: 'brand' }) + `<span>${name}</span>`));
    const foot = hub.querySelector('.mh__foot') as HTMLElement;
    const later = ui.button({ label: 'Do it later', variant: 'ghost' }); const cont = ui.button({ label: 'Continue', variant: 'primary' });
    foot.append(el('span', 'mh__note', undefined, 'Connect any lab at any time in Settings, Models.'), later, cont);
    /* b to d) one conversation */
    const conv = el('div', 'plate mc', root); conv.style.transformOrigin = '0 0';
    conv.innerHTML = `<div class="mc__view"><div class="mc__log"></div></div><div class="mc__comp"></div>`;
    const log = conv.querySelector('.mc__log') as HTMLElement;
    const msgs: Array<{ at: number; el: HTMLElement; h: number }> = [];
    const add = (at: number, n: HTMLElement): HTMLElement => { log.append(n); msgs.push({ at, el: n, h: 0 }); return n; };
    add(T_COUNCIL + 0.05, ui.entry({ kind: 'user', who: 'you', callno: ['14:20'], body: ui.html.request('should line items round on their own, or once per invoice?') }));
    const council = ui.entry({ kind: 'agent', callno: ['claude-opus-5-5', 'Council of 3'], body: `<div class="cn">${['claude-opus-5-5', 'gpt-6.2-astra', 'gemini-4-neon'].map((m) => `<div class="cn__row">${ui.html.model(m as never, { size: 14 })}<span class="cn__st" data-m="${m}">thinking</span></div>`).join('')}<div class="cn__by">${ui.html.model('claude-opus-5-5' as never, { size: 14 })}<span>combined 3 answers</span></div><p class="cn__p">${ui.html.inline('Once per invoice. Rounding each line drifts by up to a cent a line; all three answers agree, and the property test proves it.')}</p></div>` });
    add(T_COUNCIL + 0.3, council);
    add(T_AT + 1.8, ui.entry({ kind: 'user', who: 'you', callno: ['14:22'], body: ui.html.request('@GPT-6.2 Sol write the property test') }));
    add(T_AT + 2.0, el('div', 'mc__div', undefined, ui.html.modelRoute('claude-opus-5-5 → gpt-6.2-sol')));
    add(T_AT + 2.1, ui.entry({ kind: 'agent', callno: ['gpt-6.2-sol', '48s', '$0.04'], body: '<p>' + ui.html.inline('Added `prorate.test.ts`: splitting a window never changes the total, across 5,000 random splits.') + '</p>' }));
    add(T_SIGNED + 0.5, el('div', 'mc__div', undefined, ui.html.modelRoute('gpt-6.2-sol → gemini-4-neon')));
    add(T_SIGNED + 0.6, ui.entry({ kind: 'agent', callno: ['gemini-4-neon', '31s', '$0.02'], body: '<p>' + ui.html.inline('The changelog and the API docs now say amounts are integer cents.') + '</p>' }));
    add(T_SIGNED + 1.5, el('div', 'mc__div', undefined, ui.html.modelRoute('gemini-4-neon → claude-opus-5-5')));
    add(T_SIGNED + 1.6, ui.entry({ kind: 'agent', callno: ['claude-opus-5-5', '1m 12s', '$0.09'], body: '<p>' + ui.html.inline('Ready to ship: 4 files, `142 passed`, public API unchanged.') + '</p>' }));
    add(T_SIGNED + 2.4, el('div', 'mc__div', undefined, ui.html.modelRoute('claude-opus-5-5 → deepseek-v3.2')));
    add(T_SIGNED + 2.5, ui.entry({ kind: 'agent', callno: ['deepseek-v3.2', '2m 03s', '$0.01'], body: '<p>' + ui.html.inline('Ran the backfill on a copy: 1.2 million invoices in 3m 10s, every total unchanged.') + '</p>' }));
    const comp = ui.composer({ placeholder: 'Describe the change', spend: { spent: '$0.21', cap: '$0.60' }, chips: [{ label: 'Governed', pressed: true }, { label: 'Smart', pressed: true }],
      feedforward: (t) => (t.startsWith('@GPT-6.2 Sol') ? [{ text: '@GPT-6.2 Sol', kind: 'mention' }] : []) }) as HTMLElement & { setValue(s: string): void };
    conv.querySelector('.mc__comp')!.append(comp);
    const menu = el('div', 'ui-menu tr-menu mc__menu', conv, '<div class="ui-menu__list">' + ui.html.menuItems([{ title: 'Ask one model, for this message' }, ...MENU.map((m) => ({ model: m, modelColor: 'brand', label: ui.modelMark.called(m) || m, value: m }))] as never) + '</div>');
    menu.setAttribute('data-static', '');
    const heads = [line('bring the plans you already pay for.', 'h2', root), line('or start free.', 'h2', root)];
    const side = [['ask a', 'council.', T_COUNCIL, T_AT - 0.25], ['@ any', 'model.', T_AT, T_SIGNED - 0.25], ['every reply', 'signed.', T_SIGNED, T_END - 0.3]] as const;
    const sideL = side.map(([a, b]) => [line(a, 'h2', root), line(b, 'h2', root)] as const);

    /* cues */
    sfx(T0, 'arp'); [0, 1, 2].forEach((i) => sfx(T0 + 1.0 + i * 0.3, 'blip', { n: i }));
    sfx(T_FREE, 'answer');
    sfx(T_COUNCIL + 0.05, 'pop'); sfx(T_COUNCIL + 0.3, 'pop'); [0, 1, 2].forEach((i) => sfx(T_COUNCIL + 0.6 + i * 0.3, 'tone', { n: i })); sfx(T_COUNCIL + 1.6, 'resolve');
    sfx(T_AT + 0.2, 'key'); sfx(T_AT + 0.3, 'menu'); [0.45, 0.65, 0.85, 1.05].forEach((d) => sfx(T_AT + d, 'tick', { soft: true })); sfx(T_AT + 1.2, 'select'); sfx(T_AT + 1.75, 'send'); sfx(T_AT + 2.1, 'pop');
    sfx(T_SIGNED + 0.6, 'pop'); sfx(T_SIGNED + 1.6, 'pop'); sfx(T_SIGNED + 2.5, 'pop');
    ['claude-opus-5-5', 'gpt-6.2-astra', 'gemini-4-neon'].forEach((m, i) => ctx.at(T_COUNCIL + 0.6 + i * 0.3, () => { const s = council.querySelector<HTMLElement>(`.cn__st[data-m="${m}"]`); if (s) { s.textContent = 'done'; s.dataset['done'] = ''; } }));
    const TYPE = '@GPT-6.2 Sol write the property test';
    let typed = '';
    let measured = false;
    return (t) => {
      if (!measured) { msgs.forEach((m) => { m.h = m.el.getBoundingClientRect().height / KP + 20; }); measured = true; }
      /* the hub */
      const hp = step(t, T0, 0.6, SPRING), hout = step(t, T_COUNCIL - 0.25, 0.25, EASE);
      hub.style.transform = `translate(148px, ${lerp(350, 320, hp)}px) scale(1.45)`;
      hub.style.opacity = String(hp * (1 - hout));
      hub.style.visibility = t < T_COUNCIL ? 'visible' : 'hidden';
      plateEls.forEach((p, i) => {
        const pin = step(t, T0 + 0.1 + i * 0.08, 0.5, SPRING);
        p.style.opacity = String(pin); p.style.transform = `translateY(${(1 - pin) * 18}px)`;
        const conn = i < 3 ? step(t, T0 + 1.0 + i * 0.3, 0.3, EASE) : 0;
        (p.querySelector('.mh__btn') as HTMLElement).style.opacity = String(1 - conn);
        (p.querySelector('.mh__rec') as HTMLElement).style.opacity = String(conn);
        (p.querySelector('.mh__rec') as HTMLElement).style.transform = `translateY(${(1 - conn) * 6}px)`;
      });
      tiles.forEach((ti, i) => { const p = step(t, T0 + 0.4 + i * 0.05, 0.5, SPRING); ti.style.opacity = String(p); ti.style.transform = `translateY(${(1 - p) * 14}px)`; });
      later.classList.toggle('tr-ring', t >= T_FREE);
      foot.style.opacity = String(step(t, T0 + 0.8, 0.4, EASE));
      kinetic(heads[0]!, t, T0 + 0.1, T_FREE - 0.2); kinetic(heads[1]!, t, T_FREE, T_COUNCIL - 0.35);
      heads.forEach((h) => { h.style.left = '50%'; h.style.translate = '-50% 0'; h.style.top = '140px'; });
      /* the conversation */
      const cp = step(t, T_COUNCIL - 0.12, 0.6, SPRING), cout = step(t, T_END - 0.35, 0.3, EASE);
      conv.style.transform = `translate(${lerp(760, 720, cp)}px, 120px) scale(${KP})`;
      conv.style.opacity = String(cp * (1 - cout));
      conv.style.visibility = t >= T_COUNCIL - 0.15 ? 'visible' : 'hidden';
      let total = 0;
      msgs.forEach((m) => { const p = step(t, m.at, 0.45, SPRING); total += m.h * p; m.el.style.opacity = String(clamp(p * 1.4)); m.el.style.transform = `translateY(${(1 - p) * 10}px)`; m.el.style.display = t >= m.at ? '' : 'none'; });
      log.style.transform = `translateY(${-Math.max(0, total - 430)}px)`;
      /* the council folds: the member rows quiet down once the combined answer writes in */
      const fold = step(t, T_COUNCIL + 1.6, 0.5, SPRING);
      council.querySelectorAll<HTMLElement>('.cn__row').forEach((r) => { r.style.opacity = String(lerp(1, 0.55, fold)); });
      const by = council.querySelector('.cn__by') as HTMLElement, cpara = council.querySelector('.cn__p') as HTMLElement;
      by.style.opacity = String(fold); cpara.style.opacity = String(step(t, T_COUNCIL + 1.8, 0.5, EASE));
      /* "@": type, the menu, the pick, the send */
      let text = '';
      if (t >= T_AT + 0.2 && t < T_AT + 1.2) text = '@';
      else if (t >= T_AT + 1.2 && t < T_AT + 1.75) text = TYPE.slice(0, 12 + Math.floor((t - T_AT - 1.2) * 48));
      if (text !== typed) { typed = text; comp.setValue(text); }
      const mOn = t >= T_AT + 0.3 && t < T_AT + 1.3;
      menu.style.visibility = mOn ? 'visible' : 'hidden';
      if (mOn) {
        const p = step(t, T_AT + 0.3, 0.2, EASE) * (1 - step(t, T_AT + 1.2, 0.1, EASE));
        menu.style.opacity = String(p);
        menu.style.left = '24px'; menu.style.top = (conv.offsetHeight - 128 - menu.offsetHeight + (1 - p) * 6) + 'px';
        const hl = t < T_AT + 0.45 ? null : t < T_AT + 0.65 ? MENU[0] : t < T_AT + 0.85 ? MENU[2] : MENU[3];
        menu.querySelectorAll<HTMLElement>('.ui-menu__item').forEach((it) => it.classList.toggle('tr-hl', it.dataset['value'] === hl));
      }
      sideL.forEach(([a, b], i) => {
        const [, , tin, tout] = side[i]!;
        kinetic(a, t, tin, tout); kinetic(b, t, tin + 0.15, tout);
        a.style.left = b.style.left = '110px'; a.style.top = '410px'; b.style.top = '508px';
      });
    };
  }
};
