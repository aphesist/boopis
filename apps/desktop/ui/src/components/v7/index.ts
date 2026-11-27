/* The v7 kit (DESIGN-SYSTEM.md v7 section 21): every component once, `kit.<name>(opts)` an element already wired and
   `kit.html.<name>(opts)` its markup as a string. Its stylesheet is kit-v7.css; it draws on a v7 root (`data-ui="v7"`,
   `kit.applyTheme`). Each component's root carries `data-kit="<Name>"`. Each component is a folder (<name>/: its view and contract,
   behaviour.ts, its CSS, its stories and tests; docs/kit/RULES.md); this file is the barrel the app reaches them through, and the
   one place that composes several of them (a floating Menu or Notice, the composer's dictation and mentions). */
import { frag } from '../../core/dom';
import { slabPath } from '../squircle-path';
import { layer } from '../layer';
import { emit, on } from './events';
import { glyph } from './util';
import { wire } from './wire';
import { applyTheme, botFill, deriveAccent } from './theme/theme';
/* the components, in the kit's order (contract.ts LAYERS): controls, inline, rows, blocks, surfaces, the thread, the composer, the dock */
import { button, BUTTON_SIZES, BUTTON_VARIANTS } from './button/button';
import { wireHold } from './button/behaviour';
import { iconButton, ICON_BUTTON_VARIANTS } from './icon-button/icon-button';
import { kbd, kbdSpec, keyNames } from './kbd/kbd';
import { chip, CHIP_VARIANTS } from './chip/chip';
import { segmented, SEGMENTED_VARIANTS } from './segmented/segmented';
import { SELECTOR_VARIANTS, selectorItem, swatchDot } from './selector-item/selector-item';
import { switchHTML } from './switch/switch';
import { field, FIELD_KINDS } from './field/field';
import { tooltip } from './tooltip/tooltip';
import { swatches } from './swatches/swatches';
import { avatar, AVATAR_VARIANTS, ORB_SIZES } from './avatar/avatar';
import { INLINE_KINDS, inlineChip } from './inline-chip/inline-chip';
import { mark, MARK_KINDS, MARK_STATES } from './mark/mark';
import { markReveal } from './mark/behaviour';
import { STATUS_TONES, statusWord } from './status-word/status-word';
import { badge } from './badge/badge';
import { STATUS_LINE_KINDS, statusLine } from './status-line/status-line';
import { card, CARD_VARIANTS } from './card/card';
import { block } from './block/block';
import { menuRow } from './menu-row/menu-row';
import { optionRow } from './option-row/option-row';
import { menu, MENU_VARIANTS } from './menu/menu';
import type { MenuOpts } from './menu/menu';
import { wireMenu } from './menu/behaviour';
import { list, LIST_ROW_VARIANTS, listRow } from './list-row/list-row';
import { sectionHead } from './section-head/section-head';
import { notice, NOTICE_PLACES, NOTICE_TONES } from './notice/notice';
import type { NoticeOpts } from './notice/notice';
import { notify, notifyText } from './notice/notify';
import { SYSTEM_LINE_VARIANTS, systemLine } from './system-line/system-line';
import { bubble, BUBBLE_KINDS } from './bubble/bubble';
import { well } from './well/well';
import { disclosure, steps } from './disclosure/disclosure';
import { turnFoot } from './turn-foot/turn-foot';
import { hoverBar } from './hover-bar/hover-bar';
import { hoverBeside } from './hover-bar/behaviour';
import { findBar } from './find-bar/find-bar';
import { timeSeparator } from './time-separator/time-separator';
import { emptyState } from './empty-state/empty-state';
import { ASK_STATES, ASK_VARIANTS, askCard } from './ask-card/ask-card';
import { teamPlan } from './team-plan/team-plan';
import { TOOL_KINDS, TOOL_STATES, toolRow } from './tool-row/tool-row';
import { filesCard } from './files-card/files-card';
import { fileCard } from './file-card/file-card';
import { queue } from './queue/queue';
import { diffView } from './diff-view/diff-view';
import { composer, COMPOSER_KINDS } from './composer/composer';
import { composerChips, composerInsert, composerInsertChip, composerMarks, composerMentions, composerRunning } from './composer/behaviour';
import type { KitMentions } from './composer/behaviour';
import { composerDictate, composerDictation as micSay, composerDropping, composerSet, composerUndo } from './composer/editing';
import type { DictationState } from './composer/editing';
import { CHROME_RAILS, SEARCH_SHOWS, searchHint, titlePill, windowChrome } from './window-chrome/window-chrome';
import { page, section } from './page/page';
import { pane } from './pane/pane';
import { dialog } from './dialog/dialog';
import { rail } from './rail/rail';
import { sidebarFoot } from './sidebar-foot/sidebar-foot';
import { notch } from './notch/notch';
import { dock, dockAsk, dockCap, dockMore, dockOrb, dockPanel, DOCK_GEOMETRY } from './dock/dock';

