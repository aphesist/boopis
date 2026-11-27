/* First-run setup's models hub, Concept A "Marquee" (ADR-0040; the owner's pick of 21 November 2026): the Providers section of
   Settings > Models (`providers-view.ts`, which owns every action, state and card) arranged as one page to connect everything.
   First the four accounts you sign in to, as a row of plates, each with its branded button; below them a wall of key tiles (a
   connected tile inverts to the light fill); then what was found on this computer, and your own endpoint. This file is only the
   arrangement (`ProvidersLayout`): every button keeps its `data-do` and `data-way`, so the actions are the section's own.
   A status is always a word, never colour alone. Pure: markup from a plan, no host, no listeners. */
import { signinLogo, ui } from '@boopis/ui';
import type { SigninBrand } from '@boopis/ui';
import { esc } from '../core/dom';
import type { Way } from '../data/providers';
import { actionsFor, failed, hintOf, installLineHtml } from './providers-view';
import type { Plan, ProvidersLayout, Row } from './providers-view';
import { brandOf } from './signin-brands';

/** Every lab's mark on this screen, in its own colours (the owner's decision, ADR-0040): the official file where the lab published
    one (OpenAI's, GitHub's, Anthropic's; xAI's is the faithful vector the sign-in button draws), else the colour version of the
    vendored icon set. A lab has one mark on the whole screen: the key tile of xAI draws the mark of its sign-in button. */
const OFFICIAL: Readonly<Record<string, SigninBrand | 'copilot'>> = { openai: 'chatgpt', anthropic: 'claude', xai: 'xai', 'github-copilot': 'copilot' };
const FAMILY: Readonly<Record<string, string>> = { google: 'gemini', zai: 'glm', moonshot: 'kimi' };
export const labMark = (entryId: string, size = 24): string => {
  const own = OFFICIAL[entryId];
  if (own) return `<span class="fr-mark fr-mark--${size === 20 ? 's' : 'm'}">${signinLogo(own)}</span>`;
  return ui.html.modelMark(FAMILY[entryId] ?? entryId, { size, color: 'brand', label: false });
};

/** the plate's one line, in boopis's words: what the account is used for (no model is named here; the summary says what runs) */
const PLATE_COPY: Readonly<Record<string, { title: string; line: string }>> = {
  'openai.signin': { title: 'ChatGPT', line: 'Uses your ChatGPT plan.' },
  'github-copilot.signin': { title: 'GitHub Copilot', line: 'Uses your Copilot plan: models from several labs.' },
  'xai.signin': { title: 'xAI SuperGrok', line: 'Uses your SuperGrok plan.' },
  'anthropic.signin': { title: 'Claude', line: 'Uses your Claude plan; boopis never sees your login.' }
};
/** the accounts in the order of the page, and the labs whose keys lead the wall (the rest keep the catalogue's order); a way for one
    region only (`china`) is in the tail */
const PLATE_ORDER = ['openai.signin', 'github-copilot.signin', 'xai.signin', 'anthropic.signin'];
const FIRST_KEYS = ['openai', 'anthropic', 'google', 'openrouter', 'deepseek', 'xai', 'zai', 'moonshot', 'minimax'];
const rank = (list: readonly string[], id: string): number => { const i = list.indexOf(id); return i < 0 ? list.length : i; };
const isAccount = (r: Row): boolean => r.way.kind === 'signin' && brandOf(r.way.id) !== null;
const connected = (r: Row | { state: { status: string } | null }): boolean => r.state?.status === 'connected';

/** the calm words of a problem the person fixes with an ordinary step; any other error is a failure, said as one */
const CALM_WORDS: Readonly<Record<string, string>> = { 'hx.provider.needs_update': 'update needed', 'hx.provider.metered': 'not your plan' };
/** one state, in words, with a glyph or a dot beside it; red only for a real failure */
const stateWord = (r: Row): string => {
  const st = r.state?.status ?? 'unread';
  const glyph = st === 'connected' ? ui.html.icon('check', { size: 's' }) : st === 'signing_in' ? ui.html.dot('run') : '';
  const word = st === 'signing_in' ? 'connecting' : st === 'needs_install' ? 'not installed' : st === 'connected' ? 'connected'
    : st === 'error' ? (failed(r.state) ? 'failed' : CALM_WORDS[r.state?.code ?? ''] ?? 'not connected') : 'not connected';
  return `<span class="fr-st" data-status="${esc(st)}" data-tone="${failed(r.state) ? 'red' : ''}">${glyph}<span>${esc(word)}</span></span>`;
};

const smallButton = (label: string, doing: string, way: string, aria: string, ghost = true): string =>
  ui.html.button({ label, size: 's', ...(ghost ? { variant: 'ghost' as const } : {}), attrs: { 'data-do': doing, 'data-way': way, 'aria-label': `${label}, ${aria}` } });

