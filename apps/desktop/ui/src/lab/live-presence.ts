/* Provider patches and checks for the chat presence stories (stories/chat/presence-rooms.stories.ts): a bot of its own chat at
   work in a given state, and the check that every place that draws a bot (the roster, the room's header, the presence entry, the
   dock) wears the same face for it. The live provider's events are checked in `host/live/*.test.ts`; the lab draws what it shows. */
import type { Bot, DataProvider } from '../data';

/** a bot's reply is under way: the page is told it runs, and the bot is in the state `patch` gives (thinking, working with its
    activity, needing the owner) */
export function withBotAt(p: DataProvider, botId: string, patch: Partial<Bot>): DataProvider {
  const snap = p.bots.snapshot;
  return { ...p, bots: { ...p.bots,
    snapshot: () => { const s = snap(); return { ...s, bots: s.bots.map((b) => (b.id === botId ? { ...b, ...patch } : b)) }; },
    subscribe: (fn) => { const off = p.bots.subscribe(fn); const t = window.setTimeout(() => { fn({ type: 'run', botId, running: true }); }, 0); return () => { window.clearTimeout(t); off(); }; }
  } };
}

/** each group's thread cut to its first `n` messages: a room whose end is in view at every width the checker draws, so nothing
    about it depends on where a reflow left the scroll (the pill shows only while the end is out of view) */
export function firstMessages(p: DataProvider, n: number): DataProvider {
  const snap = p.groups.snapshot;
  return { ...p, groups: { ...p.groups, snapshot: () => { const s = snap(); return { ...s, threads: Object.fromEntries(Object.entries(s.threads).map(([k, v]) => [k, v.slice(0, n)])) }; } } };
}

/** the faces a bot wears on the page, by place; the places that disagree with the presence entry, in words */
export function facesDisagree(botId: string): string[] {
  const id = botId.replace(/["\\]/g, '');
  const face = (o: Element | null): string | null => (o ? (o as HTMLElement).dataset['base'] || o.getAttribute('reaction') : null);
  const places: Record<string, Element | null> = {
    'the roster': document.querySelector('#hx-side .ui-orb[data-bot="' + id + '"] > orb-avatar'),
    'the room header': document.querySelector('#hx-view-bots .bt-presence .ui-orb[data-bot="' + id + '"] > orb-avatar'),
    'the presence entry': document.querySelector('#hx-view-bots .ui-presence .ui-orb[data-bot="' + id + '"] > orb-avatar'),
    'the dock': document.querySelector('#hx-dock .k7-dock__orb[data-bot="' + id + '"] orb-avatar')
  };
  const want = face(places['the presence entry'] ?? null);
  if (!want) return ['the presence entry draws no orb for ' + botId];
  return Object.entries(places).filter(([, o]) => o && face(o) !== want).map(([where, o]) => where + ' wears ' + face(o) + ', the presence entry ' + want);
}
