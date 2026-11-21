/* Using a runtime found on this computer (ADR-0039): the one place that says how, for Settings > Models and first-run setup.
   LM Studio is the engine's own provider (`lmstudio`), so the host configures that provider with the models LM Studio itself
   listed (it rejects an id it does not list); the other runtimes (Ollama, llama.cpp, vLLM) are ordinary endpoints under the
   catalogue's own name. Either way the first model the runtime listed becomes the person's model, and models on this computer
   are never governed ones (the host decides that; nothing here can make one frontier). */
import { endpointRules } from '../data/providers';
import type { Entry, Way } from '../data/providers';
import type { ProvidersBridge } from './providers-bridge';

/** what was done: the model now in use (null when the runtime listed none), whether the engine's own provider took it, and, then, what
    the host said ("Using <model>.", possibly with why the engine restarts later) */
export interface LocalUse { model: string | null; builtin: boolean; said?: string }

/** The sentence for the person, in the same words wherever it is said. */
export function localUseNote(entry: Entry, use: LocalUse): string {
  const off = 'Governed mode stays off for models on this computer.';
  if (use.builtin && use.said) return `${use.said} ${off}`;
  if (use.model) return `Using ${use.model} on ${entry.label}. ${off}`;
  return `${entry.label} is added. Choose a model from your model list.`;
}

/** Use the runtime `way` that answered at `baseUrl`. Throws the host's own sentence when it cannot. */
export async function useLocalRuntime(bridge: ProvidersBridge, way: Way, baseUrl: string): Promise<LocalUse> {
  if (way.config === 'builtin') {
    /* the host asks the runtime itself which models it lists and takes the first: no id from here is ever sent */
    const s = await bridge.useLocal(way.id, null);
    return { model: s.detail ? s.detail.replace(/^Using /, '').replace(/\.( .*)?$/, '') : null, builtin: true, ...(s.detail ? { said: s.detail } : {}) };
  }
  const mode = way.api_mode ?? 'chat_completions';
  const t = await bridge.testEndpoint({ base_url: baseUrl, api_mode: mode });
  const first = t.models[0] ?? null;
  await bridge.addEndpoint({
    name: (way.slug ?? way.engine ?? way.id).replace(/^custom-/, ''), base_url: baseUrl, api_mode: mode, key: null,
    models: t.models.slice(0, endpointRules().limits.max_models), discover: true, context_length: null, request_timeout_s: null, use_model: first
  });
  return { model: first, builtin: false };
}
