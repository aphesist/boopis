/* Pane: its view (typed props to markup) and its contract. Its look is pane.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import type { BotLike } from '../../bot-state';
import { scrollClass } from '../../scroll';
import { orbHtml } from '../../orb';
import { kitStack } from '../avatar/avatar';
import { iconButton } from '../icon-button/icon-button';
import { segmented } from '../segmented/segmented';
import type { SegItem } from '../segmented/segmented';
import { esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Pane (3): details (356: a bot's, a room's, a session's) or tools (520, resizable: Diff, Files, Terminal, PR, + Side chat); open,
   closed, overlay under 900 ── */
export interface PaneOpts {
  variant?: U<'details' | 'tools' | 'session' | 'sheet'>; open?: U<boolean>; overlay?: U<boolean>; title?: U<string>; bot?: U<BotLike>; tab?: U<string>; sideChat?: U<boolean>;
  body?: U<string>; label?: U<string>; attrs?: U<Attrs>;
  /** details of a room: its members' stack (at 32, the orbs still) heads the pane in place of one orb, and there is no Activity |
      Library (a room has no library); no board draws a room's details (an owner question): it follows a bot's */
  members?: U<readonly BotLike[]>;
  /** `session` (board S40): the session's name with its overflow at the end (`more`: the menu's button, drawn only where the menu holds
      something), and under it where it works: the folder and the branch, in mono */
  folder?: U<string>; branch?: U<string>; more?: U<boolean>;
  /** `tools`: false draws the one tool there is alone, with no strip of tabs (S24's Diff until a second tab exists); `summary` (markup)
      then stands where the tabs would, before the close button */
  tabs?: U<boolean>; summary?: U<string>;
  /** `tools` (2b, the lead's decision for conflict 32): which of the four fixed tabs this screen has (all four unless said; a tab whose
      feature does not exist yet is not drawn), and the tabs after them (a mod's pane, named by its title, its mod in the tip) */
  fixed?: U<readonly ('diff' | 'files' | 'terminal' | 'pr')[]>; extra?: U<readonly SegItem[]>;
  /** `details` and `session`: what else shares the pane, as tabs over its head (a mod's pane beside the session's details) */
  strip?: U<{ label: string; items: readonly SegItem[]; value: string }>;
  /** `sheet` (a bot's settings, 2a: no board draws it, the nearest drawn state is S40's head): its actions at the foot, as kit Buttons'
      markup (Archive, Delete…, Done); the head holds the title and the close (`data-pane-close`, `closeLabel`, `closeKeys`) */
  foot?: U<string>; closeLabel?: U<string>; closeKeys?: U<string>;
}
export function pane(o: PaneOpts): string {
  const v = o.variant ?? 'details';
  const a = kitAttrs('Pane', { 'data-variant': v, 'data-open': o.open === false ? null : '', 'data-overlay': o.overlay ? '' : null, role: 'complementary', 'aria-label': o.label ?? (v === 'tools' ? 'Tools' : 'Details'), ...(o.attrs ?? {}) });
  const body = '<div class="k7-pane__body">' + (o.body ?? '') + '</div></aside>';
  if (v === 'tools') {
    const four: SegItem[] = [{ value: 'diff', label: 'Diff' }, { value: 'files', label: 'Files' }, { value: 'terminal', label: 'Terminal' }, { value: 'pr', label: 'PR' }];
    const tabs: SegItem[] = [...four.filter((t) => !o.fixed || (o.fixed as readonly string[]).includes(t.value)), ...(o.sideChat ? [{ value: 'chat', label: 'Side chat' }] : []), ...(o.extra ?? [])];
    return '<aside class="k7-pane"' + a + '><div class="k7-pane__grip" role="separator" aria-orientation="vertical" aria-label="Resize the tools" tabindex="0" aria-valuenow="520" aria-valuemin="356" aria-valuemax="900"></div>' +
      '<div class="k7-pane__tabs">' + (o.tabs === false ? '<div class="k7-pane__summary">' + (o.summary ?? '') + '</div>' : segmented({ label: 'Tools', items: tabs, value: o.tab ?? 'diff', variant: 'tabs' })) + '<span class="k7-grow"></span>' + iconButton({ icon: 'close', label: 'Close the tools', variant: 'tinted', attrs: { 'data-pane-close': '' } }) + '</div>' + body;
  }
  const strip = o.strip ? '<div class="k7-pane__tabs">' + segmented({ label: o.strip.label, items: o.strip.items, value: o.strip.value, variant: 'tabs' }) + '</div>' : '';
  if (v === 'sheet') {
    /* a settings sheet: the title at the start and the close at the end, a scrolling body, the actions at the foot */
    return '<aside class="k7-pane"' + a + '><div class="k7-pane__head"><div class="k7-pane__title"><h2 class="k7-pane__name">' + esc(o.title ?? '') + '</h2>' +
      iconButton({ icon: 'close', label: o.closeLabel ?? 'Close', variant: 'tinted', ...(o.closeKeys ? { keys: o.closeKeys } : {}), attrs: { 'data-pane-close': '' } }) + '</div></div>' +
      '<div class="k7-pane__body ' + scrollClass() + '">' + (o.body ?? '') + '</div>' + (o.foot ? '<div class="k7-pane__foot">' + o.foot + '</div>' : '') + '</aside>';
  }
  if (v === 'session') {
    const where = (o.folder ? glyph('folder') + '<span class="k7-mono k7-ell">' + esc(o.folder) + '</span>' : '') + (o.branch ? glyph('fork') + '<span class="k7-mono k7-ell">' + esc(o.branch) + '</span>' : '');
    return '<aside class="k7-pane"' + a + '>' + strip + (o.title === undefined ? '' : '<div class="k7-pane__head"><div class="k7-pane__title"><h2 class="k7-pane__name">' + esc(o.title) + '</h2>' +
      (o.more ? iconButton({ icon: 'more', label: 'More for this session', variant: 'tinted', haspopup: 'menu', attrs: { 'data-pane-more': '' } }) : '') + '</div>' +
      (where ? '<div class="k7-pane__where">' + where + '</div>' : '') + '</div>') + body;
  }
  if (o.members) {
    return '<aside class="k7-pane"' + a + '>' + strip + '<div class="k7-pane__head">' + kitStack(o.members, 32, { max: 6, surface: '--bg-pane' }) + '<h2 class="k7-pane__name">' + esc(o.title ?? '') + '</h2></div>' + body;
  }
  return '<aside class="k7-pane"' + a + '>' + strip + '<div class="k7-pane__head">' + (o.bot ? orbHtml({ ...o.bot, state: 'idle', attention: null }, { size: 64, live: true, motion: 'lively', mode: 'fixed', surface: '--bg-pane' }) : '') + '<h2 class="k7-pane__name">' + esc(o.title ?? '') + '</h2>' +
    segmented({ label: 'Details', items: [{ value: 'activity', label: 'Activity' }, { value: 'library', label: 'Library' }], value: o.tab ?? 'activity' }) + '</div>' + body;   /* no "More" in its corner: board 11 draws none there (the chrome's controls float over the pane's top) */
}

