/* Settings hands a bot to its own sheet (Settings › Bots' Open, Approvals' line of the bots with rules of their own): the dialog closes,
   the Bots tab opens the bot, and its sheet opens at the section named (its Approvals: drafts first). */
import { emit } from '../../core/bus';
import { closeDialog } from './page';

export function openBotSheet(from: Element | null, id: string, section?: string): void {
  closeDialog(from?.closest('dialog') ?? null);
  emit('hx:bot-select', { id, from: 'settings' });
  setTimeout(() => { emit('hx:bot-settings', { open: true, id, from: 'settings', ...(section ? { section } : {}) }); }, 0);
}
