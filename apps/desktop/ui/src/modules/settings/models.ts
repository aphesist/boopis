/* Settings › Models (board 14 names the page; its content is today's Models tab on the kit): the plan, governed mode and its heavy
   switches, the ladder, Providers (every lab's sign-in, key, runtime on this computer and endpoint of your own; `host/providers-view.ts`),
   Change models, then Voice and speech (`voice.ts`). In the page build there is no engine to ask: the plan says so and nothing else is
   offered. "find" types a lab's name into the provider search (the new session's "boopis needs a model"); "voice" scrolls to the voice
   section (the voice circle's "Set up voice"). */
import { kit } from '@boopis/ui';
import { logger } from '../../core/log';
import { settingsHost } from './host';
import { pageEl } from './page';
import type { Page } from './page';
import { mountVoice } from './voice';

const log = logger('settings-models');

export function modelsPage(): Page {
  const { el, body } = pageEl('models', 'Models');
  const models = document.createElement('div'), speech = document.createElement('div');
  models.className = 'hx-set__part'; speech.className = 'hx-set__part';
  body.append(models, speech);
  let tab: { refresh: () => Promise<void> } | null = null;
  const mounting = (settingsHost.desktop()
    ? import('../../host/models-tab').then((m) => m.mountModels(models, m.realModelsDeps(() => { (el.closest('dialog') as HTMLDialogElement | null)?.close(); })))
    : import('../../host/plan-view').then((m) => m.mountPlan(models))
  ).then((m) => { tab = m; }).catch((e: unknown) => { log.warn('the models tab did not mount', e); kit.notify('The models could not be read'); });
  const voice = mountVoice(speech);
  /** type into the provider search once it is there (it mounts on its own time) */
  const find = (name: string, tries = 40): void => {
    const q = models.querySelector<HTMLInputElement>('#hx-prov-q');
    if (q) { q.value = name; q.dispatchEvent(new Event('input', { bubbles: true })); q.scrollIntoView({ block: 'center' }); return; }
    if (tries > 0 && el.isConnected) setTimeout(() => { find(name, tries - 1); }, 100);
  };
  return {
    el,
    refresh: async () => { await mounting; await Promise.all([tab?.refresh(), voice.refresh()]); },
    reveal: async (o) => { if (o.find) find(o.find); if (o.focus === 'voice') { await voice.refresh(); voice.reveal(); } }
  };
}
