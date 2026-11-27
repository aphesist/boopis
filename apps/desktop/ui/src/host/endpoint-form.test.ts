// @vitest-environment jsdom
/* The endpoint flow (ADR-0039): Test, then Save; the key is typed once, held in memory only and never in the page's text. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@boopis/ui';
import '../modules/cards';
import { setProvider } from '../data';
import type { FormSpec, FormsSource } from '../data';
import { createMockProvider } from '../data/mock-provider';
import { useFormsHost } from '../modules/cards/forms-host';
import { chosenModels, startEndpointFlow, testProblem } from './endpoint-form';
import type { FlowHandlers, FlowUi } from './endpoint-form';
import type { EndpointRequest, EndpointTest, ProvidersBridge } from './providers-bridge';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const SECRET = 'sk-live-SECRET-9876';
const result = (over: Partial<EndpointTest> = {}): EndpointTest => ({ outcome: 'listed', models: ['m-small', 'm-big'], answered_at: null, status: 200, loopback: true, code: null, detail: null, ...over });

function harness(test: () => Promise<EndpointTest>) {
  const log: { tested: unknown[]; added: EndpointRequest[]; notices: string[]; backs: number } = { tested: [], added: [], notices: [], backs: 0 };
  const host = document.createElement('div');
  document.body.append(host);
  const bridge = {
    testEndpoint: (r: unknown) => { log.tested.push(r); return test(); },
    addEndpoint: (r: EndpointRequest) => { log.added.push(r); return Promise.resolve({ provider: 'custom', way: 'custom.' + r.name, kind: 'custom', status: 'connected', code: null, detail: null, plan: null, models_count: null, base_url: r.base_url, signin: null, checked_at: null } as never); }
  } as unknown as ProvidersBridge;
  const flowUi: FlowUi = {
    card(spec: FormSpec, handlers: FlowHandlers) {
      const src: FormsSource = { submit: handlers.submit, cancel: handlers.cancel, signin: () => Promise.reject(new Error('no')), can: { signin: false, upload: false, folder: false }, pickerItems: () => [], pickFolder: () => Promise.resolve(null) };
      useFormsHost(src);
      return ui.card('form', spec as unknown as Record<string, unknown>, { size: 'inline' });
    },
    show: (...kids) => { host.replaceChildren(...kids); },
    back: () => { log.backs += 1; },
    later: (fn) => { fn(); },
    notify: (t) => { log.notices.push(t); }
  };
  return { log, host, flow: startEndpointFlow(flowUi, bridge) };
}
const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string): void => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
const fill = (host: HTMLElement, name: string, v: string): void => type(host.querySelector(`[data-name="${name}"]`) as HTMLInputElement, v);
const press = (host: HTMLElement, action: string): void => { (host.querySelector(`[data-action="${action}"]`) as HTMLElement).click(); };

beforeAll(() => { setProvider(createMockProvider({ simulate: false })); });
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); document.body.replaceChildren(); });
afterEach(() => { useFormsHost(null); });

describe('the endpoint flow', () => {
  it('tests first: the address, the wire and the key go to the host, and nothing is saved', async () => {
    const h = harness(() => Promise.resolve(result()));
    expect(h.host.textContent).toContain('Add an endpoint of your own');
    fill(h.host, 'name', 'My server'); fill(h.host, 'base_url', 'http://127.0.0.1:8000/v1');
    type(h.host.querySelector('input[data-secret="key"]') as HTMLInputElement, SECRET);
    press(h.host, 'submit');
    await tick(); await tick();
    expect(h.log.tested).toEqual([{ base_url: 'http://127.0.0.1:8000/v1', api_mode: 'chat_completions', key: SECRET }]);
    expect(h.log.added).toEqual([]);
  });

  it('lists what Test found as a ticked checklist, then saves the ticked ids and the typed ones with the key held from the first step', async () => {
    const h = harness(() => Promise.resolve(result()));
    fill(h.host, 'name', 'My server'); fill(h.host, 'base_url', 'http://127.0.0.1:8000/v1');
    type(h.host.querySelector('input[data-secret="key"]') as HTMLInputElement, SECRET);
    press(h.host, 'submit');
    await tick(); await tick();
    expect(h.host.textContent).toContain('Choose its models');
    const boxes = [...h.host.querySelectorAll<HTMLElement>('[role="checkbox"]')];
    expect(boxes.map((b) => b.textContent?.replace(/\d$/, ''))).toEqual(['m-small', 'm-big']);
    expect(boxes.every((b) => b.getAttribute('aria-checked') === 'true')).toBe(true);
    expect(h.host.querySelector('input[data-secret]'), 'the key is not asked twice').toBeNull();
    boxes[1]?.click();
    fill(h.host, 'extra_models', 'hand-made\n\nm-small');
    press(h.host, 'submit');
    await tick(); await tick();
    expect(h.log.added).toHaveLength(1);
    expect(h.log.added[0]).toMatchObject({ name: 'My server', base_url: 'http://127.0.0.1:8000/v1', api_mode: 'chat_completions', key: SECRET, models: ['m-small', 'hand-made'], discover: true, use_model: null });
    expect(h.log.backs).toBe(1);
  });

  it('never puts the key in text on the page: not while typed, not in the second step, not after Save', async () => {
    const h = harness(() => Promise.resolve(result()));
    fill(h.host, 'name', 'S'); fill(h.host, 'base_url', 'https://api.example.com/v1');
    type(h.host.querySelector('input[data-secret="key"]') as HTMLInputElement, SECRET);
    const dump = (): string => document.body.textContent + document.body.innerHTML;
    expect(dump()).not.toContain('SECRET-9876');
    press(h.host, 'submit');
    await tick(); await tick();
    expect(dump()).not.toContain('SECRET-9876');
    press(h.host, 'submit');
    await tick(); await tick();
    expect(dump()).not.toContain('SECRET-9876');
  });

  it('says why a test failed, in the host\'s one line, and keeps the form open; the key is forgotten', async () => {
    const h = harness(() => Promise.resolve(result({ outcome: 'unreachable', models: [], detail: 'Nothing answered at that address.' })));
    fill(h.host, 'name', 'S'); fill(h.host, 'base_url', 'http://127.0.0.1:1/v1');
    type(h.host.querySelector('input[data-secret="key"]') as HTMLInputElement, SECRET);
    press(h.host, 'submit');
    await tick(); await tick();
    expect(h.host.textContent).toContain('Nothing answered at that address.');
    expect(h.host.textContent).toContain('Add an endpoint of your own');
    expect(h.log.added).toEqual([]);
  });

  it('asks for ids by hand when the server lists none', async () => {
    const h = harness(() => Promise.resolve(result({ outcome: 'empty', models: [] })));
    fill(h.host, 'name', 'S'); fill(h.host, 'base_url', 'http://127.0.0.1:8000/v1');
    press(h.host, 'submit');
    await tick(); await tick();
    expect(h.host.textContent).toContain('lists no models');
    expect(h.host.querySelector('[role="checkbox"]')).toBeNull();
    fill(h.host, 'extra_models', 'only-one');
    press(h.host, 'submit');
    await tick(); await tick();
    expect(h.log.added[0]?.models).toEqual(['only-one']);
    expect(h.log.added[0]?.key).toBeNull();
  });

  it('cancel leaves the flow', async () => {
    const h = harness(() => Promise.resolve(result()));
    press(h.host, 'cancel');
    await tick();
    expect(h.log.backs).toBe(1);
  });
});

describe('the endpoint flow\'s helpers', () => {
  it('chosenModels lists ticked ids then typed ones, each once', () => {
    expect(chosenModels({ picks: ['a', 'b'], extra_models: ' c \na\n\n' })).toEqual(['a', 'b', 'c']);
    expect(chosenModels({})).toEqual([]);
  });
  it('testProblem uses the host\'s line, with a plain one per outcome when it gave none', () => {
    expect(testProblem(result({ outcome: 'needs_key', detail: null }))).toContain('asked for a key');
    expect(testProblem(result({ outcome: 'not_a_model_server', detail: null }))).toContain('not a model server');
    expect(testProblem(result({ outcome: 'unreachable', detail: 'x' }))).toBe('x');
  });
});
