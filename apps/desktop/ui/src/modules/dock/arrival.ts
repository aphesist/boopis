/* The dock's arrival and departure (owner, 19 November 2026): it exists when something is in it (presence.ts). A dock with no
   bot and no session is not drawn: it is `off`, the same state the setting leaves it in, so the shell keeps no room for it
   and nothing of it is reachable. The first bot or the first session makes it rise; a part joining a dock that shows grows it
   in place; the last bot going, with no session, takes it away. */
import { S, X, flags, motion, presence, shownPages } from './ctx';
import { E, emitDock, kick, morph, paint, renderDots, retarget, runAfterOut, showView } from './engine';
import { setOn } from './controller';
import { fitRow } from './input';
import { setOrbLife } from './orbs';
import { pageOf } from './presence';
import { fillCards, relocateLive, renderAll, viewKey } from './views';
import { syncRoving } from './roving';

/** which parts the dock has, for the stylesheet and the tests */
export function markParts(): void {
  const p = presence();
  X.root.dataset['parts'] = [p.bots ? 'bots' : '', p.session ? 'session' : ''].filter(Boolean).join(' ');
}
/** a part joined or went (inside a morph's change): the page is one that is shown, the nub is drawn again, the row is the bots' */
export function settleParts(): void {
  S.page = pageOf(S.page, shownPages());
  renderDots();
  markParts();
}
/** The dock rises in, once, straight to the mode it was left in: its slab grows from nothing on its spring while the content
    rises inside it (the stage sinks 14px more than the slab is tall, on a slower spring, so the content is always under the slab's
    top). Nothing is shown outside the slab; reduced motion has no travel, the dock fades in. */
export function appear(): void {
  ++flags.offSeq;                       /* an exit that has not finished no longer applies */
  runAfterOut();
  S.card = null;
  const mode = S.restore === 'minimal' ? 'minimal' : 'normal';
  if (S.mode !== 'off') {               /* it had not finished leaving: it stays, and takes what is there in place */
    morph(() => { S.mode = mode; settleParts(); renderAll(); }, { render: [] });
    fitRow();
    return;
  }
  X.root.classList.remove('is-gone'); X.root.inert = false; X.root.removeAttribute('aria-hidden');
  S.mode = mode; X.root.dataset['mode'] = mode;
  S.page = pageOf(S.page, shownPages());
  markParts();
  renderDots(); renderAll(); fitRow();
  X.curView = showView(viewKey());
  fillCards(X.curView); syncRoving(); relocateLive(); setOrbLife();
  retarget(false);
  if (motion.reduce) X.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'linear' });
  else {
    snapOut();
    for (const s of [E.slabH, E.slabW]) s.v = 0;
    paint();
  }
  kick(); emitDock();
}
/** the slab at no height, the stage below the window's edge, ready to rise */
function snapOut(): void {
  E.sinkS.x = E.baseH + 14; E.sinkS.v = 0;
  E.slabH.x = 0; E.slabW.x = E.baseW;
}
/** The dock leaves because nothing is in it, the way the setting takes it away (to the pill, then down). What it was showing stays
    until it is out of sight, then `after` clears it, so no empty roster or lone "+" is ever seen on the way out. */
export function leaveEmpty(after: () => void): void {
  if (S.mode === 'off') { after(); return; }
  flags.afterOut = after;
  if (motion.reduce && X.root.getClientRects().length) {
    const fade = X.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'linear', fill: 'forwards' });
    const prev = flags.afterOut;
    flags.afterOut = () => { try { fade.cancel(); } catch { /* gone */ } prev?.(); };
  }
  setOn(false);
}
/** the user's setting changed: the dock follows it, as it did before presence (to the pill, then down; or back up) */
export function followSetting(): void {
  const want = presence().visible;
  if (want && S.mode === 'off') setOn(true);
  else if (!want && S.mode !== 'off') setOn(false);
}

