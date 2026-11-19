/* hypotaxis desktop UI: the entry. The order is the contract: styles first (one cascade), the web component, the
   data provider, the modules (each registers into its slot as it loads), then the shell boots and mounts them. */
import './styles';
import { ui } from './components';
import { startGlance } from './components/orb';
import { orbState, setupOrbs } from './components/orb-worker/host';
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
import { boot } from './modules/shell';

const log = logger('main');
/* where the engine can, the orbs draw in a worker (components/orb-worker); everywhere else the vendored element draws on this thread */
const orbs = setupOrbs();
/* the continuous corners: observe the document before anything is drawn (each module binds its own surfaces at import) */
ui.squircle.start();

async function start(): Promise<void> {
  await orbs;
  if (inTauri()) {
    /* first run: the host sets Hermes up for hypotaxis (plugin, settings, a key) before anything connects; a screen of its own, thin on purpose */
    const [{ runFirstRun }, { tauriSetupBridge }] = await Promise.all([import('./host/first-run'), import('./host/setup-bridge')]);
    await runFirstRun(tauriSetupBridge());
  }
  const provider = await selectProvider();
  setProvider(provider);
  await provider.ready;
  startGlance();
  ui.tooltip.enable();
  boot();
  if (__HX_TEST_API__) {
    /* the Playwright smoke and parity tests drive the app through this; it is compiled in only for `vite build --mode e2e` */
    (window as unknown as Record<string, unknown>)['__hx'] = { state, setState, on, emit, ui, theme: themeApi, dock: getDockApi, layout: getLayout, data: () => provider, orbs: orbState };
  }
}
start().catch((err: unknown) => {
  log.error('the app failed to start', err);
  void import('./host/notice').then((m) => { m.showStartupFailure(err); });
});
