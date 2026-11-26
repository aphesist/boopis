/* The dock on the v7 kit (DESIGN-SYSTEM.md v7 21.4; the kit's Dock, `components/v7/dock.ts`). Registers as the `dock` module.

   What it is for: reaching your bots and their asks while you work in a session. It is the Sessions tab's alone (never in the
   Bots tab), and it is not drawn until you have a bot of your own (boopis alone does not count; a session alone never draws it).
   One component, three geometries (the kit's): the row at rest (orbs 40, gap 14, 72 tall, its width fitting its content, at most
   640: D01 B shows the bots that matter now, then "N more" to the Bots tab), and open (640 x 432) for the stack of asks (D03 C:
   the amber ask pill at the row's end opens it) or a bot's card (its head, its last messages as Bubbles, its AskCard, a composer),
   with the row under it as the switcher. A hover or focus names the bot and its state in the row's end slot. Removed with v7:
   "+", the expanded roster, the pages (Run, Needs you, Scheduled, Context) and their nub, Arrange, the minimised pill, the
   card's strip of mini orbs and the orb tooltips.

   WebKitGTK (tests/e2e/dock_webkit.py): the row's live orbs are made once, in place, and never taken out of the page: a bot's rank
   is its button's CSS `order`, a bot past the fit is out of the row but still drawn (`data-out`), a hover writes its size (`--s`, `--g`). Nothing is clipped with
   `clip` or `clip-path`: the open panel clips by its own overflow, and the dock is centred on its anchor by layout, never by a
   -50% translation.

   Listens: hx:layout, hx:state, hx:theme, hx:nav, and the provider's bots and waits. Emits: hx:dock (the room the composer keeps
   above it), hx:bot-select. Every decision and message is a provider command. */
import { emit, on } from '../../core/bus';
import { register, setDockApi } from '../../core/registry';
import { getLayout, setState, state as appState } from '../../core/state';
import { $$, clamp, isMac, onReducedChange, reduced } from '../../core/dom';
import { kit, lookOf, oc, paintLook, repaintLook, restReact, ui } from '@boopis/ui';
import type { AskCardOpts, DockBot } from '@boopis/ui';
import { data } from '../../data';
import type { Bot, ThreadMessage, Wait } from '../../data';
import { asksOf, askWords, BOOPIS_ID, fit, ordered, ownBots, shows } from './model';
import { composeTools, mentionChips, voiceNeedsSetup } from '../chat/compose';
import { mentionCtx } from '../chat/refs';
import { dockRoom } from './geometry';

/* the kit's geometry (tokens.v7.json dock.geometry): the row, and open */
const G = kit.dockGeometry;
const ROW = G.row, OPEN = G.open;
const GROW_EXTRA = ROW.grow[0] + 2 * ROW.grow[1] - 3 * ROW.orb;
/** messages a bot's card shows */
const LOG_N = 4;

type Open = null | { kind: 'stack' } | { kind: 'card'; id: string };
const S = {
  bots: [] as Bot[], threads: {} as Record<string, ThreadMessage[]>, waits: [] as Wait[], runs: new Set<string>(),
  open: null as Open, hover: null as string | null, focus: null as string | null,
  /** drawn now (risen), and wanted (it is rising or will) */
  shown: false, want: false, seq: 0,
  /** bot ids in the row's order, and how many show */
  rank: [] as string[], fitN: 0,
  timeScale: 1, mounted: false, width: 0
};
const ph = (): HTMLElement => document.createElement('div');
const X = {
  slot: ph(), root: ph(), dock: ph(), row: ph(), path: null as SVGPathElement | null, svg: null as SVGSVGElement | null,
  more: null as HTMLElement | null, end: null as HTMLElement | null, panel: null as HTMLElement | null,
  orbs: new Map<string, HTMLButtonElement>(), composers: new Map<string, CardComposer>()
};
/** a bot's composer in its card: the kit's one-row Composer in a slot of its own, kept per bot so a draft survives the card closing */
interface CardComposer { slot: HTMLElement; listening: boolean; draw(): void; stop(): void }
const T = (ms: number): number => (reduced() ? 0 : ms / S.timeScale);
const botById = (id: string | null | undefined): Bot | undefined => S.bots.find((b) => b.id === id);
const nameOf = (id: string): string => botById(id)?.name ?? id;
const asks = (): Wait[] => asksOf(S.waits, S.bots);
const stateWords = (b: Bot): [string, 'owe' | 'neutral'] => { const s = ui.botState(b); return [s.word, s.attention ? 'owe' : 'neutral']; };
const dockBot = (b: Bot): DockBot => ({ id: b.id, name: b.name, shape: b.shape, color: b.color, state: b.state, attention: b.attention, paused: b.paused, needs: !!ui.botState(b).attention, ink: b.id === BOOPIS_ID });
const HINT = `Click or Enter opens its card here. Click it again, or Esc, to close. Double-click or ${isMac ? 'Command' : 'Control'}+Enter opens the full chat in the Bots tab.`;

