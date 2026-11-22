/* Presence: who is at work in a conversation, in one entry at the tail of the thread, where their replies will land.
   The chat motion research (w27/chat-motion): chat products name one typist, then two, then collapse ("several people are
   typing"); nobody repeats a row per typist. Here:
     one bot      its orb (20, the call-number size) and name in the margin, the clock under them; in the body one dot and the
                  state ("thinking") or what it is doing in words ("reading a file")
     several      the orbs side by side as the group stack draws them (one overlap step, the first underneath, "+N" the last
                  place); one sentence: "atlas and nina are thinking", "atlas is thinking, nina is reading a file",
                  "4 bots are thinking"
     rows         what differs and does not fit one sentence (three different things), and anything that needs the owner or
                  failed, gets a row of its own: its orbs, its words (Claude Code's agent panel keeps working and failed
                  agents in their own rows the same way)
     summary      past `rows` rows: "6 bots are working" with every orb in one stack and a Details disclosure that unfolds the rows
   The orbs' faces carry the state (thinking, working, compute, speaking, listening, needs, error); the words say it once.
   Motion (DESIGN-SYSTEM §11, ADR-0025), all on the compositor and from the tokens, so reduced motion makes every step instant:
     the entry rises in (`--dur-2`, 6px) and fades out (`--dur-out`); an orb that joins fades and grows in beside the others
     (`--dur-2`, several 60ms apart, like people starting to type one after another) and its neighbours glance at it; an orb
     that leaves fades and shrinks (`--dur-out`) and the rest close up (`--dur-3` on `--spring`); orbs travel between one line
     and rows on `transform` (30ms apart); words cross-fade (out `--dur-out`, in `--dur-2`) and hold at least `HOLD_MS` before a
     tool changes them again, so a burst of tools never flickers. The orbs think on their own phases (orb2 gives each a random
     one), so several thinking at once read as a conversation, not a spinner. No new loop: the one breathing dot is the
     design system's running dot (R-motion-7, R-load-1).
   Live updates never redraw an orb: an actor keeps its `<orb-avatar>` from joining to leaving; its face is an attribute
   (a canvas the orb worker owns is empty until painted, so a new node would blink).
   Accessibility: the entry is an article named by its whole sentence (every name, even when the words count them); it is not
   a live region (it sits in the thread's log, which would read every change): the coarse changes, who started, who stopped,
   who needs you, are announced once through the kit's polite region (R-a11y-7). */
import { attrs, esc, frag, nid, reduced, tokenMs } from '../core/dom';
import { announce } from './announce';
import { STATES } from './bot-state';
import type { BotLike } from './bot-state';
import { html } from './html';
import { icon } from './icons';
import { liven, oc, orbHtml } from './orb';
import { namesList, stackSplit } from './stack';

type U<T> = T | undefined;

/** what an actor is doing: thinking, in a tool, writing its reply, queued (next), stopping, waiting for the owner, failed */
export type PresenceStatus = 'thinking' | 'tool' | 'replying' | 'next' | 'stopping' | 'needs' | 'failed';
export const PRESENCE_STATUSES: readonly PresenceStatus[] = ['thinking', 'tool', 'replying', 'next', 'stopping', 'needs', 'failed'];
export type PresenceMode = 'none' | 'one' | 'line' | 'rows' | 'summary';

