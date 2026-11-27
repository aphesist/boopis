/* Every component's variants, typed, in one place: the UI lab draws a story per combination (one axis at a time), and the guard keeps
   each list in step with the options its template takes. A variant here is a value of an option of `ui.html.<name>(opts)`; states
   (hover, focus, pressed, disabled) are the design system's (§14.35) and are drawn by the lab with the element's own attributes.
   Pure data: no DOM, no globals. */
import { keysVariants } from './kbd';
import { scrollVariants } from './scroll';
import { signinVariants } from './signin-button';
import { tabsVariants } from './tabs';

export const variants = {
  signinButton: signinVariants,
  button: { variant: ['secondary', 'primary', 'ghost'], size: ['m', 's'], keys: [false, true], disabled: [false, true] },
  iconButton: { size: [undefined, 's'], window: [false, true], pressed: [undefined, false, true], expanded: [undefined, false, true] },
  hold: { fill: ['dots', 'solid'] },
  switch: { checked: [false, true], disabled: [false, true] },
  segmented: { mode: ['tabs', 'radio'], size: [undefined, 's'], vertical: [false, true], fill: [false, true] },
  tabs: tabsVariants,
  chip: { mono: [false, true], option: [false, true], pressed: [undefined, false, true], haspopup: [undefined, 'menu'] },
  chipGroup: {},
  keys: keysVariants,
  badge: {},
  dot: { kind: ['run', 'attention', 'here', 'flag'], size: [undefined, 's'] },
  code: {},
  field: { kind: ['text', 'textarea', 'select', 'model'], mono: [false, true], raised: [false, true], error: [false, true] },
  input: { mono: [false, true], raised: [false, true], rows: [undefined, 3] },
  select: { mono: [false, true], raised: [false, true] },
  setRow: { hint: [false, true] },
  setSection: {},
  row: { sub: [false, true], current: [false, true], archived: [false, true], acts: [false, true] },
  section: { open: [false, true] },
  scroll: scrollVariants,
  empty: { mark: [false, true], action: [false, true] },
  tip: { keys: [false, true], state: [false, true] },
  ladder: { variant: ['line', 'list'], off: [false, true] },
  measure: { variant: ['strip', 'row', 'grid'] },
  progress: { determinate: [false, true] },
  entry: { kind: ['user', 'agent', 'bot', 'mod'] },
  disclosure: { expanded: [false, true] },
  modelMark: { color: ['mono', 'brand'] },
  orb: { size: [16, 24, 40], still: [false, true] }
} as const;
export type ComponentName = keyof typeof variants;
