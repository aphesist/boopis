/* Settings › Bots (named in S39's nav; no board draws its page: derived). What a bot may spend and do is the bot's own: its cap and its
   tiers live in its settings sheet, and boopis keeps no default for new bots (rules-engine.md 12: no default caps; a bot's rows are
   Default, which follows the rules list). So the page lists the bots, each with its cap and its rule in a line, and opens that bot's
   own settings. A default cap or tiers for new bots is an owner question; nothing here invents one. */
import { emit } from '../../core/bus';
import { data, BOOPIS_ID } from '../../data';
import type { Bot } from '../../data';
import { kit } from '@boopis/ui';
import { fill, pageEl } from './page';
import type { Page } from './page';
import { closeDialog } from './page';
import { buttonHTML, section } from './rows';

/** a bot's line: its cap, governed or not, and how many kinds of action ask or are blocked (its tiers) */
export function botLine(b: Bot): string {
  const c = b.cfg, tiers = Object.values(c.approvals ?? {});
  const asks = tiers.filter((t) => t === 'ask').length, blocks = tiers.filter((t) => t === 'block').length;
  return [
    c.cap ? '$' + c.cap + ' a run' : 'No cap',
    c.gov === 'governed' ? 'Governed' : '',
    asks || blocks ? [asks ? asks + ' ' + (asks === 1 ? 'kind asks' : 'kinds ask') : '', blocks ? blocks + ' blocked' : ''].filter(Boolean).join(', ') : 'Follows your approval rules'
  ].filter(Boolean).join(' · ');
}

export function botsPage(): Page {
  const { el, body } = pageEl('bots', 'Bots');
  const draw = (): void => {
    const bots = data().bots.snapshot().bots.filter((b) => b.id !== BOOPIS_ID);
    fill(body, bots.length
      ? section('Your bots', bots.map((b) => ({ label: b.name, sub: botLine(b), control: buttonHTML('Open', { variant: 'ghost', attrs: { 'data-bot-open': b.id, 'aria-label': 'Open ' + b.name + '’s settings' } }) })), { 'data-part': 'bots' })
      : kit.html.emptyState({ text: 'No bots yet. A bot you make has its own cap and rules, set in its settings.' }));
  };
  draw();
  body.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-bot-open]');
    if (!b) return;
    const id = b.dataset['botOpen'] ?? '';
    closeDialog(body.closest('dialog'));
    emit('hx:bot-select', { id, from: 'settings' });
    setTimeout(() => { emit('hx:bot-settings', { open: true, from: 'settings' }); }, 0);
  });
  const off = data().bots.subscribe(() => { if (!body.contains(document.activeElement)) draw(); });
  return { el, refresh: async () => { draw(); }, destroy: () => { off(); } };
}
