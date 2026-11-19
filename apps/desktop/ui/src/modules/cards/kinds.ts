/* The card kinds: approval, ship, blank, teammate, escalation, error, schedule, connector.
   tone: what the card owes the user. red = an approval, a blank or a failure (the stamp); pulse = running;
   ink = done; ring = closed without effect; none = nothing owed. Hosts can read data-tone. */
import { esc } from '../../core/dom';
import { ui } from '@boopis/ui';
import type { CardKind } from '@boopis/ui';
import type { Ctx, Data, Kind } from './types';
import type { HxCard } from './card';
import { closeBlank, openBlank } from './popover';
import { formKind } from './form';
import { actions, at, bot, breath, btn, cap, check, code, expiryText, fmt, foot, headrow, meta, mini, model, mono, parts, qdots, quote, receipt, sentenceHTML, sentenceText, tones, well } from './parts';

const U = ui;
export { bot, cap, check, expiryText, parts };

export const KINDS: Record<CardKind, Kind> = {} as Record<CardKind, Kind>;

/* ---------------- approval: a bot or the agent wants to do something sensitive */
const holdHTML = (c: Ctx): string => U.html.hold({ hintId: c.id + '-hint', fill: c.card.opts.holdFill, attrs: { 'data-hold': true } });
KINDS.approval = {
  states: ['pending', 'holding', 'approved', 'denied', 'expired'],
  initial: 'pending',
  quiet: { 'pending>holding': 1, 'holding>pending': 1 },
  tone: tones({ pending: 'red', holding: 'red', approved: 'ink', denied: 'ring', expired: 'ring' }),
  stamp: () => 'needs you',
  resolved: (c) => c.s === 'approved' || c.s === 'denied' || c.s === 'expired',
  say: (c) => ({ approved: 'Approved: ', denied: 'Denied: ', expired: 'Expired, nothing ran: ' } as Record<string, string>)[c.s] + c.plain,
  text: (c) => sentenceText(c.d),
  render(c) {
    const d = c.d, live = c.s === 'pending' || c.s === 'holding';
    const metaParts = parts(d.meta).map((p) => /^expires in /i.test(p) ? '<span data-countdown>' + esc(cap(p)) + '</span>' : '<span>' + fmt(p) + '</span>');
    let f: string;
    if (live) f = foot(meta([qdots(c.q), ...metaParts]), actions(btn('deny', 'Deny', null, { keys: 'x' }) + holdHTML(c)));
    else if (c.s === 'approved') f = foot(receipt(at('Approved', c), true));
    else if (c.s === 'denied') f = foot(receipt(at('Denied', c)));
    else f = foot(receipt(at('Expired', c) + ', nothing ran'), actions(btn('ask-again', 'Ask again')));
    return { head: headrow(c, sentenceHTML(d)) + quote(d.quote), body: well(d.item), foot: f };
  },
  mini: (c) => mini(c, { text: sentenceHTML(c.d), meta: (c.s === 'pending' || c.s === 'holding') ? '<span data-countdown="short"></span>' : esc(cap(c.s)) }),
  act(card, a) {
    if (a === 'deny') card.setState('denied');
    else if (a === 'approve') card.setState('approved');
    else if (a === 'ask-again') { card.rearmExpiry(); card.setState('pending'); }
  }
};

