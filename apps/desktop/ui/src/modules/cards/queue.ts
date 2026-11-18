/* queue: one decision at a time, the next one peeks. HX.cards.queue(items, opts) -> .cd-queue; q.add(item) */
import { reduced } from '../../core/dom';
import { check } from './kinds';
import { animate, motion } from './motion';
import { create, emitAttention, QUEUES } from './card';
import type { HxCard, QueueRoot } from './card';
import type { CardKind, CardOpts } from '../../components/card-registry';
import type { Data } from './types';

export interface QueueItem { kind?: CardKind; data?: Data; [k: string]: unknown }
export interface Queue extends QueueRoot { add(item: QueueItem): Queue; readonly current: HxCard | null }

export function queue(items: readonly QueueItem[], opts: CardOpts & { label?: string } = {}): Queue {
  const size = opts.size ?? 'compact';
  const root = document.createElement('div') as unknown as Queue;
  root.className = 'cd-queue';
  root.dataset['size'] = size;
  if (opts.ground) root.dataset['ground'] = opts.ground;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', opts.label || 'Approval requests');
  root.innerHTML = '<div class="cd-queue__stage"><div class="cd-queue__peek" aria-hidden="true"></div><div class="cd-queue__peek" aria-hidden="true"></div></div>';
  const stage = root.firstElementChild as HTMLElement, peeks = stage.querySelectorAll<HTMLElement>('.cd-queue__peek');
  const list = items.slice();
  let idx = 0, cur: HxCard | null = null, busy = false;
  const tally: Record<string, number> = {};
  function peekState(animateIt: boolean): void {
    const rest = list.length - idx - 1;
    const p0 = peeks[0], p1 = peeks[1];
    if (!p0 || !p1) return;
    p0.hidden = rest < 1; p1.hidden = rest < 2;
    stage.style.setProperty('--cd-peek', (rest >= 2 ? 14 : rest === 1 ? 7 : 0) + 'px');
    if (!animateIt) for (const p of peeks) { p.style.transition = 'none'; void p.offsetWidth; p.style.transition = ''; }
  }
  function mount(i: number, enter: boolean): HxCard {
    const it = list[i] as QueueItem;
    const card = create(it.kind ?? 'approval', { ...((it.data ?? it) as Data) }, { ...opts, size, queue: { index: i, total: list.length }, enter: false });
    stage.appendChild(card);
    cur = card;
    if (enter) animate(card, [{ opacity: 0, transform: 'translateY(10px) scale(.96)' }, { opacity: 1, transform: 'none' }], { preset: 'settle' });
    return card;
  }
  function settle(card: HxCard): void {
    const s = card.state;
    if (s === 'approved' || s === 'denied' || s === 'expired') {
      tally[s] = (tally[s] || 0) + 1;
      setTimeout(() => promote(card), reduced() ? 300 : 900);
    }
  }
  function promote(old: HxCard): void {
    if (busy || old !== cur) return;
    busy = true;
    const hadFocus = old.contains(document.activeElement);
    const h0 = root.getBoundingClientRect().height;
    old.style.position = 'absolute'; old.style.left = '0'; old.style.right = '0'; old.style.top = '0'; old.style.zIndex = '4';
    const out = animate(old, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }], { preset: 'fade', duration: 160, fill: 'forwards' });
    idx++;
    if (idx < list.length) {
      const next = mount(idx, true);
      peekState(true);
      next.announce('Request ' + (idx + 1) + ' of ' + list.length + ': ' + next.plainText());
      if (hadFocus) { const h = next.querySelector<HTMLElement>('[data-hold]') ?? next.querySelector<HTMLElement>('.ui-btn--primary') ?? next.querySelector<HTMLElement>('button'); if (h) h.focus({ preventScroll: true }); }
    } else {
      cur = null;
      peekState(true);
      const n = list.length, a = tally['approved'] || 0, dn = tally['denied'] || 0, ex = tally['expired'] || 0;
      const done = document.createElement('div');
      done.className = 'cd-queue__done'; done.setAttribute('role', 'status'); done.tabIndex = -1;
      done.innerHTML = check() + '<span>' + n + ' decided: ' + [a ? a + ' approved' : '', dn ? dn + ' denied' : '', ex ? ex + ' expired' : ''].filter(Boolean).join(', ') + '</span>';
      stage.appendChild(done);
      animate(done, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { preset: 'fade' });
      if (hadFocus) done.focus({ preventScroll: true });
      root.dispatchEvent(new CustomEvent('hx:queue-empty', { bubbles: true, detail: { tally: { ...tally } } }));
    }
    const fin = (): void => { old.remove(); busy = false; emitAttention(); };
    if (out) out.onfinish = fin; else fin();
    /* the queue keeps the cards' rule: its height follows the next card on --dur-3 / --spring */
    const h1 = root.getBoundingClientRect().height;
    if (!reduced() && Math.abs(h1 - h0) > 1) root.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], motion('settle'));
    emitAttention();
  }
  root.addEventListener('hx:card-state', (e) => { if (e.detail.card === cur && cur) settle(cur); });
  root._waiting = () => Math.max(0, list.length - idx - 1);
  root.add = (item) => { list.push(item); if (!cur && idx >= list.length - 1) { stage.querySelector('.cd-queue__done')?.remove(); mount(idx, true); } peekState(true); emitAttention(); return root; };
  Object.defineProperty(root, 'current', { get: () => cur });
  QUEUES.add(root);
  if (list.length) mount(0, false);
  peekState(false);
  return root;
}
