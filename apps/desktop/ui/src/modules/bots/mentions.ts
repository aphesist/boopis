/* "@" in the Bots tab's composers: the kit's mention machinery (`ui.composer({ mentions })`, components/mentions.ts) with the engine's
   own handles. A group room names its members (and the whole room, `@all`); a bot's own chat names its teammates.
     what a mention is   the engine's pattern (`MENTION_SOURCE`, `hosted_room_discussion._MENTION_RE`), resolved with the same markdown
                         context the room draws its messages with, so a draft and the message it becomes read alike: a member is
                         its capsule (orb and name), `@all` the room's orbs, a bot that exists but is not here the muted capsule, and
                         anything else (an unknown handle, "@kai." whose full stop is part of the handle) stays text
     what a pick writes  the handle as the engine reads it and a space, so a full stop typed next is never part of it
   The send is the composer's plain text, unchanged: the engine reads the handles itself. */
import { ui } from '@boopis/ui';
import type { MarkdownCtx, MdBot, MentionSource, SelectEntry } from '@boopis/ui';

/** a bot a mention can name, by the handle it answers to */
export type Named = MdBot & { handle: string };
const EVERYONE = ['all', 'everyone'];
/** the handle being typed: an "@" that starts a word, then what can still become a handle by the engine's pattern */
const TYPING = /(^|[\s([{])@([A-Za-z0-9][A-Za-z0-9._:-]*)?$/;

export interface BotMentionOpts {
  /** the list's name and its foot (what naming someone does here) */
  label: string;
  foot: () => string;
  /** whom the list offers, in order */
  named: () => readonly Named[];
  /** the room as a whole (`@all`), with the words for its row; absent where there is no room */
  everyone?: (() => string | null) | undefined;
  /** the context the conversation draws its messages with: a mention in the draft is drawn as the sent one will be */
  ctx: () => MarkdownCtx;
}

/** the handle typed letters name: a handle, or a word of a name, that starts with them; then the room as a whole */
export function bestNamed(query: string, named: readonly Named[], everyone: boolean): string | null {
  const q = query.toLowerCase();
  if (!q) return null;
  const hit = named.find((b) => b.handle.toLowerCase().startsWith(q)) ?? named.find((b) => b.name.toLowerCase().split(/[\s._-]+/).some((w) => w.startsWith(q)));
  if (hit) return hit.handle;
  return everyone ? EVERYONE.find((w) => w.startsWith(q)) ?? null : null;
}

export function botMentions(o: BotMentionOpts): MentionSource {
  return {
    label: o.label,
    foot: o.foot,
    query: (before) => { const m = TYPING.exec(before); return m ? { at: m.index + (m[1] ?? '').length, query: m[2] ?? '' } : null; },
    entries: (): SelectEntry[] => {
      const room = o.everyone?.() ?? null;
      return [
        ...o.named().map((b) => ({ value: b.handle, label: b.name, ...(b.role ? { desc: b.role } : {}), lead: ui.html.orb(b, { size: 16, still: true }) })),
        ...(room ? [{ value: 'all', label: 'all', desc: room, icon: 'bots' }] : [])
      ];
    },
    best: (q) => bestNamed(q, o.named(), !!o.everyone?.()),
    write: (v) => v || null,
    find: (t) => { const ctx = o.ctx(); return ui.markdown.spans(t, ctx).map((s) => ({ at: s.at, text: s.text, kind: 'bot', ...ui.markdown.chip(s, ctx.outsideNote) })); }
  };
}
