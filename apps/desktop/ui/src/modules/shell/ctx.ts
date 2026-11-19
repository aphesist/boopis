/* The shell's shared handles: its elements, the selection per tab, the history, the attention counts. */
import { $ } from '../../core/dom';
import type { SegElement } from '@boopis/ui';
import type { Tab } from '../../core/types';

export interface Els {
  btnLeft: HTMLButtonElement; btnBack: HTMLButtonElement; btnFwd: HTMLButtonElement; btnSearch: HTMLButtonElement;
  whereProject: HTMLElement; whereTitle: HTMLElement; btnRight: HTMLButtonElement;
  btnMin: HTMLElement; btnMax: HTMLElement; btnClose: HTMLElement;
  side: HTMLElement; btnNew: HTMLButtonElement; btnAccount: HTMLButtonElement; btnSettings: HTMLButtonElement;
  rightShell: HTMLElement; rightSlot: HTMLElement; scrim: HTMLElement;
  palette: HTMLElement; palInput: HTMLInputElement; palList: HTMLElement; settings: HTMLDialogElement;
}
export const sh = {
  app: null as unknown as HTMLElement,
  el: null as unknown as Els,
  seg: { tabs: null as SegElement | null, rail: null as SegElement | null, collapse: null as SegElement | null },
  selection: { session: null, bots: null } as Record<Tab, string | null>,
  booted: false
};
export const els = (): Els => sh.el;

export function collectEls(): Els {
  return {
    btnLeft: $('#hx-btn-left'), btnBack: $('#hx-btn-back'), btnFwd: $('#hx-btn-fwd'), btnSearch: $('#hx-btn-search'),
    whereProject: $('#hx-where-project'), whereTitle: $('#hx-where-title'), btnRight: $('#hx-btn-right'),
    btnMin: $('#hx-btn-min'), btnMax: $('#hx-btn-max'), btnClose: $('#hx-btn-close'),
    side: $('#hx-side'), btnNew: $('#hx-btn-new'), btnAccount: $('#hx-btn-account'), btnSettings: $('#hx-btn-settings'),
    rightShell: $('#hx-right-shell'), rightSlot: $('#hx-right'), scrim: $('#hx-scrim'),
    palette: $('#hx-palette'), palInput: $('#hx-palette-input'), palList: $('#hx-palette-list'), settings: $('#hx-settings')
  } as Els;
}
