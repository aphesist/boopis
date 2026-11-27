/* The startup notice (host/notice.ts): when the app cannot start, a layer over the whole window with the window's own title bar. */
import { showStartupFailure } from '../../../host/notice';
import type { ControlsLayout } from '../../../host/window';
import { emit } from '../../../core/bus';
import type { Render, State, Story } from '../../types';

/* The startup notice (host/notice.ts): when the app cannot start, a layer of the same kind as first run, with the same title bar. */
const notice = (message: string, code: string, layout?: ControlsLayout): Render => async ({ root, wait: pause }) => {
  showStartupFailure(Object.assign(new Error(message), code ? { code } : {}), { mount: root, retry: () => undefined });
  if (layout) emit('hx:window-controls', { layout });
  await pause(150);
};
const NS = (tags: State['tags'], render: Render, extra: Partial<State> = {}): State => ({ tags, render, scope: '.hx-notice', ...extra });
const startup: Story = {
  id: 'settings/startup-notice', title: 'Startup notice', area: 'settings', kind: 'surface', covers: ['surface:startup-notice'], mock: { url: '/v6/__index.html', note: 'the mock has no startup notice' },
  states: {
    'the engine did not answer': NS(['typical'], notice('The engine did not answer within 30 seconds. Check that nothing else is using boopis\'s folder, then try again.', 'hx.gateway.unreachable')),
    'without a code': NS(['variant'], notice('The window could not load its settings.', '')),
    'a long reason': NS(['long'], notice('src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded_idempotency_guard_v2_final.ts could not be read: permission denied (EACCES) while the engine started, and the second attempt stopped at the same file', 'hx.setup.runtime_unpack')),
    'close only (a tiling desktop)': NS(['variant'], notice('The engine did not answer within 30 seconds.', 'hx.gateway.unreachable', 'close')),
    'close, minimize, zoom (macOS)': NS(['variant'], notice('The engine did not answer within 30 seconds.', 'hx.gateway.unreachable', 'mac')),
    'title bar, close hovered': NS(['hover'], notice('The engine did not answer within 30 seconds.', 'hx.gateway.unreachable'), { force: [{ sel: '.hx-notice [data-win="close"]', state: 'hover' }] })
  }
};

export default startup;
