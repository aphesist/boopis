/* Who is at work, in the bots tab: one presence entry (the kit's `ui.presence`) at the tail of a bot's chat or a group room, where
   the replies land, and the jump pill that carries it while the end of the conversation is out of view. The rooms say who works
   (their data: a bot's run and its state, a room's member activity); this file keeps the one entry in the log, lets a reply land
   before it or in its place, and decides when the pill shows. The research and the scenario catalogue: w27/chat-motion.
     paint(actors)   who is at work now; nobody: the entry fades out
     land(entry, w)  a reply by `w` goes before the entry, or takes its place when `w` was the only one at work (it lands where the
                     reader was looking); the others glance at it
     end(failed)     the last one stopped: a failed turn shows its error face for a moment first
   The entry never moves once it is in the log (a moved node detaches its orbs, which the worker then draws again). */
import { reduced } from '../../core/dom';
import { ui } from '@boopis/ui';
import type { BotLike, PresenceActor, PresenceElement, PresencePill, PresenceStatus } from '@boopis/ui';
import type { Bot, GroupMember, MemberActivity } from '../../data';
import { toolWords } from '../../data/tool-words';
import { atEnd } from './ledger';
import { liven } from './orbs';

/** a failed turn's error face stays this long before the entry goes */
const FAILED_MS = 1200;
/** a reply that landed this recently is what the orbs still at work glance at */
const ARRIVAL_MS = 2500;
const COMPUTE = new Set(['terminal', 'process', 'execute_code']);

/** a bot at work in its own chat: its state (the one map, `ui.botState`) and its own activity line, as the header and the roster say it */
export function botActor(b: Bot, since: number | null): PresenceActor {
  const s = ui.botState(b);
  const status: PresenceStatus = s.key === 'error' ? 'failed' : s.attention ? 'needs' : s.key === 'speaking' ? 'replying' : s.key === 'working' || s.key === 'compute' ? 'tool' : 'thinking';
  return { id: b.id, bot: b, status, doing: b.activity || null, compute: s.key === 'compute', since };
}
/** a member at work in a room: what the room says it does (queued, running, stopping, its tool), and the attention its bot owes */
export function memberActor(a: MemberActivity, m: GroupMember, bot: BotLike, o: { attention?: boolean; by?: string | null } = {}): PresenceActor {
  const status: PresenceStatus = a.status === 'queued' ? 'next' : a.status === 'stopping' ? 'stopping' : o.attention ? 'needs' : a.tool ? 'tool' : 'thinking';
  return { id: m.id, bot: { ...bot, name: m.name }, status, doing: toolWords(a.tool) || null, compute: COMPUTE.has(String(a.tool ?? '')), since: a.startedAt, by: o.by ?? null };
}

/** put a node in the thread before the presence entry (replies land above who is still at work) */
export function placeInLog(log: HTMLElement, node: Node): void {
  const tail = log.querySelector(':scope > .ui-presence:not([data-leave])');
  if (tail) tail.before(node); else log.append(node);
}

export interface RoomPresence {
  paint(actors: readonly PresenceActor[]): void;
  land(entry: HTMLElement, who: string): void;
  end(failed?: PresenceActor | null): void;
  readonly el: PresenceElement | null;
}
export interface RoomPresenceOpts {
  log(): HTMLElement | null;
  scroll(): HTMLElement | null;
  /** the composer's zone: the pill floats above it, where the jump button does */
  zone: HTMLElement;
  /** the room's jump button: its `data-unread` is how many replies arrived below the fold */
  jump(): HTMLButtonElement | null;
  /** go to the end (the room's own jump) */
  onJump(): void;
}

export function roomPresence(o: RoomPresenceOpts): RoomPresence {
  let el: PresenceElement | null = null, away = false, endT = 0;
  let arrival: { entry: Element; at: number } | null = null;
  const pill: PresencePill = ui.presence.pill();
  pill.classList.add('bt-presence-pill');
  pill.hidden = true;
  pill.addEventListener('click', () => { o.onJump(); });
  o.zone.append(pill);
  const unread = (): number => Number(o.jump()?.dataset['unread'] ?? 0) || 0;
  const paintPill = (): void => {
    const show = !!el && el.isConnected && away && el.actors.length > 0;
    if (show && el) pill.paint(el.actors, unread());
    else { pill.paint([], 0); pill.removeAttribute('aria-label'); }   /* a hidden pill holds no orbs and names nothing: what it last showed would differ by when it last showed */
    pill.hidden = !show;
    if (show) o.zone.dataset['away'] = ''; else delete o.zone.dataset['away'];
  };
  /* away from the end: the room's own rule for its jump button (`atEnd`), read once a frame at most while it scrolls */
  let raf = 0;
  const check = (): void => { const sc = o.scroll(); const was = away; away = !!sc && !atEnd(sc); if (was !== away || !pill.hidden || away) paintPill(); };
  o.scroll()?.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; check(); }); }, { passive: true });
  const watchJump = (): void => { const j = o.jump(); if (j && typeof MutationObserver === 'function') new MutationObserver(paintPill).observe(j, { attributes: true, attributeFilter: ['data-unread', 'hidden'] }); };
  watchJump();

  const drop = (): void => {
    if (el) { if (el.isConnected) el.leave(); else el.remove(); }
    el = null; paintPill();
  };
  const r: RoomPresence = {
    get el() { return el && el.isConnected ? el : null; },
    paint(actors) {
      window.clearTimeout(endT); endT = 0;
      const log = o.log();
      if (el && !el.isConnected) el = null;   /* the thread was drawn again */
      if (!actors.length || !log) { drop(); return; }
      const fresh = arrival && performance.now() - arrival.at < ARRIVAL_MS ? arrival.entry : null;
      if (el) { el.update(actors, { arrived: fresh }); arrival = null; paintPill(); return; }
      const sc = o.scroll(), follow = !sc || atEnd(sc);
      el = ui.presence({ actors, onOrb: (orb) => { liven(orb, 20); } });
      log.querySelector('.bt-empty')?.remove();
      log.append(el);
      if (follow && sc) sc.scrollTo({ top: sc.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
      away = !follow;
      paintPill();
    },
    land(entry, who) {
      const log = o.log(); if (!log) return;
      if (el && el.isConnected && el.actors.length === 1 && el.actors[0]?.id === who) {
        el.replaceWith(entry); el = null; paintPill();
        return;
      }
      placeInLog(log, entry);
      arrival = { entry, at: performance.now() };
    },
    end(failed) {
      if (!failed || !el || !el.isConnected) { drop(); return; }
      el.update([{ ...failed, status: 'failed' }]);
      window.clearTimeout(endT);
      endT = window.setTimeout(() => { endT = 0; drop(); }, FAILED_MS);
    }
  };
  return r;
}
