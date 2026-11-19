/* The "made outside boopis" mark (owner decision, 19 November 2026). Every Hermes profile except the default one is a bot, and
   the ones boopis did not make carry this small mark: the plugin read the profile's folder and found no `boopis/bot.json`
   (`Bot.madeOutside`). It sits in the roster row and in the bot's room header. A chip's capsule, mono 11 in the quiet ink, never
   a stamp (nothing is owed), never colour. It goes once any boopis setting is saved for the bot (the store exists then).
   The sentence is its tooltip and its accessible description; the visible words stay short and the row's name carries them. */
import { el, esc } from '../../core/dom';

export const OUTSIDE_LABEL = 'made outside boopis';
export const OUTSIDE_WORDS = 'Made outside boopis, for example on the command line. boopis keeps its look and settings once you change them here.';
/** what a roster row shows, and so what its accessible name holds (between the role and the state); the sentence below is its description */
export const OUTSIDE_SHORT = 'outside';

/** a visually hidden copy of the sentence for `aria-describedby`; one per surface, ids differ */
export const outsideDescription = (id: string): HTMLElement => el('span', { class: 'ui-sr', id, text: OUTSIDE_WORDS });

/** in a roster row (markup for the row's end slot; the row is a button, so the mark is not a control: the row's description carries the sentence) */
export const outsideRowMark = (): string => '<span class="bt-outside" data-outside data-tip="' + esc(OUTSIDE_WORDS) + '" data-tip-pos="right">' + OUTSIDE_SHORT + '</span>';

/** in the room's header: reachable by keyboard, so the tooltip shows on focus and a screen reader reads the sentence after the words */
export function outsideRoomMark(describedBy: string): HTMLElement {
  return el('span', { class: 'bt-outside', 'data-outside': '', role: 'note', tabindex: '0', 'data-tip': OUTSIDE_WORDS, 'aria-describedby': describedBy, text: OUTSIDE_LABEL });
}