export interface PresenceActor {
  /** stable while it works: the orb it keeps from joining to leaving */
  id: string;
  /** drawn with its look; its name is used in the words */
  bot: BotLike;
  status: PresenceStatus;
  /** what it is doing, in words ("reading a file", "in the terminal", a bot's own activity line); wins over the state word
      while it is busy (thinking, in a tool, replying) */
  doing?: U<string | null>;
  /** a tool that computes (the terminal, running code): the compute face */
  compute?: U<boolean>;
  /** when it started, ms since the epoch; the clock counts from the earliest */
  since?: U<number | null>;
  /** who asked it, when it was not the owner: said only while it is the one at work (a hand-off) */
  by?: U<string | null>;
}
export interface PresenceOpts {
  actors?: U<readonly PresenceActor[]>;
  /** orb size: 20 in a call number (R-orb-2) */
  size?: U<number>;
  /** places in a stack, "+N" included (default 5: what the 112px margin holds at 20) */
  max?: U<number>;
  /** rows before the words count them and offer Details (default 4) */
  rows?: U<number>;
  /** the clock's now (a fixed one for the lab and tests) */
  now?: U<() => number>;
  /** every orb the entry draws, as it is drawn: a surface adds its own behaviour (the bots tab's hover and poke) */
  onOrb?: U<(orb: HTMLElement) => void>;
  /** say coarse changes through the polite region (default true; the lab's static states turn it off) */
  announce?: U<boolean>;
  class?: U<string>;
}
export interface PresenceUpdate {
  /** a reply that just landed: the orbs still at work glance at it */
  arrived?: U<Element | null>;
}
export interface PresenceElement extends HTMLElement {
  update(actors: readonly PresenceActor[], o?: PresenceUpdate): void;
  /** fades out and leaves the page (the last one stopped without a reply) */
  leave(): void;
  /** Details: the rows of a summary, open or folded */
  open: boolean;
  readonly actors: readonly PresenceActor[];
  readonly mode: PresenceMode;
  /** the sentence in plain words (a pill, an announcement): attention first */
  readonly words: string;
}

/* ───────── words ───────── */
const ATTENTION: ReadonlySet<PresenceStatus> = new Set(['needs', 'failed']);
const BUSY: ReadonlySet<PresenceStatus> = new Set(['thinking', 'tool', 'replying']);
const FACE: Readonly<Record<PresenceStatus, string>> = { thinking: 'thinking', tool: 'working', replying: 'speaking', next: 'listening', stopping: 'thinking', needs: 'needs', failed: 'error' };
/** the orb2 reaction for an actor (the design system's state map, §13) */
export const presenceFace = (a: Pick<PresenceActor, 'status' | 'compute'>): string => (a.status === 'tool' && a.compute ? 'compute' : FACE[a.status]);
/* the one vocabulary (§13) where it has a word; "next" and "stopping" are the ledger's */
const word = (s: PresenceStatus, compute?: boolean): string => ({
  thinking: STATES['thinking']?.word, tool: STATES[compute ? 'compute' : 'working']?.word, replying: STATES['speaking']?.word,
  next: 'next', stopping: 'stopping', needs: STATES['needs']?.word, failed: STATES['error']?.word
}[s] ?? s);
type Tone = 'busy' | 'quiet' | 'attention';
const toneOf = (s: PresenceStatus): Tone => (ATTENTION.has(s) ? 'attention' : BUSY.has(s) ? 'busy' : 'quiet');

/** one thing several actors are doing, in the order the first of them appears */
export interface PresenceClause { key: string; status: PresenceStatus; doing: string; compute: boolean; ids: string[] }
const doingOf = (a: PresenceActor): string => (BUSY.has(a.status) ? String(a.doing ?? '').trim() : '');
export function presenceClauses(actors: readonly PresenceActor[]): PresenceClause[] {
  const out: PresenceClause[] = [];
  for (const a of actors) {
    const doing = doingOf(a), compute = a.status === 'tool' && !!a.compute && !doing;
    const key = a.status + '|' + doing + '|' + (compute ? 'c' : '');
    const c = out.find((x) => x.key === key);
    if (c) c.ids.push(a.id); else out.push({ key, status: a.status, doing, compute, ids: [a.id] });
  }
  return out;
}

/** a piece of a sentence: plain words, a name, a state word (mono, by tone) or what it is doing */
export type PresencePart = { t: 'text' | 'name' | 'doing'; v: string } | { t: 'state'; v: string; tone: Tone };
export interface PresenceRow { key: string; ids: readonly string[]; parts: readonly PresencePart[]; tone: Tone | 'none'; summary?: boolean }
export interface PresenceLayout { mode: PresenceMode; rows: PresenceRow[] }

