/* The page's heartbeat to the host (`webview_heartbeat`, src-tauri/src/webview_health.rs). Every few seconds the page says
   whether it is visible and the longest main-thread stall it saw since the last beat, measured as how late a steady
   timer ran while the page was visible (a hidden page's timers are throttled by design, so their lateness is not a
   stall). The host keeps it for Diagnostics. The answer carries the one plain notice the page shows after the host
   reloaded it to recover a dead or stuck window. */
import { commands } from './bindings';
import { logger } from '../core/log';

const log = logger('heartbeat');

/** how often the timer runs, and how many runs make one beat */
export const TICK_MS = 2000;
export const BEAT_EVERY = 5;

/** the stall a tick measured: how late it ran, counted only when the page was visible for the whole interval */
export function stallOf(expected: number, elapsed: number, visibleThroughout: boolean): number {
  if (!visibleThroughout) return 0;
  return Math.max(0, Math.round(elapsed - expected));
}

export interface HeartbeatDeps {
  now: () => number;
  visible: () => boolean;
  beat: (visible: boolean, stallMs: number) => Promise<{ notice: string | null }>;
  notice: (text: string) => void;
}

/** the beating, with its clock, page and host given (tests drive `tick` by hand) */
export function heartbeat(deps: HeartbeatDeps): { tick: () => Promise<void>; flip: () => void } {
  let last = deps.now(), worst = 0, n = 0, visibleThroughout = deps.visible();
  return {
    /* a visibility change starts a fresh interval: time spent hidden is not a stall */
    flip(): void { last = deps.now(); visibleThroughout = false; },
    async tick(): Promise<void> {
      const t = deps.now();
      worst = Math.max(worst, stallOf(TICK_MS, t - last, visibleThroughout && deps.visible()));
      last = t; visibleThroughout = deps.visible();
      if (++n % BEAT_EVERY !== 1) return;   /* the first tick beats at once, so a notice owed after a recovery shows at start */
      const stall = worst; worst = 0;
      try {
        const r = await deps.beat(deps.visible(), stall);
        if (r.notice) deps.notice(r.notice);
      } catch (e) { log.debug('the heartbeat did not reach the host', e); }
    }
  };
}

/** start beating in the desktop app */
export function startHeartbeat(notice: (text: string) => void): void {
  const hb = heartbeat({
    now: () => performance.now(),
    visible: () => document.visibilityState === 'visible',
    beat: (visible, stallMs) => commands.webviewHeartbeat(visible, stallMs),
    notice
  });
  document.addEventListener('visibilitychange', hb.flip);
  void hb.tick();
  window.setInterval(() => { void hb.tick(); }, TICK_MS);
}
