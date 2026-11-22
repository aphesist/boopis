/* Where a scheduled job's result goes, in words (pure, unit-tested). The engine keeps it as one string, `deliver`: `local`
   (saved, sent nowhere), `origin` (back to where the job was made), a platform, or `room:<room id>[@<profile>]` (a message
   in a group's room; the profile, when given, is the one whose gateway hosts the room). Several targets are separated by commas.
   What this does not know is shown as it was written, never guessed at. */

/** one piece of the sentence: plain text, or a room the reader can open */
export type DeliveryPart = { text: string; room?: undefined } | { text: string; room: string };

const ROOM = /^room:([A-Za-z0-9][A-Za-z0-9._:-]*)(?:@([A-Za-z0-9_-]+))?$/i;

/** the targets of a `deliver` string, as parts of a sentence; `[]` when the job names none */
export function deliveryParts(
  deliver: string | null | undefined,
  rooms: ReadonlyArray<{ id: string; name: string }>,
  nameOf: (profile: string) => string = (p) => p
): DeliveryPart[] {
  const targets = (deliver ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  if (!targets.length) return [];
  const out: DeliveryPart[] = [];
  const add = (...p: DeliveryPart[]): void => { out.push(...p); };
  targets.forEach((t, i) => {
    add({ text: i === 0 ? '' : i === targets.length - 1 ? ' and ' : ', ' });
    const m = ROOM.exec(t);
    if (m) {
      const [, id = '', host] = m;
      const room = rooms.find((r) => r.id === id);
      const by = host ? ` (hosted by ${nameOf(host)})` : '';
      if (room) add({ text: (i === 0 ? 'posts to ' : '') }, { text: room.name, room: room.id }, { text: by });
      else add({ text: (i === 0 ? 'posts to ' : '') + t + ' (not one of your groups)' });
      return;
    }
    const word = t.toLowerCase();
    if (word === 'local') add({ text: (i === 0 ? 'saved on this computer, ' : '') + 'sent nowhere' });
    else if (word === 'origin') add({ text: (i === 0 ? 'replies ' : '') + 'where it was made' });
    else add({ text: (i === 0 ? 'delivers to ' : '') + t });
  });
  return out;
}

/** the same, as one line of text */
export const deliveryWords = (
  deliver: string | null | undefined,
  rooms: ReadonlyArray<{ id: string; name: string }>,
  nameOf?: (profile: string) => string
): string => deliveryParts(deliver, rooms, nameOf).map((p) => p.text).join('');