/* ---------------- ship result */
function filesHTML(files: ReadonlyArray<readonly [string, number, number]>, max: number): string {
  if (!files.length) return '';
  const rows = files.slice(0, max).map((f) => {
    const path = String(f[0]), cut = path.lastIndexOf('/') + 1;
    return '<div class="cd-file" role="row"><span class="cd-file__path" role="cell"><span class="cd-file__dir">' + esc(path.slice(0, cut)) + '</span>' + esc(path.slice(cut)) + '</span>' +
      '<span class="cd-file__n" role="cell">+' + f[1] + '</span><span class="cd-file__n cd-file__n--del" role="cell">−' + f[2] + '</span>' +
      '<span class="cd-diffdots" role="cell" aria-hidden="true">' + diffdots(f[1], f[2]) + '</span></div>';
  });
  if (files.length > max) rows.push('<div class="cd-file cd-file--more" role="row"><span role="cell">' + (files.length - max) + ' more ' + (files.length - max === 1 ? 'file' : 'files') + '</span><span role="cell"></span><span role="cell"></span><span role="cell"></span></div>');
  return '<div class="cd-well cd-files" role="table" aria-label="Changed files">' + rows.join('') + '</div>';
}
function diffdots(a: number, d: number): string {
  const t = a + d, filled = Math.min(5, t), na = t ? Math.round(filled * a / t) : 0;
  let s = '';
  for (let i = 0; i < 5; i++) s += '<i' + (i < na ? ' data-d="add"' : i < filled ? ' data-d="del"' : '') + '></i>';
  return s;
}
type FileList = ReadonlyArray<readonly [string, number, number]>;
const shipFiles = (d: Data): FileList => (Array.isArray(d.files) ? (d.files as FileList) : []);
const shipText = (c: Ctx): string => ({ passed: cap(c.d.title || 'ready to ship'), failed: 'Not shipped', 'rolled-back': 'Rolled back' } as Record<string, string>)[c.s] ?? '';
KINDS.ship = {
  states: ['passed', 'failed', 'rolled-back'],
  initial: 'passed',
  tone: tones({ passed: 'ink', failed: 'red', 'rolled-back': 'ring' }),
  stamp: () => 'failed',
  resolved: (c) => c.s === 'rolled-back',
  say: (c) => c.plain,
  text: shipText,
  render(c) {
    const d = c.d, files = shipFiles(d);
    const max = c.size === 'compact' ? 3 : 6;
    const add = d.add != null ? d.add : files.reduce((n, f) => n + (f[1] || 0), 0);
    const del = d.del != null ? d.del : files.reduce((n, f) => n + (f[2] || 0), 0);
    let body = '';
    if (c.s === 'passed') {
      const rb = d.rolledBack || 0;
      body = '<p class="cd-text">' + esc(d.passed) + ' tests passed.' + (rb
        ? ' <button type="button" class="cd-token" data-action="rollback-detail" aria-expanded="' + (d.showRollback ? 'true' : 'false') + '">' +
          rb + (rb === 1 ? ' edit was' : ' edits were') + ' rolled back</button> on the way.' : '') + '</p>' +
        (d.showRollback && d.rollbackNote ? '<p class="cd-note">' + fmt(d.rollbackNote) + '</p>' : '') + filesHTML(files, max);
    } else if (c.s === 'failed') {
      const fails = d.failures ?? [];
      body = '<p class="cd-text">' + (fails.length === 1 ? '1 test failed' : fails.length + ' tests failed') + ', so nothing was pushed.</p>' +
        (fails.length ? '<div class="cd-well cd-out">' + fails.map((x) => '<div class="cd-out__hit">' + fmt(x) + '</div>').join('') + '</div>' : '');
    } else body = '<p class="cd-text">The gate failed after the last edit, so ' + code(d.branch ?? '') + ' is back where it started.</p>' + filesHTML(files, max);
    const left = meta([code(d.branch ?? ''), c.s !== 'failed' && files.length ? '<span>' + files.length + ' files</span><span>+' + add + ' −' + del + '</span>' : '']);
    const right = c.s === 'passed' ? actions(btn('view-diff', 'View diff', null, { keys: 'd' }) + btn('open-pr', 'Open PR', 'primary'))
      : c.s === 'failed' ? actions(btn('view-output', 'View output') + btn('retry', 'Fix and retry', 'primary'))
        : actions(btn('view-diff', 'View diff', null, { keys: 'd' }) + btn('retry', 'Try again', 'primary'));
    return { head: headrow(c, esc(shipText(c))) + quote(d.quote), body, foot: foot(left, right) };
  },
  mini(c) {
    const d = c.d, files = shipFiles(d);
    const add = d.add != null ? d.add : files.reduce((n, f) => n + f[1], 0), del = d.del != null ? d.del : files.reduce((n, f) => n + f[2], 0);
    return mini(c, { text: esc(shipText(c)), meta: c.s === 'failed' ? esc((d.failures ?? []).length + ' failed') : '+' + add + ' −' + del });
  },
  act(card, a) { if (a === 'rollback-detail') card.update({ showRollback: !card.data.showRollback }); }
};

