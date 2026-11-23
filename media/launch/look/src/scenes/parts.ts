/* The pieces the storyboard's key frames are built from, each drawn with the product's own kit where the product draws it:
   the group room (its head, entries, huddle, presence and composer), the session (its composer with the Governed chip, the
   agent's entry with its model route and steps, the right panel's Governance section), the boopis window at establishing
   scale (bars for every word nobody reads), the dock and a bot's dock session with its approval card, a terminal and the
   other app on the desktop (neither of them boopis, so neither is the kit), film lines, and the oversized cursor. */
import { ui } from '@boopis/ui';
import type { BotLike } from '@boopis/ui';
import '@ui/src/modules/bots/bots.css';
import '@ui/src/modules/cards/cards.css';
import { huddleEntry, huddleMessage } from '@ui/src/modules/bots/huddle';
import type { GroupMember, GroupText } from '@ui/src/data/types';
import { BOTS, ROOM, botById, filmUI, h, sharpenOrbs, typeset } from '../stage';
import type { FilmBot } from '../stage';

/* ───────── shared CSS for the scenes (tokens only) ───────── */
export const SCENE_CSS = `
.plate--room { background: radial-gradient(70% 80% at 30% 45%, color-mix(in oklab, var(--bg-2) 72%, var(--bg-3)), var(--bg-2) 70%); }
.dof-1 { filter: blur(5px); }
.dof-in { filter: blur(1.7px); }
.ui-film .ui-entry { margin: 0; }
.room-log { display: flex; flex-direction: column; gap: 32px; }
/* the room's head is the product's own (.bt-presence.bt-ghead, bots.css: its grid puts the name on the margin's edge, over
   the entries' bodies). Its ground is the room's --bg-2, invisible in the app; on the film's lit plate it would show as a
   flat box, so it is clear here. The 9:16 column is a narrow window's: the product's rule for a window under 640 px (its
   buttons take a row of their own under the name) is the film's there, because the film's viewport is never narrow. */
.ui-film .room-head { background: transparent; }
.stage[data-format="vertical"] .room-head.bt-ghead { grid-template-columns: auto minmax(0, 1fr); row-gap: var(--sp-2); }
.stage[data-format="vertical"] .room-head.bt-ghead > .bt-p-actions { grid-column: 1 / -1; justify-self: end; }
.ui-film .ui-disclosure { text-align: start; }
.film-line { position: absolute; margin: 0; font: 600 92px/1.06 var(--sans); letter-spacing: -.024em; color: var(--text-strong); text-wrap: balance; }
.film-line[data-align="center"] { left: 0; right: 0; text-align: center; }
.stage[data-format="vertical"] .film-line { font-size: 104px; }
.cursor { position: absolute; width: 48px; height: 59px; filter: var(--cursor-shadow); z-index: 20; }
.cursor svg { display: block; width: 100%; height: 100%; }
/* the boopis window at establishing scale: its own chrome, words as bars */
.win { position: absolute; border-radius: 30px; background: var(--bg-1); overflow: hidden; box-shadow: var(--plate-ring), var(--plate-shadow); }
.win__bar { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; padding: 0 22px; gap: 18px; color: var(--icon); }
.win__bar svg { width: 24px; height: 24px; }
.win__search { position: absolute; left: 50%; transform: translateX(-50%); border-radius: 999px; background: var(--bg-0); box-shadow: inset 0 0 0 1px var(--hair); display: flex; align-items: center; gap: 14px; padding: 0 18px; }
.win__ctl { margin-left: auto; display: flex; gap: 30px; color: var(--icon-quiet); }
.win__side { position: absolute; left: 0; bottom: 0; }
.win__main { position: absolute; right: 0; bottom: 0; background: var(--bg-2); border-top-left-radius: 26px; overflow: hidden; }
.tabs { position: absolute; display: flex; padding: 5px; border-radius: 16px; background: var(--bg-0); box-shadow: inset 0 0 0 1px var(--hair); }
.tabs > span { flex: 1; display: grid; place-items: center; border-radius: 12px; }
.tabs > span[data-on] { background: var(--selected); }
.tabs > span > i { display: block; height: 9px; border-radius: 5px; background: var(--text-dim); }
.tabs > span[data-on] > i { background: var(--text-on-light); opacity: .7; }
.wrow { position: absolute; display: flex; align-items: center; gap: 16px; }
.wrow .bars { display: flex; flex-direction: column; gap: 9px; }
.wbar { display: block; height: 9px; border-radius: 5px; background: color-mix(in srgb, var(--text) 22%, transparent); }
.wbar--q { background: color-mix(in srgb, var(--text) 11%, transparent); }
.wbar--s { background: color-mix(in srgb, var(--text) 40%, transparent); }
.wcomp { position: absolute; border-radius: 22px; background: var(--bg-3); box-shadow: inset 0 0 0 1px var(--hair); }
.wchip { display: inline-block; height: 26px; border-radius: 13px; background: var(--chip); box-shadow: inset 0 0 0 1px var(--hair); }
/* the dock's own session view (modules/dock), placed in a film slab instead of the app's fixed corner */
.film-dock.dk { position: relative; left: auto; bottom: auto; width: max-content; height: auto; transition: none; pointer-events: none; z-index: auto; }
.dock { position: absolute; background: var(--dock-bg); border-radius: 30px 30px 0 0; display: flex; align-items: center; justify-content: center; }
.dock__plus { color: var(--ink-on-dock); opacity: .7; }
/* a terminal and the other app: not boopis, so not the kit; dark plates from the tokens, nothing named */
.term { position: absolute; border-radius: 18px; background: var(--bg-0); overflow: hidden; box-shadow: inset 0 0 0 1px var(--hair), var(--plate-shadow); }
.term__strip { height: 30px; background: var(--bg-1); box-shadow: inset 0 -1px 0 var(--hair); }
.term__body { padding: 26px 34px; font: 400 30px/1.5 var(--mono); color: var(--text); white-space: pre; font-variant-numeric: tabular-nums; }
.term__body .q { color: var(--text-quiet); }
.term__body .p { color: var(--text-dim); }
.app2 { position: absolute; border-radius: 26px; background: var(--bg-1); box-shadow: var(--plate-ring), var(--plate-shadow); display: flex; flex-direction: column; gap: 16px; padding: 26px; }
.app2__msg { align-self: flex-start; max-width: 86%; padding: 14px 20px; border-radius: 20px; background: var(--bg-3); font: 400 32px/1.3 var(--sans); color: var(--text); }
.app2__msg[data-you] { align-self: flex-end; background: color-mix(in oklab, var(--bg-3) 70%, var(--bg-4)); }
.app2__msg .wbar { height: 12px; }
.app2__field { margin-top: auto; padding: 16px 20px; border-radius: 18px; background: var(--bg-0); box-shadow: inset 0 0 0 1px var(--line); font: 400 32px/1.3 var(--sans); color: var(--text); min-height: 72px; }
.app2__field[data-empty] { color: var(--text-quiet); }
`;

