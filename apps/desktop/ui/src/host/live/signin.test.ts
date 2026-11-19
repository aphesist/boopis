/* Sign-in fields on the live provider's forms: an agent's `signin` form is run by the host (a connector's OAuth through Hermes,
   or the provider's own login command as a vector), and where there is no host the card says so. */
import { describe, expect, it, vi } from 'vitest';
import type { FormsSource } from '../../data';
import type { GatewayClient, GatewayEvent } from '../gateway';
import type { ConnectorLogin, ConnectorsBridge } from '../connectors-bridge';
import { createFormsHost, hostCancelSignin, hostSignin, loginFailure } from './forms';
import type { FormsOptions, XSignin } from './forms';

const client = { requestRaw: vi.fn() } as unknown as GatewayClient;
const secrets = { set: vi.fn() };
const form = (signin: Record<string, unknown>): GatewayEvent => ({ type: 'plugin.boopis.form.opened', payload: { form_id: 'f1', kind: 'signin', title: 'Sign in', schema: { properties: { who: { 'x-signin': signin } }, required: ['who'] }, submit: { label: 'Sign in' }, sensitive: false, origin: 'agent' } }) as unknown as GatewayEvent;
function host(over: Partial<FormsOptions> = {}): { source: FormsSource } {
  const h = createFormsHost({ client, secrets, hooks: { opened: () => undefined, resolved: () => undefined }, ...over });
  h.handle(form({ provider: 'Linear', server: 'linear' }), { gwSession: 's', model: 'm' });
  return h;
}
const login = (o: Partial<ConnectorLogin>): ConnectorLogin => ({ command_line: 'claude auth login', ok: true, code: 0, timed_out: false, output: [], ...o });
function bridge(over: Partial<ConnectorsBridge> = {}): ConnectorsBridge {
  const no = (): never => { throw new Error('not used'); };
  return { catalog: no, inputs: no, review: no, install: no, list: no, test: no, setEnabled: no, remove: no, signin: no, cancelSignin: no, login: no, ...over } as ConnectorsBridge;
}

describe('a sign-in field of an agent form', () => {
  it('is disabled and says so where there is no host to run it', async () => {
    const h = host();
    expect(h.source.can.signin).toBe(false);
    await expect(h.source.signin('f1', 'who')).rejects.toThrow('not available in this build');
  });

  it('runs the named connector through the host and cancels it the same way', async () => {
    const seen: XSignin[] = [], stopped: XSignin[] = [];
    const h = host({ signin: (s) => { seen.push(s); return Promise.resolve(); }, cancelSignin: (s) => { stopped.push(s); return Promise.resolve(); } });
    expect(h.source.can.signin).toBe(true);
    await h.source.signin('f1', 'who');
    await h.source.cancelSignin?.('f1', 'who');
    expect(seen).toEqual([{ provider: 'Linear', server: 'linear' }]);
    expect(stopped).toEqual(seen);
  });

  it('refuses a field the form does not have, and a form that is not open', async () => {
    const h = host({ signin: () => Promise.resolve() });
    await expect(h.source.signin('f1', 'nope')).rejects.toThrow('no sign-in to run');
    await expect(h.source.signin('gone', 'who')).rejects.toThrow('no sign-in to run');
  });

  it('runs a connector by its OAuth through the bridge, and a command as a program and its arguments', async () => {
    const b = bridge({ signin: vi.fn().mockResolvedValue({}), login: vi.fn().mockResolvedValue(login({})) });
    await hostSignin({ server: 'linear' }, b);
    expect(b.signin).toHaveBeenCalledWith('linear');
    await hostSignin({ command: 'claude', args: ['auth', 'login'] }, b);
    expect(b.login).toHaveBeenCalledWith('claude', ['auth', 'login']);
    await hostSignin({ command: 'gh' }, b);
    expect(b.login).toHaveBeenLastCalledWith('gh', []);
    await expect(hostSignin({ provider: 'x' }, b)).rejects.toThrow('neither a connector nor a command');
    await hostCancelSignin({ server: 'linear' }, bridge({ cancelSignin: vi.fn().mockResolvedValue(undefined) }));
    await expect(hostCancelSignin({ command: 'gh' }, bridge())).resolves.toBeUndefined();
  });

  it('reports a command that did not succeed with how it ended and what it said last', async () => {
    const b = bridge({ login: vi.fn().mockResolvedValue(login({ ok: false, code: 1, output: ['Open https://x.example/device', 'Error: the code expired'] })) });
    await expect(hostSignin({ command: 'claude', args: ['auth', 'login'] }, b)).rejects.toThrow('claude auth login ended with exit code 1. It said: Error: the code expired');
    expect(loginFailure(login({ ok: false, timed_out: true, code: null }))).toBe('The sign-in command was stopped for running too long.');
    expect(loginFailure(login({ ok: false, code: null, output: [] }))).toBe('claude auth login ended with no exit code.');
  });
});
