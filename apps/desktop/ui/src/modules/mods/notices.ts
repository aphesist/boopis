/* A mod's notices (docs/MODS.md section 3; DESIGN-SYSTEM.md 14.29, owner decision of 19 November 2026; 2b: "mod notices are the kit
   Notice"): the app's floating Notice, led by the mod (its puzzle glyph and "name mod", then its words). One at a time behind the
   app's own, with a quiet "+N" while others wait; dismissing one (its ×, Esc inside it, or its action) shows the next at once. The
   queue is the kit's (kit.notify): a mod's notice waits its turn like any other. */
import { kit } from '@boopis/ui';

/** a mod's notice: shown now when nothing shows, else after those waiting */
export function modNotice(plugin: string, text: string, ms: number, action?: { label: string; onClick?: () => void }): void {
  kit.notify(' ' + text, { title: plugin + ' mod', icon: 'mod', ms, ...(action ? { action } : {}) });
}
