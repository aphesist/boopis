/* The v7 kit (DESIGN-SYSTEM.md v7 section 21): every component once, `kit.<name>(opts)` an element already wired and
   `kit.html.<name>(opts)` its markup as a string. Its stylesheet is kit-v7.css; it draws on a v7 root (`data-ui="v7"`,
   `kit.applyTheme`). Each component's root carries `data-kit="<Name>"`. The lab's stories are src/lab/stories/kit/. */
import { frag } from '../../core/dom';
import * as controls from './controls';
import * as inline from './inline';
import * as blocks from './blocks';
import * as thread from './thread';
import * as surfaces from './surfaces';
import { slabPath } from '../squircle-path';
import { dock, dockAsk, dockCap, dockMore, dockOrb, dockPanel, DOCK_GEOMETRY } from './dock';
import { fire } from '../../core/dom';
import { layer } from '../layer';
import { glyph } from './util';
import { applyTheme, botFill, deriveAccent } from './theme';
import { composerChips, composerInsert, composerInsertChip, composerMarks, composerMentions, composerRunning, markReveal, wire, wireHold, wireMenu } from './wire';
import { composerDictate, composerDictation as micSay, composerDropping, composerSet, composerUndo } from './compose';
import type { DictationState } from './compose';
import type { KitMentions } from './wire';
import { notify, notifyText } from './notify';

const html = {
  button: controls.button, iconButton: controls.iconButton, kbd: controls.kbd, chip: controls.chip, segmented: controls.segmented,
  selectorItem: controls.selectorItem, switch: controls.switchHTML, field: controls.field, tooltip: controls.tooltip,
  inlineChip: inline.inlineChip, mark: inline.mark, statusWord: inline.statusWord, badge: inline.badge, statusLine: inline.statusLine, avatar: inline.avatar,
  card: blocks.card, block: blocks.block, menu: blocks.menu, menuRow: blocks.menuRow, optionRow: blocks.optionRow, listRow: blocks.listRow, sectionHead: blocks.sectionHead,
  notice: blocks.notice, systemLine: blocks.systemLine, bubble: blocks.bubble, well: blocks.well, disclosure: blocks.disclosure, turnFoot: blocks.turnFoot, hoverBar: blocks.hoverBar,
  timeSeparator: blocks.timeSeparator, emptyState: blocks.emptyState, list: blocks.list,
  toolRow: thread.toolRow, askCard: thread.askCard, filesCard: thread.filesCard, fileCard: thread.fileCard, queue: thread.queue, diffView: thread.diffView, composer: thread.composer,
  windowChrome: surfaces.windowChrome, titlePill: surfaces.titlePill, page: surfaces.page, pane: surfaces.pane, dialog: surfaces.dialog, rail: surfaces.rail, sidebarFoot: surfaces.sidebarFoot, notch: surfaces.notch, dock
};
type Html = typeof html;
type Factories = { [K in keyof Html]: (o: Parameters<Html[K]>[0]) => HTMLElement };
const factories = Object.fromEntries(Object.entries(html).map(([k, fn]) => [k, (o: unknown) => wire(frag((fn as (x: unknown) => string)(o)))])) as Factories;

/** the variants each component offers, for the lab's stories */
export const kitVariants = {
  button: { variant: controls.BUTTON_VARIANTS, size: controls.BUTTON_SIZES },
  iconButton: { variant: controls.ICON_BUTTON_VARIANTS },
  chip: { variant: controls.CHIP_VARIANTS },
  segmented: { variant: controls.SEGMENTED_VARIANTS },
  selectorItem: { variant: controls.SELECTOR_VARIANTS },
  field: { kind: controls.FIELD_KINDS },
  avatar: { variant: inline.AVATAR_VARIANTS, size: inline.ORB_SIZES },
  inlineChip: { kind: inline.INLINE_KINDS },
  mark: { kind: inline.MARK_KINDS, state: inline.MARK_STATES },
  statusWord: { tone: inline.STATUS_TONES },
  statusLine: { kind: inline.STATUS_LINE_KINDS },
  card: { variant: blocks.CARD_VARIANTS },
  menu: { variant: blocks.MENU_VARIANTS },
  listRow: { variant: blocks.LIST_ROW_VARIANTS },
  notice: { place: blocks.NOTICE_PLACES, tone: blocks.NOTICE_TONES },
  systemLine: { variant: blocks.SYSTEM_LINE_VARIANTS },
  bubble: { kind: blocks.BUBBLE_KINDS },
  toolRow: { kind: thread.TOOL_KINDS, state: thread.TOOL_STATES },
  askCard: { variant: thread.ASK_VARIANTS, state: thread.ASK_STATES },
  composer: { kind: thread.COMPOSER_KINDS },
  windowChrome: { rail: surfaces.CHROME_RAILS, search: surfaces.SEARCH_SHOWS },
  dock: { kind: ['row', 'compact', 'open'] as const }
} as const;