/* ───────── the cast as the kit takes it ───────── */
export type FilmLike = BotLike & { id: string; name: string };
export const like = (b: FilmBot, state = 'idle'): FilmLike => ({ id: b.id, name: b.name, role: b.role, shape: b.shape, color: b.color, state });
export const mdCtx = { mention: (x: string): FilmLike | null => { const b = botById(x); return b ? like(b) : null; }, everyone: ROOM.members.map((b) => like(b)) };

/* ───────── film lines ───────── */
/** a film line: Libre Franklin 600, the one brass word held in the selection ({word}), lab marks inline ([claude]) */
export function filmLine(text: string, o: { y: number; x?: number; align?: 'center' | 'left'; size?: number; width?: number }): HTMLElement {
  const e = h('h2', 'film-line', typeset(text), { top: o.y + 'px' });
  e.dataset['align'] = o.align ?? 'center';
  if (o.align === 'left') { e.style.left = (o.x ?? 0) + 'px'; if (o.width) e.style.width = o.width + 'px'; }
  if (o.size) e.style.fontSize = o.size + 'px';
  return e;
}

/* ───────── the cursor: oversized, bone with an ink edge, a soft shadow ───────── */
const CURSOR = '<svg viewBox="0 0 26 32" aria-hidden="true"><path d="M2 2 L2 25 L8.2 19.4 L12.4 29 L16.6 27.2 L12.5 17.8 L21 17.6 Z" fill="var(--selected)" stroke="var(--text-on-light)" stroke-width="1.6" stroke-linejoin="round"/></svg>';
export const cursor = (x: number, y: number, size = 48): HTMLElement => h('div', 'cursor', CURSOR, { left: x + 'px', top: y + 'px', width: size + 'px', height: Math.round(size * 1.23) + 'px' });
/** the brass ring a click leaves (you are here) */
export const clickRing = (x: number, y: number, r: number): HTMLElement => h('div', 'ring', '', { left: (x - r) + 'px', top: (y - r) + 'px', width: r * 2 + 'px', height: r * 2 + 'px', 'z-index': '19' });

