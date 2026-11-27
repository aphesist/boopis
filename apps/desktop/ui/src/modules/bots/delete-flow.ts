/* Deleting a bot, one flow for its sheet and Settings › Bots (the sheet's, moved here on the kit at the 7a follow-ups): say what goes
   (the provider's removal note, counted on disk), offer Archive first, and delete only on a second press of "Delete permanently"; the
   name is the confirmation the plugin asks for (`remove(id, confirm)`). Drawn into the host the caller gives, as a kit Block. */
import { kit } from '@boopis/ui';
import type { BotsAdmin } from '../../data';
import { fill } from '../settings/page';
import { actionsHTML, buttonHTML, esc, said } from '../settings/rows';

export interface DeleteFlow {
  id: string; name: string; admin: BotsAdmin;
  /** Cancel: the flow is closed */ onCancel(): void;
  /** "Archive instead" */ onArchive(): void;
  /** deleted (the provider has said so) */ onDone(name: string): void;
  /** still wanted (the sheet or the page it is drawn in is still open) */ live?(): boolean;
}
const head = (name: string): string => kit.html.sectionHead({ title: 'Delete ' + name + ' for good?' });

export async function deleteFlow(host: HTMLElement, o: DeleteFlow): Promise<void> {
  host.hidden = false;
  fill(host, kit.html.block({ attrs: { 'data-delete': o.id }, body: '<div class="hx-set__flow">' + head(o.name) + '<p class="k7-page__note" role="status">Counting what is in its folder…</p></div>' }));
  let lines: readonly string[];
  try { lines = (await o.admin.removal(o.id)).lines; } catch (e) { lines = ['Everything in its folder (boopis could not count it: ' + said(e) + ').']; }
  if (o.live && !o.live()) return;
  fill(host, kit.html.block({ attrs: { 'data-delete': o.id }, body: '<div class="hx-set__flow">' + head(o.name) +
    '<p class="k7-page__note">This removes, and cannot be undone:</p><ul class="hx-set__list k7-page__note">' + lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' +
    '<p class="k7-page__note">Archiving keeps all of it, pauses its routines, frees the name, and can be undone.</p>' +
    '<p class="k7-page__note" role="alert" data-delete-error hidden></p>' +
    actionsHTML(buttonHTML('Cancel', { variant: 'ghost', attrs: { 'data-delete-act': 'cancel' } }), buttonHTML('Delete permanently', { variant: 'danger', attrs: { 'data-delete-act': 'sure' } }), buttonHTML('Archive instead', { variant: 'primary', attrs: { 'data-delete-act': 'archive' } })) + '</div>' }));
  const btn = (a: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[data-delete-act="' + a + '"]') as HTMLButtonElement;
  const sure = btn('sure'), word = sure.querySelector('.k7-btn__label') as HTMLElement, err = host.querySelector<HTMLElement>('[data-delete-error]') as HTMLElement;
  const all = (on: boolean): void => { for (const a of ['cancel', 'sure', 'archive']) btn(a).disabled = !on; };
  btn('cancel').addEventListener('click', () => { host.hidden = true; host.replaceChildren(); o.onCancel(); });
  btn('archive').addEventListener('click', () => { o.onArchive(); });
  sure.addEventListener('click', () => {
    if (!sure.hasAttribute('data-armed')) {
      sure.setAttribute('data-armed', ''); word.textContent = 'Click again to delete';
      setTimeout(() => { if (sure.isConnected) { sure.removeAttribute('data-armed'); word.textContent = 'Delete permanently'; } }, 4000);
      return;
    }
    all(false); err.hidden = true;
    o.admin.remove(o.id, o.id).then(() => { o.onDone(o.name); })
      .catch((e: unknown) => { all(true); err.textContent = 'It was not deleted: ' + said(e); err.hidden = false; });
  });
  requestAnimationFrame(() => { host.scrollIntoView?.({ block: 'nearest' }); btn('archive').focus({ preventScroll: true }); });
}
