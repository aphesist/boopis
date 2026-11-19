/* the dock's views: one template per page and size (min, norm, exp, card, edit), the bots' orbs, the cards and the
   per-bot composers that live inside them. */
import { esc, isMac } from '../../core/dom';
import { kbdLabel } from '../../core/keys';
import { $$, } from '../../core/dom';
import { ui } from '@boopis/ui';
import { data } from '../../data';
import type { Bot, ThreadMessage, Wait } from '../../data';
import { LOG_N, PAGE_NAME, S, X, attCount, botById, clock, ctxPct, motion, rendered } from './ctx';
import type { DockBot } from './ctx';
import { patchHTML } from './reconcile';
import { setOrbLife } from './orbs';
import { emitDock, retarget } from './engine';
import { syncRoving } from './roving';

const MOD = isMac ? 'Meta' : 'Control';
const IC: Record<string, string> = { plus: 'plus', close: 'close', stop: 'stop', sliders: 'sliders', down: 'chevron-down', left: 'back', right: 'forward' };
export const icon = (n: string, o?: { size?: string; class?: string }): string => ui.icon(IC[n] ?? n, o);

/* ───────── bots + orbs (ui.botState, ui.orb) ───────── */
export const st = (b: Bot): ReturnType<typeof ui.botState> => ui.botState(b);
const phrase = (b: Bot): string => st(b).word;
export const botLabel = (b: Bot): string => ui.botLabel(b);
/** a roster row shows the name and the state word only (no role), so its name holds exactly the visible text, in order (R-a11y-3) */
const rowLabel = (b: Bot): string => ui.botLabel({ ...b, role: '' });
/** one library orb per bot; it renders at 80 so magnification stays crisp; the wrapper is what travels */
export const makeOrb = (b: Bot): HTMLElement => ui.orb(b, { size: 40, render: 80, flag: true });
export const av = (id: string): (HTMLElement & Record<string, unknown>) | null => { const w = X.orbs.get(id); return w ? (w.querySelector('orb-avatar') as (HTMLElement & Record<string, unknown>) | null) : null; };
const miniOrb = (b: Bot, size: number): string => ui.html.orb(b, { size, render: size * 2 });
const slot = (b: Bot): string => `<span class="dk-orb" data-k="orb:${b.id}" data-slot="orb:${b.id}"></span>`;

export function relocateLive(): void {
  for (const b of S.bots) {
    const w = X.orbs.get(b.id); if (!w) continue;
    const target = $$(`[data-slot="orb:${b.id}"]`, X.root).find((x) => !x.closest('.is-leaving') && rendered(x));
    if (!target) continue;
    if (w.parentNode !== target) target.prepend(w);
    const o = parseFloat(getComputedStyle(target).getPropertyValue('--o'));
    if (o > 0) w.style.setProperty('--o', String(o));
  }
}
export function refreshBot(b: DockBot): void {
  const s = st(b), w = X.orbs.get(b.id), orb = av(b.id);
  const talking = X.composerEls.has(b.id) && X.composerEls.get(b.id)?.listening;   /* while you talk to it, it listens */
  if (orb && !talking && orb.getAttribute('reaction') !== s.reaction) orb.setAttribute('reaction', s.reaction);
  if (w) {
    const f = w.querySelector('.ui-dot--flag');
    if (s.attention && !f) w.insertAdjacentHTML('beforeend', ui.html.dot('flag'));
    if (!s.attention && f) f.remove();
  }
  for (const el of $$(`[data-bot-row="${b.id}"]`, X.root)) el.setAttribute('aria-label', rowLabel(b));
  for (const el of $$(`[data-bot-label="${b.id}"]`, X.root)) {
    el.setAttribute('aria-label', botLabel(b));
    if (el.hasAttribute('data-tip')) {
      if (s.key === 'idle') el.removeAttribute('data-tip-state'); else el.setAttribute('data-tip-state', s.word);
      if (s.attention) el.setAttribute('data-tip-tone', 'attention'); else el.removeAttribute('data-tip-tone');
    }
  }
  for (const el of $$(`[data-bot-phrase="${b.id}"]`, X.root)) el.textContent = s.word;
}