const html = {
  button, iconButton, kbd, chip, segmented,
  selectorItem, switch: switchHTML, swatchDot, kbdSpec, field, tooltip, swatches,
  inlineChip, mark, statusWord, badge, statusLine, avatar,
  card, block, menu, menuRow, optionRow, listRow, sectionHead,
  notice, systemLine, bubble, well, steps, disclosure, turnFoot, hoverBar,
  timeSeparator, emptyState, list, findBar,
  toolRow, askCard, filesCard, fileCard, queue, diffView, composer, teamPlan,
  windowChrome, titlePill, searchHint, page, pane, dialog, rail, sidebarFoot, notch, dock
};
type Html = typeof html;
type Factories = { [K in keyof Html]: (o: Parameters<Html[K]>[0]) => HTMLElement };
const factories = Object.fromEntries(Object.entries(html).map(([k, fn]) => [k, (o: unknown) => wire(frag((fn as (x: unknown) => string)(o)))])) as Factories;

/** the variants each component offers, for the lab's stories */
export const kitVariants = {
  button: { variant: BUTTON_VARIANTS, size: BUTTON_SIZES },
  iconButton: { variant: ICON_BUTTON_VARIANTS },
  chip: { variant: CHIP_VARIANTS },
  segmented: { variant: SEGMENTED_VARIANTS },
  selectorItem: { variant: SELECTOR_VARIANTS },
  field: { kind: FIELD_KINDS },
  avatar: { variant: AVATAR_VARIANTS, size: ORB_SIZES },
  inlineChip: { kind: INLINE_KINDS },
  mark: { kind: MARK_KINDS, state: MARK_STATES },
  statusWord: { tone: STATUS_TONES },
  statusLine: { kind: STATUS_LINE_KINDS },
  card: { variant: CARD_VARIANTS },
  menu: { variant: MENU_VARIANTS },
  listRow: { variant: LIST_ROW_VARIANTS },
  notice: { place: NOTICE_PLACES, tone: NOTICE_TONES },
  systemLine: { variant: SYSTEM_LINE_VARIANTS },
  bubble: { kind: BUBBLE_KINDS },
  toolRow: { kind: TOOL_KINDS, state: TOOL_STATES },
  askCard: { variant: ASK_VARIANTS, state: ASK_STATES },
  composer: { kind: COMPOSER_KINDS },
  windowChrome: { rail: CHROME_RAILS, search: SEARCH_SHOWS },
  dock: { kind: ['row', 'compact', 'open'] as const }
} as const;

/** a Menu opened against an anchor: one open at a time, placed by place.ts, Esc or an outside press closes it and focus returns
    (layer.ts); choosing a row fires ui:select {value} on the menu (cancelable) and closes it, a quick menu's check toggles in place */
