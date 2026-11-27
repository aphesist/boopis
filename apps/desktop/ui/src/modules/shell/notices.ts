/* Where the floating Notice sits in the window, and the notices that wait for the shell (conflict 31, decided at the repass's step 2a:
   the v7 spec's "floating (bottom centre)"). The kit's `kit.notify` is the one API; its layer is `#hx-notify`, and the shell says where
   the bottom of the work is: just above the open view's composer, or above the dock where the view has no composer. The composer's
   top is read once when a Notice comes in and again when the layout changes while one shows (never in a frame), and written as
   `--hx-notify-bottom` on the host; shell.css adds the gap. */
import { kit } from '@boopis/ui';
import type { NotifyOpts } from '@boopis/ui';
import { on } from '../../core/bus';

/** the composer the person sees now: the open view's, never the dock's (the dock card has its own) nor one under a dialog */
const COMPOSERS = '#hx-view-session.is-active .ss-composer, #hx-view-bots.is-active .bt-composer-zone, .hx-view.is-active .hx-stub-composer';
function composerTop(): number | null {
  for (const c of document.querySelectorAll<HTMLElement>(COMPOSERS)) {
    if (c.closest('[hidden], #hx-dock')) continue;
    const r = c.getBoundingClientRect();
    if (r.height > 0 && r.width > 0) return r.top;
  }
  return null;
}
/** write where the Notice's bottom sits: above the composer, else unset (the dock's space, shell.css) */
export function placeNotice(host: HTMLElement | null = document.getElementById('hx-notify')): void {
  if (!host) return;
  const top = composerTop(), box = host.getBoundingClientRect();
  if (top === null || box.height === 0) host.style.removeProperty('--hx-notify-bottom');
  else host.style.setProperty('--hx-notify-bottom', Math.max(0, Math.round(box.bottom - top)) + 'px');
}

/** watch the host: each Notice that comes in is placed, and placed again when the layout moves while it shows */
export function mountNotices(): void {
  const host = document.getElementById('hx-notify');
  if (!host) return;
  new MutationObserver((list) => {
    if (list.some((m) => m.type === 'childList' || (m.target instanceof HTMLElement && m.target.hasAttribute('data-in')))) placeNotice(host);
  }).observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-in'] });
  on('hx:layout', () => { if (host.querySelector('.k7-notify[data-in]')) placeNotice(host); });
}

/* A notice the host hands over while the app is still loading (the bots' repair, the watchdog, an engine update) has no work to sit
   over yet: it waits for the shell (`hx:ready`), shows at once when the shell has booted, and at once where there is no app root to
   wait for (a layer over the whole window before the shell boots, the first run, calls kit.notify itself). */
const owed: Array<{ text: string; o: NotifyOpts }> = [];
const booting = (): boolean => !!document.getElementById('hx-app')?.classList.contains('is-booting');
on('hx:ready', () => { for (const t of owed.splice(0)) kit.notify(t.text, t.o); });
export function notifyWhenReady(text: string, o: NotifyOpts = {}): void { if (booting()) owed.push({ text, o }); else kit.notify(text, o); }
