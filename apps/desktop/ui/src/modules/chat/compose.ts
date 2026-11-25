/* What a composer's own controls do, the same in a bot's chat, a room and a new session (the kit's Composer fires the events,
   wire.ts): "+" asks the host for files and sets each into the text as a chip whose words are its "@" reference, the way a typed path is read; the mic
   dictates into the text through the provider's dictation until it is switched off; "@" names what the screen offers. Talking
   to a bot (the voice button with no text) does not exist yet: the button is drawn and says so. */
import { kit } from '@boopis/ui';
import type { KitMentions } from '@boopis/ui';
import { data } from '../../data';

export const VOICE_NOT_YET = 'Talking with voice is not in this build yet';

export interface ComposeTools {
  /** who dictation is for (the open bot), null in a session */ botId(): string | null;
  /** what "@" names here; none when the screen has nothing to name */ mentions?: KitMentions;
}
/** wire the composer living in `slot` (redrawn in place: the listeners are the slot's, the mention menu each drawn composer's) */
export function composeTools(slot: HTMLElement, o: ComposeTools): { drawn(): void; stop(): void } {
  let cancel: (() => void) | null = null;
  const text = (): HTMLElement | null => slot.querySelector<HTMLElement>('.k7-composer__text');
  const stop = (): void => { cancel?.(); cancel = null; slot.querySelector('[data-mic]')?.setAttribute('aria-pressed', 'false'); };
  slot.addEventListener('ui:add', () => {
    void data().files.pick('file').then((files) => {
      const c = text(); if (!c || !files.length) return;
      c.focus();
      /* each file is a chip in the text (owner, 25 November; the boards' reference chip, S32): its name shows, its words are the "@" reference the engine reads */
      for (const f of files) kit.composerInsertChip(c, kit.html.inlineChip({ kind: 'reference', text: '@' + f.name, words: '@' + (f.path ?? f.name), attrs: { 'data-tip': f.path ?? f.name } }));
    });
  });
  slot.addEventListener('ui:dictate', (e) => {
    if (!(e as CustomEvent<{ on: boolean }>).detail.on) { cancel?.(); cancel = null; return; }
    cancel?.();
    cancel = data().dictation.start({ botId: o.botId() }, (heard) => { const c = text(); if (c) kit.composerInsert(c, heard); });
  });
  return {
    drawn() { stop(); const c = slot.querySelector<HTMLElement>('.k7-composer'); if (c && o.mentions) kit.mentions(c, o.mentions); },
    stop
  };
}