function openMenu(anchor: HTMLElement, o: MenuOpts & { place?: 'above' | 'below'; align?: 'start' | 'end' | 'center'; onSelect?: (value: string) => void }): HTMLElement | null {
  const node = wire(frag(menu({ ...o, attrs: { ...(o.attrs ?? {}), 'data-floating': '' } })));
  if (!layer.open(anchor, node, { place: o.place, align: o.align })) return null;
  node.addEventListener('click', (e) => {
    const r = (e.target as Element).closest<HTMLElement>('[data-kit~="MenuRow"], [data-kit~="OptionRow"]');
    if (!r || r.getAttribute('aria-disabled') === 'true') return;
    const value = r.dataset['value'] ?? '';
    if (!emit(node, 'ui:select', { value }, true)) return;
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
function openNotice(anchor: HTMLElement, o: Pick<NoticeOpts, 'text' | 'title' | 'icon' | 'tone'> & { /** the one way on; without it the Notice only says */ action?: string; label?: string; place?: 'above' | 'below'; align?: 'start' | 'end' | 'center'; onAction?: () => void }): HTMLElement | null {
  const node = wire(frag(notice({ text: o.text, title: o.title, icon: o.icon, tone: o.tone, place: 'floating', actions: o.action ? [{ label: o.action, value: 'act' }] : [], dismiss: true, attrs: { role: o.action ? 'dialog' : 'status', 'aria-label': o.label ?? o.title ?? o.text, 'data-floating': '' } })));
  if (!layer.open(anchor, node, { place: o.place ?? 'above', align: o.align ?? 'end' })) return null;
  node.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-dismiss]')) { layer.close(); return; }
    if (t.closest('[data-value="act"]')) { layer.close(false); o.onAction?.(); }
  });
  node.querySelector<HTMLElement>('[data-value="act"]')?.focus({ preventScroll: true });   /* a Notice with nothing to do only says (a status): the focus stays where it was */
  return node;
}
/** tell a composer what its dictation is doing, as the source reports it (composer/editing.ts `DictationState`): the composer draws preparing,
    listening and the words arriving itself; an error switches its mic off and opens a Notice at the mic that says why in the
    source's own plain words, with "Try again" (it switches the mic on again) unless the source says trying again cannot help */
function composerDictation(c: HTMLElement, ev: DictationState): void {
  micSay(c, ev);
  if (ev.kind !== 'error') return;
  const mic = (c.matches('.k7-composer') ? c : c.querySelector<HTMLElement>('.k7-composer'))?.querySelector<HTMLElement>('[data-mic]');
  if (mic) openNotice(mic, { icon: 'mic', title: ev.reason, text: '', ...(ev.retry === false ? {} : { action: 'Try again', onAction: () => { composerDictate(c, true); } }) });
}

/** "@" in a composer names one of `src`'s entries, chosen from the kit's Menu over it (composer/behaviour.ts composerMentions) */
/** the "@" list is placed against the composer's box, which is no control: the layer's aria-expanded does not belong on it (the list names itself) */
function unsaid(box: HTMLElement): void {
  if (box.dataset['unsaid'] != null) return;
  box.dataset['unsaid'] = '';
  new MutationObserver(() => { if (box.hasAttribute('aria-expanded')) box.removeAttribute('aria-expanded'); }).observe(box, { attributes: true, attributeFilter: ['aria-expanded'] });
}
const mentions = (c: HTMLElement, src: KitMentions): void => {
  composerMentions(c, src, (anchor, o) => { unsaid(anchor); const m = openMenu(anchor, { label: o.label, entries: o.entries as MenuOpts['entries'], place: 'above', align: 'start', onSelect: o.onSelect }); anchor.removeAttribute('aria-expanded'); return m; }, () => { layer.close(); });
};

