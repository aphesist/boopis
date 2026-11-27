/* Where "Open" on a receipt of "Always allow" goes (7a follow-ups, the lead's routing): the drafted exception names the bot it lets
   through (the plugin's `rules.draft` drafts it for the bot that asked), so it is finished in that bot's sheet, at its Approvals with
   the drafts first; a draft for every bot is finished in Settings › Approvals. The rules list says which, when Open is pressed; when it
   cannot be read, Settings › Approvals (where every draft can be reached from the bots' line). */
import { emit } from '../../core/bus';
import { data } from '../../data';
import type { Rule } from '../../data';
import { everyBot, isDraft, ofBot } from '../settings/rule-parts';

/** where a bot's draft is finished: its own sheet when a draft names it, else Settings (a draft for every bot, or none left) */
export function draftHome(rules: readonly Rule[], asker: { id: string; name: string } | null): 'bot' | 'settings' {
  return asker && rules.some((r) => isDraft(r) && !everyBot(r) && ofBot(r, asker)) ? 'bot' : 'settings';
}

export function openDraft(asker: { id: string; name: string } | null): void {
  const toSettings = (): void => { emit('hx:open-settings', { section: 'approvals', focus: 'drafts' }); };
  const src = data().rules;
  if (!src || !asker) { toSettings(); return; }
  src.get().then((v) => {
    if (draftHome(v.rules, asker) === 'settings') { toSettings(); return; }
    emit('hx:bot-select', { id: asker.id, from: 'receipt' });
    setTimeout(() => { emit('hx:bot-settings', { open: true, id: asker.id, section: 'approvals', from: 'receipt' }); }, 0);
  }, toSettings);
}
