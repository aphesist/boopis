/* Panes and the band (docs/MODS.md section 3; DESIGN-SYSTEM.md 14.29). A pane is a tab in the details panel from 1200px wide;
   below it the pane is inline above the composer, one open at a time and the others folded to a head. The band is one
   collapsible row above the composer. A mod's tree is drawn by `ui.modView`; what the user does goes back by handler id. */
import { $, el } from '../../core/dom';
import { logger } from '../../core/log';
import { ui } from '@boopis/ui';
import { modViewUpdate } from '@boopis/ui';
import type { ModRoot } from '@boopis/ui';
import type { ModBand, ModPane } from '../../data';
import { surface } from './surfaces';
import { ctl, dispatcher, docked, sessionOf } from './ctl';

const log = logger('mods');
const paneById = (id: string): ModPane | undefined => ctl.s.panes.find((p) => p.id === id);

/* ───────────── a pane's body: the tree, or what is true about it ───────────── */
function paneBody(p: ModPane, inline: boolean): HTMLElement {
  const wrap = el('div', { class: inline ? 'mod-inline__body ui-scroll' : 'mod-pane__body' });
  const d = p.drawing;
  if (!d) { wrap.append(el('p', { class: 'mod-note', text: 'Waiting for ' + p.plugin + ' to draw this pane.' })); return wrap; }
  if (d.kind === 'default') { wrap.append(el('p', { class: 'mod-note', text: p.plugin + ' has not drawn this pane.' })); return wrap; }
  const root = d.kind === 'tree' ? ui.modView(d.tree, { surface: inline ? 'inset' : 'frame', dispatch: dispatcher(sessionOf()), label: p.title, onInvalid: (r) => { log.warn(p.plugin + ': pane skipped, ' + r); } }) : null;
  if (!root) { wrap.append(el('p', { class: 'mod-note', text: 'This pane can’t be drawn. ' + p.plugin + ' sent a tree the renderer refused.' })); return wrap; }
  ctl.roots.set(p.id + (inline ? ':inline' : ':dock'), root);
  wrap.append(root);
  return wrap;
}
function closeButton(p: ModPane, inline = false): HTMLButtonElement {
  const close = ui.iconButton({ icon: 'close', label: 'Close ' + p.title, size: 's', class: inline ? 'ui-corner' : undefined });
  close.addEventListener('click', () => { closePane(p.id); });
  return close;
}
/** the user closes a pane: it leaves the UI (the mod is not told; Claude Code's `$.ui.close` is the mod's own) */
export function closePane(id: string): void {
  const p = paneById(id);
  if (p) hidden.set(id, p.opens);
  if (ctl.active === id) ctl.active = 'details';
  drawBand();
  surface.redrawRight?.();
  onChange?.();
}
/** panes the user closed, with the open they closed; a pane the mod opens again (a newer `mod.pane` open) comes back */
const hidden = new Map<string, number>();
const shown = (): ModPane[] => ctl.s.panes.filter((p) => hidden.get(p.id) !== p.opens);
export const dockedPanes = (): ModPane[] => (docked() ? shown() : []);
export const inlinePanes = (): ModPane[] => (docked() ? [] : shown());

function paneHead(p: ModPane, inline: boolean): HTMLElement {
  const head = el('div', { class: inline ? 'mod-inline__head' : 'mod-pane__head' });
  head.insertAdjacentHTML('beforeend', ui.html.mod(p.plugin));
  if (inline) {
    const open = !ctl.folded.get(p.id);
    const title = el('span', { class: 'mod-inline__title', text: p.title });
    const tog = ui.iconButton({ icon: 'chevron', label: (open ? 'Collapse ' : 'Expand ') + p.title, size: 's', expanded: open, tip: false });
    tog.classList.add('mod-chev', 'ui-corner');
    tog.addEventListener('click', () => {
      ctl.folded.set(p.id, open);
      if (!open) for (const o of inlinePanes()) if (o.id !== p.id) ctl.folded.set(o.id, true);   /* one open at a time, so the composer keeps the screen */
      drawBand();
      onChange?.();
      surface.slots?.band.querySelector<HTMLElement>('[data-pane="' + p.id + '"] .mod-chev')?.focus();
    });
    head.append(title, tog, closeButton(p, true));
  } else head.append(closeButton(p));
  return head;
}

/* ───────────── the tabs of the details panel ───────────── */
function tabs(list: readonly ModPane[]): HTMLElement {
  const bar = ui.tabs({ label: 'Session details and mod panes', class: 'mod-tabs', scroll: true, value: ctl.active, tabs: [
    { value: 'details', label: 'Details', id: 'mod-tab-details', ariaLabel: 'Session details' },
    ...list.map((p) => ({ value: p.id, label: p.title, labelHTML: ui.html.mod(p.title), id: 'mod-tab-' + p.id, ariaLabel: p.title + ', ' + p.plugin + ' mod', tip: p.plugin + ' mod' }))
  ] });
  /* the panel redraws with the chosen pane; keyboard focus follows the tab into the new strip */
  bar.addEventListener('ui:change', (e) => {
    const id = (e as CustomEvent<{ value: string }>).detail.value, focus = bar.contains(document.activeElement);
    ctl.active = id; surface.redrawRight?.();
    onChange?.();
    if (focus) requestAnimationFrame(() => { document.getElementById('mod-tab-' + id)?.focus(); });
  });
  return bar;
}

