/* The v6 card kinds still in use: approval, blank, connector (and the form, form.ts). Ship, teammate, escalation, error and schedule
   moved to the kit at step 6e (asks.ts, and the session's FilesCard for a ship).
   tone: what the card owes the user. red = an approval, a blank or a failure (the stamp); pulse = running;
   ink = done; ring = closed without effect; none = nothing owed. Hosts can read data-tone. */
import { esc } from '../../core/dom';
import { ui } from '@boopis/ui';
import type { CardKind } from '@boopis/ui';
import type { Ctx, Kind } from './types';
import type { HxCard } from './card';
import { closeBlank, openBlank } from './popover';
import { formKind } from './form';
import { actions, at, bot, breath, btn, cap, check, expiryText, fmt, foot, headrow, meta, mini, parts, qdots, quote, receipt, sentenceHTML, sentenceText, tones, well } from './parts';

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