export const kit = {
  html, ...factories, composerInsert, composerInsertChip, composerChips, composerMarks, composerRunning, composerSet, composerUndo, composerDropping, composerDictation, composerDictate, hoverBeside, mentions, section, dockGeometry: DOCK_GEOMETRY,
  /** the Dock's parts as markup, for the app's live dock, which keeps its orbs connected and writes each part in place */
  dockParts: { slab: slabPath, orb: dockOrb, cap: dockCap, ask: dockAsk, more: dockMore, panel: dockPanel }, wire, wireHold, wireMenu, markReveal, openMenu, openNotice, closeMenu: () => layer.close(), applyTheme, deriveAccent, botFill, notify, notifyText, keyNames, variants: kitVariants, on, emit
};
export type Kit = typeof kit;
export type { ButtonOpts } from './button/button';
export type { IconButtonOpts } from './icon-button/icon-button';
export type { KbdOpts } from './kbd/kbd';
export type { ChipOpts } from './chip/chip';
export type { SegmentedOpts, SegItem } from './segmented/segmented';
export type { SelectorItemOpts } from './selector-item/selector-item';
export type { SwitchOpts } from './switch/switch';
export type { FieldOpts } from './field/field';
export type { TooltipOpts } from './tooltip/tooltip';
export type { SwatchesOpts } from './swatches/swatches';
export type { ChromeOpts, ChromeParts } from './window-chrome/window-chrome';
export type { PageOpts } from './page/page';
export type { PaneOpts } from './pane/pane';
export type { DialogOpts } from './dialog/dialog';
export type { RailOpts, RailBot, RailGroup } from './rail/rail';
export type { SidebarFootOpts } from './sidebar-foot/sidebar-foot';
export type { NotchOpts } from './notch/notch';
export type { DockOpts, DockBot, DockKind } from './dock/dock';
export type { ToolRowOpts } from './tool-row/tool-row';
export type { AskCardOpts, AskAnswer } from './ask-card/ask-card';
export type { FilesCardOpts, FileRow } from './files-card/files-card';
export type { FileCardOpts } from './file-card/file-card';
export type { QueueOpts } from './queue/queue';
export type { DiffViewOpts, DiffLine, DiffComment } from './diff-view/diff-view';
export type { ComposerOpts, LineItem } from './composer/composer';
export type { TeamPlanOpts, PlanAction } from './team-plan/team-plan';
export type { CardOpts, RowOpts } from './card/card';
export type { BlockOpts } from './block/block';
export type { MenuOpts, MenuEntry } from './menu/menu';
export type { MenuRowOpts } from './menu-row/menu-row';
export type { OptionRowOpts } from './option-row/option-row';
export type { ListRowOpts, ListOpts } from './list-row/list-row';
export type { SectionHeadOpts } from './section-head/section-head';
export type { NoticeOpts } from './notice/notice';
export type { SystemLineOpts } from './system-line/system-line';
export type { BubbleOpts } from './bubble/bubble';
export type { WellOpts } from './well/well';
export type { DisclosureOpts, StepOpts } from './disclosure/disclosure';
export type { TurnFootOpts } from './turn-foot/turn-foot';
export type { HoverBarOpts, HoverAction } from './hover-bar/hover-bar';
export type { TimeSeparatorOpts } from './time-separator/time-separator';
export type { EmptyStateOpts } from './empty-state/empty-state';
export type { FindBarOpts } from './find-bar/find-bar';
export type { AvatarOpts } from './avatar/avatar';
export type { InlineChipOpts } from './inline-chip/inline-chip';
export type { MarkOpts } from './mark/mark';
export type { StatusWordOpts } from './status-word/status-word';
export type { BadgeOpts } from './badge/badge';
export type { StatusLineOpts } from './status-line/status-line';
export type { NotifyOpts } from './notice/notify';
export type { DictationState, DictationPhase } from './composer/editing';
export type { KitMentions, ComposerChip, ComposerMark } from './composer/behaviour';
export type { ThemeOpts, Mode as KitMode, AccentTokens } from './theme/theme';
export type { UiEvents, UiEventName } from './events';
export type { Contract, Layer } from './contract';
