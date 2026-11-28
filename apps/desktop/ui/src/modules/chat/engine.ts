/* What a thread says while boopis's engine is stopped (board S36): one line at its end, "boopis's engine stopped", with the one way
   out, "Start it again". The same line in a session, a bot's chat and a room (the last two derived from S36). The state is the
   provider's `engine` (the link to the engine: lost and not back at once, or given up on); the action is its `restart`, which asks the
   host to reach the engine again now, and is not drawn where no host can (a control shows only once its feature exists). */
import { announce, kit } from '@boopis/ui';
import { data } from '../../data';

export const ENGINE_STOPPED = 'boopis\'s engine stopped', ENGINE_START = 'Start it again';

/** the line, or nothing while the engine is reachable (or the provider has no engine of its own) */
export function engineLine(): HTMLElement | null {
  const e = data().engine, s = e?.state.get();
  if (!e || !s?.stopped) return null;
  const line = kit.systemLine({ variant: 'error', icon: 'close', text: ENGINE_STOPPED, ...(e.restart ? { action: ENGINE_START } : {}), attrs: { 'data-engine': '', role: 'status', ...(s.why ? { 'data-tip': s.why } : {}) } });
  const b = line.querySelector<HTMLButtonElement>('[data-line]');
  if (b && s.restarting) b.setAttribute('aria-disabled', 'true');
  b?.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') === 'true') return;
    announce('Starting boopis\'s engine');
    /* why it could not be asked is said, never swallowed; whether it came back is the line itself (it goes when the engine is reachable) */
    void e.restart?.().catch((err: unknown) => { kit.notify(err instanceof Error ? err.message : 'boopis\'s engine could not be started.'); });
  });
  return line;
}

/** keep the line at the end of a thread's column, whatever the thread draws after it: `col` is asked each time (a thread that is drawn
    again has a new column). Returns what stops following */
export function followEngine(col: () => HTMLElement | null): () => void {
  const e = data().engine;
  if (!e) return () => undefined;
  let watched: HTMLElement | null = null, sig = '';
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => { place(); }) : null;
  function place(): void {
    const c = col();
    if (c !== watched) { mo?.disconnect(); watched = c; sig = ''; if (c) mo?.observe(c, { childList: true }); }
    if (!c) return;
    const s = e?.state.get(), now = s?.stopped ? 'stopped' + (s.restarting ? ':restarting' : '') + ':' + (s.why ?? '') : '';
    const old = c.querySelector<HTMLElement>(':scope > [data-engine]');
    if (now === sig && (!old || old === c.lastElementChild) && !!old === !!now) return;
    sig = now;
    const had = old?.contains(document.activeElement) ?? false;
    old?.remove();
    const line = engineLine();
    if (!line) return;
    c.append(line);
    if (had) line.querySelector<HTMLElement>('[data-line]')?.focus({ preventScroll: true });
  }
  const off = e.state.subscribe(() => { place(); });
  place();
  return () => { off(); mo?.disconnect(); };
}