/* ───────── the group room, as group-room.ts draws it ───────── */
const toLine = (to: string[]): string => (to.length ? '<span class="bt-to' + (to.includes('you') ? ' is-you' : '') + '">to <b>' + listWords(to) + '</b></span>' : '');
export const listWords = (w: readonly string[]): string => (w.length < 3 ? w.join(' and ') : w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1]);
export function youEntry(text: string, t: string): string {
  return ui.html.entry({ kind: 'user', who: 'You', callno: [t], body: '<div class="ui-request">' + ui.markdown.plain(text, mdCtx) + '</div>' });
}
export function botEntry(b: FilmBot, text: string, t: string, to: string[] = []): string {
  const e = ui.html.entry({ kind: 'bot', who: ui.html.orb(like(b), { size: 20 }) + '<span class="bt-who-name">' + b.name + '</span>', callno: [t], body: ui.markdown.html(text, mdCtx) });
  return e.replace('</span><span>' + t, '</span>' + toLine(to) + '<span>' + t);
}
/** the room's head: the members' stack (32), the name, the members in words, the head's actions */
export function roomHead(): string {
  const acts = '<div class="bt-p-actions">' + ui.html.button({ label: 'Board', size: 's', variant: 'ghost' }) +
    ui.html.iconButton({ icon: 'pen', label: 'Rename' }) + ui.html.iconButton({ icon: 'bots', label: 'Members' }) + ui.html.iconButton({ icon: 'sliders', label: 'Run limit' }) + '</div>';
  return '<header class="bt-presence bt-ghead room-head"><div class="bt-p-orb">' + ui.html.stack({ members: ROOM.members.map((b) => like(b)), size: 32, max: 4 }) + '</div>' +
    '<div class="bt-p-text"><h1 class="bt-p-name">' + ROOM.name + '</h1><p class="bt-p-line"><span class="bt-p-role">' + listWords(ROOM.members.map((b) => b.name)) + '</span></p></div>' + acts + '</header>';
}
/** the room's composer: the placeholder the room writes, the members as chips */
export function roomComposer(text = ''): HTMLElement {
  const c = ui.composer({ placeholder: 'Message ' + ROOM.name + ', or @name for one', label: 'Message ' + ROOM.name, attach: false, queue: true, chips: ROOM.members.map((b) => ({ label: '@' + b.id })) });
  if (text) c.setValue(text);
  return c;
}
/** a huddle: the real entry (open or folded) for a run of members' messages */
export function huddle(msgs: GroupText[], open: boolean): HTMLElement {
  return huddleEntry(msgs, huddleDeps, { open });
}
const member = (b: FilmBot): GroupMember => ({ id: b.id, profile: b.id, handle: b.id, name: b.name });
export const huddleDeps = {
  member: (id: string): GroupMember | undefined => { const b = botById(id); return b ? member(b) : undefined; },
  orb: (m: GroupMember, size: number): string => ui.html.orb(like(botById(m.id) ?? BOTS.kai), { size }),
  to: (m: GroupText): string[] => [...(m.to ?? [])],
  ctx: mdCtx,
  drawn: (): void => undefined
};
export { huddleMessage };

/* the script's room thread (SC/script/script.md, B04 to B07) */
export const T = {
  ask: ['@kai is it ready to cut?', '14:02'] as const,
  kai1: ['Almost. @moss is the suite stable? @nina is staging free?', '14:02', ['moss', 'nina']] as const,
  huddle: [
    { kind: 'text', id: 'h1', who: 'nina', t: '14:03', round: 1, to: ['kai'], text: 'Staging is free and matches production.' },
    { kind: 'text', id: 'h2', who: 'moss', t: '14:04', round: 1, to: ['kai'], text: 'Green on every run since Monday.' },
    { kind: 'text', id: 'h3', who: 'kai', t: '14:05', round: 2, to: ['nina', 'moss'], text: 'Then it’s ready to cut.' }
  ] as GroupText[],
  next: ['@nina stage it next', '14:05'] as const
};

/* ───────── the boopis window at establishing scale ─────────
   Its own chrome (DESIGN-SYSTEM 14.1): the two-eye mark, the sidebar toggle, back and forward, the search pill, minimise,
   maximise and close at the right; never macOS. The sidebar: the tabs pill, New bot, the four bots, the group; the foot a
   grey disc and a bar (no name). The ground: the room as bars. The dock: black, the four orbs and "+". */
