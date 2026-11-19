/* Long names in cards: measured, never overflowing. A name never makes a card wider or pushes a column. In a one-row
   card the who takes at most half the line, or whatever the request leaves; several names take the longest form that
   still leaves the asker about five em ("kai, iris and nina", then "kai and 2 others"; "chief of staff… and kai" when
   the asker is the long one); a relay gives way before the asker. Whatever is cut is whole on hover and focus (the row,
   or the byline, which becomes focusable only then) and always whole in the accessible name. Refitted when a card's
   width or the theme changes. The markup is parts.ts `namesUnit`; the CSS is cards.css (.cd-names). */
import { on } from '../../core/bus';
import { restOf } from './parts';

/** the asker keeps at least this many em before the others and the relay take room */
export const FIT_MIN_EM = 5;
const others = (k: number): string => ' and ' + k + ' other' + (k > 1 ? 's' : '');
const cut = (el: HTMLElement | null): boolean => !!el && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);

/** the forms the others can take, longest first: the last is the asker alone (the stacked orbs beside it still count
    everyone, and the full names are on hover, on focus and in the accessible name: a "+N" here would contradict the
    stack's own +N) */
export const namesForms = (names: readonly string[]): string[] => (names.length <= 3 ? [restOf(names)] : []).concat([others(names.length - 1), '']);

/** shorten the others until they are not cut; true when a shorter form than the full one was needed */
export function fitNames(unit: HTMLElement): boolean {
  let names: unknown = null;
  try { names = JSON.parse(unit.dataset['names'] ?? ''); } catch { return false; }
  const first = unit.querySelector<HTMLElement>('.cd-names__first'), rest = unit.querySelector<HTMLElement>('.cd-names__rest');
  if (!Array.isArray(names) || !first || !rest) return false;
  const forms = namesForms(names.map(String));
  /* the asker's floor is set (fitCard), so a form fits when what follows it is not cut */
  let i = 0;
  for (; i < forms.length; i++) { rest.textContent = forms[i] ?? ''; if (!cut(rest)) break; }
  if (i === forms.length) rest.textContent = forms[--i] ?? '';
  return i > 0;
}

export function fitCard(card: HTMLElement): void {
  if (!card.isConnected || !card.clientWidth) return;
  for (const text of card.querySelectorAll<HTMLElement>('.cd-mini__text')) {
    const who = text.querySelector<HTMLElement>('.cd-mini__who'), what = text.querySelector<HTMLElement>('.cd-mini__what');
    if (!who || !what || !text.clientWidth) continue;
    const fs = parseFloat(getComputedStyle(text).fontSize) || 13, avail = text.clientWidth;
    const room = Math.max(avail * 0.5, avail - what.getBoundingClientRect().width - fs * 0.3);
    who.style.setProperty('--cd-who-max', Math.floor(room) + 'px');
  }
  for (const unit of card.querySelectorAll<HTMLElement>('.cd-names')) {
    /* floors from each part's own width and the room there is: the asker keeps up to five em (at least 60% of a relayed
       line), the relay up to six of what is left, so a short name never leaves a gap and the two always fit */
    const em = parseFloat(getComputedStyle(unit).fontSize) || 12;
    const first = unit.querySelector<HTMLElement>('.cd-names__first'), via = unit.querySelector<HTMLElement>('.cd-names__via'), rest = unit.querySelector<HTMLElement>('.cd-names__rest');
    if (first) first.style.minWidth = '';
    if (via) via.style.minWidth = '';
    if (rest && unit.dataset['names']) { try { rest.textContent = restOf((JSON.parse(unit.dataset['names']) as unknown[]).map(String)); } catch { /* keep */ } }
    const room = unit.clientWidth;
    const ff = first ? Math.min(first.scrollWidth, em * FIT_MIN_EM, room * (via ? 0.6 : 1)) : 0;
    if (first) first.style.minWidth = ff + 'px';
    if (via) via.style.minWidth = Math.max(0, Math.min(via.scrollWidth, em * 6, room - ff - (rest ? rest.scrollWidth : 0))) + 'px';
    const shorter = unit.dataset['names'] ? fitNames(unit) : false;
    const host = unit.closest<HTMLElement>('.cd-mini') ?? unit.closest<HTMLElement>('.cd-by__label');
    if (!host) continue;
    const clipped = shorter || [...unit.querySelectorAll<HTMLElement>('.cd-names__first, .cd-names__rest, .cd-names__via')].some(cut);
    if (clipped) { host.setAttribute('data-tip', unit.dataset['full'] ?? ''); if (host.tagName !== 'BUTTON') host.tabIndex = 0; }
    else { host.removeAttribute('data-tip'); if (host.tagName !== 'BUTTON') host.removeAttribute('tabindex'); }
  }
}

/* every connected card is fitted when its width changes; the set is ours, so refitting never walks the document */
const FITTED = new Set<HTMLElement & { _fitW?: number }>();
const observer = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
  for (const e of entries) { const t = e.target as HTMLElement & { _fitW?: number }, w = Math.round(e.contentRect.width); if (t._fitW !== w) { t._fitW = w; fitCard(t); } }
}) : null;
export function watchFit(card: HTMLElement): void { FITTED.add(card); observer?.observe(card); }
export function unwatchFit(card: HTMLElement & { _fitW?: number }): void { FITTED.delete(card); observer?.unobserve(card); card._fitW = 0; }
const refitAll = (): void => { requestAnimationFrame(() => { for (const c of FITTED) fitCard(c); }); };
if (document.fonts?.ready) void document.fonts.ready.then(refitAll);
on('hx:theme', refitAll);
