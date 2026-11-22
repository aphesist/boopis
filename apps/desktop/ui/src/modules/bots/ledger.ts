/* The ledger (the chat research's direction A): the pieces a bot conversation adds to the call-number entry, shared by the group
   room and a bot's own chat.
     the "to" line     one margin line under the name: "to you" for an answer to the user (round 0, "you" in --text-strong), "to nina
                       and moss" for a message the members pass among themselves
     a pending entry   where a member's message will land while it works: its live orb in the state's eyes, its name, who asked and
                       the clock in the margin; the travelling dot, the state word and the tool in words in the body. A queued member
                       reads "next"
     the arrival       the entry stays where the pending one was; its blocks fade up in turn; the orb speaks for a moment
     unread            a hairline with a brass dot and "new" before the first message the user has not seen, and "N new messages"
                       above the composer while they are below the fold
     hover actions     copy, reply (prefills @handle) and open the bot's chat, in the margin under the time, on hover or focus
   Frame cost: one timer a second for the clocks while anything is pending, text only; no layout read in it. */
import { el, esc, frag, reduced } from '../../core/dom';
import { ui } from '@boopis/ui';
import type { BotLike } from '@boopis/ui';
import { oc, progressDots } from '@boopis/ui';
import { livenIn, orbHTML, setReact } from './orbs';

export const listWords = (n: readonly string[]): string => (n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + (n[n.length - 1] ?? ''));

/** the margin line that says whom a message is for; null when it is for nobody in particular */
export function toLine(names: readonly string[], prefix = 'to'): HTMLElement | null {
  if (!names.length) return null;
  const you = names.length === 1 && names[0] === 'you';
  return el('span', { class: 'bt-to' + (you ? ' is-you' : ''), html: esc(prefix) + ' <b>' + esc(listWords(names)) + '</b>' });
}
/** put a "to" line in an entry's call number, before its time */
export function placeToLine(entry: HTMLElement, line: HTMLElement | null): void {
  if (!line) return;
  const callno = entry.querySelector('.ui-callno'); if (!callno) return;
  const lines = [...callno.children].filter((c) => !c.classList.contains('ui-callno__who') && !c.classList.contains('bt-acts'));
  const time = lines[lines.length - 1];
  if (time) time.before(line); else callno.append(line);
}

/* ───────── the tool a member is in, in words ───────── */
const TOOL_WORDS: Readonly<Record<string, string>> = {
  terminal: 'in the terminal', process: 'in the terminal', execute_code: 'running code', read_file: 'reading a file', search_files: 'searching files',
  write_file: 'writing a file', patch: 'editing a file', web_search: 'searching the web', web_extract: 'reading a page', todo: 'updating its list',
  memory: 'going through its memory', session_search: 'looking through past sessions', delegate_task: 'handing off a task', clarify: 'asking a question',
  vision_analyze: 'looking at an image', image_generate: 'making an image', skill_view: 'reading a skill', skills_list: 'looking at its skills',
  send_message: 'sending a message', text_to_speech: 'recording speech', cronjob: 'scheduling', ship: 'shipping its change'
};
export function toolWords(tool: string | null | undefined): string {
  const t = String(tool ?? '').trim();
  if (!t) return '';
  if (TOOL_WORDS[t]) return TOOL_WORDS[t];
  if (t.startsWith('browser_')) return 'in the browser';
  return 'using ' + t.replace(/^mcp_/, '').replace(/[_-]+/g, ' ');
}

/* ───────── the clock ───────── */
export function elapsedWords(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + 'm ' + String(r).padStart(2, '0') + 's';
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}
const CLOCKS = new Set<HTMLElement>();
let tick = 0;
function runClocks(): void {
  if (tick) return;
  tick = window.setInterval(() => {
    const now = Date.now();
    for (const c of CLOCKS) {
      if (!c.isConnected) { CLOCKS.delete(c); continue; }
      const from = Number(c.dataset['since']);
      if (Number.isFinite(from)) c.textContent = elapsedWords(now - from);
    }
    if (!CLOCKS.size) { window.clearInterval(tick); tick = 0; }
  }, 1000);
}