export interface WinOpts { x: number; y: number; w: number; h: number; tab?: 'session' | 'bots'; dock?: boolean; main?: (main: HTMLElement, w: number, h: number) => void; dim?: boolean }
export function appWindow(o: WinOpts): HTMLElement {
  const k = o.w / 1280;                          /* the window drawn as a 1280-wide app, scaled */
  const px = (v: number): string => Math.round(v * k) + 'px';
  const win = h('div', 'win', '', { left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: o.h + 'px' });
  const barH = 40 * k;
  const bar = h('div', 'win__bar', '', { height: px(40), gap: px(14), padding: '0 ' + px(18) });
  const mark = (window as unknown as { BoopisLogo: { svg(o: object): string } }).BoopisLogo.svg({ mark: true, color: 'var(--text-strong)' });
  bar.append(h('span', '', mark, { width: px(22), display: 'inline-flex' }));
  for (const name of ['sidebar-left', 'back', 'forward']) bar.append(h('span', '', ui.icon(name), { width: px(16), height: px(16), display: 'inline-flex' }));
  bar.append(h('span', 'win__search', '<span class="wbar wbar--q" style="width:' + px(14) + ';height:' + px(14) + ';border-radius:50%"></span><span class="wbar" style="width:' + px(120) + ';height:' + px(7) + '"></span>', { width: px(420), height: px(26) }));
  const ctl = h('span', 'win__ctl', '', { gap: px(22) });
  for (const name of ['minimize', 'maximize', 'close']) ctl.append(h('span', '', ui.icon(name), { width: px(14), height: px(14), display: 'inline-flex' }));
  bar.append(ctl);
  for (const s of bar.querySelectorAll<HTMLElement>('svg')) { s.style.width = '100%'; s.style.height = '100%'; }
  win.append(bar);

  const sideW = 256 * k;
  const side = h('div', 'win__side', '', { width: sideW + 'px', top: barH + 'px' });
  const tabs = h('div', 'tabs', '<span' + (o.tab === 'session' ? ' data-on' : '') + '><i style="width:' + px(52) + '"></i></span><span' + (o.tab !== 'session' ? ' data-on' : '') + '><i style="width:' + px(34) + '"></i></span>', { left: px(12), top: px(10), width: px(232), height: px(34), padding: px(3), 'border-radius': px(12) });
  for (const t of tabs.querySelectorAll<HTMLElement>('span')) t.style.borderRadius = px(9);
  side.append(tabs);
  const row = (y: number, lead: string, w1: number, w2?: number): HTMLElement => h('div', 'wrow', lead + '<span class="bars"><span class="wbar wbar--s" style="width:' + px(w1) + ';height:' + px(7) + '"></span>' + (w2 ? '<span class="wbar wbar--q" style="width:' + px(w2) + ';height:' + px(6) + '"></span>' : '') + '</span>', { left: px(16), top: px(y), gap: px(12) });
  const orbLead = (b: FilmBot, size = 20): string => '<span style="display:inline-flex;width:' + px(size) + ';height:' + px(size) + '">' + ui.html.orb(like(b), { size: Math.round(size * k) }) + '</span>';
  side.append(row(62, '<span style="color:var(--icon);display:inline-flex;width:' + px(16) + ';height:' + px(16) + '">' + ui.icon('plus') + '</span>', 64));
  if (o.tab === 'session') {
    side.append(row(104, '', 74));
    [0, 1, 2, 3].forEach((i) => side.append(row(134 + i * 34, '<span class="wbar wbar--q" style="width:' + px(10) + ';height:' + px(10) + ';border-radius:50%"></span>', [150, 120, 170, 96][i] ?? 100)));
  } else {
    ROOM.members.forEach((b, i) => side.append(row(100 + i * 44, orbLead(b), [34, 40, 44, 32][i] ?? 36, [110, 60, 104, 92][i])));
    side.append(row(288, '', 52));
    side.append(row(316, '<span style="display:inline-flex;width:' + px(44) + '">' + ui.html.stack({ members: ROOM.members.map((b) => like(b)), size: Math.round(16 * k), max: 3 }) + '</span>', 56, 120));
  }
  side.append(h('div', 'wrow', '<span class="wbar wbar--q" style="width:' + px(24) + ';height:' + px(24) + ';border-radius:50%"></span><span class="wbar" style="width:' + px(60) + ';height:' + px(7) + '"></span>', { left: px(16), bottom: px(18), gap: px(12) }));
  win.append(side);

  const mainW = o.w - sideW, mainH = o.h - barH;
  const main = h('div', 'win__main', '', { width: mainW + 'px', height: mainH + 'px', 'border-top-left-radius': px(14) });
  if (o.main) o.main(main, mainW, mainH);
  win.append(main);
  sharpenOrbs(win, 1);
  if (o.dock !== false) {
    const dw = 330 * k, dh = 66 * k;
    const dock = h('div', 'dock', '', { left: (sideW + mainW / 2 - dw / 2) + 'px', bottom: '0', width: dw + 'px', height: dh + 'px', gap: px(14), 'border-radius': px(16) + ' ' + px(16) + ' 0 0' });
    for (const b of ROOM.members) dock.append(h('span', '', ui.html.orb(like(b), { size: Math.round(40 * k) }), { display: 'inline-flex' }));
    dock.append(h('span', 'dock__plus', ui.icon('plus'), { width: px(18), height: px(18), display: 'inline-flex' }));
    win.append(dock);
    sharpenOrbs(dock, 1);
  }
  if (o.dim) win.style.filter = 'var(--far-dim)';
  return win;
}
/** the room's thread drawn as bars inside a window's ground (orbs real, words bars) */
export function barRoom(main: HTMLElement, w: number, k: number, rows: Array<[FilmBot | 'you' | 'huddle', number[]]>): void {
  const col = h('div', '', '', { position: 'absolute', left: Math.round(w / 2 - 300 * k) + 'px', top: Math.round(28 * k) + 'px', width: Math.round(600 * k) + 'px', display: 'flex', 'flex-direction': 'column', gap: Math.round(22 * k) + 'px' });
  for (const [who, lines] of rows) {
    const r = h('div', '', '', { display: 'grid', 'grid-template-columns': Math.round(112 * k) + 'px 1fr', 'align-items': 'start' });
    const lead = who === 'you' ? '<span class="wbar wbar--q" style="width:' + Math.round(26 * k) + 'px;height:' + Math.round(6 * k) + 'px"></span>'
      : who === 'huddle' ? '<span style="display:inline-flex">' + ui.html.stack({ members: [like(BOTS.nina), like(BOTS.moss), like(BOTS.kai)], size: Math.round(16 * k), max: 3 }) + '</span>'
        : '<span style="display:inline-flex">' + ui.html.orb(like(who), { size: Math.round(20 * k) }) + '</span>';
    const body = who === 'you'
      ? '<span style="justify-self:start;display:inline-flex;padding:' + Math.round(9 * k) + 'px ' + Math.round(14 * k) + 'px;border-radius:' + Math.round(16 * k) + 'px;background:var(--bg-3)"><span class="wbar wbar--s" style="width:' + Math.round((lines[0] ?? 40) * 4 * k) + 'px;height:' + Math.round(7 * k) + 'px"></span></span>'
      : '<span style="display:flex;flex-direction:column;gap:' + Math.round(10 * k) + 'px">' + lines.map((l) => '<span class="wbar' + (who === 'huddle' ? ' wbar--q' : '') + '" style="width:' + l + '%;height:' + Math.round(7 * k) + 'px"></span>').join('') + '</span>';
    r.innerHTML = lead + body;
    col.append(r);
  }
  main.append(col);
}

