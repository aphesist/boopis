/* A mod's toasts (docs/MODS.md section 3; DESIGN-SYSTEM.md 14.29, owner decision of 19 November 2026): the app's notice, led by
   the mod (glyph, name, text). One at a time, queued in order: the next appears as the previous one has faded (--dur-2); while
   others wait the toast carries a quiet "+N" in mono, and dismissing one (its close button, Esc inside it, or its action) shows
   the next at once. The library's toast is the one notice node; the queue only decides which text it shows. */
import { esc, tokenMs } from '../../core/dom';
import { ui } from '@boopis/ui';

interface Queued { plugin: string; text: string; ms: number; action?: { label: string; onClick?: () => void } | undefined; gone?: boolean }
const Q = { wait: [] as Queued[], cur: null as Queued | null, node: null as HTMLElement | null, watch: null as MutationObserver | null, timer: 0 };

function paintMore(): void {
  const n = Q.node?.querySelector<HTMLElement>('.mod-toast');
  if (!n || !Q.cur) return;
  let m = n.querySelector<HTMLElement>('.mod-toast__more');
  if (!Q.wait.length) m?.remove();
  else {
    if (!m) { m = document.createElement('span'); m.className = 'mod-toast__more'; n.append(m); }
    m.textContent = '+' + Q.wait.length; m.setAttribute('data-tip', Q.wait.length + ' more waiting'); m.setAttribute('aria-label', Q.wait.length + ' more waiting');
  }
  Q.node?.setAttribute('aria-label', Q.cur.plugin + ' mod: ' + Q.cur.text + (Q.wait.length ? ', ' + Q.wait.length + ' more waiting' : ''));
}

function showNext(): void {
  clearTimeout(Q.timer); Q.timer = 0;
  const t = Q.wait.shift();
  if (!t) { Q.cur = null; return; }
  Q.cur = t;
  const action = t.action ? { ...t.action, onClick: () => { t.gone = true; t.action?.onClick?.(); setTimeout(showNext, 0); } } : undefined;
  const node = ui.toast(t.text, { ms: t.ms, ...(action ? { action } : {}) });
  Q.node = node;
  const first = node.firstElementChild;
  if (first && first.tagName === 'SPAN') { first.className = 'mod-toast'; first.innerHTML = '<span class="mod-toast__who">' + ui.html.mod(t.plugin) + '</span><span class="mod-toast__t">' + esc(t.text) + '</span>'; }
  const x = ui.iconButton({ icon: 'close', label: 'Dismiss', size: 's', tip: false });
  x.classList.add('mod-toast__x', 'ui-corner');
  x.addEventListener('click', () => { dismiss(); });
  node.append(x);
  node.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } };
  paintMore();
  /* it fades by itself (the library's timer): when it has, the next one comes */
  Q.watch?.disconnect();
  Q.watch = new MutationObserver(() => {
    if (node.classList.contains('is-in') || Q.cur !== t || t.gone) return;
    t.gone = true; Q.watch?.disconnect();
    Q.timer = window.setTimeout(showNext, Math.max(1, tokenMs('--dur-2', 200)));   /* after the fade (1ms under reduced motion) */
  });
  Q.watch.observe(node, { attributes: true, attributeFilter: ['class'] });
}

export function dismiss(): void {
  if (!Q.cur) return;
  Q.cur.gone = true; Q.watch?.disconnect();
  if (Q.wait.length) showNext(); else { Q.cur = null; ui.toast.hide(); }
}

/** a mod's toast: shown now when nothing is showing, else queued behind the others */
export function toast(plugin: string, text: string, ms: number, action?: Queued['action']): void {
  Q.wait.push({ plugin, text, ms, action });
  if (!Q.cur) showNext(); else paintMore();
}

/** what is queued, for the tests */
export const queued = (): { showing: string | null; waiting: readonly string[] } => ({ showing: Q.cur?.text ?? null, waiting: Q.wait.map((t) => t.text) });
/** drops everything (the tests) */
export function resetToasts(): void { Q.watch?.disconnect(); clearTimeout(Q.timer); Q.wait = []; Q.cur = null; Q.node = null; Q.timer = 0; }
