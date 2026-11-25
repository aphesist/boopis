/* The shell's shared handles: its elements, the selection per tab, the history, the attention counts. */
import { $ } from '../../core/dom';
import type { SegElement } from '@boopis/ui';
import type { Tab } from '../../core/types';

export interface Els {
  btnLeft: HTMLButtonElement; btnSearch: HTMLButtonElement | null; btnTitle: HTMLButtonElement; btnRight: HTMLButtonElement;
  /** v7 has no back and forward buttons (the keys and the palette keep them): null */ btnBack: HTMLButtonElement | null; btnFwd: HTMLButtonElement | null;
  btnMin: HTMLElement; btnMax: HTMLElement; btnClose: HTMLElement;
  side: HTMLElement; btnNew: HTMLButtonElement; btnAccount: HTMLButtonElement; btnSettings: HTMLButtonElement; btnStore: HTMLButtonElement;
  rightShell: HTMLElement; rightSlot: HTMLElement; scrim: HTMLElement;
  palette: HTMLElement; palInput: HTMLInputElement; palList: HTMLElement; settings: HTMLDialogElement;
}
export const sh = {
  app: null as unknown as HTMLElement,
  el: null as unknown as Els,
  seg: { tabs: null as HTMLElement | null, collapse: null as SegElement | null },
  selection: { session: null, bots: null } as Record<Tab, string | null>,
  booted: false
};
export const els = (): Els => sh.el;

export function collectEls(): Els {
  return {
    btnLeft: $('#hx-btn-left'), btnSearch: document.getElementById('hx-btn-search'), btnTitle: $('#hx-btn-title'), btnRight: $('#hx-btn-right'),
    btnBack: null, btnFwd: null,
    btnMin: $('#hx-btn-min'), btnMax: $('#hx-btn-max'), btnClose: $('#hx-btn-close'),
    side: $('#hx-side'), btnNew: $('#hx-btn-new'), btnAccount: $('#hx-btn-account'), btnSettings: $('#hx-btn-settings'), btnStore: $('#hx-btn-store'),
    rightShell: $('#hx-right-shell'), rightSlot: $('#hx-right'), scrim: $('#hx-scrim'),
    palette: $('#hx-palette'), palInput: $('#hx-palette-input'), palList: $('#hx-palette-list'), settings: $('#hx-settings')
  } as Els;
}
