/* The new session's screen, as board S17 draws it (docs/design/v7/boards: sessionnew.js newSess, sessiontab.js shell): the canvas
   (s0.ts launchCanvas) between the chrome and the composer, and at the foot, centred on the work and 96 over the window's foot where
   the dock sits (24 where it does not): a usage limit that is close as a Notice, then the kit's one-row Composer with its two hints.
   It is the session view's while the open session has not started; the first message starts it. */
import { el } from '../../core/dom';
import { kit } from '@boopis/ui';
import { data } from '../../data';
import type { LaunchActions, LaunchView } from './s0';
import { launchCanvas } from './s0';
import { composeTools, VOICE_NOT_YET } from '../chat/compose';

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
const NOT_YET = 'Buying more usage from here is not in this build yet';

export function mountNew(root: HTMLElement, o: { actions: LaunchActions; send(text: string, background: boolean): void }): NewScreen {
  const host = el('div', { class: 'ss-new', hidden: true });
  const canvasSlot = el('div', { class: 'ss-new__slot' });
  const zone = el('div', { class: 'ss-new__zone' });
  const noticeSlot = el('div', { class: 'ss-new__notice' });
  const composerSlot = el('div', { class: 'ss-new__composer' });
  zone.append(noticeSlot, composerSlot);
  host.append(canvasSlot, zone);
  root.append(host);
  let dismissed: string | null = null, sig = '';
  const text = (): HTMLElement | null => composerSlot.querySelector<HTMLElement>('.k7-composer__text');
  function drawComposer(v: LaunchView): void {
    const ph = v.folder === null ? 'Add a folder to start' : v.model === null ? 'Choose a model to start' : 'What should change? @ files, $ skills, / commands';
    const keep = text()?.textContent ?? data().sessions.draft();
    composerSlot.replaceChildren(kit.composer({ kind: 'session', placeholder: ph, label: 'Message', hint: HINT, hintEnd: HINT_END, voiceOff: VOICE_NOT_YET, ...(keep ? { text: keep } : {}) }));
    tools.drawn();
    text()?.setAttribute('data-hx-focus', 'composer');
  }
  function drawNotice(): void {
    const n = data().limits?.get() ?? null;
    if (!n || n.id === dismissed) { noticeSlot.replaceChildren(); return; }
    noticeSlot.replaceChildren(kit.notice({ icon: 'clock', title: n.title, text: ', ' + n.detail, place: 'page', actions: [{ label: 'Get more usage', ghost: true, value: 'more', inert: NOT_YET }], dismiss: true, attrs: { 'data-limit': n.id } }));
  }
  const tools = composeTools(composerSlot, { botId: () => null });
  noticeSlot.addEventListener('click', (e) => { if ((e.target as Element).closest('[data-dismiss]')) { dismissed = noticeSlot.querySelector<HTMLElement>('[data-limit]')?.dataset['limit'] ?? null; drawNotice(); } });
  composerSlot.addEventListener('ui:send', (e) => { o.send((e as CustomEvent<{ text: string }>).detail.text, false); });
  composerSlot.addEventListener('ui:steer', (e) => { o.send((e as CustomEvent<{ text: string }>).detail.text, true); });   /* ctrl Enter: in the background */
  data().limits?.subscribe(() => { drawNotice(); });
  return {
    show(v) {
      const next = JSON.stringify(v);
      if (next !== sig || !canvasSlot.firstElementChild) { sig = next; canvasSlot.replaceChildren(launchCanvas(v, o.actions)); drawComposer(v); }
      drawNotice();
      host.hidden = false;
      root.setAttribute('data-new', '');
    },
    hide() { host.hidden = true; root.removeAttribute('data-new'); },
    get shown() { return !host.hidden; },
    focus() { text()?.focus(); },
    input: text
  };
}
