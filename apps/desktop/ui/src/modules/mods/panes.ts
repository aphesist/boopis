/* Panes and the band (docs/MODS.md section 3; 2b, the lead's decisions for conflict 32). A pane is a tab of the session's tools after
   their fixed tabs, at every width (below 900 the tools lie over the work, as the Diff does). The band shares the held or queued strip's
   slot over the composer: the kit's Queue (mod), a row per mod with its glyph and name, what it draws, and its fold. What a mod draws is
   the kit's ModView; what the person does comes back as `ui:mod` and goes to the mod by handler id. */
import { el } from '../../core/dom';
import { logger } from '../../core/log';
import { kit } from '@boopis/ui';
import type { ModBand, ModPane } from '../../data';
import { surface } from './surfaces';
import type { PanelTabs } from './surfaces';
import { ctl, dispatcher, sessionOf } from './ctl';

const log = logger('mods');
const paneById = (id: string): ModPane | undefined => ctl.s.panes.find((p) => p.id === id);
const frag = (html: string): HTMLElement => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild as HTMLElement; };

/** a mod's tree as the kit's ModView, wired, with what the person does going back to the mod; null when the renderer refuses it */
export function viewOf(tree: unknown, o: { surface: 'pane' | 'row' | 'band'; label?: string; refused: (reason: string) => void; sessionId?: string }): HTMLElement | null {
  const check = kit.modViewCheck(tree);
  if (!check.ok) { o.refused(check.reason); return null; }
  const root = kit.wire(frag(kit.html.modView({ tree, surface: o.surface, ...(o.label ? { label: o.label } : {}) })));
  const send = dispatcher(o.sessionId ?? sessionOf());
  root.addEventListener('ui:mod', (e) => { send((e as CustomEvent<{ type: 'ui.press' | 'ui.input' | 'ui.select' | 'ui.submit'; id: string; value?: string }>).detail); });
  return root;
}

/* ───────────── a pane's body: the tree, or what is true about it ───────────── */
function paneBody(p: ModPane): HTMLElement {
  const wrap = el('div', { class: 'ss-mod-pane' });
  const d = p.drawing;
  const line = (text: string): void => { wrap.innerHTML = kit.html.emptyState({ text }); };
  if (!d) { line('Waiting for ' + p.plugin + ' to draw this pane.'); return wrap; }
  if (d.kind === 'default') { line(p.plugin + ' hasn’t drawn this pane.'); return wrap; }
  const root = d.kind === 'tree' ? viewOf(d.tree, { surface: 'pane', label: p.title, refused: (r) => { log.warn(p.plugin + ': pane skipped, ' + r); } }) : null;
  if (!root) { line('This pane can’t be drawn.'); return wrap; }
  ctl.roots.set(p.id, root);
  wrap.append(root);
  return wrap;
}

/* ───────────── the tabs of the tools ───────────── */
/** what a mod's panes add to the tools (`PanelTabs`, surfaces.ts): the panel draws them after its fixed tabs (modules/session/details.ts)
    and asks again on every redraw */
export function panelTabs(): PanelTabs | null {
  const list = ctl.s.panes;
  if (!list.length) return null;
  if (ctl.active !== 'diff' && !list.some((p) => p.id === ctl.active)) ctl.active = 'diff';
  const p = ctl.active === 'diff' ? undefined : paneById(ctl.active);
  return {
    items: list.map((x) => ({ value: x.id, label: x.title, tip: x.plugin + ' mod' })),
    value: ctl.active, label: p ? p.title + ', ' + p.plugin + ' mod' : 'Diff', sig: p ? p.id + ':' + p.opens + ':' + JSON.stringify(p.drawing ?? null) : '',
    body: () => {
      ctl.roots.clear();
      return p ? paneBody(p) : null;
    },
    select: (id) => { ctl.active = id; onChange?.(); }
  };
}

/* ───────────── the band ───────────── */
/** the band's name: the mod the plugin named, or the one mod loaded */
const bandName = (b: ModBand): string | null => b.plugin ?? (ctl.s.plugins.length === 1 ? (ctl.s.plugins[0] ?? null) : null);
/** something a site's props depend on changed (a tab, the band's fold): the mods are told */
let onChange: (() => void) | null = null;
export const setOnChange = (fn: () => void): void => { onChange = fn; };

/** draws the band in its slot over the composer: the kit's Queue (mod), one row, what the mod draws and the fold */
export function drawBand(): void {
  const slot = surface.band;
  if (!slot) return;
  ctl.bandRoot = null;
  const b = ctl.s.band;
  if (!b) { slot.replaceChildren(); slot.hidden = true; return; }
  const name = bandName(b) ?? 'Mods';
  const q = kit.wire(frag(kit.html.queue({ variant: 'mod', mods: [{ name, html: '', open: ctl.bandOpen, label: bandName(b) ? name + ' mod' : 'Mods' }], attrs: { 'aria-label': 'Mods' } })));
  const d = b.drawing;
  const root = d.kind === 'tree' ? viewOf(d.tree, { surface: 'band', refused: (r) => { log.warn(name + ': band skipped, ' + r); } }) : null;
  ctl.bandRoot = root;
  if (root) q.querySelector('.k7-queue__body')?.append(root);
  q.addEventListener('ui:fold', (e) => {
    ctl.bandOpen = (e as CustomEvent<{ open: boolean }>).detail.open;
    onChange?.();
  });
  slot.replaceChildren(q);
  slot.hidden = false;
}

/** a tree changed and the structure did not: redraw the trees in place, keeping focus and the caret */
export function updateTrees(): void {
  for (const [id, root] of [...ctl.roots]) {
    if (!root.isConnected) { ctl.roots.delete(id); continue; }
    const p = paneById(id);
    if (p?.drawing?.kind === 'tree') kit.modViewUpdate(root, p.drawing.tree);
  }
  const b = ctl.s.band?.drawing;
  if (ctl.bandRoot?.isConnected && b?.kind === 'tree') kit.modViewUpdate(ctl.bandRoot, b.tree);
}

/** a pane that opens with `focus` comes forward: its tab, and the tools open on it */
export function bringForward(id: string): void {
  ctl.active = id;
  surface.openTools?.();
}