/* ───────── the geometry: one set of attributes, the kit's ───────── */
/** the dock takes a geometry: its attributes and size variables are the kit's own Dock's for that geometry (`kit.html.dock`) */
function setKind(kind: 'row' | 'open'): void {
  if (X.dock.dataset['dk'] === kind) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = kit.html.dock({ kind, bots: [] });
  const ref = tpl.content.firstElementChild;
  if (!ref) return;
  for (const n of ['data-dk', 'data-geom', 'data-pad']) X.dock.setAttribute(n, ref.getAttribute(n) ?? '');
  for (const v of ['--dk-h', '--dk-r', '--dk-f', '--dk-pad', '--dk-gap', '--dk-max']) X.dock.style.setProperty(v, (ref as HTMLElement).style.getPropertyValue(v));
}
/** the slab's path for the box as laid out now: its width follows the content and eases, its height grows to the open size */
function paintSlab(w: number, h: number): void {
  if (!X.svg || !X.path || !w || !h) return;
  const F = OPEN.F;
  X.svg.setAttribute('viewBox', '0 0 ' + (w + 2 * F) + ' ' + h); X.svg.setAttribute('width', String(w + 2 * F)); X.svg.setAttribute('height', String(h));
  X.path.setAttribute('d', kit.dockParts.slab(w, h, OPEN.R, F));
}

/* ───────── the row ───────── */
function orbAttrs(b: Bot): Record<string, string> { return { 'aria-label': ui.botLabel(b), 'aria-describedby': 'dk-hint' }; }
/** a bot's orb: made once, in place in the row (an orb made in a template and moved in is not painted by its worker) */
function addOrb(b: Bot): HTMLButtonElement {
  const html = kit.dockParts.orb(dockBot(b), ROW.orb, { render: ROW.grow[0], attrs: orbAttrs(b) });
  if (X.more) X.more.insertAdjacentHTML('beforebegin', html); else X.row.insertAdjacentHTML('beforeend', html);
  const btn = X.row.querySelector<HTMLButtonElement>('.k7-dock__orb[data-bot="' + CSS.escape(b.id) + '"]');
  if (!btn) throw new Error('the dock could not draw ' + b.id);
  kit.wire(btn);
  X.orbs.set(b.id, btn);
  return btn;
}
/** a bot's orb follows it in place: its name, its flag, its look and its reaction (the pose at rest) */
function patchOrb(b: Bot): void {
  const btn = X.orbs.get(b.id); if (!btn) return;
  const s = ui.botState(b);
  btn.setAttribute('aria-label', ui.botLabel(b));
  const flag = btn.querySelector('.k7-flag');
  if (s.attention && !flag) btn.insertAdjacentHTML('beforeend', '<span class="k7-flag" aria-hidden="true"></span>'); else if (!s.attention && flag) flag.remove();
  const o = btn.querySelector('orb-avatar');
  if (o) { paintLook(o, lookOf(b)); restReact(o, X.composers.get(b.id)?.listening ? 'listening' : s.reaction); }
}
/** the end slot: the hovered bot's name and state, else the ask pill, else nothing. A bot focused by the keyboard takes the Iris ring
    and the slot keeps the pill (board DK1, "focus"): the pill is the row's last stop, so the keys reach it */
