/* hypotaxis desktop UI: the entry. The order is the contract: styles first (one cascade), the web component, the
   data provider, the modules (each registers into its slot as it loads), then the shell boots and mounts them. */
import './styles';
import '../vendor/orb-avatar.min.js';
import { ui } from './components';
import { startGlance } from './components/orb';
import { logger } from './core/log';
import { getDockApi } from './core/registry';
import { getLayout, setState, state } from './core/state';
import { emit, on } from './core/bus';
import { setProvider } from './data';
import { selectProvider } from './data/select';
import { themeApi } from './styles/theme';
import './modules/cards';
import './modules/session';
import './modules/bots';
import './modules/dock';
import { boot } from './modules/shell';

const log = logger('main');

async function start(): Promise<void> {
  const provider = await selectProvider();
  setProvider(provider);
  await provider.ready;
  startGlance();
  ui.tooltip.enable();
  boot();
  if (__HX_TEST_API__) {
    /* the Playwright smoke and parity tests drive the app through this; it is compiled in only for `vite build --mode e2e` */
    (window as unknown as Record<string, unknown>)['__hx'] = { state, setState, on, emit, ui, theme: themeApi, dock: getDockApi, layout: getLayout };
  }
}
start().catch((err: unknown) => {
  log.error('the app failed to start', err);
  void import('./host/notice').then((m) => { m.showStartupFailure(err); });
});
