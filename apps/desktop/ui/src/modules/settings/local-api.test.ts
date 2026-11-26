// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { describeStatus } from '../../host/local-api';
import type { LocalApiBridge, LocalApiStatus } from '../../host/local-api';
import { localApiHTML, renderLocalApi } from './local-api';

const OFF: LocalApiStatus = { enabled: false, running: false, url: null, token_file: null, streams: 0, version: 1, problem: null };
const ON: LocalApiStatus = { enabled: true, running: true, url: 'http://127.0.0.1:47821', token_file: '/data/client-token', streams: 0, version: 1, problem: null };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function fake(next: LocalApiStatus | Error): LocalApiBridge & { calls: string[] } {
  const calls: string[] = [];
  const answer = (name: string): Promise<LocalApiStatus> => { calls.push(name); return next instanceof Error ? Promise.reject(next) : Promise.resolve(next); };
  return { calls, status: () => answer('status'), setEnabled: (e) => answer('setEnabled:' + String(e)), rotate: () => answer('rotate') };
}

beforeEach(() => { document.body.replaceChildren(); });

describe('Settings, Local API on the kit', () => {
  it('says it is off by default, and offers nothing but the switch', () => {
    const html = localApiHTML(OFF);
    expect(html).toContain('data-set="local-api"');
    expect(html).toContain('data-kit="Card"');
    expect(html).not.toContain('data-rotate');
    expect(html).not.toContain('client-token');
    expect(describeStatus(OFF)).toMatch(/^Off\./);
  });

  it('shows the address and the token file\'s path when it is on, and never anything that looks like the token itself', () => {
    const html = localApiHTML(ON);
    expect(html).toContain('http://127.0.0.1:47821');
    expect(html).toContain('/data/client-token');
    expect(html).toContain('data-rotate');
    expect(Object.keys(ON)).not.toContain('token');
  });

  it('counts the apps that follow it, and puts the host\'s reason in words when nothing listens', () => {
    expect(describeStatus({ ...ON, streams: 1 })).toContain('One app is following');
    expect(describeStatus({ ...ON, streams: 3 })).toContain('3 apps are following');
    const s = { ...OFF, enabled: true, problem: 'The token file would be readable by other users, so the endpoint stays off.' };
    expect(describeStatus(s)).toBe(s.problem);
    expect(localApiHTML(s)).not.toContain('data-rotate');
  });

  it('turning the switch on asks the host and draws what it answers', async () => {
    const sec = document.createElement('section'); document.body.append(sec);
    const bridge = fake(ON);
    renderLocalApi(sec, OFF, bridge);
    sec.querySelector<HTMLButtonElement>('[data-set="local-api"]')!.click();
    await tick();
    expect(bridge.calls).toContain('setEnabled:true');
    expect(sec.querySelector('[data-rotate]')).not.toBeNull();
  });

  it('a refused change asks the host for the true state again, so the switch goes back', async () => {
    const sec = document.createElement('section'); document.body.append(sec);
    const bridge = fake(new Error('boopis could not open the endpoint.'));
    renderLocalApi(sec, OFF, bridge);
    sec.querySelector<HTMLButtonElement>('[data-set="local-api"]')!.click();
    await tick(); await tick();
    expect(bridge.calls).toEqual(['setEnabled:true', 'status']);
  });

  it('Rotate asks the host once', async () => {
    const sec = document.createElement('section'); document.body.append(sec);
    const bridge = fake(ON);
    renderLocalApi(sec, ON, bridge);
    sec.querySelector<HTMLButtonElement>('[data-rotate]')!.click();
    await tick();
    expect(bridge.calls).toEqual(['rotate']);
  });
});