const nameOf = (actors: readonly PresenceActor[], id: string): string => actors.find((a) => a.id === id)?.bot.name ?? id;
function subject(actors: readonly PresenceActor[], ids: readonly string[]): PresencePart[] {
  if (ids.length > 3) return [{ t: 'text', v: ids.length + ' bots' }];
  const names = ids.map((id) => nameOf(actors, id));
  const out: PresencePart[] = [];
  names.forEach((n, i) => {
    if (i) out.push({ t: 'text', v: i === names.length - 1 ? ' and ' : ', ' });
    out.push({ t: 'name', v: n });
  });
  return out;
}
/** what a clause says after its subject; `bare` drops the verb (one bot: its name is in the margin) */
function predicate(c: PresenceClause, plural: boolean, bare: boolean): PresencePart[] {
  const verb = (v: string): PresencePart[] => (bare ? [] : [{ t: 'text', v: ' ' + v + ' ' }]);
  const state = (v: string): PresencePart => ({ t: 'state', v, tone: toneOf(c.status) });
  if (c.status === 'needs') return [...(bare ? [] : [{ t: 'text' as const, v: ' ' }]), state(plural ? 'need you' : word('needs'))];
  if (c.status === 'failed') return [...(bare ? [] : [{ t: 'text' as const, v: ' ' }]), state(word('failed'))];
  const is = plural ? 'are' : 'is';
  if (c.doing) return [...verb(is), { t: 'doing', v: c.doing }];
  return [...verb(is), state(word(c.status, c.compute))];
}
const clauseParts = (actors: readonly PresenceActor[], c: PresenceClause): PresencePart[] => [...subject(actors, c.ids), ...predicate(c, c.ids.length > 1, false)];
const rowTone = (cs: readonly PresenceClause[]): Tone | 'none' => (cs.some((c) => ATTENTION.has(c.status)) ? 'attention' : cs.some((c) => BUSY.has(c.status)) ? 'busy' : 'none');

/** how the entry draws a set of actors: the mode and its rows (pure; the element and the tests share it) */
export function presenceLayout(actors: readonly PresenceActor[], o: { rows?: U<number>; open?: U<boolean> } = {}): PresenceLayout {
  if (!actors.length) return { mode: 'none', rows: [] };
  const clauses = presenceClauses(actors);
  if (actors.length === 1) {
    const c = clauses[0] as PresenceClause;
    return { mode: 'one', rows: [{ key: c.key, ids: c.ids, parts: predicate(c, false, true), tone: rowTone([c]) }] };
  }
  const normal = clauses.filter((c) => !ATTENTION.has(c.status)), alert = clauses.filter((c) => ATTENTION.has(c.status));
  if (!alert.length && normal.length <= 2) {
    const parts: PresencePart[] = [];
    normal.forEach((c, i) => { if (i) parts.push({ t: 'text', v: ', ' }); parts.push(...clauseParts(actors, c)); });
    return { mode: 'line', rows: [{ key: 'line', ids: actors.map((a) => a.id), parts, tone: rowTone(normal) }] };
  }
  const own = (c: PresenceClause): PresenceRow => ({ key: c.key, ids: c.ids, parts: clauseParts(actors, c), tone: rowTone([c]) });
  const max = Math.max(1, o.rows ?? 4);
  if (normal.length + alert.length <= max) return { mode: 'rows', rows: [...normal, ...alert].map(own) };
  const ids = normal.flatMap((c) => c.ids);
  const head: PresenceRow = { key: 'summary', ids: o.open ? [] : ids, parts: [{ t: 'text', v: ids.length + ' bots are ' }, { t: 'state', v: word('tool'), tone: 'busy' }], tone: 'busy', summary: true };
  return { mode: 'summary', rows: [head, ...(o.open ? normal.map(own) : []), ...alert.map(own)] };
}
const plain = (parts: readonly PresencePart[]): string => parts.map((p) => p.v).join('');
/** the sentence in plain words, attention first ("nina needs you", "atlas and kai are thinking"); one bot is named */
export function presenceWords(actors: readonly PresenceActor[]): string {
  if (!actors.length) return '';
  const clauses = presenceClauses(actors);
  const alert = clauses.filter((c) => ATTENTION.has(c.status)), normal = clauses.filter((c) => !ATTENTION.has(c.status));
  const first = alert[0];
  if (first) return plain(clauseParts(actors, first));
  if (normal.length <= 2) return normal.map((c) => plain(clauseParts(actors, c))).join(', ');
  return actors.length + ' bots are ' + word('tool');
}
/** the entry's accessible name: every clause, and every name when the words count them */
export function presenceLabel(actors: readonly PresenceActor[]): string {
  const clauses = presenceClauses(actors);
  const said = clauses.map((c) => plain(clauseParts(actors, c))).join(', ');
  const counted = clauses.some((c) => c.ids.length > 3);
  return said + (counted ? ': ' + namesList(actors.map((a) => a.bot.name ?? a.id)) : '');
}