function drawEnd(): void {
  const who = botById(S.hover), a = asks();
  const html = who ? kit.dockParts.cap(who.name, ...stateWords(who)) : a.length && S.open?.kind !== 'stack' ? kit.dockParts.ask(askWords(a, nameOf)) : '';
  const sig = who ? 'cap:' + who.id + ':' + stateWords(who)[0] : html;
  if (X.end?.dataset['sig'] === sig && (html !== '' || !X.end)) return;
  /* the pill gives way to a hovered bot's name: a keyboard's focus on it goes to the row's first bot, never to the page */
  const held = !!X.end && X.end === document.activeElement;
  X.end?.remove(); X.end = null;
  if (held) visibleOrbs()[0]?.focus({ preventScroll: true });
  if (!html) return;
  X.row.insertAdjacentHTML('beforeend', html);
  X.end = X.row.lastElementChild as HTMLElement;
  X.end.dataset['sig'] = sig;
  X.end.style.order = '1001';
  /* one tab stop for the row (a toolbar): the arrows reach the pill */
  if (X.end.matches('.k7-dock__ask')) { X.end.setAttribute('aria-label', askWords(a, nameOf) + ', open the asks'); X.end.tabIndex = -1; }
}
function drawMore(n: number): void {
  if (!n) { X.more?.remove(); X.more = null; return; }
  if (X.more?.dataset['n'] === String(n)) return;
  X.more?.remove();
  X.row.insertAdjacentHTML('beforeend', kit.dockParts.more(n));
  X.more = X.row.lastElementChild as HTMLElement;
  X.more.dataset['n'] = String(n); X.more.dataset['act'] = 'more'; X.more.style.order = '1000'; X.more.tabIndex = -1;
  kit.wire(X.more);
}
/** the sizes on the row now: the hovered orb 52, its neighbours 46, the rest 40 ("Grow bots on hover" off: all 40) */
function sizeOf(i: number, hi: number): number {
  if (hi < 0 || appState.orbGrow === false) return ROW.orb;
  return i === hi ? ROW.grow[0] : Math.abs(i - hi) === 1 ? ROW.grow[1] : ROW.orb;
}
/** the room the dock may take: at most 640, and the room around its middle between the bars (geometry.ts dockRoom) */
function room(): number {
  const L = getLayout(), vw = innerWidth;
  const r = dockRoom({ centred: appState.dockCentred, viewportW: L ? L.viewportW : vw, centerX: L ? L.centerX : vw / 2, viewLeft: L ? L.viewLeft : 0, viewRight: L ? L.viewRight : vw, flare: OPEN.F });
  return Math.min(ROW.w, r > 0 ? r : vw - 2 * OPEN.F);
}
/** order, fit, sizes and width: every bot's rank is its button's `order`, a bot past the fit is out of the row (`data-out`), the width is the content's */
function layoutRow(): void {
  const list = ordered(S.bots);
  S.rank = list.map((b) => b.id);
  drawEnd();
  const endW = X.end ? X.end.offsetWidth : 0;
  let moreW = 0;
  if (list.length > 1) { drawMore(list.length); moreW = X.more ? X.more.offsetWidth : 0; }
  const f = fit(list.length, { room: room(), pad: ROW.pad, orb: ROW.orb, gap: ROW.gap, grow: appState.orbGrow === false ? 0 : GROW_EXTRA, end: X.end?.matches('.k7-dock__cap') ? 0 : endW, more: moreW });
  S.fitN = f.shown;
  drawMore(f.more);
  const vis = list.slice(0, f.shown), hi = vis.findIndex((b) => b.id === S.hover);
  list.forEach((b, i) => {
    const btn = X.orbs.get(b.id); if (!btn) return;
    btn.style.order = String(i);
    const show = i < f.shown;
    /* a bot past what fits is out of the row (`data-out`: no room, not seen, inert), never `hidden`: see dock.css */
    if (btn.hasAttribute('data-out') === show) { btn.toggleAttribute('data-out', !show); btn.inert = !show; if (show) btn.removeAttribute('aria-hidden'); else btn.setAttribute('aria-hidden', 'true'); }
    const s = show ? sizeOf(i, hi) : ROW.orb;
    if (btn.style.getPropertyValue('--s') !== s + 'px') { btn.style.setProperty('--s', s + 'px'); btn.style.setProperty('--g', String(s / ROW.orb)); }
    btn.toggleAttribute('data-awake', show && i === hi);
  });
  /* one tab stop: the focused orb, else the first */
  const stop = X.orbs.get(S.focus && vis.some((b) => b.id === S.focus) ? S.focus : vis[0]?.id ?? '');
  for (const btn of X.orbs.values()) {
    const t = btn === stop ? 0 : -1;
    if (btn.tabIndex !== t) btn.tabIndex = t;
    if (btn === stop) btn.setAttribute('data-hx-focus', 'dock'); else btn.removeAttribute('data-hx-focus');
  }
  const items = [...vis.map((_, i) => sizeOf(i, hi)), ...(f.more ? [X.more ? X.more.offsetWidth : moreW] : []), ...(X.end ? [X.end.offsetWidth] : [])];
  const content = 2 * ROW.pad + items.reduce((a, b) => a + b, 0) + Math.max(0, items.length - 1) * ROW.gap;
  const w = S.open ? Math.min(OPEN.w, room()) : content;
  if (w !== S.width) { S.width = w; X.dock.style.width = w + 'px'; }
  const cur = S.open?.kind === 'card' ? S.open.id : null;
  for (const [id, btn] of X.orbs) { if (id === cur) btn.setAttribute('aria-current', 'true'); else btn.removeAttribute('aria-current'); }
}

/* ───────── the open dock: the stack, a bot's card ───────── */
function askOpts(w: Wait): AskCardOpts {
  const b = botById(w.bot), d = w.kind === 'approval' ? w.data : null;
  return {
    variant: 'standalone', state: 'needs', ...(b ? { bot: b } : {}), who: (b?.name ?? w.who) + ' asks', ask: (d?.title || w.title) || 'Approve this step',
    ...(d?.quote ? { sub: d.quote } : {}), ...(d?.item?.length ? { command: d.item.join('\n') } : {}),
    /* what the provider can carry out: once, or deny ("Always for staging" needs the rules engine, w34/rules-engine) */
    answers: [{ label: 'Hold to allow once', primary: true, hold: true }, { label: 'Deny', keys: 'esc' }],
    attrs: { 'data-wait': w.id }
  };
}
function logOf(id: string): { kind: 'user' | 'agent'; text: string }[] {
  return (S.threads[id] ?? []).filter((m): m is Extract<ThreadMessage, { kind: 'text' }> => m.kind === 'text').slice(-LOG_N).map((m) => ({ kind: m.who === 'you' ? 'user' : 'agent', text: m.text }));
}
/** one composer per bot, kept so a draft survives: the kit's Composer (the one every chat has), sending to the bot's thread. "+" adds a
    file as a chip, "@" names a teammate, the mic dictates (the bot's orbs listen meanwhile), Stop stops the bot's run */
