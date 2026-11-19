/* The host's keychain as a small interface, so the forms never touch Tauri and tests inject a fake. A secret goes from the
   field to `set` and nowhere else: there is no command that reads one back (docs/FORMS.md section 3). */
import { commands } from './bindings';
import { asHostError } from './bridge';

export interface SecretsBridge {
  /** store a secret in the OS keychain under `service` and `account` */
  set(service: string, account: string, value: string): Promise<void>;
}

export function tauriSecrets(): SecretsBridge {
  return {
    async set(service, account, value) {
      try { await commands.secretSet(service, account, value); } catch (e) { throw asHostError(e); }
    }
  };
}