/* ---------------- blank: an open question the agent left in its answer */
KINDS.blank = {
  states: ['open', 'answered'],
  initial: 'open',
  tone: (c) => (c.s === 'open' ? 'red' : 'none'),
  stamp: () => 'waiting for you',
  attention: (c) => c.s === 'open' && c.size !== 'popover',
  resolved: () => false,
  say: (c) => (c.s === 'answered' ? 'Answered: ' + c.d.answer : 'Open question: ' + c.d.question),
  text: (c) => c.d.question ?? '',
  /* the library's blank mark, made live: it opens the popover */
  inline(c) {
    const a = c.s === 'answered' ? (c.d.answer ?? '') : '';
    return U.html.blank({ answer: a }).replace('<button type="button" class="ui-blank"', '<button type="button" class="ui-blank cd-blank" data-action="open-blank" id="' + c.id + '-t"');
  },
  render(c) {
    const d = c.d, opts = d.options ?? [];
    const chosen = c.s === 'answered' ? d.answer : null;
    const custom = chosen != null && opts.indexOf(chosen) < 0 ? chosen : '';
    const body = '<div class="cd-opts" role="radiogroup" aria-labelledby="' + c.id + '-t">' + opts.map((o, i) =>
      '<button type="button" class="cd-opt" role="radio" data-opt="' + i + '" aria-checked="' + (chosen === o) + '"' + (i < 9 ? ' aria-keyshortcuts="' + (i + 1) + '"' : '') + ' tabindex="-1">' +
      '<span class="cd-opt__ring" aria-hidden="true"></span><span>' + fmt(o) + '</span>' + (i < 9 ? '<span class="cd-opt__key" aria-hidden="true">' + (i + 1) + '</span>' : '') + '</button>').join('') + '</div>' +
      '<label class="cd-free"' + (custom ? ' data-on' : '') + '><span class="cd-opt__ring" aria-hidden="true"></span><span class="ui-sr">Your own answer</span>' +
      '<input type="text" autocomplete="off" spellcheck="false" placeholder="Or write your own" value="' + esc(custom) + '"></label>';
    const right = c.size === 'popover' ? actions(btn('later', 'Later', 'ghost') + btn('answer', 'Answer', 'primary', { disabled: !chosen }))
      : actions(btn('answer', c.s === 'answered' ? 'Change answer' : 'Answer', 'primary', { disabled: !chosen }));
    const left = c.s === 'answered' && c.size !== 'popover' ? receipt(at('Answered', c)) : '';
    /* under the sentence it came from, the popover needs only the short form of the question */
    return { head: headrow(c, '<span class="cd-raw">' + fmt(c.size === 'popover' && d.short ? d.short : (d.question ?? '')) + '</span>'), body, foot: foot(left, right) };
  },
  mini: (c) => mini(c, { text: '<span class="cd-raw">' + fmt(c.d.short || c.d.question || '') + '</span>', meta: c.s === 'answered' ? '<span class="cd-raw">' + esc(c.d.answer) + '</span>' : 'Answer' }),
  act(card, a, x) {
    if (a === 'open-blank') { openBlank(card); return; }
    if (a === 'answer' && x.value) {
      const src = card.source;
      if (src) { closeBlank(card); src.update({ state: 'answered', answer: x.value }); }
      else card.update({ state: 'answered', answer: x.value });
    }
    if (a === 'later' && card.source) closeBlank(card);
  }
};

