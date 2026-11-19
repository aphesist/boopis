/* The tab bar: a row of plain tabs, the selected one on the --current fill (DESIGN-SYSTEM.md §14.21, the Settings head; the details
   panel's mod panes, §14.29). It is not the tabs pill (§14.3, `segmented({mode: 'tabs'})`), which slides a bone thumb in a track for
   two to four views; this one names sections and may hold more.
   Corners: a tab takes the corner radius of the band it sits on (`--r-corner`, DESIGN-SYSTEM.md §8.2, R-corner-5), so in a dialog's 30px corner band at a
   12px inset it is 18px, which on a 28px tab is a capsule, the same as the close button beside it; on a surface that declares no
   nesting it is --r-s. Wired by `hydrate()` (`data-ui="tabs"`): one tab stop, Left/Right, Home/End, a cancelable `ui:change` {value}. */
import { attrs, cx, esc } from '../core/dom';

type U<T> = T | undefined;

export interface TabDef {
  value: string;
  label: string;
  /** markup in place of the label's text (a mod's glyph and name); `label` still names it */
  labelHTML?: U<string>;
  ariaLabel?: U<string>;
  /** the tab's own id (the panel names it with aria-labelledby) and the panel it controls */
  id?: U<string>; controls?: U<string>;
  tip?: U<string>;
}
export interface TabsOpts {
  tabs: readonly TabDef[];
  value?: U<string | null>;
  label: string;
  /** a strip that scrolls sideways when the tabs do not fit, with a faded edge (no bar) and the open tab kept in view */
  scroll?: U<boolean>;
  class?: U<string>; id?: U<string>;
}
/** the variants the UI lab draws */
export const tabsVariants = { scroll: [false, true] } as const;

export function tabs(o: TabsOpts): string {
  const cur = o.tabs.some((t) => t.value === o.value) ? o.value : o.tabs[0]?.value;
  return '<div class="' + cx('ui-tabs', o.scroll && 'ui-tabs--scroll ui-scroll ui-scroll--x ui-scroll--bare', o.class) + '" role="tablist" data-ui="tabs"' + attrs({ id: o.id, 'aria-label': o.label }) + '>' +
    o.tabs.map((t) => {
      const on = t.value === cur;
      return '<button type="button" class="ui-tab" role="tab"' + attrs({ id: t.id, 'aria-controls': t.controls, 'aria-selected': String(on), tabindex: on ? null : '-1', 'aria-label': t.ariaLabel, 'data-value': t.value, 'data-tip': t.tip }) + '>' +
        (t.labelHTML ?? '<span>' + esc(t.label) + '</span>') + '</button>';
    }).join('') + '</div>';
}

/** keep the open tab of a scrolling strip in view and fade the edge that cuts the rest (read, then write: one frame) */
export function fitTabs(bar: HTMLElement): void {
  if (!bar.classList.contains('ui-tabs--scroll')) return;
  const t = bar.querySelector<HTMLElement>('[aria-selected="true"]');
  const sl = bar.scrollLeft, cw = bar.clientWidth, sw = bar.scrollWidth;
  const l = t ? t.offsetLeft - bar.offsetLeft : 0, w = t ? t.offsetWidth : 0;
  const to = t && l + w > sl + cw ? l + w - cw + 12 : sl;
  if (to !== sl) bar.scrollLeft = to;
  bar.toggleAttribute('data-more', to + cw < sw - 2);
}
