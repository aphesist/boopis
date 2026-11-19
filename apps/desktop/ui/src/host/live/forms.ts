/* Forms on the live provider (docs/FORMS.md section 6): the plugin's `form.opened` and `form.resolved` events, Hermes's
   `clarify.request`, and the answers. Opened forms are remembered by id so that answering in one place resolves them
   everywhere (the provider's hooks put the same form in the conversation and in the dock's queue).
   Secrets: `submit` splits them off (`splitSecrets`), stores each with the host's keychain (`secret_set`), and sends the
   plugin `provided: [field, ...]` only. A secret's value is in no frame, no event, no log and no error message. */
import { logger } from '../../core/log';
import type { FormOutcome, FormSpec, FormsSource, FormStatus, PickerItem, PickerKind } from '../../data';
import { inTauri } from '../bridge';
import type { GatewayClient, GatewayEvent } from '../gateway';
import { fromFreeTierLimit, fromGatewayEvent, fromPluginEvent, replyFor, splitSecrets } from '../forms';
import { limitFromSurface, rememberLimit } from '../free-tier';
import type { ErrorSurface } from '../../vendor/hermes-shared/gateway-contract.generated';
import type { FormModel } from '../forms';
import type { SecretsBridge } from '../secrets';
import type { ConnectorLogin, ConnectorsBridge } from '../connectors-bridge';
import { loginFor, signinKnown } from '../logins';

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
  /** what the person chose on a free-tier limit notice ('choose' another model, or 'wait'); the host's setup does the rest */
  onFreeTierChoice?: (choice: string) => Promise<void>;
  /** runs a sign-in field (`x-signin`) in the host; null where there is no host. Rejects with the words the card shows */
  signin?: ((s: XSignin) => Promise<void>) | null;
  /** ends a sign-in that is running (the user cancelled it) */
  cancelSignin?: ((s: XSignin) => Promise<void>) | null;
}
export type { XSignin } from '../logins';
import type { XSignin } from '../logins';
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
      if (entry.model.source.kind === 'free-tier') {
        try { await opts.onFreeTierChoice?.(String(plain['choice'] ?? '')); } catch (e) { throw new Error(words(e)); }
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
    /* the host runs it: Hermes's own OAuth flow for a connector (`server`), or a provider's own login command (`command`); where
       there is no host the control says so instead of pretending (AGENTS.md invariant 5) */
    async signin(id: string, field: string): Promise<void> {
      if (!opts.signin) throw new Error('Signing in from here is not available in this build yet.');
      const s = open.get(id)?.spec.schema.properties?.[field]?.['x-signin'];
      if (!s) throw new Error('This form has no sign-in to run.');
      await opts.signin(s);
    },
    cancelSignin: async (id: string, field: string): Promise<void> => {
      const s = open.get(id)?.spec.schema.properties?.[field]?.['x-signin'];
      if (s) await opts.cancelSignin?.(s);
    },
    /* what the host would run for a provider the form names, from the host's own table: display only, the host decides again */
    login: (s: XSignin) => { const l = s.server || s.command !== undefined || s.args !== undefined ? null : loginFor(s.provider); return l ? { known: true, line: l.line } : { known: !!s.server }; },
    can: { signin: !!opts.signin, upload: false, folder: !!opts.pickFolder },
    pickerItems: (_kind: PickerKind): readonly PickerItem[] => [],
    pickFolder: () => (opts.pickFolder ? opts.pickFolder() : Promise.resolve(null))
  };

  return {
    source,
    handle(ev, ctx) {
      const p = (ev.payload ?? {}) as Record<string, unknown>;
      switch (ev.type) {
        case 'plugin.boopis.form.opened': add(fromPluginEvent(ctx.gwSession, p, ctx.model), ctx.gwSession); return true;
        case 'plugin.boopis.form.resolved': {
          const status = p['status'];
          settle(String(p['form_id'] ?? ''), status === 'cancelled' || status === 'expired' ? status : 'submitted');
          return true;
        }
        case 'clarify.request': add(fromGatewayEvent('clarify.request', ctx.gwSession, { ...p, ...(typeof ev['execution_generation'] === 'number' && p['execution_generation'] === undefined ? { execution_generation: ev['execution_generation'] } : {}) }, ctx.model), ctx.gwSession); return true;
        case 'message.complete': {
          /* a turn the free tier refused: remember what Hermes said (Settings shows it later) and raise the notice; the turn's
             own completion is still the provider's to handle, so this is never "a form's event" */
          const limit = limitFromSurface(p['error_surface'] as ErrorSurface | null | undefined);
          if (limit) { rememberLimit(limit); add(fromFreeTierLimit(limit, `${ctx.gwSession}:${String(ev.seq ?? Date.now())}`), ctx.gwSession); }
          return false;
        }
        case 'clarify.settled': case 'clarify.cancelled': settle(String(p['prompt_id'] ?? ''), ev.type === 'clarify.cancelled' ? 'cancelled' : 'submitted'); return true;
        default: return false;
      }
    },
    async reload(gwSession, model) {
      let res: unknown;
      try { res = await client.requestRaw('plugin.boopis.form.list', { session_id: gwSession }); } catch { return; }   /* a plugin without forms: nothing to draw */
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
/** the free-tier limit notice's "choose another model": ask setup's models question again (`change-models.ts`, the same thing
    Settings > Models does). "wait" changes nothing. */
export async function chooseAnotherModel(choice: string): Promise<void> {
  if (choice !== 'choose') return;
  const { changeModels } = await import('../change-models');
  await changeModels();
}
export const hasHostDialogs = (): boolean => inTauri();

/** What a sign-in command that did not succeed says to the person: how it ended, then the end of what it said. */
export function loginFailure(r: ConnectorLogin): string {
  if (r.timed_out) return 'The sign-in command was stopped for running too long.';
  const last = r.output.at(-1);
  return `${r.command_line} ended with ${r.code === null ? 'no exit code' : 'exit code ' + String(r.code)}.` + (last ? ' It said: ' + last : '');
}
/** Run a sign-in field in the host: a connector's OAuth through Hermes, or the host's own sign-in for a provider id in its table. A form
    never chooses what runs: a command or arguments in the field are refused here without asking the host, and the host refuses a
    provider it does not know again. */
export async function hostSignin(s: XSignin, bridge?: ConnectorsBridge): Promise<void> {
  if (!signinKnown(s)) throw new Error('This sign-in is not one boopis knows.');
  const b = bridge ?? (await import('../connectors-bridge')).tauriConnectorsBridge();
  if (s.server) { await b.signin(s.server); return; }
  const r = await b.login(s.provider ?? '');
  if (!r.ok) throw new Error(loginFailure(r));
}
export async function hostCancelSignin(s: XSignin, bridge?: ConnectorsBridge): Promise<void> {
  if (!s.server) return;
  const b = bridge ?? (await import('../connectors-bridge')).tauriConnectorsBridge();
  await b.cancelSignin(s.server);
}