function composerFor(id: string): CardComposer | null {
  const b = botById(id); if (!b || data().info.unavailable['bots.send']) return null;
  const had = X.composers.get(id);
  if (had) return had;
  const slot = document.createElement('div');
  slot.className = 'dk-composer';
  const others = (): Bot[] => S.bots.filter((x) => x.id !== id);
  const tools = composeTools(slot, {
    botId: () => id,
    mentions: {
      label: 'Bots', foot: () => nameOf(id) + ' reads the name. The bot you name does not see this chat.',
      chips: (t) => mentionChips(t, mentionCtx(others().map((x) => ({ ...x, id: x.id, name: x.name })))),
      entries: () => others().map((x) => ({ value: x.id, label: x.name, ...(x.role ? { desc: x.role } : {}), leadHTML: ui.html.orb(x, { size: 16, still: true }) }))
    }
  });
  const text = (): HTMLElement | null => slot.querySelector<HTMLElement>('.k7-composer__text');
  /* while you dictate, the bot's orbs (in the row and in the card's head) listen */
  const listen = (on: boolean): void => {
    made.listening = on;
    const x = botById(id); if (x) patchOrb(x);
    const head = S.open?.kind === 'card' && S.open.id === id ? X.panel?.querySelector('.k7-dock__head orb-avatar') : null;
    if (head) { if (on) head.setAttribute('reaction', 'listening'); else head.removeAttribute('reaction'); }
  };
  const made: CardComposer = {
    slot, listening: false,
    draw() {
      const x = botById(id); if (!x) return;
      const keep = text()?.textContent ?? '';
      slot.replaceChildren(kit.composer({ kind: 'dock', placeholder: 'Message ' + x.name, label: 'Message ' + x.name, running: S.runs.has(id), voiceSetup: voiceNeedsSetup(), ...(x.color ? { fill: kit.botFill(x.color) } : {}), ...(keep ? { text: keep } : {}) }));
      tools.drawn();
    },
    stop() { tools.stop(); if (made.listening) listen(false); }
  };
  const send = (ev: Event): void => {
    const t = (ev as CustomEvent<{ text: string }>).detail.text, x = botById(id);
    if (!t || !x) return;
    data().bots.send(id, t, 'dock');
    ui.announce(`Sent to ${x.name}`);
  };
  slot.addEventListener('ui:send', send);
  slot.addEventListener('ui:steer', send);   /* ctrl Enter sends as Enter does until the keys get their own pass (owner, 25 November) */
  slot.addEventListener('ui:stop', () => { if (data().bots.stop(id)) ui.announce('Stopped ' + nameOf(id)); });
  slot.addEventListener('ui:dictate', (ev) => listen((ev as CustomEvent<{ on: boolean }>).detail.on));
  slot.addEventListener('keydown', (e) => {
    const mic = slot.querySelector<HTMLElement>('[data-mic]');
    /* Esc while dictating stops dictating (the card stays); alt+V switches the mic, as in every composer */
    if (e.key === 'Escape' && mic?.getAttribute('aria-pressed') === 'true') { e.preventDefault(); e.stopPropagation(); mic.click(); return; }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyV') { e.preventDefault(); mic?.click(); }
  });
  made.draw();
  X.composers.set(id, made);
  return made;
}
function panelHTML(open: NonNullable<Open>): string {
  if (open.kind === 'stack') return kit.dockParts.panel({ kind: 'stack', asks: asks().map(askOpts) });
  const b = botById(open.id); if (!b) return '';
  const w = asks().find((x) => x.bot === b.id);
  return kit.dockParts.panel({ kind: 'card', bot: dockBot(b), state: stateWords(b)[0], log: logOf(b.id), ...(w ? { ask: askOpts(w) } : {}), composerHTML: '<div class="dk-composer-slot"></div>' });
}
/** the panel above the row, written in place (its orb is painted where it is made), then wired */
function drawPanel(): void {
  const open = S.open; if (!open) return;
  const old = X.panel;
  X.row.insertAdjacentHTML('beforebegin', panelHTML(open));
  X.panel = X.row.previousElementSibling as HTMLElement;
  old?.remove();
  const p = X.panel;
  p.setAttribute('role', 'group');
  p.dataset['open'] = open.kind;
  const head = p.querySelector('.k7-dock__head');
  const close = head?.querySelector<HTMLElement>('[aria-label="Close"]');
  close?.setAttribute('data-act', 'close');
  if (open.kind === 'card') {
    const b = botById(open.id);
    p.setAttribute('aria-label', 'Card of ' + (b?.name ?? ''));
    close?.setAttribute('aria-label', 'Close the card of ' + (b?.name ?? ''));
    const go = head?.querySelector<HTMLElement>('[aria-label="Open in Bots"]');
    go?.setAttribute('data-act', 'open-chat'); go?.setAttribute('aria-label', 'Open ' + (b?.name ?? '') + ' in Bots');
    const log = p.querySelector<HTMLElement>('.k7-dock__log');
    if (log) { log.setAttribute('role', 'log'); log.setAttribute('aria-label', 'Recent messages with ' + (b?.name ?? '')); }
    const slot = p.querySelector('.dk-composer-slot'), c = composerFor(open.id);
    if (slot && c) slot.replaceWith(c.slot); else slot?.remove();
  } else {
    p.setAttribute('aria-label', 'Waiting on you');
    close?.setAttribute('aria-label', 'Close the asks');
  }
  kit.wire(p);
  p.scrollTop = p.scrollHeight;
}
/** a card's log follows the bot's thread in place */
function drawLog(id: string): void {
  if (S.open?.kind !== 'card' || S.open.id !== id || !X.panel) return;
  const log = X.panel.querySelector<HTMLElement>('.k7-dock__log'); if (!log) return;
  const tpl = document.createElement('template'); tpl.innerHTML = panelHTML(S.open);
  const next = tpl.content.querySelector('.k7-dock__log');
  if (next && next.innerHTML !== log.innerHTML) { log.innerHTML = next.innerHTML; X.panel.scrollTop = X.panel.scrollHeight; }
}
function openPanel(open: NonNullable<Open>, focus = true): void {
  if (!S.shown) return;
  if (open.kind === 'card' && !botById(open.id)) return;
  if (open.kind === 'stack' && !asks().length) return;
  S.open = open;
  drawPanel();
  setKind('open');
  S.hover = null;
  layoutRow();
  document.getElementById('hx-app')?.setAttribute('data-dock-open', open.kind);
  if (focus) {
    const to = open.kind === 'card' ? X.panel?.querySelector<HTMLElement>('.k7-composer__text') : X.panel?.querySelector<HTMLElement>('[data-kit~="AskCard"] [data-hold]');
    (to ?? X.panel?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }
  if (open.kind === 'card') ui.announce('Card of ' + nameOf(open.id)); else ui.announce('Waiting on you');
  emitDock();
}
/** back to the row: the panel shrinks with the slab (it clips by its own overflow) and goes once the slab has settled */
function closePanel(refocus: boolean): void {
  const was = S.open; if (!was) return;
  S.open = null;
  document.getElementById('hx-app')?.removeAttribute('data-dock-open');
  setKind('row');
  layoutRow();
  const p = X.panel; X.panel = null;
  if (was.kind === 'card') X.composers.get(was.id)?.stop();
  if (p) { p.setAttribute('inert', ''); setTimeout(() => p.remove(), T(ROW_MS)); }
  if (refocus) (was.kind === 'card' ? X.orbs.get(was.id) : (X.end?.matches('.k7-dock__ask') ? X.end : X.orbs.get(S.rank[0] ?? '')))?.focus({ preventScroll: true });
  emitDock();
}
/** the 200 ms every change of the slab takes (--dur-2, --ease-sharp) */
const ROW_MS = 200;
function toggleCard(id: string): void {
  if (S.open?.kind === 'card' && S.open.id === id) closePanel(true); else openPanel({ kind: 'card', id });
}
function openInBots(id: string): void {
  emit('hx:bot-select', { id, from: 'dock', source: 'dock' });
  setState({ tab: 'bots' });
  if (S.open) closePanel(false);
}
function decide(waitId: string, ok: boolean): void {
  data().waits.resolve(waitId, ok ? 'approved' : 'denied');
}

/* ───────── arrival and departure ───────── */
/* the boopis bot is in the row with the others (the boards: "boopis is not special, it is one of your bots"); it alone does not draw the dock */
const visibleNow = (): boolean => shows({ ownBots: ownBots(S.bots).length, tab: appState.tab, setting: appState.dock !== 'off' });
/** the dock follows what is in it, the tab and the setting. `animate`: the first bot raises it (the composer moves up first, then the
    slab rises and the orbs pop in left to right) and the last takes it away (an open panel closes, the slab sinks, then the composer
    moves down); a tab switch shows or hides it at once */
function follow(animate: boolean): void {
  const want = visibleNow();
  if (want === S.want) return;
  S.want = want;
  const my = ++S.seq;
  if (want) {
    X.root.removeAttribute('inert'); X.root.removeAttribute('aria-hidden');
    S.shown = true; layoutRow();
    emitDock();
    if (!animate) { X.root.classList.add('is-snap'); X.root.dataset['in'] = ''; void X.root.offsetWidth; X.root.classList.remove('is-snap'); X.root.style.visibility = ''; return; }
    /* reduced motion: in its place at once (no travel, not one frame of it), cross-faded in */
    if (reduced()) { X.root.classList.add('is-snap'); X.root.dataset['in'] = ''; void X.root.offsetWidth; X.root.classList.remove('is-snap'); X.root.style.visibility = ''; X.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'linear' }); return; }
    setTimeout(() => {
      if (my !== S.seq) return;
      X.root.style.visibility = '';
      X.root.dataset['in'] = '';
      popIn(S.rank.slice(0, S.fitN));
    }, T(ROW_MS));
  } else {
    if (S.open) closePanel(false);
    S.hover = null; S.focus = null;
    const done = (): void => { if (my !== S.seq) return; S.shown = false; X.root.style.visibility = 'hidden'; X.root.setAttribute('inert', ''); X.root.setAttribute('aria-hidden', 'true'); emitDock(); };
    if (!animate) { X.root.classList.add('is-snap'); delete X.root.dataset['in']; void X.root.offsetWidth; X.root.classList.remove('is-snap'); done(); return; }
    delete X.root.dataset['in'];
    setTimeout(done, T(ROW_MS) + 20);
  }
}
/** orbs pop in left to right (100 ms each, 40 ms apart, from scale .98); reduced motion: they are simply there */
function popIn(ids: readonly string[], blink?: string): void {
  if (reduced()) return;
  ids.forEach((id, i) => {
    const btn = X.orbs.get(id); if (!btn || btn.hasAttribute('data-out')) return;
    const a = btn.animate([{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: T(100), delay: T(i * 40), easing: 'cubic-bezier(.165, .84, .44, 1)', fill: 'backwards' });
    if (id === blink) a.addEventListener('finish', () => oc(btn.querySelector('orb-avatar'), 'blink'));
  });
}

/* ───────── the room it reports ───────── */
let sent = '';
function emitDock(): void {
  const off = appState.dock === 'off';
  const h = S.want ? ROW.h : 0;
  const mode = off ? 'off' : S.open ? 'expanded' : 'normal';
  /* the shell reads the dock's mode here (mod+shift+J opens the asks and folds them again; modules/shell/actions.ts) */
  if (X.root.dataset['mode'] !== mode) X.root.dataset['mode'] = mode;
  const key = mode + '|' + h + '|' + S.width;
  if (key === sent) return;
  sent = key;
  emit('hx:dock', { mode, page: S.open?.kind ?? 'bots', width: S.width, height: h, rest: h });
}

/* ───────── input ───────── */
function visibleOrbs(): HTMLButtonElement[] { return S.rank.slice(0, S.fitN).map((id) => X.orbs.get(id)).filter((b): b is HTMLButtonElement => !!b); }
function setHover(id: string | null): void { if (S.hover === id) return; S.hover = id; layoutRow(); }
/** the last orb a pointer clicked, and when: a double-click opens that bot's full chat, wherever its second click lands (the first
    click opened the card, and the row under the pointer has moved since) */
let lastClick: { id: string; t: number } | null = null;
const DOUBLE_MS = 500;
function onClick(e: MouseEvent): void {
  const t = e.target as Element;
  if (e.detail === 2 && lastClick && performance.now() - lastClick.t < DOUBLE_MS) { const id = lastClick.id; lastClick = null; openInBots(id); return; }
  const orb = t.closest<HTMLElement>('.k7-dock__orb');
  lastClick = orb && X.row.contains(orb) && e.detail === 1 ? { id: orb.dataset['bot'] ?? '', t: performance.now() } : null;
  if (orb && X.row.contains(orb)) {
    /* a pointer's click is answered by the orb itself, a small poke (the owner's v6 decision; a smaller one under reduced motion) */
    if (e.detail > 0) oc(orb.querySelector('orb-avatar'), 'poke', reduced() ? 0.5 : 0.9);
    toggleCard(orb.dataset['bot'] ?? ''); return;
  }
  if (t.closest('.k7-dock__ask')) { openPanel({ kind: 'stack' }); return; }
  const act = t.closest<HTMLElement>('[data-act]')?.dataset['act'];
  if (act === 'more') { setState({ tab: 'bots' }); return; }
  if (act === 'close') { closePanel(true); return; }
  if (act === 'open-chat' && S.open?.kind === 'card') { openInBots(S.open.id); return; }
  /* an ask's Deny (its hold commits through ui:commit) */
  const chip = t.closest<HTMLElement>('[data-kit~="AskCard"] [data-kit~="Chip"]');
  const card = chip?.closest<HTMLElement>('[data-wait]');
  if (chip && card && !chip.hasAttribute('data-hold')) decide(card.dataset['wait'] ?? '', false);
}
function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement;
  if (e.key === 'Escape' && !e.defaultPrevented) {
    const card = t.closest<HTMLElement>('[data-wait]');
    if (card && !t.closest('.k7-composer')) { e.preventDefault(); decide(card.dataset['wait'] ?? '', false); return; }
    if (S.open) { e.preventDefault(); e.stopPropagation(); closePanel(true); }
    return;
  }
  if (e.key === 'x' && !e.ctrlKey && !e.metaKey && !e.altKey) { const card = t.closest<HTMLElement>('[data-wait]'); if (card && !t.closest('.k7-composer')) { e.preventDefault(); decide(card.dataset['wait'] ?? '', false); return; } }
  if (!t.closest('.k7-dock__row')) return;
  /* the row's stops, in the order drawn: the bots, then "N more", then the ask pill */
  const orbs = visibleOrbs(), all: HTMLElement[] = [...orbs, ...(X.more ? [X.more] : []), ...(X.end?.matches('.k7-dock__ask') ? [X.end] : [])];
  const at = all.indexOf(t.closest<HTMLElement>('button') ?? t);
  if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { const b = orbs[+e.key - 1]; if (b) { e.preventDefault(); b.focus(); } return; }
  if (at < 0) return;
  const n = ({ ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: all.length - 1 } as Record<string, number>)[e.key];
  if (n != null) { e.preventDefault(); all[clamp(n, 0, all.length - 1)]?.focus(); return; }
  if (at >= orbs.length) return;   /* "N more" and the pill are buttons: Enter and Space press them */
  const id = orbs[at]?.dataset['bot'] ?? '';
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openInBots(id); return; }
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(id); }
}

