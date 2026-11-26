/* A Settings page: the kit's Page (settings variant: its title, the scope where it has one, its sections) as an element the dialog
   keeps. `refresh` reads again what moved while the dialog was closed; `reveal` scrolls to a part a caller named. */
import { kit } from '@boopis/ui';
import type { SegItem } from '@boopis/ui';
import { frag } from '../../core/dom';

export interface Page {
  el: HTMLElement;
  refresh?: () => Promise<void>;
  reveal?: (o: { find?: string; focus?: string }) => Promise<void> | void;
  destroy?: () => void;
}

/** the page's element; its body is filled by the page module (`body`) */
export function pageEl(id: string, title: string, scope?: { items: readonly SegItem[]; value: string }): { el: HTMLElement; body: HTMLElement } {
  const el = frag(kit.html.page({ variant: 'settings', title, ...(scope ? { scope: { ...scope, attrs: { 'data-scope': '' } } } : {}), attrs: { id: 'hx-set-' + id, 'data-page': id } }));
  kit.wire(el);
  return { el, body: el.querySelector<HTMLElement>('.k7-page__body') as HTMLElement };
}

/** fill a page part with kit markup, wired */
export function fill(host: HTMLElement, html: string): void {
  host.innerHTML = html;
  kit.wire(host);
}

/** scroll a part into view in the dialog's page, and move the focus to it */
export function revealPart(el: Element | null): void {
  if (!(el instanceof HTMLElement)) return;
  el.scrollIntoView({ block: 'start' });
  const f = el.matches('input, textarea, button, [tabindex]') ? el : el.querySelector<HTMLElement>('input, textarea, button, [tabindex="0"]');
  f?.focus({ preventScroll: true });
}