/** what Pane promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<PaneOpts>({
  name: 'Pane',
  folder: 'pane',
  layer: 'surface',
  summary: 'The right side: details (356: a bot\'s, a room\'s, a session\'s), the tools (520, resizable: Diff, Files, Terminal, PR, Side chat), or a settings sheet (its title, a scrolling body of sections, its actions at the foot). Open, closed, or an overlay under 900.',
  exports: ['pane'],
  props: {
    variant: 'details (the default), tools, session or sheet',
    open: 'false: closed',
    overlay: 'an overlay (under 900)',
    title: 'its name',
    bot: 'details: the bot whose orb heads it',
    tab: 'the tab chosen (Activity, Library; or a tool)',
    sideChat: 'tools: a Side chat tab',
    body: 'what it holds, as markup',
    label: 'its accessible name',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)',
    members: 'a room\'s details: its members\' stack heads it',
    folder: 'session: the folder it works in',
    branch: 'session: the branch',
    more: 'session: the overflow menu\'s button',
    tabs: 'tools: false draws the one tool alone, with no tabs',
    summary: 'tools without tabs: what stands where the tabs would',
    fixed: 'tools: which of the four fixed tabs this screen has (all four unless said)',
    extra: 'tools: the tabs after the fixed ones (a mod\'s pane)',
    strip: 'what else shares the pane, as tabs over its head',
    foot: 'sheet: its actions, as kit Buttons\' markup',
    closeLabel: 'sheet: the close button\'s name',
    closeKeys: 'sheet: the close button\'s keys'
  },
  events: [],
  states: ['data-variant', 'data-open', 'data-overlay'],
  parts: ['k7-pane__head', 'k7-pane__tabs', 'k7-pane__grip', 'k7-pane__body', 'k7-pane__foot'],
  tokens: [
    '--bg-pane', '--ctl-s', '--focus-w', '--fs-l', '--fs-s', '--fs-xs', '--gap-s', '--hair', '--hl', '--lh-l', '--lh-m', '--lh-s',
    '--lh-xs', '--pad-chrome', '--pad-pane-top', '--pad-pane-top-session', '--pane-sec-top', '--right-w', '--shadow-modal',
    '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--text', '--text-dim', '--tools-w'
  ],
  a11y: 'role="complementary" named Details or Tools; the tools\' grip is a focusable vertical separator with its value.',
  boards: ['11-botchat', 'S40-details']
});
