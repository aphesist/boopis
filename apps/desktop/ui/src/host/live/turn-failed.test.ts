import { describe, expect, it } from 'vitest';
import { engineDetails } from '../errors';
import { turnFailedCode, turnFailedWords } from './turn-failed';

const UNKNOWN = "⚠️ Unknown provider 'claude-subscription-directsdk-experimental'. Check 'hermes model' for available providers, or run 'hermes doctor' to diagnose config issues.";

describe('a failed bot turn, in boopis’s words', () => {
  it('says the bot cannot reach its model, with the next step, and keeps the engine’s words for Diagnostics', () => {
    const words = turnFailedWords('kai', UNKNOWN);
    expect(words).toMatch(/^kai can’t reach its model\. Check that you are signed in in Settings, Models/);
    expect(words).not.toMatch(/hermes/i);
    expect(engineDetails().some((d) => d.code === 'hx.bots.model_unreachable' && d.detail.includes('Unknown provider'))).toBe(true);
  });
  it('reads the engine’s reason code first, and the text only when there is none', () => {
    expect(turnFailedCode('whatever', 'provider_auth_or_access')).toBe('hx.bots.model_unreachable');
    expect(turnFailedCode('Unknown provider x', 'provider_server_error')).toBe('hx.bots.turn_failed');
    expect(turnFailedCode('HTTP 429 Too Many Requests')).toBe('hx.provider.rate_limited');
    expect(turnFailedCode('the provider said 401', 'not a code: a sentence')).toBe('hx.bots.model_unreachable');
    expect(turnFailedCode('member turn failed')).toBe('hx.bots.turn_failed');
    expect(turnFailedWords('nina', '', 'runtime_offline')).toBe('nina could not reply. Try again. If it keeps failing, the details are in Settings, General, Diagnostics.');
  });
});
