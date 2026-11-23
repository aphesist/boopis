/* B12 to B16: the terminal, the run live in the room, the other app, the approval and the hold (SC/script/script.md). */
import { ui } from '@boopis/ui';
import '@ui/src/modules/dock/dock.css';
import type { GroupText } from '@ui/src/data/types';
import { BOTS, ROOM, filmUI, h, sharpenOrbs } from '../stage';
import { appWindow, botEntry, cursor, filmLine, holdAt, huddle, like, otherApp, terminal, youEntry } from './parts';

const pool = (s: HTMLElement, x: string, y: string, w = '90%', hh = '96%', c = 'var(--lamp-cool)'): void => {
  s.style.setProperty('--pool-x', x); s.style.setProperty('--pool-y', y); s.style.setProperty('--pool-w', w); s.style.setProperty('--pool-h', hh);
  s.style.setProperty('--pool', c);
};
const CMD = '<span class="p">$</span> boopis run --group release "write the release notes"';
const OUT = [
  '<span class="q">[14:07:41]</span> kai', '  @vox draft them from the merged changes.',
  '<span class="q">[14:07:58]</span> vox', '  The draft is in CHANGELOG.md.',
  '<span class="q">[14:08:16]</span> kai', '  Read it. Tightened the fixes section.',
  '<span class="q">-- done: the bots stopped handing off after 3 rounds</span>', '<span class="p">$</span> '
];
const caret = '<span style="display:inline-block;width:.6em;height:1.1em;vertical-align:-.2em;background:var(--text)"></span>';

/** B12 at 29.4 s: the camera has eased onto the terminal; the command is typed, the caret at rest, Enter about to fall on
    the downbeat */
export function b12(s: HTMLElement, v: boolean): void {
  pool(s, v ? '50%' : '34%', v ? '36%' : '56%');
  s.append(filmLine(v ? 'The {whole} team,<br>from a terminal' : 'The {whole} team, from a terminal', { y: v ? 240 : 70, size: v ? 104 : 88 }));
  if (v) {
    s.append(terminal({ x: 40, y: 560, w: 1000, h: 560, lines: '<span class="p">$</span> boopis run --group release\n  "write the release notes"' + caret, size: 34 }));
    const w = 1100, k = w / 1280;
    const win = appWindow({ x: 160, y: 1200, w, h: 620, tab: 'bots', dim: true, main: () => undefined });
    win.style.filter = 'blur(6px) var(--far-dim)';
    s.append(win);
    void k;
    return;
  }
  const win = appWindow({ x: 1000, y: 300, w: 1100, h: 620, tab: 'bots', main: () => undefined });
  win.style.filter = 'blur(6px) var(--far-dim)';
  s.append(win);
  const t = terminal({ x: -30, y: 250, w: 1130, h: 640, lines: '\n' + CMD + caret, size: 30 });
  (t.querySelector('.term__body') as HTMLElement).style.paddingLeft = '70px';
  s.append(t);
}

/** B13 at 31.3 s: the run printed in the terminal's plain format while the same messages landed in the open room, whose
    entries read by their orbs and names; vox's and kai's messages have gathered into a live huddle */
export function b13(s: HTMLElement, v: boolean): void {
  pool(s, '50%', '50%');
  const msgs: GroupText[] = [
    { kind: 'text', id: 'r1', who: 'vox', t: '14:07', round: 1, to: ['kai'], text: 'The draft is in CHANGELOG.md.' },
    { kind: 'text', id: 'r2', who: 'kai', t: '14:08', round: 2, to: ['vox'], text: 'Read it. Tightened the fixes section.' }
  ];
  const room = h('div', 'room-log');
  if (v) room.dataset['margin'] = 'off';
  room.insertAdjacentHTML('beforeend', youEntry('write the release notes', '14:07') + botEntry(BOTS.kai, '@vox draft them from the merged changes.', '14:07', ['vox']));
  room.append(huddle(msgs, true));
  const lines = CMD + '\n' + OUT.join('\n');
  if (v) {
    s.append(terminal({ x: 30, y: 230, w: 1020, h: 720, lines: '<span class="p">$</span> boopis run --group release\n  "write the release notes"\n' + OUT.join('\n').replace('-- done: the bots stopped handing off after 3 rounds', '-- done: the bots stopped handing\n   off after 3 rounds'), size: 28 }));
    s.append(h('div', 'plate plate--room', '', { left: '30px', top: '1000px', width: '1100px', height: '1000px' }));
    s.append(filmUI(room, { x: 70, y: 1040, width: 360, scale: 2.6 }).outer);
    return;
  }
  s.append(h('div', 'plate plate--room', '', { left: '1000px', top: '-60px', width: '1000px', height: '1200px' }));
  s.append(filmUI(room, { x: 1040, y: 130, width: 560, scale: 2.6 }).outer);
  const t = terminal({ x: -24, y: 110, w: 1004, h: 860, lines, size: 28 });
  (t.querySelector('.term__body') as HTMLElement).style.whiteSpace = 'pre-wrap';
  (t.querySelector('.term__body') as HTMLElement).style.paddingLeft = '60px';
  s.append(t);
}