/** "42s", "3m 05s", "1h 02m" */
export function elapsedWords(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + 'm ' + String(r).padStart(2, '0') + 's';
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}

/* ───────── the clocks: one timer a second while any presence counts, text only, no layout read ───────── */
const CLOCKS = new Map<HTMLElement, () => number>();
let tick = 0;
function paintClock(c: HTMLElement, now: () => number): void {
  const from = Number(c.dataset['since']);
  const t = Number.isFinite(from) && from > 0 ? elapsedWords(now() - from) : '';
  if (c.textContent !== t) c.textContent = t;
}
function runClocks(): void {
  if (tick) return;
  tick = window.setInterval(() => {
    for (const [c, now] of CLOCKS) { if (!c.isConnected) { CLOCKS.delete(c); continue; } paintClock(c, now); }
    if (!CLOCKS.size) { window.clearInterval(tick); tick = 0; }
  }, 1000);
}

/* ───────── the element ───────── */
/** how long words stay before a tool changes them again (a new or departing bot changes them at once) */
export const HOLD_MS = 1200;
const GLANCE_MS = 900;
const JOIN_STAGGER = 60, TRAVEL_STAGGER = 30;
const partHTML = (p: PresencePart): string =>
  p.t === 'name' ? '<b class="ui-presence__who">' + esc(p.v) + '</b>' : p.t === 'doing' ? '<span class="ui-presence__doing">' + esc(p.v) + '</span>' : p.t === 'state' ? '<span class="ui-state" data-tone="' + (p.tone === 'quiet' ? 'quiet' : p.tone) + '">' + esc(p.v) + '</span>' : esc(p.v);
const markHTML = (tone: Tone | 'none'): string => '<span class="ui-presence__mark">' + (tone === 'busy' ? html.dot('run') : tone === 'attention' ? html.dot('attention') : '') + '</span>';
const nextFrame = (fn: () => void): void => { requestAnimationFrame(() => requestAnimationFrame(fn)); };
type Orb = HTMLElement & { _hover?: boolean };
/** write an orb's face without redrawing it; a hovered orb keeps listening and takes the face when the pointer leaves (orbs.ts) */
function setFace(o: Orb | null, face: string): void {
  if (!o) return;
  o.dataset['base'] = face;
  if (!o._hover && o.getAttribute('reaction') !== face) o.setAttribute('reaction', face);
}
const plainBot = (b: BotLike): BotLike => ({ ...b, attention: null, paused: false });
/** drop a node after its exit transition (or at once under reduced motion, where the token is 1ms) */
function exit(n: HTMLElement, after?: () => void): void {
  n.setAttribute('data-leave', '');
  const ms = reduced() ? 0 : tokenMs('--dur-out', 120) + 40;
  window.setTimeout(() => { n.remove(); after?.(); }, ms);
}

