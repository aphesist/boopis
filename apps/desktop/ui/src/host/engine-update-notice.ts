/* The host updates the engine's code by itself when that is all setup would do (setup::update in the host): no screen, and
   one line when it is done. If it failed, the earlier code is still in use and the line offers the setup screen's Set up. */
import { events } from './bindings';

export interface EngineUpdate { state: string; message: string }
export interface NoticeAction { label: string; onClick: () => void }

/** listen for the host's update notices; `show` puts one on screen, `setUp` opens the setup screen; returns the function that
    stops listening */
export async function listenEngineUpdates(
  show: (text: string, action?: NoticeAction) => void,
  setUp: () => void,
  listen: (cb: (u: EngineUpdate) => void) => Promise<() => void> = (cb) => events.engineUpdateEvent.listen((e) => { cb(e.payload); })
): Promise<() => void> {
  return listen((u) => {
    if (u.state === 'failed') show(u.message, { label: 'Set up', onClick: setUp });
    else show(u.message);
  });
}