/* ───────── a terminal: plain, dark, a thin strip, nothing named ───────── */
export function terminal(o: { x: number; y: number; w: number; h: number; lines: string; size?: number }): HTMLElement {
  const t = h('div', 'term', '<div class="term__strip"></div><div class="term__body">' + o.lines + '</div>', { left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: o.h + 'px' });
  if (o.size) (t.querySelector('.term__body') as HTMLElement).style.fontSize = o.size + 'px';
  return t;
}

/* ───────── the other app on the desktop: nameless and generic, a message list and one field ───────── */
export function otherApp(o: { x: number; y: number; w: number; h: number; msgs: Array<{ text?: string; bars?: number[]; you?: boolean }>; field?: string; fieldPlaceholder?: boolean }): HTMLElement {
  const a = h('div', 'app2', '', { left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: o.h + 'px' });
  for (const m of o.msgs) {
    const e = h('div', 'app2__msg', m.text ? m.text : '<span style="display:flex;flex-direction:column;gap:12px">' + (m.bars ?? [70]).map((w) => '<span class="wbar" style="width:' + w * 3.2 + 'px"></span>').join('') + '</span>');
    if (m.you) e.dataset['you'] = '';
    a.append(e);
  }
  const f = h('div', 'app2__field', o.field ?? '');
  if (!o.field) f.dataset['empty'] = '';
  a.append(f);
  return a;
}