/* ---------------- teammate request or hand-off, from a named bot */
KINDS.teammate = {
  states: ['pending', 'accepted', 'declined'],
  initial: 'pending',
  tone: tones({ pending: 'none', accepted: 'ink', declined: 'ring' }),
  resolved: (c) => c.s !== 'pending',
  orb: (c) => ({ pending: 'listening', accepted: 'happy', declined: 'idle' } as Record<string, string>)[c.s] ?? 'idle',
  say: (c) => cap(c.s) + ': ' + c.plain,
  text: (c) => sentenceText(c.d),
  render(c) {
    const d = c.d;
    const f = c.s === 'pending' ? foot(meta(parts(d.meta).map((p) => '<span>' + fmt(p) + '</span>')), actions(btn('decline', 'Decline') + btn('accept', 'Accept', 'primary')))
      : foot(receipt(at(cap(c.s), c), c.s === 'accepted'));
    return { head: headrow(c, sentenceHTML(d)) + quote(d.quote), body: well(d.item), foot: f };
  },
  mini: (c) => mini(c, { text: sentenceHTML(c.d), meta: esc(c.s === 'pending' ? parts(c.d.meta)[0] || '' : cap(c.s)) }),
  act(card, a) { if (a === 'accept') card.setState('accepted'); if (a === 'decline') card.setState('declined'); }
};

/* ---------------- escalation: the governance ladder moved the session to a stronger model */
const escText = (c: Ctx): string => (c.s === 'capped' ? 'Stopped at the ' + c.d.cap + ' cap' : 'Moved up to ' + c.d.to);
const ladderOf = (c: Ctx): { L: ReadonlyArray<readonly [string, string]>; cur: number } => {
  const L = c.d.ladder ?? [], cur = c.d.current != null ? c.d.current : L.findIndex((x) => x[0] === c.d.to);
  return { L, cur };
};
const stations = (c: Ctx, ground?: string): string => { const { L, cur } = ladderOf(c); return U.html.ladder({ stations: L, current: cur, ground: ground || 'var(--cd-surface)' }); };
const escWhat = (c: Ctx, size: number): string => (c.s === 'capped' ? 'Stopped at the ' + mono(c.d.cap ?? '') + ' cap' : 'Moved up to ' + model(c.d.to ?? '', size));
const escWhy = (c: Ctx): string => (c.s === 'capped' ? 'The next step needs ' + model(c.d.next || 'opus 5.5') : fmt(cap(c.d.reason)));
KINDS.escalation = {
  states: ['escalated', 'capped'],
  initial: 'escalated',
  tone: (c) => (c.s === 'capped' ? 'red' : 'none'),
  stamp: () => 'needs you',
  resolved: () => false,
  say: escText,
  text: escText,
  inline(c) {
    const d = c.d;
    const end = c.s === 'capped'
      ? actions(btn('stop', 'Stop here', null, { size: 's' }) + btn('raise', 'Raise cap to ' + (d.raiseTo || '$1.00'), 'primary', { size: 's' }))
      : '<span class="cd-rule__meta">' + esc(d.spent) + ' of ' + esc(d.cap) + '</span>';
    return '<div class="cd-rule" role="note" aria-labelledby="' + c.id + '-t">' + stations(c, 'var(--bg-2)') +
      '<span class="cd-rule__what"><span id="' + c.id + '-t">' + escWhat(c, 14) + '</span><span class="ui-stamp" data-stamp></span></span>' +
      '<span class="cd-rule__why">' + escWhy(c) + '</span>' +
      '<span class="cd-rule__line" aria-hidden="true"></span>' + end + '</div>';
  },
  render(c) {
    const d = c.d, { L, cur } = ladderOf(c);
    const steps = U.html.ladder({ stations: L.map((x) => [x[0], cap(x[1])] as const), current: cur, variant: 'list', ground: 'var(--cd-surface)' });
    const f = c.s === 'capped' ? foot(meta(['<span>' + esc(d.spent) + ' of ' + esc(d.cap) + '</span>']), actions(btn('stop', 'Stop here') + btn('raise', 'Raise to ' + (d.raiseTo || '$1.00'), 'primary')))
      : foot(meta(['<span>' + esc(d.spent) + ' of ' + esc(d.cap) + ' spent</span>']));
    return { head: headrow(c, escWhat(c, 16)) + '<p class="cd-quote">' + escWhy(c) + '</p>', body: steps, foot: f };
  },
  mini: (c) => mini(c, { who: false, lead: U.icon('ladder', { class: 'cd-glyph' }), text: c.s === 'capped' ? 'Stopped at ' + mono(c.d.cap ?? '') : 'On ' + model(c.d.to ?? ''), meta: c.s === 'capped' ? 'Raise cap' : 'from ' + esc(c.d.from) }),
  act(card, a) { if (a === 'raise') card.update({ state: 'escalated', cap: card.data.raiseTo || '$1.00' }); }
};