/* ───────── formatting ───────── */
export const fmtDur = (s: number): string => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
export const fmtCost = (v: number | null): string => (v == null ? 'unknown' : v < 0.01 && v > 0 ? '$' + v.toFixed(4) : '$' + v.toFixed(2));
const kfmt = (n: number): string => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
const run = () => S.run as NonNullable<typeof S.run>;
/** the model with its provider's mark (mono), through the library's one primitive */
const runModel = (): string => ui.html.model(run().model, { size: 14 });
const runHow = (): string => (run().escalated ? `escalated ${run().escalated === 1 ? 'once' : run().escalated + ' times'}` : 'on the first try');
const runSub = (): string => run().stopped ? 'Stopped by you' : `${runModel()} ${runHow()}`;
/** the run button's name: its visible words, in order (WCAG 2.5.3), then what it does */
const runName = (): string => `${run().title} ${run().stopped ? 'Stopped by you' : `${run().model} ${runHow()}`}, show run details`;
/** the run's spend: the library's running total and its row of dots (dots, not bars) */
/* a cost the plugin could not price is shown as unknown, and a run with no cap has no meter (ADR-0012) */
export const costHTML = (): string => (run().cost == null || run().cap == null
  ? `<span class="dk-mono">${esc(run().cost == null ? 'cost unknown' : fmtCost(run().cost))}</span>`
  : ui.html.capacity(fmtCost(run().cost), fmtCost(run().cap), { label: `${fmtCost(run().cost)} of the ${fmtCost(run().cap)} cap spent` }));
export const meterHTML = (): string => (run().cost == null || run().cap == null ? '' : ui.html.measure({ used: run().cost ?? 0, total: run().cap || 1, dots: 10, variant: 'row', label: 'Cost cap' }));
/** the ladder (line at rest, list expanded); finish() keys its stations run:t0… so they travel between views */
const ladderLine = (): string => `<span class="dk-ladder" data-tip="Model ladder: ${esc(run().model)}" data-tip-pos="top">${ui.html.ladder({ stations: run().ladder, current: run().current, ground: 'var(--dock-bg)' })}</span>`;
const ladderList = (): string => ui.html.ladder({ variant: 'list', ground: 'var(--dock-bg)', current: run().current,
  stations: run().ladder.map(([m, rule], i) => [m, i === run().current && !run().stopped ? `${rule}, running` : rule] as const) });
/** a page that shows sample data in a live build says so (the mock's bots and schedules are previews) */
const preview = (src: 'bots' | 'schedules'): string => (data().info.preview.has(src) ? `<span class="dk-preview" data-e>Preview</span>` : '');
const pillBtn = (label: string): string => `<button class="dk-pillbtn" data-act="restore" aria-label="${esc(label)}"></button>`;
const pillAtt = (): string => (attCount() ? `<span class="dk-att">${ui.html.dot('attention')}</span>` : '');
const needLabel = (n: number): string => `${n} ${n === 1 ? 'needs' : 'need'} you`;
const dotFor = (b: Bot): string => { const s = st(b); return s.attention ? ui.html.dot('attention') : s.busy ? ui.html.dot('run') : ''; };
const emptyWait = (): string => `<div class="dk-empty" data-e>${ui.html.empty({ title: 'Nothing needs you', text: 'Approvals and open questions from bots and runs land here.' })}</div>`;
type BtnO = Parameters<typeof ui.html.button>[0];
const btn = (label: string, act: string, o: Partial<BtnO> = {}): string => ui.html.button({ ...o, label, attrs: { 'data-act': act, ...(o.attrs ?? {}) } });
const keyHint = (): string => { const k = kbdLabel('mod+J'); return k ? `${k} brings it back` : 'Alt and the arrow keys move a page'; };
const stopBtn = (): string => ui.html.iconButton({ icon: 'stop', label: run().stopped ? 'Run stopped' : 'Stop run', disabled: run().stopped, class: 'dk-stop', tipPos: 'top', attrs: { 'data-act': 'stop', 'data-k': 'run:stop' } });

