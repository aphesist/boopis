import { describe, expect, it, vi } from 'vitest';
import { listenEngineUpdates } from './engine-update-notice';
import type { EngineUpdate, NoticeAction } from './engine-update-notice';

describe('the notice of an update the host made by itself', () => {
  it('shows the line it was given, and offers Set up only when the update failed', async () => {
    let send: (u: EngineUpdate) => void = () => undefined;
    const shown: Array<{ text: string; action: string | null }> = [];
    let offered: NoticeAction | undefined;
    const setUp = vi.fn();
    const stop = vi.fn();
    const off = await listenEngineUpdates((text, action) => { shown.push({ text, action: action?.label ?? null }); offered = action; }, setUp, (cb) => { send = cb; return Promise.resolve(stop); });
    send({ state: 'done', message: 'Updated the engine’s plugin to this version.' });
    send({ state: 'failed', message: 'boopis could not update the engine’s plugin, so it keeps using the earlier one. Choose Set up to try again.' });
    expect(shown).toEqual([
      { text: 'Updated the engine’s plugin to this version.', action: null },
      { text: 'boopis could not update the engine’s plugin, so it keeps using the earlier one. Choose Set up to try again.', action: 'Set up' }
    ]);
    offered?.onClick();
    expect(setUp).toHaveBeenCalledOnce();
    off();
    expect(stop).toHaveBeenCalled();
  });
});
