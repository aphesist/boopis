/* How a bot's id is made from the name it was given: lower case, letters, digits and hyphens only. One rule for the
   provider that creates the bot and for the new-bot form that tells you what the name will turn into. */
export const botIdBase = (name: string): string => String(name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'bot';
