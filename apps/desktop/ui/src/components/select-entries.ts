/* A list's choices as data (what the session's model menu builds before the kit's Menu draws it): an option, or options under a header
   with a provider's mark. Data only: the v6 select and its listbox that drew them went at the repass's step 2a, and the kit's Menu draws
   every list (`kit.openMenu`). */
import type { ModelRef } from './model-mark';

type U<T> = T | undefined;

export interface SelectOption {
  value: string; label?: U<string>; desc?: U<string>; mono?: U<boolean>;
  /** a model: its provider's mark leads (brand colour: a list of models is the picker, design system 10.1) */
  model?: U<ModelRef>; icon?: U<string>; /** trusted markup that leads the label (an orb), drawn by the app and never by data */ lead?: U<string>;
  disabled?: U<boolean>; keys?: U<string>;
}
/** options under a header; the header may carry a provider's mark or an icon */
export interface SelectGroup { label: string; model?: U<ModelRef>; icon?: U<string>; options: readonly SelectOption[] }
export type SelectEntry = SelectOption | SelectGroup;

export const isGroup = (e: SelectEntry): e is SelectGroup => 'options' in e;
