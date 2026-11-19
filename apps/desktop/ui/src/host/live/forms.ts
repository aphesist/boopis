/* Forms on the live provider (docs/FORMS.md section 6): the plugin's `form.opened` and `form.resolved` events, Hermes's
   `clarify.request`, and the answers. Opened forms are remembered by id so that answering in one place resolves them
   everywhere (the provider's hooks put the same form in the conversation and in the dock's queue).
   Secrets: `submit` splits them off (`splitSecrets`), stores each with the host's keychain (`secret_set`), and sends the
   plugin `provided: [field, ...]` only. A secret's value is in no frame, no event, no log and no error message. */
import { logger } from '../../core/log';
import type { FormOutcome, FormSpec, FormsSource, FormStatus, PickerItem, PickerKind } from '../../data';
import { inTauri } from '../bridge';
import type { GatewayClient, GatewayEvent } from '../gateway';
import { fromGatewayEvent, fromPluginEvent, replyFor, splitSecrets } from '../forms';
import type { FormModel } from '../forms';
import type { SecretsBridge } from '../secrets';

const log = logger('forms');

export interface FormEntry { model: FormModel; spec: FormSpec; /** the gateway's session id */ gwSession: string }
export interface FormHooks {
  opened(entry: FormEntry): void;
  resolved(entry: FormEntry, status: FormStatus, receipt?: string): void;
}
export interface FormsOptions {
  client: GatewayClient; secrets: SecretsBridge; hooks: FormHooks;
  /** the folder dialog of the host; null where there is none (a plain browser) */
  pickFolder?: (() => Promise<string | null>) | null;
}
export interface FormsHost {
  source: FormsSource;
  /** an event that may be a form's; true when it was */
  handle(ev: GatewayEvent, ctx: { gwSession: string; model: string }): boolean;
  /** draw again the forms a session still has open (after a reconnect, or when a session is resumed) */
  reload(gwSession: string, model: string): Promise<void>;
  /** the forms not yet answered */
  openIds(): string[];
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** what a failed answer says to the person: the plugin's stable code is for logs, the words are for them */
function words(e: unknown): string {
  const m = message(e).replace(/^hx\.[a-z_.]+:?\s*/i, '').trim();
  return m || 'The answer was not delivered. Try again.';
}

export function createFormsHost(opts: FormsOptions): FormsHost {
  const { client, secrets, hooks } = opts;
  const open = new Map<string, FormEntry>();
  const closed = new Set<string>();

  function add(model: FormModel | null, gwSession: string): void {
    if (!model || open.has(model.id) || closed.has(model.id)) return;
    const entry: FormEntry = { model, spec: model.spec, gwSession };
    open.set(model.id, entry);
    hooks.opened(entry);
  }
  function settle(id: string, status: FormStatus): void {
    const entry = open.get(id);
    if (!entry) return;
    open.delete(id);
    closed.add(id);
    hooks.resolved(entry, status);
  }

  const source: FormsSource = {
    async submit(id: string, outcome: FormOutcome): Promise<void> {
      const entry = open.get(id);
      if (!entry) throw new Error('This form is no longer open.');
      let plain: Record<string, unknown>, targets: ReturnType<typeof splitSecrets>['secrets'];
      try { ({ plain, secrets: targets } = splitSecrets(entry.model, { ...outcome.values, ...outcome.secrets })); } catch (e) { throw new Error(message(e)); }
      /* the keychain first: the plugin confirms each provided secret with the host before it tells the agent anything */
      for (const t of targets) {
        try { await secrets.set(t.service, t.account, t.value); } catch (e) { throw new Error('The key could not be saved to your keychain: ' + words(e)); }
      }
      const reply = replyFor(entry.model, { cancelled: false, values: plain, provided: targets.map((t) => t.field) });
      if (reply) {
        try { await client.requestRaw(reply.method, reply.params); } catch (e) { log.warn('a form answer was not delivered', e instanceof Error ? e.name : 'error'); throw new Error(words(e)); }
      }
      settle(id, 'submitted');
    },
    async cancel(id: string): Promise<void> {
      const entry = open.get(id);
      if (!entry) return;
      const reply = replyFor(entry.model, { cancelled: true });
      try { if (reply) await client.requestRaw(reply.method, reply.params); } catch (e) { log.warn('a form cancel was not delivered', e instanceof Error ? e.name : 'error'); }
      settle(id, 'cancelled');
    },
    /* no OAuth flow exists in the host yet: the control says so instead of pretending (AGENTS.md invariant 5) */
    signin(): Promise<void> { return Promise.reject(new Error('Signing in from here is not available in this build yet.')); },
    can: { signin: false, upload: false, folder: !!opts.pickFolder },
    pickerItems: (_kind: PickerKind): readonly PickerItem[] => [],
    pickFolder: () => (opts.pickFolder ? opts.pickFolder() : Promise.resolve(null))
  };

  return {
    source,
    handle(ev, ctx) {
      const p = (ev.payload ?? {}) as Record<string, unknown>;
      switch (ev.type) {
        case 'plugin.hypotaxis.form.opened': add(fromPluginEvent(ctx.gwSession, p, ctx.model), ctx.gwSession); return true;
        case 'plugin.hypotaxis.form.resolved': {
          const status = p['status'];
          settle(String(p['form_id'] ?? ''), status === 'cancelled' || status === 'expired' ? status : 'submitted');
          return true;
        }
        case 'clarify.request': add(fromGatewayEvent('clarify.request', ctx.gwSession, { ...p, ...(typeof ev['execution_generation'] === 'number' && p['execution_generation'] === undefined ? { execution_generation: ev['execution_generation'] } : {}) }, ctx.model), ctx.gwSession); return true;
        case 'clarify.settled': case 'clarify.cancelled': settle(String(p['prompt_id'] ?? ''), ev.type === 'clarify.cancelled' ? 'cancelled' : 'submitted'); return true;
        default: return false;
      }
    },
    async reload(gwSession, model) {
      let res: unknown;
      try { res = await client.requestRaw('plugin.hypotaxis.form.list', { session_id: gwSession }); } catch { return; }   /* a plugin without forms: nothing to draw */
      const forms = (res as { forms?: unknown } | null)?.forms;
      if (Array.isArray(forms)) for (const f of forms) if (f && typeof f === 'object') add(fromPluginEvent(gwSession, f as Record<string, unknown>, model), gwSession);
    },
    openIds: () => [...open.keys()]
  };
}

/** the host's own folder dialog, in the desktop app only */
export async function tauriPickFolder(): Promise<string | null> {
  const { commands } = await import('../bindings');
  const picked = await commands.pickFolder();
  return picked ? picked.path : null;
}
export const hasHostDialogs = (): boolean => inTauri();
