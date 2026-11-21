/* First-run setup's models hub (ADR-0040): the Providers section of Settings > Models (`providers-view.ts`, which owns every action,
   state and card) drawn as one place to connect everything: the labs you sign in to with an account you already pay for come first,
   each a lab mark, its state and its branded button; then every key, the runtimes found on this computer, your own endpoint and the
   rest, as the section lists them. This file is only the arrangement (`ProvidersLayout`): change it and nothing else moves. Pure:
   markup from a plan, no host, no listeners. */
import { ui } from '@boopis/ui';
import { esc } from '../core/dom';
import type { Way } from '../data/providers';
import { actionsFor, blockHtml, head, hintOf, rowHtml, rowNote, statusWord } from './providers-view';
import type { Block, Plan, ProvidersLayout, Row } from './providers-view';
import { brandOf } from './signin-brands';

/** a lab's mark: the id of the model family that draws it (`ui.modelMark` reads a model's name) */
const MARK_OF: Readonly<Record<string, string>> = { anthropic: 'claude', openai: 'gpt', google: 'gemini', xai: 'grok', zai: 'glm', moonshot: 'kimi' };
export const labMark = (entryId: string, size = 24): string => ui.html.modelMark(MARK_OF[entryId] ?? entryId, { size, label: false });

/** the rows whose sign-in has a branded button: the account tiles at the head of the hub */
const isAccount = (r: Row): boolean => r.way.kind === 'signin' && brandOf(r.way.id) !== null;

const tileAction = (r: Row, canSignin: (w: Way) => boolean): string => {
  const acts = actionsFor(r.way, r.state, canSignin(r.way));
  return acts.map((a) => (a.do === 'signin' ? ui.html.signinButton({ brand: brandOf(r.way.id) ?? 'chatgpt', attrs: { 'data-do': a.do, 'data-way': r.way.id } })
    : ui.html.button({ label: a.label, size: 's', ...(a.primary ? { variant: 'primary' as const } : a.ghost ? { variant: 'ghost' as const } : {}), attrs: { 'data-do': a.do, 'data-way': r.way.id, 'aria-label': `${a.label}, ${r.way.label}` } }))).join('');
};

/** one account: the lab's mark and name, where it stands (a word, never a colour alone), what it is, and its button */
export function accountTile(r: Row, canSignin: (w: Way) => boolean): string {
  const notes = r.way.notes.filter(rowNote).map((n) => `<p class="ui-field__hint" data-note="${esc(n.id)}">${esc(n.text)}</p>`).join('');
  return `<li class="fr-account" data-way="${esc(r.way.id)}" data-status="${esc(r.state?.status ?? 'unread')}">` +
    `<span class="fr-account__head">${r.entry.id === 'github-copilot' ? '' : `<span class="fr-account__mark" aria-hidden="true">${labMark(r.entry.id)}</span>`}<span class="fr-account__name">${esc(r.entry.label)}</span>` +
    `<span class="ui-set__value" data-status="${esc(r.state?.status ?? 'unread')}">${esc(statusWord(r.state))}</span></span>` +
    `<span class="ui-field__hint fr-account__hint">${esc(hintOf(r.way, r.state))}</span>${notes}` +
    `<span class="fr-account__act">${tileAction(r, canSignin)}</span></li>`;
}

/** the hub's list for a plan. A search or a filter lists everything in one run, as the section does. */
export function hubHtml(p: Plan, canSignin: (w: Way) => boolean, tailOpen: boolean): string {
  if (p.empty) return '<p class="ui-field__hint" role="status" data-prov-none>No provider matches. Try another word, or choose All.</p>';
  const accounts = p.main.flatMap((b) => b.rows).filter(isAccount);
  const rest = (b: Block): Block => ({ ...b, rows: b.rows.filter((r) => !isAccount(r)) });
  const blocks = p.main.map(rest).filter((b) => b.rows.length || b.endpoints?.length);
  const out: string[] = [];
  if (accounts.length) out.push(head('accounts', 'Sign in with an account you already pay for', 2) + `<ul class="fr-accounts" aria-label="Accounts">${accounts.map((r) => accountTile(r, canSignin)).join('')}</ul>`);
  if (p.found.length) out.push(head('found', 'Found on this computer', 2) + p.found.map((r) => rowHtml(r, canSignin, true)).join(''));
  out.push(...blocks.map((b) => blockHtml(b, canSignin, true, 2)));
  if (p.more.length) {
    const n = p.more.reduce((c, b) => c + b.rows.length, 0);
    out.push('<div class="fr-more">' + ui.html.button({ label: `More providers (${String(n)})`, size: 's', variant: 'ghost', attrs: { id: 'hx-prov-more', 'aria-expanded': String(tailOpen), 'aria-controls': 'hx-prov-tail' } }) + '</div>');
    out.push(`<div id="hx-prov-tail"${tailOpen ? '' : ' hidden'}>${p.more.map((b) => blockHtml(b, canSignin, true, 2)).join('')}</div>`);
  }
  return out.join('');
}

export const HUB_LAYOUT: ProvidersLayout = { title: 'Your accounts and keys', level: 2, planHtml: hubHtml, back: 'Back to your models' };
