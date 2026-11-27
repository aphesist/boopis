/* The look editor: a bot's colour and shape, changed after it exists (the owner, 22 November 2026: "there should be a way to
   edit their visual"). It is the "Look" section of the bot's settings sheet, with the new-bot sheet's Colour and Shape tabs
   and its dice (here the dice rolls a colour and a shape, never a name and never the eyes).

   A choice shows at once on every orb of the bot (the sheet's own orb, the room's header, the roster, the dock, a group's
   members: the kit's `repaintLook`) and is saved a moment later, when the choosing stops, through the same command the
   new-bot sheet saves a look with: the plugin's `bots.write` on a live bot (`admin.saveOwn`), the provider's `update` on
   the mock. The provider then sends the bot with its new look and every place keeps it. A bot made outside boopis gets its
   store on that first save, and its "made outside" mark goes. A save that fails puts the saved look back everywhere and
   says why under the picker. */
import { el } from '../../core/dom';
import { announce, kit, lookOf, repaintLook, rollLook } from '@boopis/ui';
import { data } from '../../data';
import type { Bot } from '../../data';
import { lookPicker, lookWords, offeredShapes } from './look-picker';
import type { LookValue } from './look-picker';
import { bot, S } from './model';

const SAVE_AFTER = 400;
const sentence = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** saves a look through the provider: resolves when it is kept */
export function saveLook(id: string, look: LookValue): Promise<void> {
  const admin = data().bots.admin;
  if (admin) return admin.saveOwn(id, { look: { shape: look.shape, color: look.color } });
  data().bots.update(id, { look: { shape: look.shape, color: look.color } });
  return Promise.resolve();
}

export interface LookEditor { kids: HTMLElement[]; meta: string }
/** the parts of the Look section for `b`; `onMeta` is told the section's new words ("mint circle") */
export function lookEditor(b: Bot, onMeta: (words: string) => void): LookEditor {
  const saved = (): LookValue => lookOf(bot(b.id) ?? b);
  const dice = kit.iconButton({ icon: 'dice', label: 'Surprise me with a colour and shape', tip: 'Surprise me', variant: 'ghost', attrs: { 'data-look-dice': '' } });
  const err = el('p', { class: 'bt-sheet__error', role: 'alert', hidden: true });
  let timer = 0, wanted: LookValue | null = null;

  const show = (look: LookValue): void => { repaintLook(document, b.id, look); onMeta(lookWords(look)); };
  function save(): void {
    const look = wanted; wanted = null;
    if (!look) return;
    const before = saved();
    if (look.shape === before.shape && look.color === before.color) return;
    saveLook(b.id, look).then(() => { err.hidden = true; }).catch((e: unknown) => {
      const back = saved();
      picker.set(back); show(back);
      err.textContent = 'boopis did not save its look: ' + sentence(e); err.hidden = false;
    });
  }
  /** a choice: shown everywhere now, saved when the choosing stops (arrow keys choose as they move) */
  function choose(look: LookValue): void {
    show(look);
    wanted = look; err.hidden = true;
    window.clearTimeout(timer); timer = window.setTimeout(save, SAVE_AFTER);
  }
  const picker = lookPicker({ value: saved(), class: 'bt-look--sheet', aside: dice, onPick: (_what, look) => choose(look) });
  dice.addEventListener('click', () => {
    const others = (S.bots.length ? S.bots : data().bots.snapshot().bots).filter((x) => x.id !== b.id).map((x) => lookOf(x));
    const look = rollLook({ shapes: offeredShapes(), taken: others, avoid: picker.value });
    picker.set(look); choose(look);
    announce('Look: ' + lookWords(look));
  });
  return {
    kids: [picker.el, err],
    meta: lookWords(saved())
  };
}
