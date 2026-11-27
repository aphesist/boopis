/* The floating Notice at work (DESIGN-SYSTEM.md v7 21.2 row 12, 21.3: "the toast becomes the floating Notice, a 44 pill"; conflict 31,
   decided at the repass's step 2a: the v7 spec wins, "floating (bottom centre)"): one line that tells the person something the app or a
   mod did, with up to two actions and a dismiss. The one API every notice of the app goes through (Settings' receipts, the store,
   connectors, a mod's notices).
   - One at a time, in order: a notice that comes while another shows waits behind it, and the one showing carries a quiet "+N" for
     those waiting. When it goes, the next comes after its fade (`--dur-2`); dismissing it (its ×, Esc inside it, its action) shows the
     next at once. The same words again while they show only start their time again.
   - It stays 3 s (6 s with an action, or what the caller asks), longer while the pointer or the focus is on it, then fades (`--dur-2`;
     reduced motion: at once).
   - Its layer is one polite live region (`role="status"`): a screen reader hears each notice once, without being interrupted; the
     red tone alone is an alert.
   The host is the app's `[data-notify-host]` (a v7 root), else `#hx-app` or the body; where it sits is the host's CSS (`.k7-notify`:
   the bottom centre of its host; the shell lifts it just above the composer, or above the dock where there is no composer). */
import { frag, tokenMs } from '../../../core/dom';
import { wire } from '../wire';
import { notice } from './notice';

export interface NotifyOpts {
  action?: { label: string; onClick?: () => void } | undefined; ms?: number | undefined; tone?: 'neutral' | 'owe' | 'accent' | 'red' | undefined;
  /** the words that lead the line, in --text (a mod's notice: its name, "pomodoro mod") */
  title?: string | undefined;
  /** a glyph before the line (a mod's notice: its puzzle glyph) */
  icon?: string | undefined;
}
interface Item { text: string; o: NotifyOpts }
const Q = { wait: [] as Item[], cur: null as Item | null, pending: null as Item | null, node: null as HTMLElement | null, timer: 0, next: 0, holdMs: 3000 };

const fadeMs = (): number => Math.max(1, tokenMs('--dur-2', 200));
const arm = (): void => { clearTimeout(Q.timer); Q.timer = window.setTimeout(() => { go(false); }, Q.holdMs); };
const hold = (): void => { clearTimeout(Q.timer); };

function host(): HTMLElement {
  if (Q.node && Q.node.isConnected) return Q.node;
  const n = document.createElement('div');
  n.className = 'k7-notify';
  n.setAttribute('role', 'status'); n.setAttribute('aria-live', 'polite');
  (document.querySelector('[data-notify-host]') ?? document.getElementById('hx-app') ?? document.body).appendChild(n);
  n.addEventListener('pointerenter', hold); n.addEventListener('pointerleave', () => { if (Q.cur) arm(); });
  n.addEventListener('focusin', hold); n.addEventListener('focusout', () => { if (Q.cur) arm(); });
  n.addEventListener('keydown', (e) => { if (e.key === 'Escape' && Q.cur) { e.preventDefault(); e.stopPropagation(); go(true); } });
  Q.node = n;
  return n;
}

/** draw the one showing, with "+N" for those waiting */
function draw(): void {
  const t = Q.cur, n = Q.node;
  if (!t || !n) return;
  const o = t.o;
  const el = wire(frag(notice({
    text: t.text, place: 'floating', tone: o.tone ?? 'neutral', dismiss: true, more: Q.wait.length,
    ...(o.title ? { title: o.title } : {}), ...(o.icon ? { icon: o.icon } : {}), ...(o.action ? { actions: [{ label: o.action.label }] } : {}),
    /* the layer is the live region: the Notice inside it is not a second one (a red one is still an alert) */
    attrs: { role: o.tone === 'red' ? 'alert' : 'none' }
  })));
  const focused = n.contains(document.activeElement);
  n.replaceChildren(el);
  el.querySelector<HTMLElement>('[data-kit~="Button"]')?.addEventListener('click', () => { o.action?.onClick?.(); go(true); });
  el.querySelector<HTMLElement>('[data-dismiss]')?.addEventListener('click', () => { go(true); });
  if (focused) (el.querySelector<HTMLElement>('[data-kit~="Button"]') ?? el.querySelector<HTMLElement>('[data-dismiss]'))?.focus({ preventScroll: true });
}

function show(t: Item): void {
  clearTimeout(Q.next);
  Q.pending = null; Q.cur = t;
  const n = host();
  draw();
  requestAnimationFrame(() => { if (Q.cur === t) n.setAttribute('data-in', ''); });
  Q.holdMs = t.o.ms || (t.o.action ? 6000 : 3000);
  arm();
}

/** the one showing goes: dismissed (the next comes at once) or its time is up (the next comes after its fade) */
function go(dismissed: boolean): void {
  clearTimeout(Q.timer);
  if (!Q.cur) return;
  const next = Q.wait.shift();
  if (next && dismissed) { show(next); return; }
  Q.cur = null;
  Q.node?.removeAttribute('data-in');
  if (next) { Q.pending = next; Q.next = window.setTimeout(() => { show(next); }, fadeMs()); }
}

/** show `text` in the floating Notice, now or after those already waiting; returns its layer */
export function notify(text: string, o: NotifyOpts = {}): HTMLElement {
  const n = host();
  if (Q.cur && !Q.wait.length && Q.cur.text === text && Q.cur.o.title === o.title) { arm(); return n; }
  if (Q.cur || Q.pending) { Q.wait.push({ text, o }); draw(); return n; }
  show({ text, o });
  return n;
}
/** the Notice showing now, for tests: its words, or '' */
export const notifyText = (): string => (Q.cur ? Q.node?.querySelector('.k7-notice__text')?.textContent ?? '' : '');
/** what shows and what waits, for tests */
export const notifyQueued = (): { showing: string | null; waiting: readonly string[] } => ({ showing: Q.cur?.text ?? null, waiting: Q.wait.map((t) => t.text) });
/** dismiss the one showing (the next comes at once) */
export const notifyDismiss = (): void => { go(true); };
/** drops every notice and the layer (tests, and a page that starts again) */
export function notifyReset(): void { clearTimeout(Q.timer); clearTimeout(Q.next); Q.wait = []; Q.cur = null; Q.pending = null; Q.node?.remove(); Q.node = null; }