/** called by the session on every redraw of the details panel; null leaves the panel as it was */
export function decoratePanel(pnl: HTMLElement): HTMLElement | null {
  const list = dockedPanes();
  if (!list.length) return null;
  if (ctl.active !== 'details' && !list.some((p) => p.id === ctl.active)) ctl.active = 'details';
  const head = $('.ui-panel__head', pnl), body = $('.ui-panel__body', pnl);
  const bar = tabs(list);
  head.classList.add('mod-head'); head.replaceChildren(bar);
  /* the strip scrolls when the tabs do not fit: the library keeps the open tab in view and fades the cut edge */
  body.setAttribute('role', 'tabpanel'); body.setAttribute('aria-labelledby', 'mod-tab-' + ctl.active);
  body.addEventListener('scroll', () => { ctl.scroll[ctl.active] = body.scrollTop; }, { passive: true });
  for (const k of [...ctl.roots.keys()]) if (k.endsWith(':dock')) ctl.roots.delete(k);
  const p = ctl.active === 'details' ? undefined : paneById(ctl.active);
  if (p) {
    pnl.setAttribute('aria-label', p.title + ', ' + p.plugin + ' mod');
    const pane = el('div', { class: 'mod-pane' });
    pane.append(paneHead(p, false), paneBody(p, false));
    body.replaceChildren(pane);
  }
  requestAnimationFrame(() => { body.scrollTop = ctl.scroll[ctl.active] ?? 0; });
  return pnl;
}

/* ───────────── the band, and the inline panes of narrow windows ───────────── */
/** the band's one row: the mod, what it says, the fold */
function rowEl(b: ModBand): HTMLElement {
  const name = b.plugin ?? (ctl.s.plugins.length === 1 ? (ctl.s.plugins[0] ?? null) : null);
  const row = el('div', { class: 'mod-row', 'data-open': String(ctl.bandOpen), 'data-row': name ?? 'mods', role: 'group', 'aria-label': (name ? name + ' mod' : 'Mods') });
  const who = el('span', { class: 'mod-row__who', 'data-tip': name ? name + ' mod' : 'A mod of this session' });
  who.innerHTML = ui.html.mod(name ?? 'Mods');
  const body = el('div', { class: 'mod-row__body' });
  const d = b.drawing;
  const root = d.kind === 'tree' ? ui.modView(d.tree, { surface: 'inset', dispatch: dispatcher(sessionOf()), onInvalid: (r) => { log.warn((name ?? 'a mod') + ': band skipped, ' + r); } }) : null;
  ctl.bandRoot = root;
  if (root) body.append(root);
  const tog = ui.iconButton({ icon: 'chevron', label: (ctl.bandOpen ? 'Collapse ' : 'Expand ') + (name ?? 'mods'), size: 's', expanded: ctl.bandOpen, tip: false });
  tog.classList.add('mod-chev', 'ui-corner');
  tog.addEventListener('click', () => {
    ctl.bandOpen = !ctl.bandOpen;
    if (ctl.bandOpen && !docked()) for (const p of inlinePanes()) ctl.folded.set(p.id, true);
    drawBand();
    onChange?.();
    requestAnimationFrame(() => { surface.slots?.band.querySelector<HTMLElement>('.mod-row .mod-chev')?.focus(); });
  });
  row.append(who, body, tog);
  return row;
}
/** something a site's props depend on changed (a tab, a fold, the band's collapse): the mods are told */
let onChange: (() => void) | null = null;
export const setOnChange = (fn: () => void): void => { onChange = fn; };

/** draws the band slot: inline panes (narrow windows) and the band row */
export function drawBand(): void {
  const slot = surface.slots?.band;
  if (!slot) return;
  for (const k of [...ctl.roots.keys()]) if (k.endsWith(':inline')) ctl.roots.delete(k);
  ctl.bandRoot = null;
  const kids: HTMLElement[] = [];
  const inl = inlinePanes();
  inl.forEach((p, i) => {
    if (!ctl.folded.has(p.id)) ctl.folded.set(p.id, i < inl.length - 1);
    const open = !ctl.folded.get(p.id);
    const sec = el('section', { class: 'mod-inline ui-nest', 'data-open': String(open), 'data-pane': p.id, 'aria-label': p.title + ', ' + p.plugin + ' mod' });
    sec.append(paneHead(p, true));
    if (open) sec.append(paneBody(p, true));
    kids.push(sec);
  });
  if (ctl.s.band) {
    const band = el('div', { class: 'mod-band ui-nest', role: 'region', 'aria-label': 'Mods' });
    band.append(rowEl(ctl.s.band));
    kids.push(band);
  }
  slot.replaceChildren(...kids);
}

/** a tree changed and the structure did not: redraw the trees in place, keeping focus and the caret */
export function updateTrees(): void {
  for (const [key, root] of [...ctl.roots]) {
    if (!root.isConnected) { ctl.roots.delete(key); continue; }
    const p = paneById(key.slice(0, key.lastIndexOf(':')));
    if (p?.drawing?.kind === 'tree') modViewUpdate(root, p.drawing.tree);
  }
  const b = ctl.s.band?.drawing;
  if (ctl.bandRoot?.isConnected && b?.kind === 'tree') modViewUpdate(ctl.bandRoot as ModRoot, b.tree);
}

/** a pane that opens with `focus` comes forward: the tab in the details panel (which opens), or the unfolded pane when inline */
export function bringForward(id: string): void {
  if (docked()) ctl.active = id;
  else { for (const p of inlinePanes()) ctl.folded.set(p.id, p.id !== id); }
}