/** a bot's session in the dock, in the dock's own markup (modules/dock/views.ts `bots:card` and `logHTML`, its classes
    styled by modules/dock/dock.css): the head (the orb at 40, the name, the state, the role, the full-chat and close
    buttons), the last messages as the Bots tab draws them (ui.html.entry, the call number folded above, yours as request
    bubbles), the bot's open card, the library composer, and the switcher. The slab is the dock's black, its top corners
    the dock's 30. `room` narrows the view as the dock's own --dock-room does in a narrow window (9:16). */
interface LogMsg { who: 'you' | 'nina'; t: string; text?: string; bars?: number[] }
function dockSession(o: { x: number; w?: number; scale: number; face: string; flag?: boolean; state?: string; composer?: boolean; log: LogMsg[]; card?: HTMLElement; room?: number }): HTMLElement {
  const X = o.scale, b = BOTS.nina;
  const entries = o.log.map((m) => {
    const you = m.who === 'you';
    const body = m.bars
      ? '<div style="display:flex;flex-direction:column;gap:9px;padding:6px 0">' + m.bars.map((w) => '<span class="wbar" style="width:' + Math.round(w * 3.6) + 'px;height:6px"></span>').join('') + '</div>'
      : you ? ui.html.request(m.text ?? '') : '<p>' + (m.text ?? '') + '</p>';
    return ui.html.entry({ kind: you ? 'user' : 'bot', who: you ? 'You' : b.name, callno: m.t ? [m.t] : [], body });
  }).join('');
  const attention = o.face === 'needs';
  const state = attention ? ui.html.dot('attention') + '<span class="dk-card-word">needs you</span>' : (o.state ?? '');
  const view = h('div', 'dk-view dk-v-bots-card');
  view.dataset['view'] = 'bots:card';
  view.innerHTML =
    '<div class="dk-card-head"><span class="dk-orb">' + ui.html.orb(like(b, o.face), { size: 40, flag: !!o.flag }) + '</span>' +
    '<div class="dk-card-who"><div class="dk-card-line"><span class="dk-card-name">' + b.name + '</span><span class="dk-card-state"' + (attention ? ' data-tone="attention"' : '') + '>' + state + '</span></div><div class="dk-card-role">' + b.role + '</div></div>' +
    '<span class="dk-card-acts">' + ui.html.iconButton({ icon: 'bots', label: 'Open the full chat with ' + b.name, size: 's' }) + ui.html.iconButton({ icon: 'close', label: 'Close the session with ' + b.name, size: 's' }) + '</span></div>' +
    '<div class="dk-sess-log ui-scroll" data-margin="off">' + entries + '</div>' +
    (o.card ? '<div class="dk-ask" data-size="compact"></div>' : '') +
    (o.composer !== false ? '<div class="dk-sess-composer"></div>' : '') +
    '<div class="dk-strip">' + ROOM.members.map((x) => '<span class="ui-orb-btn dk-strip-bot"' + (x.id === b.id ? ' aria-current="true"' : '') + '>' + ui.html.orb(like(x), { size: 18 }) + '</span>').join('') + '</div>';
  if (o.card) view.querySelector('.dk-ask')!.append(o.card);
  if (o.composer !== false) {
    const c = ui.composer({ placeholder: 'Message ' + b.name, label: 'Message ' + b.name, attach: false, bot: like(b) });
    c.classList.add('dk-composer');
    view.querySelector('.dk-sess-composer')!.append(c);
  }
  const dk = h('div', 'dk film-dock', '', o.room ? { '--dock-room': o.room + 'px' } : undefined);
  dk.dataset['ground'] = 'dock';
  dk.append(view);
  const f = filmUI(dk, { x: 0, y: 0, scale: X });
  f.outer.style.position = 'relative';
  const w = o.w ?? Math.round((o.room ?? 456) * X);
  const slab = h('div', '', '', { position: 'absolute', left: o.x + 'px', top: '0px', width: w + 'px', background: 'var(--dock-bg)', 'border-radius': Math.round(30 * X) + 'px ' + Math.round(30 * X) + 'px 0 0', 'box-shadow': 'var(--slab-shadow)', overflow: 'hidden' });
  slab.append(f.outer);
  sharpenOrbs(slab, X);
  return slab;
}

