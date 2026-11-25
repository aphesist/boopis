/* The shell's chrome on the v7 kit (DESIGN-SYSTEM.md v7 7, 12.1, 19; screens 11 to 13): no title bar. A 56 px drag region holds
   the kit's WindowChrome: the sidebar toggle over the rail, the title pill centred on the window (the open bot's orb, a room's
   stack, or a session's glyph, and the name; it opens the details), the search hint (S5: "Search ctrl K", it opens the palette),
   the details button and the thin window glyphs. The open sidebar's head is the Sessions / Bots pill and New (screen 13); its
   foot is you, Store and Settings (screen 12). The whole app is a v7 root (`data-ui="v7"` on the body), in the theme the
   scheme of the v6 preset picks, until Settings > Appearance moves to v7's own themes (w33/settings-store). */
import { $, frag } from '../../core/dom';
import { kit, ui } from '@boopis/ui';
import type { BotLike } from '@boopis/ui';
import { data } from '../../data';
import { themeApi } from '../../styles/theme';
import { sh } from './ctx';

/** the v7 root follows the scheme of the active theme: dark, or light (Bone) */
export function syncV7Theme(): void {
  const mode = themeApi.scheme() === 'light' ? 'light' : 'dark';
  if (document.body.getAttribute('data-ui') === 'v7' && document.body.getAttribute('data-theme') === mode) return;
  kit.applyTheme(document.body, { theme: mode });
}

export function drawChrome(app: HTMLElement): void {
  const host = $('#hx-chrome', app);
  host.replaceChildren(kit.windowChrome({
    title: '', search: 'hint',
    parts: {
      toggle: { id: 'hx-btn-left', 'aria-controls': 'hx-side', 'aria-expanded': 'true', 'data-kbd': 'mod+B', 'data-tip-pos': 'bottom' },
      title: { id: 'hx-btn-title' },
      search: { id: 'hx-btn-search', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
      details: { id: 'hx-btn-right', 'aria-controls': 'hx-right-shell', 'aria-expanded': 'false', 'data-kbd': 'mod+I' },
      windowGroup: { role: 'group', 'aria-label': 'Window' },
      min: { id: 'hx-btn-min', 'data-win': 'min' }, max: { id: 'hx-btn-max', 'data-win': 'max', 'aria-label': 'Full screen', 'data-tip': 'Full screen' },
      close: { id: 'hx-btn-close', 'data-win': 'close' }
    }
  }));
  host.querySelector('.k7-chrome__wc')?.classList.add('hx-win');
}

/** the open sidebar's head: Sessions / Bots (the kit's Segmented, a tab list over the two lists) and New, a floating 36 circle */
export function drawSideHead(app: HTMLElement): void {
  const seg = kit.segmented({
    label: 'View', variant: 'tabs', value: 'session', attrs: { id: 'hx-seg' },
    items: [
      { value: 'session', label: 'Sessions', controls: 'hx-list-session', id: 'hx-tab-session', keys: 'alt+1', dot: false },
      { value: 'bots', label: 'Bots', controls: 'hx-list-bots', id: 'hx-tab-bots', keys: 'alt+2', dot: false }
    ]
  });
  seg.classList.add('hx-seg');
  $('#hx-seg', app).replaceWith(seg);
  sh.seg.tabs = seg;
  const add = kit.iconButton({ icon: 'plus', label: 'New session', keys: 'mod+shift+O', attrs: { id: 'hx-btn-new', 'data-tip-pos': 'bottom' } });
  add.classList.add('hx-new');
  $('#hx-btn-new', app).replaceWith(add);
}

/** the foot: you (the account menu), Store and Settings */
export function drawSideFoot(app: HTMLElement): void {
  const U = data().user.get();
  const foot = $('#hx-foot', app);
  foot.replaceChildren(frag(
    '<button class="k7-reset hx-me" id="hx-btn-account" type="button" aria-haspopup="menu" aria-expanded="false" data-tip-pos="top">' +
      '<span class="hx-avatar" aria-hidden="true"></span><span class="hx-me__name" id="hx-account-name"></span></button>'),
  kit.iconButton({ icon: 'store', label: 'Store', keys: 'mod+shift+S', attrs: { id: 'hx-btn-store', 'aria-haspopup': 'dialog' } }),
  kit.iconButton({ icon: 'gear', label: 'Settings', keys: 'mod+,', attrs: { id: 'hx-btn-settings', 'aria-haspopup': 'dialog' } }));
  const me = $('#hx-btn-account', foot);
  $('.hx-avatar', me).innerHTML = ui.icon('user');
  $('#hx-account-name', me).textContent = U.name;
  me.setAttribute('aria-label', 'Account, ' + U.name);
  me.dataset['tip'] = U.name;
}

/** select a tab of the kit's Segmented without telling anyone (the state did it) */
export function selectTab(seg: HTMLElement, value: string): void {
  const items = [...seg.querySelectorAll<HTMLButtonElement>('.k7-seg__item')];
  items.forEach((b, i) => {
    const on = b.dataset['value'] === value;
    b.setAttribute('aria-selected', String(on));
    if (document.activeElement !== b) b.tabIndex = on ? 0 : -1;
    if (on) seg.style.setProperty('--i', String(i));
  });
}

/* ── the title pill: the open bot's orb (24), a room's stack, or a session's glyph, then the name ── */
export interface TitleLead { bot?: BotLike | null; members?: readonly BotLike[] | null; icon?: string | null }
let leadSig = '';
export function setTitle(name: string, lead: TitleLead, label: string): void {
  const pill = sh.el?.btnTitle;
  if (!pill) return;
  const sig = lead.members?.length ? 'm:' + lead.members.map((m) => m.id + (m.color ?? '') + (m.shape ?? '')).join() : lead.bot ? 'b:' + lead.bot.id + (lead.bot.color ?? '') + (lead.bot.shape ?? '') : 'i:' + (lead.icon ?? '');
  const nameEl = pill.querySelector('.k7-title__name');
  if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;
  if (sig !== leadSig) {
    leadSig = sig;
    const next = frag(kit.html.titlePill({ title: name, ...(lead.members?.length ? { members: lead.members } : lead.bot ? { bot: lead.bot } : lead.icon ? { icon: lead.icon } : {}) }));
    const old = pill.querySelector('.k7-title__name')?.previousElementSibling;
    if (old) old.remove();
    /* the lead's markup is written into the page (an orb made in a template and moved in is not painted by its worker) */
    const newLead = next.querySelector('.k7-title__name')?.previousElementSibling;
    if (newLead) pill.insertAdjacentHTML('afterbegin', newLead.outerHTML);
    pill.toggleAttribute('data-lead', !!newLead);
  }
  pill.setAttribute('aria-label', label);
}
