/* "Change models": ask setup's models question again, through the first run's model question (modules/onboarding/setup.ts). The host forgets the
   earlier choice (nothing in Hermes changes until the new one is made), then the view runs setup again, which stops at that
   question. Used from Settings > Models and from the free-tier limit notice's "choose another model". */
import { reopenModels, tauriSetupBridge } from './setup-bridge';
import type { SetupBridge } from './setup-bridge';

export interface ChangeModelsDeps {
  reopen: () => Promise<void>;
  /** show the first-run view over the app and resolve when the user is through it */
  run: (bridge: SetupBridge, opts: { autostart: boolean; title: string }) => Promise<void>;
  bridge: () => SetupBridge;
}

/** Resolves once the question is on screen; `done` resolves when the user is through it. A host that refuses to forget the
    choice rejects, and nothing is shown. */
export async function changeModels(deps?: Partial<ChangeModelsDeps>): Promise<{ done: Promise<void> }> {
  const reopen = deps?.reopen ?? reopenModels;
  const run = deps?.run ?? (async (bridge, opts) => { await (await import('../modules/onboarding/setup')).runFirstRun(bridge, document.body, opts); });
  const bridge = (deps?.bridge ?? tauriSetupBridge)();
  await reopen();
  return { done: run(bridge, { autostart: true, title: 'Change models' }) };
}