/* ───────── a pending entry ───────── */
export interface PendingOpts {
  bot: BotLike & { id: string; name: string };
  status: 'queued' | 'running' | 'stopping';
  tool?: string | null | undefined;
  /** who asked it (a member's name, or "you"); omitted when nobody in particular */
  by?: string | null | undefined;
  startedAt?: number | null | undefined;
  /** what it is doing, in words already (a bot's own activity line); wins over the tool */
  activity?: string | null | undefined;
}
const stateOf = (o: PendingOpts): { word: string; state: string } =>
  o.status === 'queued' ? { word: 'next', state: 'listening' } : o.status === 'stopping' ? { word: 'stopping', state: 'thinking' } : o.tool ? { word: 'working', state: o.tool === 'terminal' || o.tool === 'execute_code' ? 'compute' : 'working' } : { word: 'thinking', state: 'thinking' };

/** where a member's message will land while it works */
export function pendingEntry(o: PendingOpts): HTMLElement {
  const s = stateOf(o);
  const e = frag(ui.html.entry({ kind: 'bot', who: orbHTML(o.bot, 20, { state: s.state }) + '<span class="bt-who-name">' + esc(o.bot.name) + '</span>', callno: [], label: o.bot.name + ', ' + s.word }));
  e.classList.add('bt-pending-entry');
  e.dataset['pending'] = o.bot.id;
  const body = e.querySelector('.ui-entry__body') as HTMLElement;
  const line = el('p', { class: 'bt-pending', role: 'status' });
  line.append(progressDots({ value: null, label: o.bot.name + ' is ' + s.word, dots: 5 }));
  line.append(el('span', { class: 'bt-pending__word' }), el('span', { class: 'bt-pending__act' }));
  body.append(line);
  livenIn(e);
  updatePending(e, o);
  return e;
}
/** change what a pending entry says, in place (its dot keeps travelling, its clock keeps counting) */
export function updatePending(e: HTMLElement, o: PendingOpts): void {
  const s = stateOf(o);
  const callno = e.querySelector('.ui-callno') as HTMLElement;
  const doing = o.activity || toolWords(o.tool);
  e.setAttribute('aria-label', o.bot.name + ', ' + s.word + (doing && o.status === 'running' ? ', ' + doing : ''));
  e.classList.toggle('is-queued', o.status === 'queued');
  setReact(e.querySelector<HTMLElement>('.ui-callno__who orb-avatar'), s.state);
  const word = e.querySelector('.bt-pending__word'); if (word) word.textContent = s.word;
  const act = e.querySelector('.bt-pending__act'); if (act) act.textContent = o.status === 'running' ? (o.activity || toolWords(o.tool)) : '';
  const dots = e.querySelector<HTMLElement>('.bt-pending .ui-progress'); if (dots) dots.hidden = o.status === 'queued';
  let by = callno.querySelector<HTMLElement>('.bt-to');
  if (o.by) { const want = toLine([o.by], 'asked by'); if (want && (!by || by.innerHTML !== want.innerHTML)) { if (by) by.replaceWith(want); else callno.append(want); } }
  else by?.remove();
  let clock = callno.querySelector<HTMLElement>('.bt-elapsed');
  if (o.startedAt && o.status !== 'queued') {
    if (!clock) { clock = el('span', { class: 'bt-elapsed' }); callno.append(clock); }
    clock.dataset['since'] = String(o.startedAt);
    clock.textContent = elapsedWords(Date.now() - o.startedAt);
    CLOCKS.add(clock); runClocks();
  } else if (clock) { CLOCKS.delete(clock); clock.remove(); }
}
/** a pending entry that goes without a message (stopped, failed): it fades out */
export function dropPending(e: HTMLElement): void {
  if (reduced() || typeof e.animate !== 'function') { e.remove(); return; }
  const a = e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'cubic-bezier(.2,.8,.2,1)' }) as Animation | undefined;
  if (a?.finished) a.finished.then(() => { e.remove(); }, () => { e.remove(); }); else e.remove();
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
export function setJump(b: HTMLButtonElement | null, n: number): void {
  if (!b) return;
  b.hidden = n <= 0;
  const label = b.querySelector('span'); if (label) label.textContent = n === 1 ? '1 new message' : n + ' new messages';
}
/** whether a scroller shows its end (within a line) */
export const atEnd = (s: HTMLElement): boolean => s.scrollHeight - s.scrollTop - s.clientHeight < 48;

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
