/* The ledger (the chat research's direction A): the pieces a bot conversation adds to the call-number entry, shared by the group
   room and a bot's own chat.
     the "to" line     one margin line under the name: "to you" for an answer to the user (round 0, "you" in --text-strong), "to nina
                       and moss" for a message the members pass among themselves
     who is at work    one presence entry where the replies will land (the kit's `ui.presence`, placed by presence.ts); the tool a
                       member is in, in words, is `data/tool-words.ts`
     the arrival       a reply lands where the presence entry was (above it while others still work); its blocks fade up in
                       turn; the orb speaks for a moment
     unread            a hairline with a brass dot and "new" before the first message the user has not seen, and "N new messages"
                       above the composer while they are below the fold ("1 for you" and the attention dot when one addresses them)
     hover actions     copy, reply (prefills @handle) and open the bot's chat, in the margin under the time, on hover or focus
   Frame cost: no timer here; the presence keeps the one clock. */
import { el, esc, reduced } from '../../core/dom';
import { ui } from '@boopis/ui';
import { oc } from '@boopis/ui';
import { setReact } from './orbs';

export const listWords = (n: readonly string[]): string => (n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + (n[n.length - 1] ?? ''));

/** the margin line that says whom a message is for; null when it is for nobody in particular */
export function toLine(names: readonly string[], prefix = 'to'): HTMLElement | null {
  if (!names.length) return null;
  const you = names.length === 1 && names[0] === 'you';
  return el('span', { class: 'bt-to' + (you ? ' is-you' : ''), html: esc(prefix) + ' <b>' + esc(listWords(names)) + '</b>' });
}
/** put a "to" line in an entry: on a v7 turn after the member's name above its first bubble (or, for your own, on the turn's top
    line, at its end); on a v6 entry in its call number, before its time */
export function placeToLine(entry: HTMLElement, line: HTMLElement | null): void {
  if (!line) return;
  const byline = entry.querySelector('.k7-byline');
  if (byline) { byline.append(' ', line); return; }
  if (entry.classList.contains('bt-turn')) { entry.prepend(el('div', { class: 'bt-turn__to' }, line)); return; }
  const callno = entry.querySelector('.ui-callno'); if (!callno) return;
  const lines = [...callno.children].filter((c) => !c.classList.contains('ui-callno__who') && !c.classList.contains('bt-acts'));
  const time = lines[lines.length - 1];
  if (time) time.before(line); else callno.append(line);
}

/* ───────── the arrival ───────── */
/** a message lands: its blocks fade up in turn, the orb speaks for a moment and settles */
export function arrival(entry: HTMLElement, body: HTMLElement | null): void {
  if (body) ui.markdown.arrive(body);
  else if (!reduced() && typeof entry.animate === 'function') entry.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  const o = entry.querySelector<HTMLElement>('.ui-callno__who orb-avatar');
  if (o) { setReact(o, 'speaking'); window.setTimeout(() => { setReact(o, 'idle'); }, 1600); }
}
/** the speaker's orb glances at the teammate it handed to (one read of where that teammate's orb is, then a look) */
export function glanceAt(from: HTMLElement | null | undefined, to: HTMLElement | null | undefined): void {
  const a = from?.querySelector<HTMLElement>('.ui-callno__who orb-avatar'), b = to?.querySelector<HTMLElement>('.ui-callno__who orb-avatar');
  if (!a || !b) return;
  requestAnimationFrame(() => { const r = b.getBoundingClientRect(); oc(a, 'lookAt', r.left + r.width / 2, r.top + r.height / 2); window.setTimeout(() => { oc(a, 'lookAt'); }, 1200); });
}

/* ───────── unread ───────── */
/** the hairline with a brass dot and "new" */
export const unreadDivider = (): HTMLElement => el('div', { class: 'bt-unread', role: 'separator', 'aria-label': 'New messages since you last looked', html: ui.html.dot('here') + '<span>new</span>' });
/** "N new messages" above the composer: a button that scrolls to the latest */
export function jumpButton(onJump: () => void): HTMLButtonElement {
  const b = ui.button({ label: 'New messages', size: 's', icon: 'chevron-down', class: 'bt-jump' });
  b.hidden = true;
  b.addEventListener('click', onJump);
  return b;
}
/** how many messages arrived below the fold, and how many of them address the person (`@user`): those add the attention dot and say so */
export function setJump(b: HTMLButtonElement | null, n: number, you = 0): void {
  if (!b) return;
  b.dataset['unread'] = String(Math.max(0, n));   /* the presence pill reads it (presence.ts) */
  b.hidden = n <= 0;
  const label = b.querySelector('span'); if (label) label.textContent = (n === 1 ? '1 new message' : n + ' new messages') + (you > 0 && n > 0 ? (n === 1 ? ', for you' : ', ' + you + ' for you') : '');
  const dot = b.querySelector(':scope > .ui-dot');
  if (you > 0 && n > 0 && !dot) b.insertAdjacentHTML('beforeend', ui.html.dot('attention'));
  else if (!(you > 0 && n > 0)) dot?.remove();
}
/** whether a scroller shows its end (within a line): the chats' one definition */
export { atEnd } from '../chat/follow-zone';

/* ───────── hover actions ───────── */
export interface ActsOpts { name: string; copy: () => string; reply?: (() => void) | undefined; open?: (() => void) | undefined }
/** copy, reply and open the bot's chat, in the margin under the time; shown on hover or focus */
export function entryActs(entry: HTMLElement, o: ActsOpts): void {
  const callno = entry.querySelector('.ui-callno'); if (!callno || callno.querySelector('.bt-acts')) return;
  const acts = el('span', { class: 'bt-acts' });
  const copy = ui.iconButton({ icon: 'copy', label: 'Copy ' + o.name + '’s message', tip: 'Copy', size: 's', keys: 'C', class: 'ui-corner' });
  copy.addEventListener('click', () => { void ui.copyText(o.copy()); });
  acts.append(copy);
  if (o.reply) { const r = o.reply; const b = ui.iconButton({ icon: 'at', label: 'Reply to ' + o.name, tip: 'Reply', size: 's', class: 'ui-corner' }); b.addEventListener('click', () => { r(); }); acts.append(b); }
  if (o.open) { const op = o.open; const b = ui.iconButton({ icon: 'bots', label: 'Open ' + o.name + '’s chat', tip: 'Open chat', size: 's', class: 'ui-corner' }); b.addEventListener('click', () => { op(); }); acts.append(b); }
  callno.append(acts);
}
