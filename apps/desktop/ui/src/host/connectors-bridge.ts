/* The connector commands of the host, as a small interface so the views never touch Tauri and tests inject a fake. The host
   validates every input again (names, URLs, commands) and keeps every key: a secret goes from a field to `install` (the
   keychain) and no further; nothing here returns one (docs/CONNECTORS.md, docs/FORMS.md section 3). */
import { commands } from './bindings';
import type {
  ConnectorCatalogEntry, ConnectorInfo_Deserialize, ConnectorInstall, ConnectorLogin, ConnectorRemoval, ConnectorRequest, ConnectorReview_Deserialize,
  ConnectorSignIn, ConnectorSource, ConnectorTest, Form_Deserialize
} from './bindings';
import { asHostError } from './bridge';

export type { ConnectorCatalogEntry, ConnectorInstall, ConnectorLogin, ConnectorRemoval, ConnectorRequest, ConnectorSignIn, ConnectorSource, ConnectorTest };
export type ConnectorInfo = ConnectorInfo_Deserialize;
export type ConnectorReview = ConnectorReview_Deserialize;
export type ConnectorForm = Form_Deserialize;

export interface ConnectorsBridge {
  /** the curated collection, as data compiled into the app */
  catalog(): Promise<ConnectorCatalogEntry[]>;
  /** the form that asks for a source's inputs (a URL, a command, or a collection entry's setup values) */
  inputs(source: ConnectorSource, connector?: string, variant?: string): Promise<ConnectorForm>;
  /** what an install would add, exactly, and the hash the install must name; changes nothing */
  review(request: ConnectorRequest): Promise<ConnectorReview>;
  /** install what the review showed; `secrets` go to the keychain and no further */
  install(request: ConnectorRequest, planHash: string, secrets: Readonly<Record<string, string>>): Promise<ConnectorInstall>;
  list(): Promise<ConnectorInfo[]>;
  test(name: string): Promise<ConnectorTest>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
  remove(name: string, deleteCredentials: boolean): Promise<ConnectorRemoval>;
  /** Hermes's own OAuth flow for a remote server: resolves when it ends */
  signin(name: string): Promise<ConnectorSignIn>;
  cancelSignin(name: string): Promise<void>;
  /** a provider's own sign-in command, run exactly as shown, never through a shell */
  login(command: string, args: readonly string[]): Promise<ConnectorLogin>;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

export function tauriConnectorsBridge(): ConnectorsBridge {
  return {
    catalog: () => call(commands.connectorCatalog()),
    inputs: async (source, connector, variant) => (await call(commands.connectorInputs(source, connector ?? null, variant ?? null))) as ConnectorForm,
    review: async (request) => (await call(commands.connectorReview(request))) as ConnectorReview,
    install: (request, planHash, secrets) => call(commands.connectorInstall(null, request, planHash, { ...secrets })),
    list: async () => (await call(commands.connectorList(null))) as ConnectorInfo[],
    test: (name) => call(commands.connectorTest(null, name)),
    setEnabled: async (name, enabled) => { await call(commands.connectorSetEnabled(null, name, enabled)); },
    remove: (name, deleteCredentials) => call(commands.connectorRemove(null, name, deleteCredentials)),
    signin: (name) => call(commands.connectorSignin(null, name)),
    cancelSignin: async (name) => { await call(commands.connectorSigninCancel(null, name)); },
    login: (command, args) => call(commands.connectorLogin(command, [...args]))
  };
}
