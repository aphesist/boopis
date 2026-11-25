/* The v7 kit (DESIGN-SYSTEM.md v7 section 21): every component once, `kit.<name>(opts)` an element already wired and
   `kit.html.<name>(opts)` its markup as a string. Its stylesheet is kit-v7.css; it draws on a v7 root (`data-ui="v7"`,
   `kit.applyTheme`). Each component's root carries `data-kit="<Name>"`. The lab's stories are src/lab/stories/kit/. */
import { frag } from '../../core/dom';
import * as controls from './controls';
import * as inline from './inline';
import * as blocks from './blocks';
import * as thread from './thread';
import * as surfaces from './surfaces';
import { dock, DOCK_GEOMETRY } from './dock';
import { fire } from '../../core/dom';
import { layer } from '../layer';
import { glyph } from './util';
import { applyTheme, botFill, deriveAccent } from './theme';
import { markReveal, wire, wireHold, wireMenu } from './wire';
import { hide as hideNotice, notify } from './notify';

const html = {
  button: controls.button, iconButton: controls.iconButton, kbd: controls.kbd, chip: controls.chip, segmented: controls.segmented,
  selectorItem: controls.selectorItem, switch: controls.switchHTML, field: controls.field, tooltip: controls.tooltip,
  inlineChip: inline.inlineChip, mark: inline.mark, statusWord: inline.statusWord, badge: inline.badge, statusLine: inline.statusLine, avatar: inline.avatar,
  card: blocks.card, block: blocks.block, menu: blocks.menu, menuRow: blocks.menuRow, optionRow: blocks.optionRow, listRow: blocks.listRow, sectionHead: blocks.sectionHead,
  notice: blocks.notice, systemLine: blocks.systemLine, bubble: blocks.bubble, well: blocks.well, disclosure: blocks.disclosure, turnFoot: blocks.turnFoot,
  timeSeparator: blocks.timeSeparator, emptyState: blocks.emptyState, list: blocks.list,
  toolRow: thread.toolRow, askCard: thread.askCard, filesCard: thread.filesCard, queue: thread.queue, diffView: thread.diffView, composer: thread.composer,
  windowChrome: surfaces.windowChrome, titlePill: surfaces.titlePill, page: surfaces.page, pane: surfaces.pane, dialog: surfaces.dialog, rail: surfaces.rail, notch: surfaces.notch, dock
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
  return node;
}

export const kit = {
  html, ...factories, section: surfaces.section, dockGeometry: DOCK_GEOMETRY, wire, wireHold, wireMenu, markReveal, openMenu, closeMenu: () => layer.close(), applyTheme, deriveAccent, botFill, keyNames: controls.keyNames, variants: kitVariants, notify, hideNotice
};
export type Kit = typeof kit;
export type { ButtonOpts, IconButtonOpts, ChipOpts, SegmentedOpts, SegItem, SelectorItemOpts, SwitchOpts, FieldOpts, KbdOpts, TooltipOpts } from './controls';
export type { ChromeOpts, PageOpts, PaneOpts, DialogOpts, RailOpts, RailBot, NotchOpts } from './surfaces';
export type { DockOpts, DockBot, DockKind } from './dock';
export type { ToolRowOpts, AskCardOpts, AskAnswer, FilesCardOpts, FileRow, QueueOpts, DiffViewOpts, DiffLine, DiffComment, ComposerOpts, LineItem } from './thread';
export type { CardOpts, RowOpts, BlockOpts, MenuOpts, MenuEntry, MenuRowOpts, OptionRowOpts, ListRowOpts, ListOpts, SectionHeadOpts, NoticeOpts, SystemLineOpts, BubbleOpts, WellOpts, DisclosureOpts, StepOpts, TurnFootOpts, TimeSeparatorOpts, EmptyStateOpts } from './blocks';
export type { AvatarOpts, InlineChipOpts, MarkOpts, StatusWordOpts, BadgeOpts, StatusLineOpts } from './inline';
export type { NotifyOpts } from './notify';
export type { ThemeOpts, Mode as KitMode, AccentTokens } from './theme';