/** B14 at 34.5 s: one click on nina's orb opened her session in the dock (her own chat, older messages as bars); in the
    nameless app at the right your message is typed and about to be sent. The product's own dock markup (board page
    b14-dock); act 4 still builds from the hand-made `b14` below until it moves to this one. */
export function b14Dock(s: HTMLElement, v: boolean): void {
  pool(s, '50%', '70%');
  /* 16:9: the line sits in the right column over the other app, as in B15, so the slab can rise to full height */
  s.append(filmLine(v ? '{Same} thread,<br>from your other apps' : '{Same} thread,<br>from your<br>other apps', v ? { y: 240, size: 100 } : { y: 110, align: 'left', x: 1350, size: 80, width: 540 }));
  const X = 2.6;
  const ds = dockSession({ x: v ? 46 : 110, scale: X, face: 'idle', room: v ? 380 : undefined, log: [{ who: 'nina', t: '13:40', bars: [86, 58] }, { who: 'you', t: '13:41', bars: [44] }, { who: 'nina', t: '13:41', bars: [72] }] });
  s.append(ds);
  const hgt = (ds.firstElementChild as HTMLElement).getBoundingClientRect().height;
  /* 16:9: the slab grew up from the frame's bottom edge; 9:16: it sits in the middle band, the other app under it */
  ds.style.top = Math.round(v ? 500 : 1080 - hgt) + 'px';
  if (!v) ds.style.bottom = '0';
  const app = otherApp(v ? { x: 120, y: Math.round(500 + hgt + 36), w: 840, h: Math.max(200, Math.round(1640 - 500 - hgt - 36)), msgs: [{ bars: [70, 40] }], field: 'nina, go ahead with staging' } : { x: 1350, y: 440, w: 530, h: 540, msgs: [{ bars: [70, 46] }, { bars: [40], you: true }, { bars: [62] }], field: 'nina, go ahead with staging' });
  s.append(app);
  const f = app.querySelector<HTMLElement>('.app2__field')!.getBoundingClientRect();
  s.append(cursor(Math.round(f.right - 70), Math.round(f.top + 30)));
}

/** B15 at 36.4 s: your message showed in the dock session as yours and in the other app; nina's reply streamed in both;
    her approval card has risen with the stamp, her face turned to needs with the flag; the light warms red around it.
    The product's own dock markup (board page b15-dock); act 4 still builds from the hand-made `b15` below. */
export function b15Dock(s: HTMLElement, v: boolean): void {
  pool(s, v ? '50%' : '34%', v ? '62%' : '72%', '70%', '80%', 'var(--lamp-red)');
  s.append(filmLine('Nothing ships<br>until you {hold}', v ? { y: 220, size: 96 } : { y: 120, align: 'left', x: 1330, size: 80, width: 570 }));
  const X = 2.6;
  const card = approvalCard();
  const ds = dockSession({ x: v ? 46 : 80, scale: X, face: 'needs', flag: true, composer: false, room: v ? 380 : undefined, card, log: [
    { who: 'you', t: '14:09', text: 'nina, go ahead with staging' },
    { who: 'nina', t: '14:09', text: 'Ready. Deploying needs your approval.' }
  ] });
  s.append(ds);
  /* framed so the whole card shows; the session's composer is below the frame */
  const hgt = (ds.firstElementChild as HTMLElement).getBoundingClientRect().height;
  /* framed on the head through the card; the switcher runs off the bottom edge in 16:9 */
  ds.style.top = (v ? 470 : 44) + 'px';
  ds.style.bottom = '0';
  void hgt;
  /* 9:16: the other app sits under the card, in front of the slab's switcher, inside the safe band */
  const askBottom = ds.querySelector('.dk-ask')?.getBoundingClientRect().bottom ?? 1400;
  s.append(otherApp(v ? { x: 120, y: Math.round(askBottom + 28), w: 840, h: Math.max(150, Math.round(1640 - askBottom - 28)), msgs: [{ text: 'nina needs your approval' }], field: '' } : { x: 1330, y: 400, w: 550, h: 560, msgs: [{ text: 'nina, go ahead with staging', you: true }, { text: 'Ready. Deploying needs your approval.' }, { text: 'nina needs your approval' }], field: '' }));
}
/** the approval card, compact, on the dock's ground, pending: the markup the card layer renders for it (modules/cards: card.ts
    regions, kinds.ts approval, parts.ts headrow, byline, well, foot), drawn statically because the card layer's live element
    needs the app's data provider. No expiry and no cost in its foot (the script leaves both out). */
