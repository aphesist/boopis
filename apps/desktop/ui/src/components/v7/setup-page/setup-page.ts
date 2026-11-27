/* SetupPage: its view (typed props to markup) and its contract. Its look is setup-page.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { avatar } from '../avatar/avatar';
import { button } from '../button/button';
import { iconButton } from '../icon-button/icon-button';
import { attrs, esc, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── SetupPage (the first run's part (a), boards O-P01 to O-P04, O-X01, O-X03; ob3-screens.js `prePage`): the whole window before the
   app, no sidebar, composer, title pill or dock. The "oo" logomark leads, 44 over the heading (`mark: 'top'`) or at the hero's 96 in
   the scene (`'hero'`); one heading at 196, its lede under it; then what the step shows (a card 520 wide, or a scene); the actions
   at 640, stacked and 288 wide, or a status line in their place; a quiet way out at the foot's start; the window's glyphs ── */
export interface SetupAction { label: string; primary?: U<boolean>; /** what it is called to the app (data-setup) */ value: string; disabled?: U<boolean>; busy?: U<boolean> }
export interface SetupPageOpts {
  title: string; lede?: U<string>;
  /** where the logomark stands: over the heading, at the hero's size in the scene, or nowhere */ mark?: U<'top' | 'hero' | 'none'>;
  /** the logomark's state (thinking while a sign-in waits, sleeping) */ markState?: U<string>;
  /** what the step shows under the lede, as kit markup (a Card, a Block of OptionRows, a Composer) */ bodyHTML?: U<string>;
  /** the body is a scene of its own height (Try it's composer), not a card under the lede */ scene?: U<boolean>;
  /** a Notice over the body (offline), as kit markup */ noticeHTML?: U<string>;
  actions?: U<readonly SetupAction[]>;
  /** in place of the actions: what is happening, with its figure ("Getting boopis ready", "62%") */ status?: U<{ text: string; figure?: U<string> }>;
  /** the quiet way out at the foot's start ("Skip setup", "Finish later") */ skip?: U<{ label: string; value: string }>;
  /** the window's glyphs (off on a tiling desktop where the host draws none) */ windowControls?: U<boolean>;
  /** the app's handles on the window's glyphs (data-win), for the shell's controller */ windowParts?: U<{ group?: U<Attrs>; min?: U<Attrs>; max?: U<Attrs>; close?: U<Attrs> }>;
  attrs?: U<Attrs>;
}
export function setupPage(o: SetupPageOpts): string {
  const mark = o.mark ?? 'top', w = o.windowParts ?? {};
  const logo = avatar({ variant: 'logomark', label: 'boopis', ...(o.markState ? { state: o.markState } : {}) });
  const acts = o.status
    ? '<div class="k7-setup__status" role="status"><span class="k7-setup__working">' + esc(o.status.text) + '</span>' + (o.status.figure ? '<span class="k7-mono k7-setup__figure">' + esc(o.status.figure) + '</span>' : '') + '</div>'
    : (o.actions ?? []).map((a) => button({ label: a.label, variant: a.primary ? 'primary' : 'secondary', disabled: a.disabled || a.busy, attrs: { 'data-setup': a.value, 'aria-busy': a.busy ? 'true' : null } })).join('');
  return '<section class="k7-setup"' + kitAttrs('SetupPage', { 'aria-labelledby': 'k7-setup-title', 'data-mark': mark, 'data-scene': o.scene ? '' : null, ...(o.attrs ?? {}) }) + '>' +
    (mark === 'top' ? '<div class="k7-setup__mark"' + partAttrs('SetupMark') + '>' + logo + '</div>' : '') +
    '<h1 class="k7-setup__title" id="k7-setup-title">' + esc(o.title) + '</h1>' +
    (o.lede ? '<p class="k7-setup__lede">' + esc(o.lede) + '</p>' : '') +
    (o.noticeHTML ? '<div class="k7-setup__notice">' + o.noticeHTML + '</div>' : '') +
    (mark === 'hero' ? '<div class="k7-setup__scene" data-hero><div class="k7-setup__hero"' + partAttrs('SetupMark') + '>' + logo + '</div></div>' : '') +
    (o.bodyHTML ? '<div class="k7-setup__body"' + partAttrs('SetupBody') + '>' + o.bodyHTML + '</div>' : '') +
    '<div class="k7-setup__acts"' + partAttrs('SetupActions') + '>' + acts + '</div>' +
    (o.skip ? '<div class="k7-setup__skip">' + button({ label: o.skip.label, variant: 'ghost', attrs: { 'data-setup': o.skip.value } }) + '</div>' : '') +
    (o.windowControls === false ? '' : '<div class="k7-setup__wc" role="group" aria-label="Window"' + attrs(w.group ?? {}) + '>' +
      iconButton({ icon: 'minimize', label: 'Minimize', variant: 'ghost', attrs: w.min }) + iconButton({ icon: 'maximize', label: 'Maximize', variant: 'ghost', attrs: w.max }) +
      iconButton({ icon: 'close', label: 'Close window', variant: 'ghost', attrs: w.close }) + '</div>') +
    '</section>';
}

/** what SetupPage promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<SetupPageOpts>({
  name: 'SetupPage',
  folder: 'setup-page',
  layer: 'surface',
  summary: 'The first run\'s whole-window page before the app: the logomark, one heading and its lede, what the step shows, the actions stacked at 640 (or a status line), a quiet way out, the window\'s glyphs.',
  exports: ['setupPage'],
  props: {
    title: 'the heading',
    lede: 'one or two lines under it',
    mark: 'top (44 over the heading, the default), hero (96 in the scene) or none',
    markState: 'the logomark\'s state (thinking, sleeping)',
    bodyHTML: 'what the step shows, as kit markup',
    scene: 'the body is a scene with its own height (Try it), not a card',
    noticeHTML: 'a Notice over the body, as kit markup',
    actions: 'the buttons, stacked: each a label, primary or not, its value (data-setup), disabled, busy',
    status: 'in place of the actions: what is happening, and its figure',
    skip: 'the quiet way out at the foot\'s start: its label and value',
    windowControls: 'the window\'s glyphs (false on a tiling desktop)',
    windowParts: 'the app\'s handles on the window\'s glyphs (data-win)',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: [],
  states: ['data-mark', 'data-scene', 'aria-busy'],
  parts: ['SetupMark', 'SetupBody', 'SetupActions'],
  tokens: [
    '--bg-2', '--chrome-y', '--ctl', '--fs-3xl', '--fs-l', '--fs-m', '--fs-xs', '--gap-hair', '--lh-3xl', '--lh-l', '--setup-acts-w', '--setup-acts-y',
    '--setup-card-w', '--setup-gap', '--setup-head-y', '--setup-hero-h', '--setup-hero-logo', '--setup-hero-w', '--setup-lede-w', '--setup-mark-y',
    '--setup-scene-h', '--setup-scene-w', '--setup-skip-x', '--setup-skip-y', '--sp-1', '--sp-2', '--sp-3', '--sp-5', '--text', '--text-dim',
    '--text-strong', '--wc-h', '--wc-w'
  ],
  a11y: 'A region named by its heading; the actions are Buttons in reading order, the status a live region; the window\'s glyphs a group named Window.',
  boards: ['O-P01', 'O-P01b', 'O-P02', 'O-P03', 'O-P03b', 'O-P03c', 'O-P03d', 'O-P03e', 'O-P04d', 'O-P04c']
});
