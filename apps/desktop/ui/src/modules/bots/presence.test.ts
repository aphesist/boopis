/* Who is at work in a room: the words the presence line says for a member in a tool (the owner's "using fetch fetch", 0.1.9). */
import { describe, expect, it } from 'vitest';
import { memberActor } from './presence';

describe('the presence label of a member at work', () => {
  const member = { id: 'm-kai', profile: 'kai', handle: 'kai', name: 'kai' };
  const bot = { id: 'kai', name: 'kai', state: 'idle' };
  it('names the tool once', () => {
    const a = memberActor({ member: 'm-kai', status: 'running', round: 0, startedAt: null, tool: 'mcp__fetch__fetch' }, member, bot);
    expect(a.status).toBe('tool');
    expect(a.doing).toBe('using fetch');
  });
  it('is thinking between tools', () => {
    const a = memberActor({ member: 'm-kai', status: 'running', round: 0, startedAt: null, tool: null }, member, bot);
    expect(a.status).toBe('thinking');
    expect(a.doing).toBeNull();
  });
});