/* ---------------- error: a gate failed */
const errLead = (c: Ctx): string => ({ failed: mono(c.d.gate ?? '') + ' failed', retrying: 'Retrying ' + mono(c.d.gate ?? '') + ' on ' + model(c.d.retryWith ?? '', 16), passed: mono(c.d.gate ?? '') + ' passes' } as Record<string, string>)[c.s] ?? '';
KINDS.error = {
  states: ['failed', 'retrying', 'passed'],
  initial: 'failed',
  tone: tones({ failed: 'red', retrying: 'pulse', passed: 'ink' }),
  stamp: () => 'failed',
  resolved: (c) => c.s === 'passed',
  say: (c) => c.plain,
  text: (c) => ({ failed: (c.d.gate ?? '') + ' failed', retrying: 'Retrying ' + (c.d.gate ?? '') + ' on ' + (c.d.retryWith ?? ''), passed: (c.d.gate ?? '') + ' passes' } as Record<string, string>)[c.s] ?? '',
  render(c) {
    const d = c.d;
    const out = (d.output ?? []).length ? '<div class="cd-well cd-out">' + (d.output ?? []).map((l) => '<div' + (/FAIL/.test(l) ? ' class="cd-out__hit"' : '') + '>' + esc(l) + '</div>').join('') + '</div>' : '';
    const f = c.s === 'failed' ? foot('', actions(btn('view-output', 'View output') + btn('retry', d.retryWith ? 'Retry on ' + d.retryWith : 'Retry', 'primary')))
      : c.s === 'retrying' ? foot('<p class="cd-receipt">' + breath() + '<span>Running on ' + model(d.retryWith ?? '') + '</span></p>', actions(btn('stop', 'Stop')))
        : foot(receipt(at('Passed on retry', c), true), actions(btn('view-output', 'View output')));
    return { head: headrow(c, errLead(c)) + (d.test ? '<p class="cd-quote cd-mono">' + fmt(d.test) + '</p>' : ''), body: out + (d.note ? '<p class="cd-note">' + fmt(d.note) + '</p>' : ''), foot: f };
  },
  mini: (c) => mini(c, { text: errLead(c), meta: c.s === 'failed' ? 'Retry' : c.s === 'retrying' ? breath() : esc(c.at) }),
  act(card, a) { if (a === 'retry') card.setState('retrying'); if (a === 'stop') card.setState('failed'); }
};

