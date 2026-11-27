/* The new session's screen, as board S17 draws it (docs/design/v7/boards: sessionnew.js newSess, sessiontab.js shell): the canvas
   (s0.ts launchCanvas) between the chrome and the composer, and at the foot, centred on the work and 96 over the window's foot where
   the dock sits (24 where it does not): a usage limit that is close as a Notice, then the kit's one-row Composer with its two hints.
   It is the session view's while the open session has not started; the first message starts it. */
import { el } from '../../core/dom';
import { kit } from '@boopis/ui';
import { data } from '../../data';
import type { LaunchActions, LaunchView } from './s0';
import { launchCanvas } from './s0';
import { composeTools, later, micUnavailable, voiceNeedsSetup } from '../chat/compose';
import { emit } from '../../core/bus';
import { ledger, writeLedger } from '../onboarding/ledger';
import { isStep, setDefaultCareful } from '../settings/sessions';

export interface NewScreen {
  /** draw it (again) for these launch settings and show it */
  show(v: LaunchView): void;
  hide(): void;
  readonly shown: boolean;
  focus(): void;
  /** the composer's text field, for what watches typing */
  input(): HTMLElement | null;
}
const HINT = 'Enter starts the session', HINT_END = 'ctrl Enter starts it in the background';

/** the first run's step on this canvas, from the ledger (modules/onboarding/ledger.ts): only once a folder and a model are there, and the
    hand-off only where the boopis bot's part exists (`bots-onboarding`) */
export function firstRunStep(v: Pick<LaunchView, 'folder' | 'model'>, handoff: { count: number | null } | null): NonNullable<LaunchView['firstRun']> | null {
  if (v.folder === null || v.model === null) return null;
  const l = ledger();
  if (l.sessions === 'careful' || l.sessions === 'ready') return { step: l.sessions };
  if (l.sessions === 'done' && l.bots === 'todo' && handoff && later('bots-onboarding')) return { step: 'handoff', count: handoff.count };
  return null;
}
/** the hand-off counts down from this many seconds, then opens the Bots tab by itself (board O-H01: "Opening Bots in 3 s") */
export const HANDOFF_SECONDS = 3;

export function mountNew(root: HTMLElement, o: { actions: LaunchActions; send(text: string, background: boolean): void; /** draw it again (the launch settings changed) */ redraw?(): void }): NewScreen {
  const host = el('div', { class: 'ss-new', hidden: true });
  const canvasSlot = el('div', { class: 'ss-new__slot' });
  const zone = el('div', { class: 'ss-new__zone' });
  const noticeSlot = el('div', { class: 'ss-new__notice' });
  const composerSlot = el('div', { class: 'ss-new__composer' });
  zone.append(noticeSlot, composerSlot);
  host.append(canvasSlot, zone);
  root.append(host);
  let dismissed: string | null = null, sig = '';
  /* the hand-off's countdown: the seconds left while it runs, null once it waits for a press (reduced motion, or the person moved) */
  let count: number | null = HANDOFF_SECONDS, tick = 0, last: LaunchView | null = null;
  const actions: LaunchActions = {
    ...o.actions,
    firstRun(what, value) {
      if (what === 'pick') { if (isStep(value)) { setDefaultCareful(value); o.redraw?.(); } return; }
      if (what === 'careful') { if (isStep(value)) setDefaultCareful(value); writeLedger({ sessions: 'ready' }); o.redraw?.(); return; }
      if (what === 'suggest') { const t = text(); if (t) { t.textContent = value; t.dispatchEvent(new Event('input', { bubbles: true })); t.focus(); } writeLedger({ sessions: 'done' }); return; }
      window.clearInterval(tick);
      if (what === 'later') { writeLedger({ bots: 'later' }); o.redraw?.(); return; }
      if (what === 'bots') { emit('hx:onboarding-bots', { from: 'handoff' }); }
    }
  };
  const text = (): HTMLElement | null => composerSlot.querySelector<HTMLElement>('.k7-composer__text');
  function drawComposer(v: LaunchView): void {
    const ph = v.folder === null ? 'Add a folder to start' : v.model === null ? 'Choose a model to start' : v.firstRun?.step === 'careful' ? 'Pick how careful first' : 'What should change? @ files, $ skills, / commands';
    const keep = text()?.textContent ?? data().sessions.draft();
    composerSlot.replaceChildren(kit.composer({ kind: 'session', placeholder: ph, label: 'Message', hint: HINT, hintEnd: HINT_END, voiceSetup: voiceNeedsSetup(), micOff: micUnavailable(), ...(keep ? { text: keep } : {}) }));
    tools.drawn();
    text()?.setAttribute('data-hx-focus', 'composer');
  }
  function drawNotice(): void {
    const n = data().limits?.get() ?? null;
    if (!n || n.id === dismissed) { noticeSlot.replaceChildren(); return; }
    noticeSlot.replaceChildren(kit.notice({ icon: 'clock', title: n.title, text: ', ' + n.detail, place: 'page', actions: later('usage') ? [{ label: 'Get more usage', ghost: true, value: 'more' }] : [], dismiss: true, attrs: { 'data-limit': n.id } }));
  }
  const tools = composeTools(composerSlot, { botId: () => null });
  noticeSlot.addEventListener('click', (e) => { if ((e.target as Element).closest('[data-dismiss]')) { dismissed = noticeSlot.querySelector<HTMLElement>('[data-limit]')?.dataset['limit'] ?? null; drawNotice(); } });
  composerSlot.addEventListener('ui:send', (e) => { o.send((e as CustomEvent<{ text: string }>).detail.text, false); });
  composerSlot.addEventListener('ui:steer', (e) => { o.send((e as CustomEvent<{ text: string }>).detail.text, true); });   /* ctrl Enter: in the background */
  data().limits?.subscribe(() => { drawNotice(); });
  return {
    show(v0) {
      last = v0;
      const v: LaunchView = { ...v0, firstRun: v0.firstRun !== undefined ? v0.firstRun : firstRunStep(v0, { count }) ?? null };
      /* the hand-off counts down once, then opens Bots by itself; under reduced motion it waits for a press (the prompt, O-H01b) */
      if (v.firstRun?.step === 'handoff' && !tick && count !== null) {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) { count = null; v.firstRun = { step: 'handoff', count: null }; }
        else tick = window.setInterval(() => {
          if (count === null) return;
          count -= 1;
          if (count <= 0) { window.clearInterval(tick); count = null; emit('hx:onboarding-bots', { from: 'handoff' }); return; }
          if (last && !host.hidden) this.show(last);
        }, 1000);
      }
      const next = JSON.stringify(v);
      if (next !== sig || !canvasSlot.firstElementChild) { sig = next; canvasSlot.replaceChildren(launchCanvas(v, actions)); drawComposer(v); }
      drawNotice();
      host.hidden = false;
      root.setAttribute('data-new', '');
    },
    hide() { host.hidden = true; root.removeAttribute('data-new'); if (tick) { window.clearInterval(tick); count = null; } },
    get shown() { return !host.hidden; },
    focus() { text()?.focus(); },
    input: text
  };
}
