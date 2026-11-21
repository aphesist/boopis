/* The provider commands of the host (ADR-0039) as a small interface, so the Providers section never touches Tauri and tests
   inject a fake. Errors come back as `HostError` with the host's own sentence. */
import { commands, events } from './bindings';
import type { EndpointRequest_Deserialize, EndpointTestResult_Serialize, ProviderSigninEvent, ProviderState_Serialize, SigninCode } from './bindings';
import { asHostError } from './bridge';

export type ProviderState = ProviderState_Serialize;
export type EndpointRequest = EndpointRequest_Deserialize;
export type EndpointTest = EndpointTestResult_Serialize;
export type { ProviderSigninEvent, SigninCode };

export interface ProvidersBridge {
  /** every way's state (never dials a runtime on this computer) */
  list(): Promise<ProviderState[]>;
  /** ask the runtimes on this computer; called when the section is shown and on "Check again", never in the background */
  probe(): Promise<ProviderState[]>;
  /** save a key (to the keychain, by the host) and check it once; the key is in no result */
  setKey(way: string, key: string): Promise<ProviderState>;
  remove(way: string): Promise<ProviderState>;
  signOut(way: string): Promise<ProviderState>;
  signinStart(way: string): Promise<SigninCode>;
  signinCancel(way: string): Promise<void>;
  onSigninEnd(cb: (e: ProviderSigninEvent) => void): Promise<() => void>;
  testEndpoint(request: { base_url: string; api_mode: EndpointRequest['api_mode']; key?: string | null }): Promise<EndpointTest>;
  addEndpoint(request: EndpointRequest): Promise<ProviderState>;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

export function tauriProvidersBridge(): ProvidersBridge {
  return {
    list: () => call(commands.providerList(null)),
    probe: () => call(commands.providerProbeLocal(null)),
    setKey: (way, key) => call(commands.providerSetKey(way, key, null)),
    remove: (way) => call(commands.providerRemove(way, null)),
    signOut: (way) => call(commands.providerSignOut(way, null)),
    signinStart: (way) => call(commands.providerSigninStart(way, null)),
    signinCancel: async (way) => { await call(commands.providerSigninCancel(way)); },
    onSigninEnd: (cb) => events.providerSigninEvent.listen((e) => { cb(e.payload); }),
    testEndpoint: (r) => call(commands.providerTestEndpoint({ base_url: r.base_url, api_mode: r.api_mode, key: r.key ?? null })),
    addEndpoint: (r) => call(commands.providerAddEndpoint(r))
  };
}