/* ───────── data ───────── */
function onBots(): void {
  const d = data();
  d.bots.subscribe((ev) => {
    if (ev.type === 'bot-created') {
      if (botById(ev.bot.id)) return;
      const b = { ...ev.bot };
      S.bots.push(b); S.threads[b.id] ??= [];
      addOrb(b);
      const was = S.want;
      layoutRow();
      follow(true);
      if (was && S.shown) popIn([b.id], b.id);
      else if (!was) { const orb = X.orbs.get(b.id); setTimeout(() => oc(orb?.querySelector('orb-avatar'), 'blink'), T(ROW_MS + 100 + 40 * S.fitN)); }
    } else if (ev.type === 'bot-archived') {
      const i = S.bots.findIndex((x) => x.id === ev.id); if (i < 0) return;
      S.bots.splice(i, 1);
      if (S.open?.kind === 'card' && S.open.id === ev.id) closePanel(false);
      const btn = X.orbs.get(ev.id); X.orbs.delete(ev.id);
      X.composers.get(ev.id)?.stop(); X.composers.delete(ev.id); S.runs.delete(ev.id);
      const last = !S.bots.length;
      if (last) { follow(true); setTimeout(() => btn?.remove(), T(ROW_MS) + 40); } else { btn?.remove(); layoutRow(); }
    } else if (ev.type === 'bot') {
      const b = botById(ev.bot.id); if (!b) return;
      Object.assign(b, { state: ev.bot.state, attention: ev.bot.attention, activity: ev.bot.activity, role: ev.bot.role, paused: ev.bot.paused });
      const look = lookOf(ev.bot); b.shape = look.shape; b.color = look.color;
      repaintLook(X.root, b.id, look);
      patchOrb(b);
      layoutRow();
      if (S.open?.kind === 'card' && S.open.id === b.id) { const w = X.panel?.querySelector('.k7-dock__head [data-kit~="StatusWord"]'); if (w) w.outerHTML = kit.html.statusWord({ text: stateWords(b)[0], tone: stateWords(b)[1] }); }
    } else if (ev.type === 'message') {
      if (ev.streaming || !botById(ev.botId)) return;
      (S.threads[ev.botId] ??= []).push(ev.message); drawLog(ev.botId);
    } else if (ev.type === 'message-end') {
      if (!botById(ev.botId)) return;
      const th = (S.threads[ev.botId] ??= []);
      if (!th.find((x) => x.id === ev.messageId)) th.push({ kind: 'text', id: ev.messageId, who: ev.botId, t: new Date().toTimeString().slice(0, 5), text: ev.text });
      drawLog(ev.botId);
    } else if (ev.type === 'thread') {
      if (!botById(ev.botId)) return;
      S.threads[ev.botId] = [...ev.messages]; drawLog(ev.botId);
    } else if (ev.type === 'run') {
      /* its composer shows Stop while the bot's run goes, in place (a draft and the caret stay) */
      if (ev.running) S.runs.add(ev.botId); else S.runs.delete(ev.botId);
      const c = X.composers.get(ev.botId); if (c) kit.composerRunning(c.slot, ev.running);
    }
  });
  d.waits.subscribe((ev) => {
    if (ev.type === 'added') { if (!S.waits.some((w) => w.id === ev.wait.id)) S.waits.push(ev.wait); }
    else S.waits = S.waits.filter((w) => w.id !== ev.id);
    const open = S.open;
    if (open?.kind === 'stack') { if (asks().length) drawPanel(); else closePanel(X.root.contains(document.activeElement)); }
    else if (open?.kind === 'card') {
      /* the card's ask comes and goes in place; its composer keeps its draft and focus */
      const had = X.panel?.querySelector<HTMLElement>('[data-kit~="AskCard"]'), w = asks().find((x) => x.bot === open.id);
      if (had && had.dataset['wait'] !== w?.id) had.remove();
      if (w && !X.panel?.querySelector('[data-wait="' + CSS.escape(w.id) + '"]')) {
        X.panel?.querySelector('.dk-composer')?.insertAdjacentHTML('beforebegin', kit.html.askCard(askOpts(w)));
        if (X.panel) kit.wire(X.panel);
      }
    }
    layoutRow();
  });
}

