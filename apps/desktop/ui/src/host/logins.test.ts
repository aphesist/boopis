/* The table of sign-in commands the UI checks a form against: the same file the host reads. */
import { describe, expect, it } from 'vitest';
import { knownLogins, loginFor, signinKnown } from './logins';

describe('the sign-in table', () => {
  it('has unique ids and a line to show for each; the only Claude one is the official CLI\'s own sign-in for the subscription', () => {
    const all = knownLogins();
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((l) => l.id)).size).toBe(all.length);
    for (const l of all) { expect(l.line.length).toBeGreaterThan(0); if (l.id !== 'claude-code') expect(`${l.id} ${l.line}`.toLowerCase()).not.toMatch(/claude|anthropic/); }
    expect(loginFor('claude-code')?.line).toBe('claude auth login --claudeai');
    expect(loginFor('claude-code')?.line, 'never the Console login, which bills API usage').not.toContain('--console');
    expect(loginFor('gcloud')?.line).toBe('gcloud auth login --brief');
    expect(loginFor('curl')).toBeNull();
    expect(loginFor(undefined)).toBeNull();
  });
  it('knows a sign-in by a connector or a provider id, and never by a command', () => {
    expect(signinKnown({ server: 'linear' })).toBe(true);
    expect(signinKnown({ provider: 'gcloud' })).toBe(true);
    expect(signinKnown({ provider: 'gcloud', command: 'gcloud' })).toBe(false);
    expect(signinKnown({ provider: 'gcloud', args: [] })).toBe(false);
    expect(signinKnown({ server: 'linear', command: 'x' })).toBe(false);
    expect(signinKnown({ provider: 'nope' })).toBe(false);
    expect(signinKnown({})).toBe(false);
  });
});