function approvalCard(): HTMLElement {
  const by = '<div class="cd-by" data-origin="teammate">' + ui.html.orb(like(BOTS.nina), { size: 18 }) + '<span class="cd-by__label">nina</span></div>';
  const head = '<div class="cd-headrow"><div class="cd-headmain">' + by + '<p class="cd-lead">nina wants to deploy to staging</p></div>' + ui.html.stamp('needs you') + '</div>';
  const body = '<div class="cd-well"><div class="cd-well__line cd-well__line--first"><span class="cd-well__strong">staging</span><span>invoices-api</span></div></div>';
  const foot = '<div class="cd-foot"><div class="cd-actions">' + ui.html.button({ label: 'Deny', action: 'deny' }) + ui.html.hold({ attrs: { 'data-hold': 'true' } }) + '</div></div>';
  const card = h('hx-card', '', '<div class="cd-side" data-r="side"></div><div class="cd-main"><div data-r="head">' + head + '</div><div data-r="body">' + body + '</div><div data-r="foot">' + foot + '</div></div>');
  Object.assign(card.dataset, { kind: 'approval', size: 'compact', ground: 'dock', state: 'pending', tone: 'red' });
  return card;
}

/** B16 at 37.9 s: the camera has pushed in until the hold button fills about 60% of the frame; the cursor is pressing and
    the fill is half way: the ordered dot field gathers at the leading edge, fusing into the bone fill, the label inverting */
export function b16(s: HTMLElement, v: boolean): void {
  pool(s, '50%', '50%', '70%', '70%', 'var(--lamp-red-close)');
  s.style.background = 'var(--dock-bg)';
  s.querySelector<HTMLElement>('.ground')!.style.opacity = '0';   /* the camera is inside the dock: its black is the frame */
  const X = v ? 6.6 : 7.8;
  const foot = h('div', '', ui.html.button({ label: 'Deny', size: 'm' }) + ui.html.hold({ label: 'Hold to approve' }), { display: 'flex', gap: '8px', 'align-items': 'center' });
  foot.dataset['ground'] = 'dock';
  const f = filmUI(foot, { x: 0, y: 0, scale: X });
  s.append(f.outer);
  const btn = f.outer.querySelector<HTMLElement>('.ui-hold')!;
  const r = btn.getBoundingClientRect();
  const cx = v ? 540 : 960, cy = v ? 960 : 540;
  f.outer.style.left = Math.round(cx - (r.left - f.outer.getBoundingClientRect().left) - r.width / 2) + 'px';
  f.outer.style.top = Math.round(cy - r.height / 2) + 'px';
  holdAt(btn, 0.52, X);
  const r2 = btn.getBoundingClientRect();
  const c = cursor(Math.round(r2.left + r2.width * 0.62), Math.round(r2.top + r2.height * 0.42), Math.round(48 * 1.9 * 0.85));
  s.append(c);
}

/* ───────── the hand-made dock session (the storyboard's first key frames, kept only for act 4) ─────────
   Act 4 (src/acts/a4/desk.ts buildSet) takes these two key frames apart by their structure: the slab's column children
   [head, you, reply, card] in b15 and [head, bars, bars, composer] in b14. They are not the product's dock: the head, the
   older messages and the request are drawn by hand, the composer is the compact one. b14Dock and b15Dock above are the
   product's own dock view (dock/views.ts markup, dock.css); act 4 moves to them, and then these go. */
