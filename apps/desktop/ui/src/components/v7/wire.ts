/* The v7 kit's wiring: one registry of behaviours. Each component that has keyboard, focus or pointer behaviour keeps it in its folder's
   behaviour.ts; this file only says which elements get which behaviour, in a fixed order, and wires each element once
   (`wire(root)` wires every kit component under root). Events bubble and are cancelable where an action follows (events.ts):
   ui:change {value} (Segmented, Switch, Chip, a check Row), ui:commit (a hold finished), ui:toggle {open} (Disclosure, Card's danger
   zone, FilesCard, DiffView). State lives in ARIA and data attributes (R-state-2). */
import { wireRestOrb } from './avatar/behaviour';
import { wireHold } from './button/behaviour';
import { wireCheckRow, wireRowAction } from './card/behaviour';
import { wireChip } from './chip/behaviour';
import { wireCommandPalette } from './command-palette/behaviour';
import { wireComposer } from './composer/behaviour';
import { wireDisclosure } from './disclosure/behaviour';
import { paintDock } from './dock/behaviour';
import { wireHoverBar } from './hover-bar/behaviour';
import { wireTiles } from './tiles/behaviour';
import { wireInfo, wireMark } from './mark/behaviour';
import { wireMenu } from './menu/behaviour';
import { wireSegmented } from './segmented/behaviour';
import { wireSwitch } from './switch/behaviour';

/* which behaviours an element has: an element can carry two (a chip that holds) */
const WIRED = new WeakMap<Element, Set<string>>();
const once = (el: Element, key: string): boolean => { let s = WIRED.get(el); if (!s) WIRED.set(el, (s = new Set())); if (s.has(key)) return false; s.add(key); return true; };
/* the registry, in the order the behaviours are wired (an element that matches two gets both, in this order) */
const WIRES: ReadonlyArray<readonly [string, (el: HTMLElement) => void]> = [
  ['.k7-seg', wireSegmented],                                     /* segmented/ */
  ['.k7-switch', (el) => wireSwitch(el as HTMLButtonElement)],   /* switch/ */
  ['.k7-chip', (el) => wireChip(el as HTMLButtonElement)],       /* chip/ */
  ['[data-hold]', wireHold],                                      /* button/: a Button or Chip that holds */
  ['[data-disclose]', wireDisclosure],                            /* disclosure/: and every collapsed summary */
  ['[data-kit~="Menu"]', wireMenu],                               /* menu/ */
  ['[data-kit~="CommandPalette"]', wireCommandPalette],           /* command-palette/ */
  ['.k7-mark', wireMark],                                         /* mark/ */
  ['.k7-info', wireInfo],                                         /* mark/: an info label */
  ['.k7-composer', wireComposer],                                 /* composer/ */
  ['.k7-row[data-action]', wireRowAction],                        /* card/: a Row that is a control */
  ['.k7-row[data-check]', wireCheckRow],                          /* card/: a Row that is a checkbox */
  ['.k7-file[data-action]', wireRowAction],                       /* file-card/: a FileCard that opens */
  ['.k7-hoverbar', wireHoverBar],
  ['.k7-tiles[data-variant="goals"]', wireTiles],                /* tiles/ */                                 /* hover-bar/ */
  ['.k7-dock', paintDock],                                        /* dock/ */
  ['.ui-orb[data-orb-rest]', wireRestOrb]                         /* avatar/: a bot at rest wakes under the pointer */
];
/** wire every kit component under root (and root itself) once */
export function wire<T extends Element>(root: T): T {
  for (const [sel, fn] of WIRES) {
    if (root.matches(sel) && once(root, sel)) fn(root as unknown as HTMLElement);
    for (const el of root.querySelectorAll<HTMLElement>(sel)) if (once(el, sel)) fn(el);
  }
  return root;
}