/* ───────── build ───────── */
function build(slot: HTMLElement): void {
  X.slot = slot;
  const root = document.createElement('div');
  root.className = 'dk';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Dock');
  slot.appendChild(root);
  X.root = root;
  root.innerHTML = kit.html.dock({ kind: 'row', bots: [], render: ROW.grow[0] }) + `<span class="ui-sr" id="dk-hint">${HINT}</span>`;
  X.dock = root.querySelector<HTMLElement>('.k7-dock') as HTMLElement;
  X.row = X.dock.querySelector<HTMLElement>('.k7-dock__row') as HTMLElement;
  X.svg = X.dock.querySelector<SVGSVGElement>('.k7-dock__slab');
  X.path = X.svg?.querySelector('path') ?? null;
  for (const b of ordered(S.bots)) addOrb(b);
  if (typeof ResizeObserver === 'function') new ResizeObserver((es) => { for (const e of es) { const s = e.borderBoxSize?.[0]; paintSlab(s ? s.inlineSize : X.dock.offsetWidth, s ? s.blockSize : X.dock.offsetHeight); } }).observe(X.dock, { box: 'border-box' });
}

function setTimeScale(f: number): void {
  S.timeScale = clamp(+f || 1, 0.02, 4);
  const set = (n: string, ms: number): void => { if (S.timeScale === 1) X.root.style.removeProperty(n); else X.root.style.setProperty(n, Math.round(ms / S.timeScale) + 'ms'); };
  set('--dur-1', 120); set('--dur-pop', 100); set('--dur-2', 200); set('--dur-3', 300);
}

