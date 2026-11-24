/* The v7 kit (DESIGN-SYSTEM.md v7 section 21): every component once, `kit.<name>(opts)` an element already wired and
   `kit.html.<name>(opts)` its markup as a string. Its stylesheet is kit-v7.css; it draws on a v7 root (`data-ui="v7"`,
   `kit.applyTheme`). Each component's root carries `data-kit="<Name>"`. The lab's stories are src/lab/stories/kit/. */
import { frag } from '../../core/dom';
import * as controls from './controls';
import { applyTheme, botFill, deriveAccent } from './theme';
import { wire, wireHold, wireMenu } from './wire';

const html = {
  button: controls.button, iconButton: controls.iconButton, kbd: controls.kbd, chip: controls.chip, segmented: controls.segmented,
  selectorItem: controls.selectorItem, switch: controls.switchHTML, field: controls.field, tooltip: controls.tooltip
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
  field: { kind: controls.FIELD_KINDS }
} as const;

export const kit = {
  html, ...factories, wire, wireHold, wireMenu, applyTheme, deriveAccent, botFill, keyNames: controls.keyNames, variants: kitVariants
};
export type Kit = typeof kit;
export type { ButtonOpts, IconButtonOpts, ChipOpts, SegmentedOpts, SegItem, SelectorItemOpts, SwitchOpts, FieldOpts, KbdOpts, TooltipOpts } from './controls';
export type { ThemeOpts, Mode as KitMode, AccentTokens } from './theme';