/** an account: the lab's name and where it stands, what it is, and its branded button, or a receipt once it is connected or on its way.
    Each plate has one outlined action: its sign-in, or, when the program it runs on is missing, Copy command. */
export function plateHtml(r: Row, canSignin: (w: Way) => boolean): string {
  const copy = PLATE_COPY[r.way.id] ?? { title: r.entry.label, line: r.way.hint };
  const acts = actionsFor(r.way, r.state, canSignin(r.way));
  const st = r.state?.status ?? 'unread';
  const brand = brandOf(r.way.id);
  const note = r.state?.detail ?? (st === 'error' ? hintOf(r.way, r.state) : '');
  let action = '';
  if (st === 'connected') {
    const out = acts.find((a) => a.do === 'signout');
    action = `<span class="fr-rcpt"><span class="fr-rcpt__t">${ui.html.icon('check', { size: 's' })}<span>${esc(r.state?.plan ?? 'Signed in')}</span></span>${out ? smallButton(out.label, out.do, r.way.id, copy.title) : ''}</span>`;
  } else if (st === 'signing_in') {
    action = `<span class="fr-rcpt"><span class="fr-rcpt__t">${ui.html.dot('run')}<span>Finish signing in</span></span>${smallButton('Continue', 'continue', r.way.id, copy.title)}</span>`;
  } else {
    action = acts.map((a) => (a.do === 'signin' && brand
      ? ui.html.signinButton({ brand, attrs: { 'data-do': a.do, 'data-way': r.way.id } })
      : smallButton(a.label, a.do, r.way.id, copy.title, a.do !== 'signin' && a.do !== 'copy'))).join('');
  }
  /* the program a sign-in runs on, when it is missing or old: where to paste the maker's command, and the command (copied by its button) */
  const install = r.state?.install ? installLineHtml(r.state.install, 'fr-plate__note', true) : '';
  return `<article class="fr-plate" data-sq data-way="${esc(r.way.id)}" data-state="${st === 'connected' ? 'connected' : st === 'signing_in' ? 'connecting' : failed(r.state) ? 'failed' : 'off'}" aria-label="${esc(copy.title)}">` +
    `<header class="fr-plate__h"><h3 class="fr-plate__t"><span class="fr-plate__mark" aria-hidden="true">${labMark(r.entry.id, 20)}</span>${esc(copy.title)}</h3>${stateWord(r)}</header>` +
    `<p class="fr-plate__p">${esc(copy.line)}</p>${note ? `<p class="fr-plate__note" data-note>${ui.html.inline(note)}</p>` : ''}${install}<div class="fr-plate__act">${action}</div></article>`;
}

/** a key tile: the lab's mark and state, its name, and what to do; the whole tile is the button that opens the key form. A connected
    tile also has Remove, set over its corner (a button cannot hold a button). */
export function tileHtml(r: Row, name: string): string {
  const st = r.state?.status ?? 'unread';
  const sub = st === 'connected' ? 'Key saved' : st === 'error' ? (r.state?.detail ?? 'Something is wrong with this key.') : `${ui.html.icon('plus', { size: 's' })}<span>Add a key</span>`;
  const remove = st === 'connected' ? `<span class="fr-tile__act">${smallButton('Remove', 'remove', r.way.id, name)}</span>` : '';
  return `<div class="fr-tilewrap"><button type="button" class="fr-tile" data-sq data-way="${esc(r.way.id)}" data-do="key" data-state="${st === 'connected' ? 'connected' : st === 'error' ? 'failed' : 'off'}">` +
    `<span class="fr-tile__top"><span class="fr-tile__mark" aria-hidden="true">${labMark(r.entry.id)}</span>${stateWord(r)}</span>` +
    `<span class="fr-tile__name">${esc(name)}</span><span class="fr-tile__sub">${sub}</span></button>${remove}</div>`;
}

/** the entry's name for its first key way, the way's own for any other (a second key of the same lab, the one for China) */
const nameOf = (r: Row): string => (r.entry.ways.find((w) => w.kind === 'key' && !w.hidden)?.id === r.way.id ? r.entry.label : r.way.label);
/** every key way of a list of blocks, as tiles: the entry's name for its first way, the way's own for the others */
const keyRows = (blocks: Plan['main']): Row[] => blocks.flatMap((b) => b.rows.filter((r) => r.way.kind === 'key'));
const regional = (r: Row): boolean => r.way.region !== undefined;
const tilesOf = (rows: Row[]): string => rows.map((r) => tileHtml(r, nameOf(r))).join('');

/** a runtime found on this computer, or an endpoint that is set up */
function lrow(mark: string, title: string, sub: string, state: string, control: string): string {
  return `<div class="fr-lrow" data-sq data-state="${state}"><span class="fr-lrow__mark" aria-hidden="true">${mark}</span><span class="fr-lrow__t"><b>${esc(title)}</b><span>${esc(sub)}</span></span>${control}</div>`;
}