export function presence(o: PresenceOpts = {}): PresenceElement {
  const size = o.size ?? 20, maxPlaces = Math.max(2, o.max ?? 5), maxRows = o.rows ?? 4, now = o.now ?? Date.now;
  const id = nid('presence');
  const root = frag<PresenceElement>(html.entry({ kind: 'bot', who: '<span class="ui-stack ui-stack--live ui-presence__orbs" aria-hidden="true" style="--s:' + size + 'px"></span><span class="ui-presence__name"></span>', callno: [], label: '' }));
  root.classList.add('ui-presence');
  root.style.setProperty('--s', size + 'px');   /* the orb size: the stack's places and the rows' pitch */
  if (o.class) root.classList.add(...o.class.split(/\s+/).filter(Boolean));
  root.setAttribute('aria-live', 'off');
  const callno = root.querySelector('.ui-callno') as HTMLElement;
  const layer = root.querySelector('.ui-presence__orbs') as HTMLElement;
  const name = root.querySelector('.ui-presence__name') as HTMLElement;
  const by = document.createElement('span'); by.className = 'ui-presence__by';
  const clock = document.createElement('span'); clock.className = 'ui-presence__clock';
  callno.append(by, clock);
  const body = root.querySelector('.ui-entry__body') as HTMLElement;
  const disclosure = frag<HTMLButtonElement>(html.disclosure({ label: 'Details', controls: id + '-rows', expanded: false }));
  disclosure.removeAttribute('data-ui');   /* toggled here, never by a hydrate of the page around it (it would toggle twice) */
  disclosure.addEventListener('click', () => { st.open = !st.open; disclosure.setAttribute('aria-expanded', String(st.open)); paint(st.actors, {}, true); });

  const slots = new Map<string, HTMLElement>();     /* actor id -> its slot (the orb inside never changes) */
  const more = new Map<string, HTMLElement>();      /* row key -> its "+N" disc */
  const st = { actors: [] as readonly PresenceActor[], mode: 'none' as PresenceMode, open: false, sig: '', text: '', wordsAt: 0, words: null as HTMLElement | null, pending: 0, first: true, left: false };

  const orbOf = (s: HTMLElement | undefined): Orb | null => s?.querySelector<Orb>('orb-avatar') ?? null;
  function makeSlot(a: PresenceActor): HTMLElement {
    const s = frag('<span class="ui-stack__one ui-presence__slot" data-id="' + esc(a.id) + '" data-enter><span class="ui-presence__pop">' + orbHtml(plainBot(a.bot), { size, state: presenceFace(a) }) + '</span></span>');
    const orb = orbOf(s);
    if (orb) { orb.dataset['base'] = presenceFace(a); if (o.onOrb) o.onOrb(orb); else liven(orb, { size }); }
    return s;
  }
  const place = (s: HTMLElement, col: number, row: number): void => { s.style.setProperty('--col', String(col)); s.style.setProperty('--row', String(row)); };

  /** the orbs where the layout puts them: new ones enter, gone ones leave, the rest travel */
  function paintOrbs(layout: PresenceLayout, byId: Map<string, PresenceActor>, travel: boolean): string[] {
    const want = new Map<string, [number, number]>(), wantMore = new Map<string, [number, number, number]>();
    let cols = 1;
    layout.rows.forEach((r, ri) => {
      if (!r.ids.length) return;
      const { shown, more: n } = stackSplit(r.ids.length, maxPlaces);
      r.ids.slice(0, shown).forEach((aid, ci) => want.set(aid, [ci, ri]));
      if (n) wantMore.set(r.key, [shown, ri, n]);
      cols = Math.max(cols, shown + (n ? 1 : 0));
    });
    const joined: string[] = [];
    for (const [aid, s] of slots) if (!want.has(aid)) { slots.delete(aid); exit(s); }
    let k = 0, t = 0;
    for (const [aid, [c, r]] of want) {
      const a = byId.get(aid) as PresenceActor;
      let s = slots.get(aid);
      if (!s) {
        s = makeSlot(a); place(s, c, r);
        s.style.setProperty('--delay', (st.first ? 0 : k++ * JOIN_STAGGER) + 'ms');
        layer.append(s); slots.set(aid, s); joined.push(aid);
        const n = s; nextFrame(() => { n.removeAttribute('data-enter'); });
      } else {
        s.style.setProperty('--delay', (travel ? t++ * TRAVEL_STAGGER : 0) + 'ms');
        place(s, c, r);
        setFace(orbOf(s), presenceFace(a));
      }
    }
    for (const [key, m] of more) if (!wantMore.has(key)) { more.delete(key); exit(m); }
    for (const [key, [c, r, n]] of wantMore) {
      let m = more.get(key);
      if (!m) { m = frag('<span class="ui-stack__more ui-presence__slot" data-enter></span>'); layer.append(m); more.set(key, m); const x = m; nextFrame(() => { x.removeAttribute('data-enter'); }); }
      m.setAttribute('data-more', '+' + n);
      place(m, c, r);
    }
    layer.style.setProperty('--cols', String(cols));
    layer.style.setProperty('--rows', String(Math.max(1, layout.rows.length)));
    return joined;
  }

  /** the words, cross-faded when they change */
  function paintWords(layout: PresenceLayout): void {
    const fixed = layout.mode === 'rows' || layout.mode === 'summary';
    const next = document.createElement('div');
    next.className = 'ui-presence__words';
    if (fixed) next.setAttribute('data-fixed', '');
    for (const r of layout.rows) {
      const p = document.createElement('p');
      p.className = 'ui-presence__row';
      p.innerHTML = markHTML(r.tone) + '<span class="ui-presence__text">' + r.parts.map(partHTML).join('') + '</span>';
      if (fixed) p.setAttribute('data-tip', plain(r.parts));
      if (r.summary) { const had = document.activeElement === disclosure; p.append(disclosure); if (had) disclosure.focus({ preventScroll: true }); }
      next.append(p);
    }
    if (layout.mode === 'summary') { disclosure.hidden = false; next.id = id + '-rows'; }
    const old = st.words;
    st.words = next;
    if (old && old.isConnected && !reduced()) {
      old.removeAttribute('id');
      exit(old);
      next.setAttribute('data-enter', '');
      body.prepend(next);
      nextFrame(() => { next.removeAttribute('data-enter'); });
    } else { old?.remove(); body.prepend(next); }
  }

  /** the orbs still at work look at something for a moment (a newcomer, a reply that landed): one read of where it is, then a look */
  function glance(at: Element | null | undefined, who: readonly string[]): void {
    if (!at || !who.length) return;
    requestAnimationFrame(() => {
      const r = at.getBoundingClientRect(); if (!r.width && !r.height) return;
      const x = r.left + Math.min(r.width, 120) / 2, y = r.top + Math.min(r.height, 24) / 2;
      for (const aid of who) {
        const orb = orbOf(slots.get(aid)); if (!orb) continue;
        orb.setAttribute('data-glance-hold', '');
        oc(orb, 'lookAt', x, y);
        window.setTimeout(() => { orb.removeAttribute('data-glance-hold'); oc(orb, 'lookAt'); }, GLANCE_MS);
      }
    });
  }

  function paint(actors: readonly PresenceActor[], u: PresenceUpdate, force = false): void {
    window.clearTimeout(st.pending); st.pending = 0;
    const before = st.actors;
    st.actors = actors;
    const layout = presenceLayout(actors, { rows: maxRows, open: st.open });
    const travel = layout.mode !== st.mode && st.mode !== 'none';
    st.mode = layout.mode;
    root.dataset['mode'] = layout.mode;
    const byId = new Map(actors.map((a) => [a.id, a] as const));
    const joined = paintOrbs(layout, byId, travel);
    /* one bot: its name in the margin, and who asked it when that was not the owner (a hand-off) */
    const solo = layout.mode === 'one' ? actors[0] : undefined;
    const nm = solo?.bot.name ?? '';
    if (name.textContent !== nm) name.textContent = nm;
    name.hidden = !solo;
    by.innerHTML = solo?.by && solo.by !== 'you' ? 'asked by <b>' + esc(solo.by) + '</b>' : '';
    by.hidden = !by.innerHTML;
    /* the clock counts from the earliest start of those at work (a queued bot has not started) */
    const starts = actors.filter((a) => a.status !== 'next' && a.since).map((a) => a.since as number);
    clock.dataset['since'] = starts.length ? String(Math.min(...starts)) : '';
    paintClock(clock, now);
    if (starts.length) { CLOCKS.set(clock, now); runClocks(); } else CLOCKS.delete(clock);
    disclosure.hidden = layout.mode !== 'summary';
    if (layout.mode !== 'summary' && st.open) { st.open = false; disclosure.setAttribute('aria-expanded', 'false'); }
    root.setAttribute('aria-label', presenceLabel(actors));
    const tip = namesList(actors.map((a) => a.bot.name ?? a.id));
    if (layer.getAttribute('data-tip') !== tip) layer.setAttribute('data-tip', tip);
    /* the words: at once when who or what kind of work changes, else after they have been read */
    const sig = layout.mode + '|' + actors.map((a) => a.id + ':' + (BUSY.has(a.status) ? 'busy' : a.status)).join(',') + '|' + st.open;
    const text = layout.rows.map((r) => r.tone + plain(r.parts)).join('/') + '|' + st.open;
    const changed = text !== st.text;
    if (changed) {
      const wait = st.wordsAt + HOLD_MS - performance.now();
      if (sig === st.sig && wait > 0 && !force) st.pending = window.setTimeout(() => { paint(st.actors, {}); }, wait);
      else { paintWords(layout); st.text = text; st.wordsAt = performance.now(); }
    }
    if (sig !== st.sig && o.announce !== false && !st.first) {
      const gone = before.filter((a) => !byId.has(a.id));
      announce(actors.length ? presenceWords(actors) : gone.length ? namesList(gone.map((a) => a.bot.name ?? a.id)) + (gone.length > 1 ? ' have' : ' has') + ' stopped' : '');
    } else if (st.first && o.announce !== false && actors.length) announce(presenceWords(actors));
    st.sig = sig;
    /* who looks at what: the ones already here at a newcomer, those still at work at a reply that landed */
    const stay = actors.filter((a) => before.some((b) => b.id === a.id)).map((a) => a.id);
    if (!st.first && joined.length) glance(slots.get(joined[joined.length - 1] as string), stay.filter((x) => !joined.includes(x)));
    if (u.arrived) glance(u.arrived, stay);
    if (st.first) { st.first = false; root.setAttribute('data-enter', ''); nextFrame(() => { root.removeAttribute('data-enter'); }); }
  }

  Object.defineProperties(root, {
    actors: { get: () => st.actors },
    mode: { get: () => st.mode },
    words: { get: () => presenceWords(st.actors) },
    open: { get: () => st.open, set: (v: boolean) => { if (st.open === !!v) return; st.open = !!v; disclosure.setAttribute('aria-expanded', String(st.open)); paint(st.actors, {}, true); } }
  });
  root.update = (actors, u = {}): void => { if (!st.left) paint(actors, u); };
  root.leave = (): void => {
    if (st.left) return;
    st.left = true; window.clearTimeout(st.pending); CLOCKS.delete(clock);
    if (o.announce !== false && st.actors.length) announce(namesList(st.actors.map((a) => a.bot.name ?? a.id)) + (st.actors.length > 1 ? ' have' : ' has') + ' stopped');
    if (!root.isConnected) return;
    exit(root);
  };
  paint(o.actors ?? [], {});
  return root;
}