/* ───────── a session's last messages, drawn as the Bots tab draws them (ui.html.entry; yours as request bubbles) ───────── */
const sessState = (b: Bot): string => { const s = st(b); return `${dotFor(b)}${s.key === 'idle' ? '' : `<span class="dk-card-word">${esc(s.word)}</span>`}`; };
const threadOf = (id: string): ThreadMessage[] => (S.threads[id] ??= []);
function logHTML(b: Bot): string {
  let msgs = threadOf(b.id).filter((m) => m.kind === 'text' && m.text).map((m) => m as Extract<ThreadMessage, { kind: 'text' }>);
  if (!msgs.length && b.last) msgs = [{ kind: 'text', id: 'last', who: b.id, t: b.last.t, text: b.last.text }];
  if (!msgs.length) return `<p class="dk-sess-empty">Nothing from ${esc(b.name)} yet. Say what you need below.</p>`;
  const groups: Array<{ who: string; t: string; body: string }> = [];
  for (const m of msgs.slice(-LOG_N)) {
    const body = m.who === 'you' ? ui.html.request(m.text) : `<p>${esc(m.text)}</p>`;
    const g = groups[groups.length - 1];
    if (g && g.who === m.who) { g.body += body; g.t = m.t || g.t; } else groups.push({ who: m.who, t: m.t, body });
  }
  return groups.map((g) => {
    const you = g.who === 'you', name = you ? 'You' : (botById(g.who) ?? b).name;
    return ui.html.entry({ kind: you ? 'user' : 'bot', who: esc(name), callno: g.t ? [g.t] : [], label: name + (g.t ? ', ' + g.t : ''), body: g.body });
  }).join('');
}
export function paintSession(b: Bot, log: boolean): void {
  const v = X.curView && X.curView.dataset['view'] === 'bots:card' && S.card === b.id ? X.curView : null; if (!v) return;
  const el = v.querySelector<HTMLElement>('.dk-card-state');
  if (el) { el.innerHTML = sessState(b); if (st(b).attention) el.setAttribute('data-tone', 'attention'); else el.removeAttribute('data-tone'); }
  const lg = log ? v.querySelector<HTMLElement>('.dk-sess-log') : null;
  if (lg) { const end = lg.scrollHeight - lg.scrollTop - lg.clientHeight < 24; lg.innerHTML = logHTML(b); if (end) lg.scrollTop = lg.scrollHeight; retarget(false); emitDock(); }
}

/* ───────── long names ─────────
   A bot can be "chief of staff for the billing migration": a tooltip shows a clipped name, the accessible name keeps it
   whole; rows and the session head ellipsise in CSS. */