/** the names the "More providers" tile gives: labs not already on the wall first (a lab's regional key, such as Kimi's for
    China, carries the lab's name, so naming it again would repeat a tile that is right there), then the regional ways by their own names */
export function moreNames(tail: Row[], shown: Row[]): string {
  const onWall = new Set(shown.map((r) => r.entry.id));
  const fresh = tail.filter((r) => !onWall.has(r.entry.id)).map((r) => r.entry.label);
  const names = (fresh.length ? fresh : tail.map((r) => r.way.label)).filter((v, i, a) => a.indexOf(v) === i);
  return names.slice(0, 3).join(', ');
}

/** the hub's list for a plan */
export function hubHtml(p: Plan, canSignin: (w: Way) => boolean, tailOpen: boolean): string {
  const rows = [...p.main, ...p.more].flatMap((b) => b.rows);
  const accounts = rows.filter(isAccount).sort((a, b) => rank(PLATE_ORDER, a.way.id) - rank(PLATE_ORDER, b.way.id));
  const all = [...keyRows(p.main), ...keyRows(p.more)];
  const keys = keyRows(p.main).filter((r) => !regional(r)).sort((a, b) => rank(FIRST_KEYS, a.entry.id) - rank(FIRST_KEYS, b.entry.id));
  const tail = all.filter((r) => !keys.includes(r));
  const out: string[] = [];
  out.push(`<section aria-labelledby="fr-h-accounts"><div class="fr-sec"><h2 class="fr-sec__h" id="fr-h-accounts">Sign in with your plan</h2><span class="fr-sec__n">${String(accounts.filter(connected).length)} of ${String(accounts.length)} connected</span></div>` +
    `<div class="fr-plates">${accounts.map((r) => plateHtml(r, canSignin)).join('')}</div></section>`);
  const more = tail.length
    ? `<div class="fr-tilewrap"><button type="button" class="fr-tile fr-tile--more" data-sq id="hx-prov-more" aria-expanded="${String(tailOpen)}" aria-controls="hx-prov-tail"><span class="fr-tile__top"><span class="fr-tile__mark" aria-hidden="true">${ui.html.icon('ladder')}</span><span class="fr-st"><span>${String(tail.length)} more</span></span></span><span class="fr-tile__name">More providers</span><span class="fr-tile__sub">${esc(moreNames(tail, keys))} and more</span></button></div>`
    : '';
  out.push(`<section aria-labelledby="fr-h-keys"><div class="fr-sec"><h2 class="fr-sec__h" id="fr-h-keys">Or add an API key</h2><span class="fr-sec__n">${String(keys.filter(connected).length)} of ${String(keys.length)} connected</span></div>` +
    `<div class="fr-tiles">${tilesOf(keys)}${more}</div><div id="hx-prov-tail"${tailOpen ? '' : ' hidden'}><div class="fr-tiles fr-tiles--tail">${tilesOf(tail)}</div></div></section>`);
  /* what answered on this computer, and your own endpoint */
  const found = p.found;
  const local = found.length
    ? found.map((r) => lrow(labMark(r.entry.id, 20), r.entry.label, r.state?.models_count != null ? `Found, ${String(r.state.models_count)} ${r.state.models_count === 1 ? 'model' : 'models'}` : 'Found', 'off', smallButton('Use it', 'use', r.way.id, r.entry.label, false))).join('')
    : lrow(ui.html.icon('ladder'), 'Nothing answered here', 'Start Ollama, LM Studio or similar', 'off', smallButton('Check again', 'recheck', 'ollama.local', 'on this computer', false));
  const custom = p.main.find((b) => b.id === 'group-custom');
  const add = custom?.rows.find((r) => r.way.kind === 'custom');
  const endpoints = (custom?.endpoints ?? []).map((s) => lrow(ui.html.icon('ladder'), s.way.slice('custom.'.length), [s.base_url, s.detail].filter(Boolean).join(' '), s.status === 'connected' ? 'connected' : 'failed', smallButton('Remove', 'remove', s.way, s.way.slice('custom.'.length)))).join('');
  out.push(`<div class="fr-band"><section aria-labelledby="fr-h-local"><div class="fr-sec"><h2 class="fr-sec__h" id="fr-h-local">Found on this computer</h2></div><div class="fr-lrows">${local}</div></section>` +
    `<section aria-labelledby="fr-h-end"><div class="fr-sec"><h2 class="fr-sec__h" id="fr-h-end">Your own endpoint</h2></div><div class="fr-lrows fr-lrows--one">${endpoints}${add ? lrow(ui.html.icon('plus'), 'Custom endpoint', 'Any compatible server', 'off', smallButton('Add endpoint', 'endpoint', add.way.id, 'your own endpoint', false)) : ''}</div></section></div>`);
  return out.join('');
}

export const HUB_LAYOUT: ProvidersLayout = { title: 'Connect your labs', level: 2, bare: true, planHtml: hubHtml, back: 'Back to your labs' };