/* ───────── the pill: the same presence, small, when the end of the conversation is out of view ─────────
   The room's jump button grows the bots at work: their orbs at 16 (still, as every 16px orb is: R-orb-4, and nothing more
   animates in a second corner of the window) and the words, or "N new messages" once replies have arrived below. */
export interface PresencePill extends HTMLButtonElement {
  paint(actors: readonly PresenceActor[], unread?: number): void;
}
export function presencePill(o: { size?: U<number>; max?: U<number> } = {}): PresencePill {
  const size = o.size ?? 16, max = o.max ?? 4;
  const b = frag<PresencePill>(html.button({ label: '', size: 's', class: 'ui-presence-pill' }));
  b.style.setProperty('--s', size + 'px');
  b.insertAdjacentHTML('afterbegin', '<span class="ui-stack ui-presence-pill__stack" aria-hidden="true"' + attrs({ style: '--s:' + size + 'px' }) + '></span>');
  b.insertAdjacentHTML('beforeend', icon('chevron-down'));
  const stack = b.querySelector('.ui-presence-pill__stack') as HTMLElement;
  const label = b.querySelector(':scope > span:not(.ui-stack)') as HTMLElement;
  label.classList.add('ui-presence-pill__label');
  const kept = new Map<string, HTMLElement>();
  b.paint = (actors, unread = 0): void => {
    const { shown, more } = stackSplit(actors.length, max);
    const ids = actors.slice(0, shown).map((a) => a.id);
    for (const [k, n] of kept) if (!ids.includes(k)) { kept.delete(k); n.remove(); }
    for (const a of actors.slice(0, shown)) {
      let n = kept.get(a.id);
      if (n) { setFace(n.querySelector<Orb>('orb-avatar'), presenceFace(a)); continue; }
      /* only a new orb is inserted: one already drawn is never moved (a moved orb is detached and drawn again) */
      n = frag('<span class="ui-stack__one">' + orbHtml(plainBot(a.bot), { size, state: presenceFace(a), still: true }) + '</span>');
      kept.set(a.id, n);
      stack.insertBefore(n, stack.querySelector(':scope > .ui-stack__more'));
    }
    let m = stack.querySelector<HTMLElement>(':scope > .ui-stack__more');
    if (more) { if (!m) { m = frag('<span class="ui-stack__more"></span>'); stack.append(m); } m.setAttribute('data-more', '+' + more); } else m?.remove();
    stack.hidden = !actors.length;
    const t = unread > 0 ? (unread === 1 ? '1 new message' : unread + ' new messages') : presenceWords(actors) || 'Jump to the end';
    if (label.textContent !== t) label.textContent = t;
    b.setAttribute('aria-label', t + (unread > 0 && actors.length ? ', ' + presenceWords(actors) : '') + '. Go to the end');
  };
  return b;
}