export const clip = (t: string | null | undefined, n: number): string => { const s = String(t || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
/** a tooltip's label stays within about 280px with its state and key */
const TIP_CH = 26;
export const tipOf = (b: Pick<Bot, 'name' | 'role'>): string => { const n = clip(b.name, 18), room = TIP_CH - n.length - 2; return room >= 8 ? `${n}, ${clip(b.role, room)}` : n; };

/* ───────── view templates ───────── */
function tileHTML(p: { id: string; on: boolean }, i: number): string {
  const name = PAGE_NAME[p.id] ?? p.id, first = i === 0, last = i === S.pages.length - 1;
  const onCount = S.pages.filter((x) => x.on).length;   /* the arrangement's own count: a page whose part is absent is still arranged */
  let glyph = '';
  if (p.id === 'bots') glyph = S.bots.slice(0, 6).map((b) => `<i style="background:${esc(b.color)}"></i>`).join('');
  if (p.id === 'run') glyph = ui.html.ladder({ stations: run().ladder, current: run().current, ground: 'var(--dock-bg)' });
  if (p.id === 'wait') glyph = (S.waits.length ? ui.html.dot('attention') : '') + `<span class="dk-tile-sub">${S.waits.length}</span>`;
  if (p.id === 'sched') glyph = `<span class="dk-tile-sub">${S.sched.length} runs</span>`;
  if (p.id === 'ctx') glyph = `<span class="dk-tile-sub">${ctxPct()}%</span>`;
  const dot = !p.on ? '<i class="dk-tile-dot" data-off></i>' : `<i class="dk-tile-dot"${p.id === S.page ? ' aria-current="true"' : ''} data-k="dot:${p.id}"></i>`;
  return `<li class="dk-tile" data-tile="${p.id}"${p.on ? '' : ' data-off'}><span class="dk-tile-o" data-e aria-hidden="true"></span>
      <span class="dk-tile-name" data-e>${esc(name)}</span><span class="dk-tile-glyph" aria-hidden="true" data-e>${glyph}</span>
      <span class="dk-tile-foot">${dot}${btn(p.on ? 'Shown' : 'Hidden', 'page-toggle', { variant: 'ghost', size: 's', class: 'dk-tile-show', attrs: { 'data-id': p.id, 'aria-pressed': String(p.on), 'aria-label': `Show ${name} in the dock`, 'aria-disabled': p.on && onCount === 1 ? 'true' : null, 'data-e': true } })}</span>
      <span class="dk-tile-move">${ui.html.iconButton({ icon: 'back', label: `Move ${name} left`, size: 's', disabled: first, attrs: { 'data-act': 'page-left', 'data-id': p.id } })}${ui.html.iconButton({ icon: 'forward', label: `Move ${name} right`, size: 's', disabled: last, attrs: { 'data-act': 'page-right', 'data-id': p.id } })}</span></li>`;
}

export const V: Record<string, () => string> = {
  'bots:min': () => {
    const n = attCount();
    return `${pillBtn('Show the dock' + (n ? ', ' + needLabel(n) : ''))}<span class="dk-mini" aria-hidden="true">${S.bots.map((b) => slot(b)).join('')}</span>${preview('bots')}${pillAtt()}`;
  },
  'bots:norm': () => `<div class="dk-row" role="toolbar" aria-label="Bots" aria-orientation="horizontal">${preview('bots')}${S.bots.map((b, i) => { const s = st(b); return (
    `<button class="dk-bot" data-act="session" data-id="${b.id}" data-bot-label="${b.id}" aria-label="${esc(botLabel(b))}" aria-describedby="dk-bot-hint" aria-keyshortcuts="Enter ${MOD}+Enter" tabindex="${i === S.rowIdx ? 0 : -1}"` +
    ` data-tip="${esc(tipOf(b))}"${s.key === 'idle' ? '' : ` data-tip-state="${esc(s.word)}"`}${s.attention ? ' data-tip-tone="attention"' : ''} data-kbd="enter" data-tip-pos="top">${slot(b)}</button>`); }).join('')}` +
    `<button class="dk-add" data-act="new-bot" aria-label="New bot" data-tip="New bot" data-tip-pos="top" tabindex="${S.rowIdx === S.bots.length ? 0 : -1}"><span data-k="add">${icon('plus')}</span></button></div>`,
  'bots:exp': () => `${preview('bots')}<ul class="dk-roster" aria-label="All bots">${S.bots.map((b, i) => ui.html.row({ title: b.name, sub: phrase(b), lead: slot(b), tabindex: i === S.rowIdx ? '0' : '-1',
      attrs: { 'data-act': 'session', 'data-id': b.id, 'data-bot-row': b.id, 'aria-label': rowLabel(b), 'aria-describedby': 'dk-bot-hint' } })).join('')}` +
    ui.html.row({ title: 'New bot', sub: 'Set one up', tabindex: S.rowIdx === S.bots.length ? '0' : '-1', lead: `<span class="dk-add-ring"><span class="dk-add-ring-o" data-e></span><span data-k="add">${icon('plus')}</span></span>`, attrs: { 'data-act': 'new-bot' } }) + '</ul>',
  /* the bot's session: its last messages, its open cards, the library composer, and the other bots to switch to */
  'bots:card': () => {
    const b = botById(S.card); if (!b) return '';
    const s = st(b);
    return `<div class="dk-card-head">${slot(b)}
      <div class="dk-card-who" data-e><div class="dk-card-line"><span class="dk-card-name" id="dk-card-name" title="${esc(b.name)}">${esc(b.name)}</span>` +
      `<span class="dk-card-state"${s.attention ? ' data-tone="attention"' : ''}>${sessState(b)}</span></div><div class="dk-card-role">${esc(b.role)}</div>${preview('bots')}</div>` +
      `<span class="dk-card-acts" data-e>` +
      ui.html.iconButton({ icon: 'bots', label: `Open the full chat with ${b.name}`, tip: 'Full chat', keys: 'mod+Enter', size: 's', tipPos: 'top', attrs: { 'data-act': 'open-chat', 'data-id': b.id } }) +
      ui.html.iconButton({ icon: 'close', label: `Close the session with ${b.name}`, tip: 'Close', keys: 'Esc', size: 's', tipPos: 'top', attrs: { 'data-act': 'close-card' } }) + `</span></div>
      <div class="dk-sess-log ui-scroll" data-e data-margin="off" role="log" tabindex="0" aria-label="Recent messages with ${esc(b.name)}">${logHTML(b)}</div>
      ${S.waits.filter((w) => w.bot === b.id).map((w) => `<div class="dk-ask" data-e data-card="${w.id}" data-size="compact"></div>`).join('')}
      <div class="dk-sess-composer" data-e data-composer="${b.id}"></div>
      <div class="dk-strip" role="group" aria-label="Switch session">${S.bots.map((x) => x.id === b.id
        ? `<button class="ui-orb-btn dk-strip-bot" data-act="close-card" aria-current="true" tabindex="0" aria-label="${esc(x.name)}, open; close the session" data-tip="${esc(clip(x.name, 18))}" data-tip-pos="top" data-e>${ui.html.orb(x, { size: 18, render: 36 })}</button>`   /* the live orb sits in the head; the switcher shows a copy inside its selection ring */
        : `<button class="ui-orb-btn dk-strip-bot" data-act="session" data-id="${x.id}" data-bot-label="${x.id}" tabindex="-1" aria-label="${esc(botLabel(x))}" data-tip="${esc(clip(x.name, 18))}" data-tip-pos="top">${slot(x)}</button>`).join('')}</div>`;
  },

  'run:min': () => `${pillBtn(`Show the dock, run ${run().stopped ? 'stopped' : 'in progress'}, ${fmtDur(run().elapsed)}`)}${ladderLine()}<span class="dk-time" data-k="run:time" data-run-time>${fmtDur(run().elapsed)}</span><span data-k="run:cost" data-run-cost>${costHTML()}</span>${pillAtt()}`,
  'run:norm': () => `${ladderLine()}
    <button class="dk-run-open" data-act="expand" aria-label="${esc(runName())}" aria-expanded="false"><span class="dk-run-title" data-k="run:title">${esc(run().title)}</span> <span class="dk-run-model" data-k="run:model">${runSub()}</span></button>
    <span class="dk-time" data-k="run:time" data-run-time aria-label="Elapsed">${fmtDur(run().elapsed)}</span>
    <span class="dk-cost"><span data-k="run:cost" data-run-cost>${costHTML()}</span><span data-k="run:meter" data-run-meter>${meterHTML()}</span></span>
    ${stopBtn()}`,
  'run:exp': () => `<div class="dk-runx-head"><div><div class="dk-run-title" data-k="run:title">${esc(run().title)}</div><div class="dk-run-model" data-k="run:model">${runSub()}</div></div>${stopBtn()}</div>
    <div class="dk-ladderx">${ladderList()}</div>
    <hr class="dk-rule" data-e><div class="dk-runx-spend"><span class="dk-time" data-k="run:time" data-run-time>${fmtDur(run().elapsed)}</span><span data-k="run:cost" data-run-cost>${costHTML()}</span><span data-k="run:meter" data-run-meter>${meterHTML()}</span>
      <span class="dk-runx-more" data-e>${esc(run().tokens || 'unknown')} tokens, ${run().trips} round trips, step ${run().step}</span></div>
    <div class="dk-settings" data-e>` +
      ui.html.setRow({ label: 'Governed', hint: run().governed ? 'The ladder picks the model' : `Stays on ${run().model}`, for: 'dk-sw-governed', control: ui.html.switch({ id: 'dk-sw-governed', checked: run().governed }) }) +
      (data().info.live ? '' : ui.html.setRow({ label: 'Sandbox network', for: 'dk-sw-network', control: ui.html.switch({ id: 'dk-sw-network', checked: run().network }) })) + '</div>',

  'wait:min': () => {
    const n = S.waits.length;
    return n ? `${pillBtn('Show the dock, ' + needLabel(n))}<span class="dk-ui" data-e>${needLabel(n)}</span><span class="dk-att">${ui.html.dot('attention')}</span>`
      : `${pillBtn('Show the dock, nothing needs you')}<span class="dk-dim dk-ui" data-e>All clear</span>`;
  },
  'wait:norm': () => (S.waits.length ? '<div class="dk-cards" data-cards="mini"></div>' : emptyWait()),
  'wait:exp': () => (S.waits.length ? '<div class="dk-cards" data-cards="compact"></div>' : emptyWait()),

  'sched:min': () => {
    const s = S.sched.find((x) => !x.paused); const b = s && botById(s.bot);
    return s && b ? `${pillBtn(`Show the dock, next scheduled run: ${b.name}, ${s.next}`)}${preview('schedules')}<span class="dk-mini-orb" data-k="s:orb:${s.id}">${miniOrb(b, 16)}</span><span data-k="s:bot:${s.id}">${esc(b.name)}</span><span class="dk-sched-when" data-k="s:next:${s.id}"><b>${esc(s.next)}</b></span>${pillAtt()}`
      : `${pillBtn('Show the dock, no scheduled runs')}${preview('schedules')}<span class="dk-dim dk-ui" data-e>Nothing scheduled</span>`;
  },
  'sched:norm': () => `${preview('schedules')}<ul class="dk-sched">${S.sched.filter((s) => !s.paused).slice(0, 2).map((s) => { const b = botById(s.bot) as DockBot; return `<li class="dk-sched-row">
      <span class="dk-mini-orb" data-k="s:orb:${s.id}">${miniOrb(b, 18)}</span><span class="dk-sched-bot" data-k="s:bot:${s.id}">${esc(b.name)}</span>
      <button class="dk-sched-what" data-act="expand" data-k="s:what:${s.id}" aria-label="${esc(s.what)}, ${esc(s.when)}; show all scheduled runs">${esc(s.what)}</button>
      <span class="dk-sched-when" data-k="s:next:${s.id}"><b>${esc(s.next)}</b></span></li>`; }).join('') || `<li>${ui.html.empty({ title: 'Nothing scheduled', text: 'Bots you schedule show their next run here.' })}</li>`}</ul>`,
  'sched:exp': () => `${preview('schedules')}<div class="dk-sched-head" data-e>Scheduled runs<span>${S.sched.length} in total</span></div><ul class="dk-sched">${S.sched.map((s) => { const b = botById(s.bot) as DockBot; return `<li class="dk-sched-row"${s.paused ? ' data-paused' : ''}>
      <span class="dk-mini-orb" data-k="s:orb:${s.id}">${miniOrb(b, 18)}</span><span class="dk-sched-bot" data-k="s:bot:${s.id}">${esc(b.name)}</span>
      <span class="dk-sched-what" data-k="s:what:${s.id}">${esc(s.what)}<span class="dk-sub dk-mono"> ${esc(s.when)}</span></span>
      <span class="dk-sched-end"><span class="dk-sched-when" data-k="s:next:${s.id}">${s.paused ? 'Paused' : `<b>${esc(s.next)}</b>`}</span>
      <span class="dk-sched-acts">${btn('Run now', 'sched-run', { size: 's', attrs: { 'data-id': s.id, 'aria-label': `Run ${s.what} now` } })}${btn(s.paused ? 'Resume' : 'Pause', 'sched-pause', { size: 's', attrs: { 'data-id': s.id, 'aria-pressed': String(s.paused), 'aria-label': `${s.paused ? 'Resume' : 'Pause'} ${s.what}` } })}</span></span></li>`; }).join('')}</ul>`,

  'ctx:min': () => `${pillBtn(`Show the dock, context ${ctxPct()}% used`)}<span class="dk-ctx-num" data-k="c:num">${ctxPct()}%</span>${pillAtt()}`,
  'ctx:norm': () => `<span class="dk-ctx-num" data-k="c:num">${ctxPct()}%</span><span class="dk-ctx-dots" data-k="c:bar">${ui.html.measure({ variant: 'row', total: S.ctx.total, parts: S.ctx.parts, dots: 24 })}</span><span class="dk-ctx-of" data-k="c:of">${kfmt(S.ctx.used)} / ${kfmt(S.ctx.total)}</span>
    ${btn('Details', 'expand', { attrs: { 'data-e': true } })}`,
  'ctx:exp': () => `<div class="dk-ctxx-head"><span class="dk-ctx-num" data-k="c:num">${ctxPct()}%</span><span class="dk-ctx-of" data-k="c:of">${kfmt(S.ctx.used)} / ${kfmt(S.ctx.total)}</span></div>
    <span class="dk-ctx-grid" data-k="c:bar">${ui.html.measure({ variant: 'grid', total: S.ctx.total, parts: S.ctx.parts, cols: 20 })}</span>
    <div class="dk-ctx-legend" data-e>${ui.html.legend(S.ctx.parts, kfmt)}</div>
    <div class="dk-ctx-acts" data-e>${btn('Open the context panel', 'open-context')}</div>`,

  'edit:edit': () => `<div class="dk-edit-head" data-e><div><h2 id="dk-edit-h">Dock pages</h2><p>Drag to reorder. Hidden pages stay reachable in the app.</p></div>${btn('Done', 'done', { variant: 'primary' })}</div>
    <ul class="dk-tiles" aria-label="Pages in order">${S.pages.map((p, i) => tileHTML(p, i)).join('')}</ul>
    <div class="dk-edit-foot" data-e>${btn('Turn off the dock', 'dock-off', { variant: 'ghost' })}<p>${esc(keyHint())}</p></div>`
};

/* after a view renders: key the ladder's stations, mark the roster's text as entering, put the cards in place */
export function finish(el: HTMLElement, key: string): void {
  $$('.ui-ladder .ui-ladder__st', el).forEach((s, i) => { if (!s.closest('.dk-tile')) s.dataset['k'] = 'run:t' + i; });
  if (key === 'bots:exp') for (const r of $$('.ui-row', el)) { r.querySelector('.ui-row__text')?.setAttribute('data-e', ''); const sub = r.querySelector<HTMLElement>('.ui-row__sub'); if (sub && r.dataset['id']) sub.dataset['botPhrase'] = r.dataset['id']; }
  fillCards(el);
  syncRoving();
}
/* a card element is shared by the views that show it (the compact approval sits in nina's card and in the expanded
   needs-you view), so every view that becomes visible takes its cards back */
export function cardFor(w: Wait, size: string): HTMLElement {
  const k = w.id + ':' + size;
  let el = X.cardEls.get(k);
  if (!el) {
    el = ui.card(w.kind, w.data as unknown as Record<string, unknown>, { size: size as 'compact' | 'mini', ground: 'dock' });
    el.dataset['wait'] = w.id;
    el.dataset['k'] = 'card:' + k;
    X.cardEls.set(k, el);
  }
  return el;
}
export function fillCards(el: HTMLElement | null): void {
  if (!el) return;
  for (const slotEl of $$('[data-cards]', el)) {
    const want = S.waits.map((w) => cardFor(w, slotEl.dataset['cards'] ?? 'mini'));
    if (want.length !== slotEl.children.length || want.some((c, i) => slotEl.children[i] !== c)) slotEl.replaceChildren(...want);
  }
  for (const slotEl of $$('[data-card]', el)) {
    const w = S.waits.find((x) => x.id === slotEl.dataset['card']);
    if (w && slotEl.firstElementChild !== cardFor(w, slotEl.dataset['size'] ?? 'compact')) slotEl.replaceChildren(cardFor(w, slotEl.dataset['size'] ?? 'compact'));
  }
  for (const slotEl of $$('[data-composer]', el)) {
    const c = composerFor(slotEl.dataset['composer'] ?? '');
    if (c && slotEl.firstElementChild !== c) slotEl.replaceChildren(c);
  }
  const log = el.querySelector<HTMLElement>('.dk-sess-log'); if (log) log.scrollTop = log.scrollHeight;
}
/* one library composer per bot, kept across renders so a draft survives; what you send lands in the bot's thread */
export function composerFor(id: string): ReturnType<typeof ui.composer> | null {
  const b = botById(id); if (!b) return null;
  if (data().info.unavailable['bots.send']) return null;   /* a bot that cannot be messaged yet has no composer, rather than one that sends nowhere */
  let c = X.composerEls.get(id);
  if (!c) {
    /* the library's compact composer: one row, mic and send in its corner; with `bot` the mic talks to this bot
       (alt+V, a tap toggles, a hold talks while held, Esc stops) and the bot's orbs here listen while you talk */
    c = ui.composer({ placeholder: `Message ${b.name}`, label: `Message ${b.name}`, attach: false, bot: b,
      orbs: () => [av(id), ...$$(`.dk-strip-bot[aria-current="true"] orb-avatar`, X.root)].filter(Boolean) });
    c.classList.add('dk-composer');
    c.input.removeAttribute('data-hx-focus');     /* the shell's composer region is the tab's, not the dock's */
    c.addEventListener('ui:send', (ev) => sendTo(id, (ev as CustomEvent<{ text: string }>).detail.text));
    /* when you stop talking, the orb takes the bot's current state (it may have changed meanwhile) */
    c.addEventListener('ui:dictate', (ev) => { if (!((ev as CustomEvent<{ value: boolean }>).detail.value)) setTimeout(() => { const x = botById(id); if (x) refreshBot(x); }, 0); });
    X.composerEls.set(id, c);
  }
  return c;
}
function sendTo(id: string, text: string): void {
  const b = botById(id); if (!b || !text) return;
  data().bots.send(id, text, 'dock');   /* the provider adds it to the thread; the dock paints it when it arrives */
  const o = av(id);
  if (o && !X.composerEls.get(id)?.listening) { o.setAttribute('reaction', 'listening'); setTimeout(() => { const x = botById(id); if (x) refreshBot(x); }, 1800); }
  ui.announce(`Sent to ${b.name}`);
}
export const timeNow = clock;
export function viewEl(key: string): HTMLElement | null { return X.root.querySelector<HTMLElement>(`.dk-view[data-view="${key}"]:not(.is-ghost)`); }
export function renderView(key: string): void {
  const el = viewEl(key); const tpl = V[key]; if (!el || !tpl) return;
  patchHTML(el, tpl());
  finish(el, key);
}
export function renderAll(): void { for (const k of Object.keys(V)) if (k !== 'bots:card' || S.card) renderView(k); }
export function renderMins(): void { for (const p of ['bots', 'run', 'wait', 'sched', 'ctx']) renderView(p + ':min'); }
export function viewKey(): string {
  if (S.mode === 'edit') return 'edit:edit';
  if (S.mode === 'minimal' || S.mode === 'off') return S.page + ':min';
  if (S.mode === 'expanded') return S.page === 'bots' && S.card ? 'bots:card' : S.page + ':exp';
  return S.page + ':norm';
}
export { setOrbLife, motion };
