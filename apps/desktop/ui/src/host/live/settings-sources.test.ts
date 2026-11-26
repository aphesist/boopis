/* The live provider's Settings sources over fake host commands: the rules file read as the page reads it, every change sent with the
   revision, Keep mine through the host; speech: the model's words, the voice choice, and a key that goes to `secret_set` alone. */
import { describe, expect, it } from 'vitest';
import { liveRules, liveSpeech, rulesViewOf, voiceKeyService } from './settings-sources';
import type { SettingsCommands } from './settings-sources';

function commands(): SettingsCommands & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const rec = (name: string, out: unknown) => (...a: unknown[]): Promise<never> => { calls.push([name, ...a]); return Promise.resolve(out as never); };
  return {
    calls,
    rulesGet: rec('get', { rules: { revision: 4, rules: [{ id: 'default.secrets', type: 'ask', text: 'Ask before…', enabled: true, source: 'default', bots: null, kinds: ['reads'] }, { id: 'x_1', type: 'exception', state: 'draft', text: 'kai may…', source: 'card', bots: ['kai'], kinds: [], excepts: ['default.secrets'] }, { text: 'no id' }], removed_defaults: ['default.purchases'], reviewer: { mode: 'pinned', provider: 'gemini', model: 'flash' } }, reviewer_status: 'ok', changed_outside: true }),
    rulesPut: rec('put', { revision: 5, id: 'r_1' }), rulesSetEnabled: rec('enabled', { revision: 5 }), rulesRemove: rec('remove', { revision: 5, undo_token: 'tok' }),
    rulesUndo: rec('undo', { revision: 6 }), rulesRestoreDefaults: rec('restore', { revision: 6 }), rulesAcceptOutside: rec('accept', {}), rulesDiscardOutside: rec('discard', {}),
    rulesReviewerSet: rec('reviewer', { reviewer: {}, problems: ['nina: no engine'] }),
    dictationModel: rec('model', { id: 'base-q5_1', size: 59707625, state: 'fetching', done: 1000, failed: null, language: null }),
    dictationModelFetch: rec('fetch', { state: 'fetching' }), dictationModelDelete: rec('delete', { state: 'absent' }),
    voiceSettingsGet: rec('voiceGet', { provider: 'elevenlabs', local_url: null }), voiceSettingsSet: rec('voiceSet', { provider: 'local', local_url: 'http://127.0.0.1:8880/v1/audio/speech' }),
    secretSet: rec('secretSet', null), secretExists: rec('secretExists', true), secretDelete: rec('secretDelete', null)
  };
}
const plugin = (calls: unknown[][]) => (method: string, params: Record<string, unknown>): Promise<unknown> => { calls.push(['plugin', method, params]); return Promise.resolve(method === 'rules.kinds' ? { kinds: ['messages'] } : { candidates: [{ provider: 'gemini', model: 'flash', estimate_usd: 0.0002 }], unpriced: [{ provider: 'local', model: 'qwen' }] }); };

describe('the live rules source', () => {
  it('reads the file as the page does: rules (a draft marked), removed defaults, the reviewer, an outside change', async () => {
    const c = commands();
    const v = await liveRules({ commands: c, plugin: plugin(c.calls), onOutside: () => () => undefined }).get();
    expect(v.revision).toBe(4);
    expect(v.rules.map((r) => r.id)).toEqual(['default.secrets', 'x_1']);
    expect(v.rules[1]?.state).toBe('draft');
    expect(v.removedDefaults).toEqual(['default.purchases']);
    expect(v.reviewer).toEqual({ mode: 'pinned', provider: 'gemini', model: 'flash' });
    expect(v.changedOutside).toBe(true);
    expect(rulesViewOf(null).rules).toEqual([]);
  });
  it('sends every change with the revision read; Keep mine and the reviewer go through the host', async () => {
    const c = commands();
    const r = liveRules({ commands: c, plugin: plugin(c.calls), onOutside: () => () => undefined });
    expect(await r.put({ type: 'ask', text: 'Ask before x.' }, 4)).toEqual({ revision: 5, id: 'r_1' });
    expect(await r.remove('default.secrets', 5)).toEqual({ revision: 5, undo: 'tok' });
    await r.discardOutside();
    expect(await r.kinds('Ask before emailing.')).toEqual({ kinds: ['messages'] });
    expect((await r.reviewers()).map((x) => x.model)).toEqual(['flash', 'qwen']);
    expect(await r.setReviewer('auto', null)).toEqual(['nina: no engine']);
    expect(c.calls).toContainEqual(['put', { type: 'ask', text: 'Ask before x.' }, 4]);
    expect(c.calls).toContainEqual(['discard']);
    expect(c.calls).toContainEqual(['reviewer', 'auto', 'gemini', 'flash']);
  });
});

describe('the live speech source', () => {
  it('reads the model, and a key goes to the keychain under the voice provider\'s name and nowhere else', async () => {
    const c = commands();
    const s = liveSpeech(c);
    expect((await s.model()).state).toBe('fetching');
    await s.setKey('fish_audio', 'fa-key-123');
    const withKey = c.calls.filter((x) => JSON.stringify(x).includes('fa-key-123'));
    expect(withKey).toEqual([['secretSet', 'boopis.voice.fish_audio', 'api_key', 'fa-key-123']]);
    expect(voiceKeyService('elevenlabs')).toBe('boopis.voice.elevenlabs');
    const out = await s.setVoice({ provider: 'local', localUrl: 'http://127.0.0.1:8880/v1/audio/speech' });
    expect(out).toEqual({ provider: 'local', localUrl: 'http://127.0.0.1:8880/v1/audio/speech' });
    expect(s.ready.get()).toBe(true);
  });
});
