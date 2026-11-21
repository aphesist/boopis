/* The endpoint form's flow (ADR-0039): the card of kind `endpoint` in its two steps, and what each step asks of the host.
     1. Test: the name, address, wire and an optional key go to `provider_test_endpoint`, which saves nothing and lists the models.
     2. Save: the ticked models (and ids typed by hand) go to `provider_add_endpoint`.
   The key is typed once. The card hands it to the sink and drops it from its own memory; the flow keeps it in a closure variable
   (never the DOM, never an event, never a log) until Save, Cancel or a failed step, then overwrites it. The pages around it
   (`FlowUi`) are the Providers section's: this file draws nothing of its own but the two cards. */
import type { FormOutcome, FormSpec } from '../data';
import type { EndpointValues } from '../data/providers';
import { endpointForm } from './forms';
import type { EndpointRequest, EndpointTest, ProvidersBridge, ProviderState } from './providers-bridge';

export interface FlowHandlers {
  submit(formId: string, outcome: FormOutcome): Promise<void>;
  cancel(formId: string): Promise<void>;
}
/** what the flow needs of the place it is drawn in */
export interface FlowUi {
  /** draw a form card for `spec`, answered by `handlers` */
  card(spec: FormSpec, handlers: FlowHandlers): HTMLElement;
  /** replace what is shown with these nodes (the card, and a way back) */
  show(...kids: Node[]): void;
  /** leave the flow: the list is drawn again */
  back(): void;
  /** run `fn` once the card's receipt has shown */
  later(fn: () => void): void;
  toast(text: string): void;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const lines = (v: unknown): string[] => text(v).split('\n').map((l) => l.trim()).filter(Boolean);

/** what a failed Test says, in the host's own one line (it never carries the server's text or the key) */
export function testProblem(t: EndpointTest): string {
  switch (t.outcome) {
    case 'needs_key': return t.detail ?? 'The server asked for a key. Type it and test again.';
    case 'not_a_model_server': return t.detail ?? 'Something answered at that address, but it is not a model server.';
    case 'unreachable': return t.detail ?? 'Nothing answered at that address.';
    default: return t.detail ?? 'The test did not finish.';
  }
}

/** the ids Save sends: the ticked ones, then the typed ones, each once, in that order */
export function chosenModels(values: Readonly<Record<string, unknown>>): string[] {
  const picks = Array.isArray(values['picks']) ? (values['picks'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  return [...new Set([...picks, ...lines(values['extra_models'])])];
}

export interface EndpointFlowOptions {
  /** fill the first step (a runtime found on this computer: its address and wire) */
  prefill?: Partial<EndpointValues>;
  /** called with the saved way once Save succeeded (after the receipt) */
  saved?: (state: ProviderState) => void;
}

/** Start the flow in `ui`. Returns what stops it early (the section is closed): the typed key is dropped. */
export function startEndpointFlow(ui: FlowUi, bridge: ProvidersBridge, opts: EndpointFlowOptions = {}): { abort: () => void } {
  let key = '';
  const forget = (): void => { key = ''; };

  const stepSave = (typed: Partial<EndpointValues>, found: readonly string[]): void => {
    const model = endpointForm('save', { found, values: typed });
    ui.show(ui.card(model.spec, {
      async submit(_id, outcome) {
        const v = outcome.values;
        const request: EndpointRequest = {
          name: text(v['name']).trim(), base_url: text(v['base_url']).trim(), api_mode: (text(v['api_mode']) || 'chat_completions') as EndpointRequest['api_mode'],
          key: key || null, models: chosenModels(v), discover: v['discover'] !== false, context_length: null, request_timeout_s: null, use_model: null
        };
        let saved: ProviderState;
        try { saved = await bridge.addEndpoint(request); } catch (e) { forget(); throw new Error(e instanceof Error ? e.message : 'The endpoint was not saved.'); }
        forget();
        ui.later(() => { ui.toast(saved.status === 'error' ? (saved.detail ?? 'Saved, but it has a problem.') : 'Saved. Choose it from your model list.'); opts.saved?.(saved); ui.back(); });
      },
      cancel() { forget(); ui.back(); return Promise.resolve(); }
    }));
  };

  const stepTest = (values?: Partial<EndpointValues>): void => {
    const model = endpointForm('test', { values: values ?? opts.prefill ?? {} });
    ui.show(ui.card(model.spec, {
      async submit(_id, outcome) {
        const v = outcome.values;
        const typed: Partial<EndpointValues> = { name: text(v['name']).trim(), base_url: text(v['base_url']).trim(), api_mode: (text(v['api_mode']) || 'chat_completions') as EndpointValues['api_mode'], discover: v['discover'] !== false };
        key = outcome.secrets['key'] ?? '';
        let t: EndpointTest;
        try { t = await bridge.testEndpoint({ base_url: typed.base_url ?? '', api_mode: typed.api_mode ?? 'chat_completions', key: key || null }); } catch (e) { forget(); throw new Error(e instanceof Error ? e.message : 'The test did not run.'); }
        if (t.outcome !== 'listed' && t.outcome !== 'empty') { forget(); throw new Error(testProblem(t)); }
        ui.later(() => { stepSave(typed, t.outcome === 'listed' ? t.models : []); });
      },
      cancel() { forget(); ui.back(); return Promise.resolve(); }
    }));
  };
  stepTest();
  return { abort: forget };
}
