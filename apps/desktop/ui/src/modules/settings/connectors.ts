/* Settings › Connectors (board 14 names the page): the connectors boopis's engine has, each with its state, its switch, Test, Sign in
   and Remove, boopis's collection and the other ways to add one, for the main profile or one bot (`host/connectors.ts`, on the kit since
   7a). The full Connectors page, with the store's item rows, is step 7b. In the page build there is no engine to ask: it says so. */
import { kit } from '@boopis/ui';
import { data } from '../../data';
import { emit } from '../../core/bus';
import { logger } from '../../core/log';
import { settingsHost } from './host';
import { fill, pageEl } from './page';
import type { Page } from './page';
import { closeDialog } from './page';

const log = logger('settings-connectors');

export function connectorsPage(): Page {
  const { el, body } = pageEl('connectors', 'Connectors');
  let view: { refresh: () => Promise<void> } | null = null;
  if (!settingsHost.desktop()) {
    fill(body, kit.html.emptyState({ text: 'Connectors are added in the desktop app. This page cannot reach boopis’s engine.' }));
    return { el };
  }
  const openStore = (): void => { closeDialog(el.closest('dialog')); emit('hx:open-store', { screen: 'browse' }); };
  const mounting = Promise.all([import('../../host/connectors'), import('../../host/connectors-bridge')])
    .then(([v, bridge]) => v.mountConnectors(body, { bridge: bridge.tauriConnectorsBridge(), bridgeFor: (bot) => bridge.tauriConnectorsBridge(bot), bots: () => data().bots.snapshot().bots.map((b) => ({ id: b.id, name: b.name })), toast: (t) => { kit.notify(t); }, openStore }))
    .then((m) => { view = m; })
    .catch((e: unknown) => { log.warn('the connectors did not mount', e); });
  return { el, refresh: async () => { await mounting; await view?.refresh(); } };
}