/* ───────── the session (modules/session): its composer with the Governed chip, the agent's entry, steps, the panel ───────── */
export function sessionComposer(text = ''): HTMLElement {
  const c = ui.composer({ placeholder: 'Ask for a change', label: 'Message the session', attach: true, chips: [{ label: 'Governed', icon: 'ladder', pressed: true }] });
  if (text) c.setValue(text);
  return c;
}
export interface Step { title: string; mono?: boolean; meta?: string[]; kind?: 'step' | 'fail' | 'escalate' }
export function agentEntry(models: string[], steps: Step[], openSteps = true): string {
  const callno = models.map((m, i) => (i === 0 ? m : '→ ' + m));
  const id = 'steps-' + models.length;
  const e = ui.html.entry({ kind: 'agent', callno, steps: { count: steps.length, id, open: openSteps }, body: ui.html.steps(steps.map((s) => ({ title: s.title, mono: s.mono, meta: s.meta ?? null, kind: s.kind ?? 'step' })), { id }) });
  return e;
}
export function governance(current: number): string {
  const ladder = ui.html.ladder({ stations: [['gpt-6.2-sol', ''], ['gpt-6.2-astra', '']], current, variant: 'list', label: 'Escalation ladder' });
  return ui.html.section({ label: 'Governance', open: true, body: ladder });
}

/* ───────── the dock and a bot's session in it (DESIGN-SYSTEM 14.12) ───────── */
export function dockRow(k: number): HTMLElement {
  const d = h('div', 'dock', '', { position: 'relative', height: Math.round(76 * k) + 'px', padding: '0 ' + Math.round(22 * k) + 'px', gap: Math.round(14 * k) + 'px', 'border-radius': Math.round(30 * k / 2) + 'px ' + Math.round(30 * k / 2) + 'px 0 0' });
  d.dataset['ground'] = 'dock';
  for (const b of ROOM.members) d.append(h('span', '', ui.html.orb(like(b), { size: Math.round(40 * k) }), { display: 'inline-flex' }));
  d.append(h('span', 'dock__plus', ui.icon('plus'), { width: Math.round(18 * k) + 'px', height: Math.round(18 * k) + 'px', display: 'inline-flex' }));
  sharpenOrbs(d, 1);
  return d;
}

/* ───────── a hold button caught mid-hold, with the product's dot field (Bayer 4x4 on a 3px grid, at film scale) ───────── */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** set a rendered hold button's fill to `p` (0..1) and draw its leading-edge dot field over it, `x` being the film scale */
export function holdAt(btn: HTMLElement, p: number, x: number): void {
  const edge = 0.14;
  for (const el of btn.querySelectorAll<HTMLElement>('.ui-hold__solid, .ui-hold__label--on')) el.style.clipPath = 'inset(0 ' + ((1 - p + edge) * 100) + '% 0 0)';
  const r = btn.getBoundingClientRect();
  const W = r.width, H = r.height, cell = 3 * x, dot = 2 * x;
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  /* the field takes the product's own canvas slot (under both labels), zoomed back to film pixels */
  c.className = 'ui-hold__fx';
  Object.assign(c.style, { width: W + 'px', height: H + 'px', zoom: String(1 / x) });
  const g = c.getContext('2d'); if (!g) return;
  g.scale(dpr, dpr);
  g.fillStyle = getComputedStyle(btn).getPropertyValue('--selected').trim() || '#ece6da';
  const P = W * p, fr = W * 0.22, from = P - W * (edge + 0.02);
  for (let col = Math.max(0, Math.floor(from / cell)); col < Math.ceil(P / cell); col++) {
    const xx = col * cell, v = (P - (xx + 1)) / fr;
    for (let row = 0; row < Math.ceil(H / cell); row++) {
      if (v > ((BAYER[((row & 3) << 2) | (col & 3)] ?? 0) + 0.5) / 16) { g.beginPath(); g.arc(xx + dot / 2, row * cell + dot / 2, dot / 2, 0, Math.PI * 2); g.fill(); }
    }
  }
  btn.querySelector('.ui-hold__fx')?.replaceWith(c);
}

export { filmUI };