/* ---------------- schedule: a bot asks to run on a timer */
KINDS.schedule = {
  states: ['pending', 'scheduled', 'dismissed'],
  initial: 'pending',
  tone: tones({ pending: 'none', scheduled: 'ink', dismissed: 'ring' }),
  resolved: (c) => c.s !== 'pending',
  orb: (c) => ({ pending: 'idle', scheduled: 'happy', dismissed: 'idle' } as Record<string, string>)[c.s] ?? 'idle',
  say: (c) => (c.s === 'scheduled' ? 'Scheduled: ' : c.s === 'dismissed' ? 'Not scheduled: ' : '') + c.plain,
  text: (c) => sentenceText(c.d),
  render(c) {
    const d = c.d, days = d.days ?? [1, 1, 1, 1, 1, 0, 0], L = ['M', 'T', 'W', 'T', 'F', 'S', 'S'], N = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const on = N.filter((_, i) => days[i]);
    const week = '<div class="cd-week" role="img" aria-label="Runs on ' + esc(on.join(', ')) + '">' + L.map((l) => '<b aria-hidden="true">' + l + '</b>').join('') + days.map((x) => '<i' + (x ? ' data-on' : '') + '></i>').join('') + '</div>';
    const body = '<div class="cd-sched">' + week + '<div class="cd-sched__when"><span class="cd-sched__time">' + esc(d.time) + (d.cron ? code(d.cron) : '') + '</span><span class="cd-dim">' + esc(cap(d.when)) + '</span></div></div>';
    const f = c.s === 'pending' ? foot(meta(parts(d.meta).map((p) => '<span>' + fmt(p) + '</span>')), actions(btn('dismiss', 'Not now', 'ghost') + btn('schedule', 'Schedule it', 'primary')))
      : c.s === 'scheduled' ? foot(receipt('Scheduled, first run ' + esc(d.next ?? ''), true), actions(btn('edit', 'Edit')))
        : foot(receipt('Not scheduled'), actions(btn('undo-dismiss', 'Schedule it')));
    return { head: headrow(c, sentenceHTML(d)) + quote(d.quote), body, foot: f };
  },
  mini: (c) => mini(c, { text: sentenceHTML(c.d), meta: esc(c.d.time) }),
  act(card, a) {
    if (a === 'schedule' || a === 'undo-dismiss') card.setState('scheduled');
    if (a === 'dismiss') card.setState('dismissed');
  }
};

/* ---------------- connector sign-in (owes nothing until it fails: no stamp while it simply needs a sign-in) */
const connText = (c: Ctx): string => {
  const n = cap(c.d.name);
  return ({ needed: n + ' needs you to sign in', waiting: 'Waiting for ' + n + ' in your browser', connected: n + ' is connected', failed: n + ' sign-in did not finish' } as Record<string, string>)[c.s] ?? '';
};
KINDS.connector = {
  origin: (c) => ({ kind: 'mcp', server: c.d.name }),
  states: ['needed', 'waiting', 'connected', 'failed'],
  initial: 'needed',
  tone: tones({ needed: 'none', waiting: 'pulse', connected: 'ink', failed: 'red' }),
  stamp: () => 'failed',
  resolved: (c) => c.s === 'connected',
  say: (c) => c.plain,
  text: connText,
  render(c) {
    const d = c.d, n = cap(d.name);
    const text = ({
      needed: 'Sign in once to give this session its ' + (d.tools != null ? d.tools + ' ' : '') + n + ' tools.',
      waiting: 'Finish signing in on ' + (d.host || n) + '. This card updates when it’s done.',
      connected: (d.tools != null ? d.tools + ' tools' : 'Tools') + ' ready' + (d.scopes ? ': ' + d.scopes.join(', ') : '') + '.',
      failed: 'The browser closed before ' + n + ' sent a token. Try again, or sign in later from Connectors.'
    } as Record<string, string>)[c.s] ?? '';
    const note = c.s === 'needed' || c.s === 'waiting' ? '<p class="cd-note">Opens ' + esc(d.host || n) + ' in your browser. The token stays on this machine.</p>' : '';
    const f = c.s === 'needed' ? foot('', actions(btn('later', 'Not now', 'ghost') + btn('sign-in', 'Sign in', 'primary')))
      : c.s === 'waiting' ? foot('<p class="cd-receipt">' + breath() + '<span>Waiting for the browser</span></p>', actions(btn('cancel', 'Cancel')))
        : c.s === 'connected' ? foot(receipt(at('Connected', c), true))
          : foot('', actions(btn('later', 'Not now', 'ghost') + btn('sign-in', 'Try again', 'primary')));
    return { head: headrow(c, esc(connText(c))), body: '<p class="cd-text">' + esc(text) + '</p>' + note, foot: f };
  },
  mini: (c) => mini(c, { who: false, text: esc(connText(c)), meta: c.s === 'needed' || c.s === 'failed' ? 'Sign in' : c.s === 'waiting' ? breath() : esc(c.at) }),
  act(card, a) { if (a === 'sign-in') card.setState('waiting'); if (a === 'cancel') card.setState('needed'); }
};
KINDS.form = formKind;
export type { HxCard };
