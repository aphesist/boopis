/* boopis desktop UI: the entry. The order is the contract: styles first (one cascade), the web component, the
   data provider, the modules (each registers into its slot as it loads), then the shell boots and mounts them. */
import './styles';
import '../vendor/boopis-logo.js';
import { card, kit, popover, scrollEdges, squircle, tooltip } from '@boopis/ui';
import { notifyWhenReady } from './modules/shell/notices';
import { startGlance } from '@boopis/ui';
import { orbState, setupOrbs } from '@boopis/ui';
import { logger } from './core/log';
import { getDockApi } from './core/registry';
import { getLayout, setState, state } from './core/state';
import { emit, on } from './core/bus';
import { setProvider } from './data';
import { selectProvider } from './data/select';
import { inTauri } from './host/bridge';
import { themeApi } from './styles/theme';
import './modules/cards';
import './modules/session';
import './modules/bots';
import './modules/dock';
import './modules/mods';
import { boot } from './modules/shell';

const log = logger('main');
/* where the engine can, the orbs draw in a worker (components/orb-worker); everywhere else the vendored element draws on this thread */
const orbs = setupOrbs();
/* the continuous corners: observe the document before anything is drawn (each module binds its own surfaces at import) */
squircle.start();
scrollEdges.start();

/* the watchdog's and the engine update's notices wait for the shell (`notifyWhenReady`): a notice shown while the app is still
   booting has no work to sit over. The update's may offer an action (Set up) */
type NoticeAction = { label: string; onClick: () => void };
function noticeWhenReady(text: string, action?: NoticeAction): void { notifyWhenReady(text, { ms: 8000, action }); }

async function start(): Promise<void> {
  await orbs;
  /* the host's watchdog hears from the page from the start (host/heartbeat.ts); after it reloaded a dead or stuck page, the first beat brings its one notice */
  if (inTauri()) void import('./host/heartbeat').then((m) => { m.startHeartbeat(noticeWhenReady); }).catch((e: unknown) => { log.warn('the heartbeat did not start', e); });
  if (inTauri()) {
    /* first run: the host sets Hermes up for boopis (plugin, settings, a key) before anything connects; a screen of its own, thin on purpose */
    const [{ runFirstRun }, { tauriSetupBridge }] = await Promise.all([import('./modules/onboarding/setup'), import('./host/setup-bridge')]);
    /* an install set up before gets this app's engine code by itself (no screen): its one line is listened for before the
       check that starts it, and waits for the shell; a failed update offers the setup screen's Set up */
    await import('./host/engine-update-notice').then((m) => m.listenEngineUpdates(noticeWhenReady, () => { void runFirstRun(tauriSetupBridge(), document.body, { autostart: true }); })).catch((e: unknown) => { log.warn('engine update notices are not listened for', e); });
    await runFirstRun(tauriSetupBridge(), document.body);
  }
  const provider = await selectProvider();
  setProvider(provider);
  await provider.ready;
  startGlance();
  tooltip.enable();
  boot();
  if (inTauri()) void import('./host/links').then((m) => m.wireExternalLinks(undefined, (e) => { kit.notify(e instanceof Error ? e.message : 'The link did not open'); }));
  if (inTauri()) void import('./host/connectors-notice').then((m) => m.listenConnectorRestarts()).catch((e: unknown) => { log.warn('connector notices are not listened for', e); });
  if (__HX_TEST_API__) {
    /* the Playwright smoke and parity tests drive the app through this; it is compiled in only for `vite build --mode e2e` */
    (window as unknown as Record<string, unknown>)['__hx'] = { state, setState, on, emit, card, squircle, popover, tooltip, theme: themeApi, dock: getDockApi, layout: getLayout, data: () => provider, orbs: orbState };
  }
}
start().catch((err: unknown) => {
  log.error('the app failed to start', err);
  void import('./host/notice').then((m) => { m.showStartupFailure(err); });
});
