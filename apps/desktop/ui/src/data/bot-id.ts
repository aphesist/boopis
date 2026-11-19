/* How a bot's id is made from the name it was given: lower case, letters, digits and hyphens only. One rule for the
   provider that creates the bot and for the new-bot form that tells you what the name will turn into. */
export const botIdBase = (name: string): string => String(name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'bot';
/** `base` with the lowest number from 2 that `inUse` does not know ("nova-2") */
export function numbered(base: string, inUse: (name: string) => boolean): string {
  let n = 2;
  while (inUse(base + '-' + n)) n++;
  return base + '-' + n;
}