/** a Menu opened against an anchor: one open at a time, placed by place.ts, Esc or an outside press closes it and focus returns
    (layer.ts); choosing a row fires ui:select {value} on the menu (cancelable) and closes it, a quick menu's check toggles in place */
function openMenu(anchor: HTMLElement, o: blocks.MenuOpts & { place?: 'above' | 'below'; align?: 'start' | 'end' | 'center'; onSelect?: (value: string) => void }): HTMLElement | null {
  const node = wire(frag(blocks.menu({ ...o, attrs: { ...(o.attrs ?? {}), 'data-floating': '' } })));
  if (!layer.open(anchor, node, { place: o.place, align: o.align })) return null;
  node.addEventListener('click', (e) => {
    const r = (e.target as Element).closest<HTMLElement>('[data-kit~="MenuRow"], [data-kit~="OptionRow"]');
    if (!r || r.getAttribute('aria-disabled') === 'true') return;
    const value = r.dataset['value'] ?? '';
    if (!fire(node, 'ui:select', { value }, true)) return;
    o.onSelect?.(value);
    if (r.getAttribute('role') === 'menuitemcheckbox') { const on = r.getAttribute('aria-checked') !== 'true'; r.setAttribute('aria-checked', String(on)); const c = r.querySelector('.k7-mrow__check'); if (c) c.innerHTML = on ? glyph('check') : ''; return; }
    layer.close();
  });
  (node.querySelector<HTMLElement>('[aria-checked="true"]') ?? node.querySelector<HTMLElement>('[data-kit~="MenuRow"], [data-kit~="OptionRow"]'))?.focus({ preventScroll: true });
  tipCutRows(node);
  return node;
}
/** a row whose second words are cut where the row ends (a MenuRow's description, an OptionRow's meaning) says them whole in its tooltip:
    nothing a menu says is lost to its width. A row that has a tooltip of its own keeps it */
function tipCutRows(menu: HTMLElement): void {
  for (const d of menu.querySelectorAll<HTMLElement>('.k7-mrow__desc, .k7-orow__meaning')) {
    const row = d.closest<HTMLElement>('[data-kit~="MenuRow"], [data-kit~="OptionRow"]');
    if (row && !row.dataset['tip'] && d.scrollWidth > d.clientWidth + 1) { row.dataset['tip'] = d.textContent ?? ''; row.dataset['tipPos'] = 'right'; }
  }
}

/** a Notice opened against an anchor: what a control that cannot act yet needs, in one line, with the one action that gets there (the
    voice circle with no voice model: "Set up voice"). It is the Menu's layer: one open at a time, Esc or an outside press closes it and
    focus returns to the anchor. The action closes it and calls `onAction` */
function openNotice(anchor: HTMLElement, o: Pick<blocks.NoticeOpts, 'text' | 'title' | 'icon' | 'tone'> & { /** the one way on; without it the Notice only says */ action?: string; label?: string; place?: 'above' | 'below'; align?: 'start' | 'end' | 'center'; onAction?: () => void }): HTMLElement | null {
  const node = wire(frag(blocks.notice({ text: o.text, title: o.title, icon: o.icon, tone: o.tone, place: 'floating', actions: o.action ? [{ label: o.action, value: 'act' }] : [], dismiss: true, attrs: { role: o.action ? 'dialog' : 'status', 'aria-label': o.label ?? o.title ?? o.text, 'data-floating': '' } })));
  if (!layer.open(anchor, node, { place: o.place ?? 'above', align: o.align ?? 'end' })) return null;
  node.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-dismiss]')) { layer.close(); return; }
    if (t.closest('[data-value="act"]')) { layer.close(false); o.onAction?.(); }
  });
  node.querySelector<HTMLElement>('[data-value="act"]')?.focus({ preventScroll: true });   /* a Notice with nothing to do only says (a status): the focus stays where it was */
  return node;
}
/** tell a composer what its dictation is doing, as the source reports it (compose.ts `DictationState`): the composer draws preparing,
    listening and the words arriving itself; an error switches its mic off and opens a Notice at the mic that says why in the
    source's own plain words, with "Try again" (it switches the mic on again) unless the source says trying again cannot help */