function mount(slot: HTMLElement): void {
  if (S.mounted) return;
  const d = data(), snap = d.bots.snapshot();
  S.bots = snap.bots.filter((b) => b.id !== 'default').map((b) => ({ ...b }));
  S.threads = Object.fromEntries(Object.entries(snap.threads).map(([k, v]) => [k, [...v]]));
  S.waits = [...d.waits.snapshot()];
  build(slot);
  S.mounted = true;
  X.root.style.visibility = 'hidden'; X.root.setAttribute('inert', ''); X.root.setAttribute('aria-hidden', 'true');
  layoutRow();
  follow(false);
  emitDock();

  X.root.addEventListener('click', onClick);
  X.root.addEventListener('keydown', onKey);
  X.root.addEventListener('ui:commit', (e) => { const card = (e.target as Element).closest<HTMLElement>('[data-wait]'); if (card) decide(card.dataset['wait'] ?? '', true); });
  X.row.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; const o = (e.target as Element).closest<HTMLElement>('.k7-dock__orb'); setHover(o ? o.dataset['bot'] ?? null : S.hover); });
  X.row.addEventListener('pointerleave', () => setHover(null));
  X.row.addEventListener('focusin', (e) => { const o = (e.target as Element).closest<HTMLElement>('.k7-dock__orb'); const id = o && o.matches(':focus-visible') ? o.dataset['bot'] ?? null : null; for (const b of X.orbs.values()) b.toggleAttribute('data-focus', b === o && !!id); if (S.focus !== id) { S.focus = id; layoutRow(); } });
  X.row.addEventListener('focusout', (e) => { if (X.row.contains(e.relatedTarget as Node | null)) return; for (const b of X.orbs.values()) b.removeAttribute('data-focus'); if (S.focus) { S.focus = null; layoutRow(); } });
  /* a click outside returns the dock to rest; a press inside a menu or popover the dock opened counts as inside */
  document.addEventListener('pointerdown', (e) => {
    if (!S.open) return;
    const t = e.target as Element | null;
    if (!t || X.root.contains(t) || t.closest('[data-floating], .ui-menu, .ui-pop, .ui-listbox, .k7-pop, .ui-tip')) return;
    closePanel(false);
  }, true);
  if (document.fonts?.addEventListener) document.fonts.addEventListener('loadingdone', () => layoutRow());
  onReducedChange(() => layoutRow());
  on('hx:layout', (l) => { if (typeof l.centerX === 'number') X.root.style.setProperty('--dk-cx', l.centerX + 'px'); layoutRow(); });
  on('hx:state', (ev) => {
    if (ev.changed.includes('orbGrow') || ev.changed.includes('dockCentred')) layoutRow();
    if (ev.changed.includes('tab')) follow(false);
    if (ev.changed.includes('dock') && !ev.initial) follow(true);
    emitDock();
  });
  on('hx:theme', () => {
    for (const o of $$('orb-avatar', X.root)) { const c = o.getAttribute('color'); if (c) o.setAttribute('color', c); const e = o.getAttribute('eye-color'); if (e) o.setAttribute('eye-color', e); }
    layoutRow();
  });
  on('hx:nav', (n) => {
    if (n.region !== 'dock') return;
    const all = S.open && X.panel ? $$<HTMLElement>('button:not([disabled])', X.panel) : visibleOrbs();
    (n.action === 'last' ? all[all.length - 1] : all[0])?.focus({ preventScroll: true });
  });
  onBots();
}

