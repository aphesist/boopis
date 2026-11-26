/* Settings › Keyboard: today's bindings (the keymap, `modules/shell/keymap.ts` KEYGROUPS), read only, one section per group, each row the
   action and its keys as the kit's key chips (alternatives with "or", a sequence with a quiet "then", a hold with "hold"). Rebinding is
   the keys' own pass (0.3.0); mod+/ opens the same list as a sheet to filter. No board draws the page: derived from board 14's rows. */
import { kit } from '@boopis/ui';
import { KEYGROUPS } from '../shell/keymap';
import { fill, pageEl } from './page';
import type { Page } from './page';
import { section } from './rows';

export function keyboardPage(): Page {
  const { el, body } = pageEl('keys', 'Keyboard');
  fill(body, KEYGROUPS.map(([group, rows]) => section(group, rows.map(([label, spec]) => ({ label, wrap: true, control: kit.html.kbdSpec(spec) })))).join('') +
    '<p class="k7-page__note">Keys shown for this computer. In a web browser a few belong to the browser (F6, and Alt+1 or Alt+2 on Linux); every action is also in the palette. Changing a key comes later.</p>');
  return { el };
}
