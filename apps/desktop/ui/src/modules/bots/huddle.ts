/* The huddle (the chat research's direction B, on top of the ledger): the replies to the user stay full entries; what the members say
   among themselves (a later round) folds into one entry, "nina, kai and moss worked it out, 4 messages", whose body is compact
   messages on a spine. It stays open while the conversation is live and folds when the user writes again; the user's own
   opening or folding of it is kept. The disclosure is the kit's (`ui.disclosure`); the unread divider sits inside it, before the
   first message the user has not seen. Reduced motion: it opens and folds at once. */
import { $, el, esc, frag, reduced } from '../../core/dom';
import { ui } from '@boopis/ui';
import type { MarkdownCtx } from '@boopis/ui';
import type { GroupMember, GroupMessage, GroupText } from '../../data';
import { listWords, unreadDivider } from './ledger';

/** a message the members wrote among themselves: a member's, in a later round (round 0 answers the user), that does not address the
    person (`toYou`: a member's `@user`), since a reply to the person stays a full entry */
export const isBetween = (m: GroupMessage, toYou?: (m: GroupMessage) => boolean): m is GroupText & { round: number } => m.kind === 'text' && m.who !== 'you' && typeof m.round === 'number' && m.round > 0 && !toYou?.(m);
/** the runs of two or more such messages in a thread, as [start, end) index pairs */
export function huddleRuns(msgs: readonly GroupMessage[], toYou?: (m: GroupMessage) => boolean): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < msgs.length;) {
    const at = msgs[i];
    if (!at || !isBetween(at, toYou)) { i++; continue; }
    let j = i + 1;
    while (j < msgs.length && isBetween(msgs[j] as GroupMessage, toYou)) j++;
    if (j - i >= 2) runs.push([i, j]);
    i = j;
  }
  return runs;
}
/** whether the conversation is live at a run: the user has not written since */
export const liveAt = (msgs: readonly GroupMessage[], end: number): boolean => !msgs.slice(end).some((m) => m.kind === 'text' && m.who === 'you');

export interface HuddleDeps {
  member(id: string): GroupMember | undefined;
  /** the orb of a member, as markup, at a size */
  orb(m: GroupMember, size: number): string;
  /** the names a message is for (the ledger's "to" words) */
  to(m: GroupText): string[];
  ctx: MarkdownCtx;
  /** a message's body was drawn: the room remembers it, and resolves its paths */
  drawn(m: GroupText, node: HTMLElement): void;
}
export interface HuddleOpts { open: boolean; unreadBefore?: string | undefined }

const label = (members: readonly GroupMember[], n: number): string => listWords(members.map((m) => m.name)) + ' worked it out, ' + n + (n === 1 ? ' message' : ' messages');
let seq = 0;

/** one compact message: orb, name, to, time, the markdown */
export function huddleMessage(m: GroupText, d: HuddleDeps): HTMLElement {
  const who = d.member(m.who);
  const to = d.to(m);
  const a = el('article', { class: 'bt-hmsg', 'data-msg': m.id, 'aria-label': (who?.name ?? m.who) + (to.length ? ', to ' + listWords(to) : '') + (m.t ? ', ' + m.t : '') });
  a.append(frag('<header class="bt-hmsg__head">' + (who ? d.orb(who, 20) : '') + '<span class="bt-hmsg__name">' + esc(who?.name ?? m.who) + '</span>' +
    (to.length ? '<span class="bt-hmsg__to">to <b>' + esc(listWords(to)) + '</b></span>' : '') + (m.t ? '<time class="bt-hmsg__t">' + esc(m.t) + '</time>' : '') + '</header>'));
  const node = ui.markdown(m.text, d.ctx);
  a.append(node);
  d.drawn(m, node);
  return a;
}

/** the folded entry for a run of messages */
export function huddleEntry(msgs: readonly GroupText[], d: HuddleDeps, o: HuddleOpts): HTMLElement {
  const members = [...new Set(msgs.map((m) => m.who))].map((id) => d.member(id)).filter((m): m is GroupMember => !!m);
  const id = 'bt-huddle-' + (++seq);
  const first = msgs[0]?.t ?? '', last = msgs[msgs.length - 1]?.t ?? '';
  const stack = '<span class="bt-stack">' + members.map((m) => d.orb(m, 16)).join('') + '</span>';
  const text = label(members, msgs.length);
  const e = frag(ui.html.entry({ kind: 'bot', who: stack, callno: first && last && first !== last ? [first + ' to ' + last] : first ? [first] : [], label: text }));
  e.classList.add('bt-huddle-entry');
  e.setAttribute('data-hx-turn', ''); e.tabIndex = -1;
  e.dataset['huddle'] = String(msgs.length);
  const callno = e.querySelector('.ui-callno');
  callno?.querySelector('.ui-callno__who')?.after(frag('<span class="bt-to">between <b>themselves</b></span>'));
  const head = ui.disclosure({ label: text, controls: id, expanded: o.open });
  const body = el('div', { class: 'bt-huddle__body', id, hidden: !o.open });
  for (const m of msgs) {
    if (o.unreadBefore === m.id) body.append(unreadDivider());
    body.append(huddleMessage(m, d));
  }
  head.addEventListener('ui:change', () => { e.dataset['user'] = '1'; if (!reduced() && !body.hidden) body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' }); });
  $('.ui-entry__body', e).append(head, body);
  return e;
}
/** the user wrote: every huddle they did not open or fold themselves folds */
export function foldHuddles(log: ParentNode): void {
  for (const e of log.querySelectorAll<HTMLElement>('.bt-huddle-entry:not([data-user])')) {
    const head = e.querySelector<HTMLElement>('.ui-disclosure'), body = e.querySelector<HTMLElement>('.bt-huddle__body');
    if (head) head.setAttribute('aria-expanded', 'false');
    if (body) body.hidden = true;
  }
}