register('dock', { mount });

/** what the shell, the lab and the tests may call */
setDockApi({
  /* v7 has one row and one open size: 'expanded' opens the asks (when any wait), anything else returns to the row */
  setMode: (m) => { if (m === 'expanded') openPanel({ kind: 'stack' }); else closePanel(false); },
  setOn: (v) => setState({ dock: v ? 'on' : 'off' }),
  focus: () => { (visibleOrbs().find((b) => b.tabIndex === 0) ?? visibleOrbs()[0])?.focus({ preventScroll: true }); },
  botAt: (n) => S.rank.slice(0, S.fitN)[(+n || 0) - 1] ?? null,
  openSession: (id) => openPanel({ kind: 'card', id }, false),
  openAsks: () => openPanel({ kind: 'stack' }, false),
  closeSession: () => closePanel(false),
  get state() { return { shown: S.shown, open: S.open?.kind ?? null, card: S.open?.kind === 'card' ? S.open.id : null, asks: asks().length, row: S.rank.slice(0, S.fitN), more: S.bots.length - S.fitN, hover: S.hover, width: S.width }; },
  timeScale: setTimeScale,
  hover: (x) => {
    if (x == null) { setHover(null); return; }
    const hit = visibleOrbs().find((b) => { const r = b.getBoundingClientRect(); return x >= r.left && x <= r.right; });
    setHover(hit?.dataset['bot'] ?? null);
  }
});
