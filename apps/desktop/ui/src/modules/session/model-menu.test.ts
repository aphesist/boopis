/* The menu the Governed chip opens when governed mode cannot run (ADR-0037): plain words, the allowed models, a way out. */
import { describe, expect, it } from 'vitest';
import type { ModelChoice } from '../../data/types';
import { SETTINGS_VALUE, governedUnavailableEntries, smartPreview } from './model-menu';

const F = { available: false, why: 'tier \'free\' runs nous/welcome, which is not a frontier model.', sentence: 'Claude Opus 5.5 or later and Gemini 4 Carbon or later', allowed: ['Claude Opus 5.5', 'Gemini 4 Carbon'] };

describe('governedUnavailableEntries', () => {
  it('says it is unavailable, why, which models it allows, and offers Settings > Models', () => {
    const e = governedUnavailableEntries(F) as { title?: string; foot?: string; label?: string; value?: string }[];
    expect(e[0]?.title).toBe('Governed mode is unavailable');
    expect(e[1]?.foot).toContain('nous/welcome');
    expect(e[1]?.foot).toContain('runs only on Claude Opus 5.5 or later and Gemini 4 Carbon or later');
    expect(e.at(-1)).toMatchObject({ label: 'Open Settings, Models', value: SETTINGS_VALUE });
  });
  it('still says something when the reason is empty', () => {
    expect(JSON.stringify(governedUnavailableEntries({ ...F, why: '' }))).toContain('No frontier model is set up.');
  });
});

describe('smartPreview never previews a heavy model (ADR-0037)', () => {
  const P = 'claude-subscription-directsdk-experimental';
  const ch = (provider: string, model: string, tier: number): ModelChoice => ({ value: provider + '/' + model, provider, model, providerName: provider, tier, tierName: model });
  const ladder = [ch(P, 'haiku', 0), ch(P, 'opus', 1), ch(P, 'fable', 2)];

  it('previews the strongest tier that is not heavy for design work, though Fable sits on top', () => {
    expect(smartPreview(ladder, { text: 'design the sync layer' })?.choice.model).toBe('opus');
    expect(smartPreview(ladder, { text: 'hi' })?.choice.model).toBe('haiku');
    for (const text of ['', 'hi', 'debug this', 'design it', 'x '.repeat(900)]) expect(smartPreview(ladder, { text })?.choice.model).not.toBe('fable');
  });
  it('previews nothing when every tier is heavy', () => {
    expect(smartPreview([ch(P, 'fable', 0), ch('xai', 'grok-4.7', 1)], { text: 'design it' })).toBeNull();
  });
});