function handDock(o: { x: number; y: number; w: number; scale: number; face: string; flag?: boolean; composer?: boolean; body: Array<string | Node> }): HTMLElement {
  const X = o.scale;
  const slab = h('div', '', '', { position: 'absolute', left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', bottom: '0', background: 'var(--dock-bg)', 'border-radius': Math.round(30 * X / 2) + 'px ' + Math.round(30 * X / 2) + 'px 0 0', 'box-shadow': 'var(--slab-shadow)' });
  const inner = h('div', '', '', { display: 'flex', 'flex-direction': 'column', gap: '16px', padding: '16px 18px' });
  inner.dataset['ground'] = 'dock';
  const head = h('div', '', ui.html.orb(like(BOTS.nina, o.face), { size: 40 }) + '<span style="display:flex;flex-direction:column"><span style="font:600 var(--fs-l)/1.2 var(--sans);color:var(--text-strong)">nina</span><span style="font:400 var(--fs-xs)/1.35 var(--sans);color:var(--text-quiet)">deploys</span></span>',
    { display: 'flex', 'align-items': 'center', gap: '12px', position: 'relative' });
  if (o.flag) head.querySelector('.ui-orb')?.insertAdjacentHTML('beforeend', '<span class="ui-dot ui-dot--flag" aria-hidden="true"></span>');
  inner.append(head);
  for (const b of o.body) { if (typeof b === 'string') inner.insertAdjacentHTML('beforeend', b); else inner.append(b); }
  if (o.composer !== false) inner.append(ui.composer({ placeholder: 'Message nina', label: 'Message nina', compact: true }));
  const f = filmUI(inner, { x: 0, y: 0, scale: X, width: Math.round(o.w / X) });
  f.outer.style.position = 'relative';
  slab.append(f.outer);
  sharpenOrbs(slab, X);
  return slab;
}
const oldBars = (n: number[]): string => '<div style="display:flex;flex-direction:column;gap:12px;padding-left:4px">' + n.map((w) => '<span class="wbar" style="width:' + w + '%;height:6px"></span>').join('') + '</div>';
const youEntryDock = (text: string, t: string): string => '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><span style="font:400 var(--fs-2xs)/1.45 var(--mono);color:var(--text-quiet)">You ' + t + '</span><div class="ui-request">' + text + '</div></div>';

/** B14, hand-made (act 4's): as the storyboard boarded it */
export function b14(s: HTMLElement, v: boolean): void {
  pool(s, '50%', '70%');
  s.append(filmLine(v ? '{Same} thread,<br>from your other apps' : '{Same} thread, from your other apps', { y: v ? 240 : 80, size: v ? 100 : 88 }));
  const X = 2.6;
  const ds = handDock({ x: v ? 70 : 200, y: 0, w: v ? 940 : 980, scale: X, face: 'idle', body: [oldBars([82, 64]), oldBars([56])] });
  s.append(ds);
  const hgt = (ds.firstElementChild as HTMLElement).getBoundingClientRect().height;
  ds.style.top = Math.round((v ? 1220 : 1080) - hgt) + 'px';
  if (v) ds.style.bottom = (1920 - 1220) + 'px';
  const app = otherApp(v ? { x: 120, y: 1290, w: 840, h: 320, msgs: [{ bars: [70, 40] }], field: 'nina, go ahead with staging' } : { x: 1260, y: 330, w: 620, h: 600, msgs: [{ bars: [70, 46] }, { bars: [40], you: true }, { bars: [62] }], field: 'nina, go ahead with staging' });
  s.append(app);
  const f = app.querySelector<HTMLElement>('.app2__field')!.getBoundingClientRect();
  s.append(cursor(Math.round(f.right - 70), Math.round(f.top + 30)));
}

/** B15, hand-made (act 4's): as the storyboard boarded it */
export function b15(s: HTMLElement, v: boolean): void {
  pool(s, v ? '50%' : '34%', v ? '62%' : '72%', '70%', '80%', 'var(--lamp-red)');
  s.append(filmLine('Nothing ships<br>until you {hold}', v ? { y: 220, size: 96 } : { y: 120, align: 'left', x: 1240, size: 84, width: 660 }));
  const X = 2.6;
  const ds = handDock({ x: v ? 70 : 140, y: 0, w: v ? 940 : 1000, scale: X, face: 'needs', flag: true, composer: false, body: [
    youEntryDock('nina, go ahead with staging', '14:09'),
    '<p style="margin:0;font:400 var(--fs-m)/1.5 var(--sans);color:var(--text)">Ready. Deploying needs your approval.</p>',
    approvalCard()
  ] });
  s.append(ds);
  const hgt = (ds.firstElementChild as HTMLElement).getBoundingClientRect().height;
  ds.style.top = Math.round(v ? 480 : 1060 - hgt) + 'px';
  if (v) ds.style.bottom = Math.round(1920 - 480 - hgt - 20) + 'px';
  s.append(otherApp(v ? { x: 120, y: 1350, w: 840, h: 260, msgs: [{ text: 'nina needs your approval' }], field: '' } : { x: 1240, y: 400, w: 640, h: 560, msgs: [{ text: 'nina, go ahead with staging', you: true }, { text: 'Ready. Deploying needs your approval.' }, { text: 'nina needs your approval' }], field: '' }));
}