function composerDictation(c: HTMLElement, ev: DictationState): void {
  micSay(c, ev);
  if (ev.kind !== 'error') return;
  const mic = (c.matches('.k7-composer') ? c : c.querySelector<HTMLElement>('.k7-composer'))?.querySelector<HTMLElement>('[data-mic]');
  if (mic) openNotice(mic, { icon: 'mic', title: ev.reason, text: '', ...(ev.retry === false ? {} : { action: 'Try again', onAction: () => { composerDictate(c, true); } }) });
}

/** "@" in a composer names one of `src`'s entries, chosen from the kit's Menu over it (wire.ts composerMentions) */
/** the "@" list is placed against the composer's box, which is no control: the layer's aria-expanded does not belong on it (the list names itself) */
function unsaid(box: HTMLElement): void {
  if (box.dataset['unsaid'] != null) return;
  box.dataset['unsaid'] = '';
  new MutationObserver(() => { if (box.hasAttribute('aria-expanded')) box.removeAttribute('aria-expanded'); }).observe(box, { attributes: true, attributeFilter: ['aria-expanded'] });
}
const mentions = (c: HTMLElement, src: KitMentions): void => {
  composerMentions(c, src, (anchor, o) => { unsaid(anchor); const m = openMenu(anchor, { label: o.label, entries: o.entries as blocks.MenuOpts['entries'], place: 'above', align: 'start', onSelect: o.onSelect }); anchor.removeAttribute('aria-expanded'); return m; }, () => { layer.close(); });
};

export const kit = {
  html, ...factories, composerInsert, composerInsertChip, composerChips, composerMarks, composerRunning, composerSet, composerUndo, composerDropping, composerDictation, composerDictate, hoverBeside: blocks.hoverBeside, mentions, section: surfaces.section, dockGeometry: DOCK_GEOMETRY,
  /** the Dock's parts as markup, for the app's live dock, which keeps its orbs connected and writes each part in place */
  dockParts: { slab: slabPath, orb: dockOrb, cap: dockCap, ask: dockAsk, more: dockMore, panel: dockPanel }, wire, wireHold, wireMenu, markReveal, openMenu, openNotice, closeMenu: () => layer.close(), applyTheme, deriveAccent, botFill, notify, notifyText, keyNames: controls.keyNames, variants: kitVariants
};
export type Kit = typeof kit;
export type { ButtonOpts, IconButtonOpts, ChipOpts, SegmentedOpts, SegItem, SelectorItemOpts, SwitchOpts, FieldOpts, KbdOpts, TooltipOpts } from './controls';
export type { ChromeOpts, ChromeParts, PageOpts, PaneOpts, DialogOpts, RailOpts, RailBot, RailGroup, SidebarFootOpts, NotchOpts } from './surfaces';
export type { DockOpts, DockBot, DockKind } from './dock';
export type { ToolRowOpts, AskCardOpts, AskAnswer, FilesCardOpts, FileCardOpts, FileRow, QueueOpts, DiffViewOpts, DiffLine, DiffComment, ComposerOpts, LineItem } from './thread';
export type { CardOpts, RowOpts, BlockOpts, MenuOpts, MenuEntry, MenuRowOpts, OptionRowOpts, ListRowOpts, ListOpts, SectionHeadOpts, NoticeOpts, SystemLineOpts, BubbleOpts, WellOpts, DisclosureOpts, StepOpts, TurnFootOpts, HoverBarOpts, HoverAction, TimeSeparatorOpts, EmptyStateOpts } from './blocks';
export type { AvatarOpts, InlineChipOpts, MarkOpts, StatusWordOpts, BadgeOpts, StatusLineOpts } from './inline';
export type { NotifyOpts } from './notify';
export type { DictationState, DictationPhase } from './compose';
export type { KitMentions, ComposerChip, ComposerMark } from './wire';
export type { ThemeOpts, Mode as KitMode, AccentTokens } from './theme';
