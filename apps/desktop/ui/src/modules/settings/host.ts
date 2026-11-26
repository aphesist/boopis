/* What Settings reaches outside the data provider: the desktop app's host for the parts that exist only there (the window controls'
   detection, the Local API, Diagnostics, the providers and connectors views), as one seam. The real one asks Tauri; the lab and the
   tests replace parts of it (`setSettingsHost`), so every page and state can be drawn without a host. */
import { inTauri } from '../../host/bridge';
import type { LocalApiBridge } from '../../host/local-api';

export interface DiagnosticsHost {
  /** the renderer report as text to copy (the frames measured, when they were) */
  report(withFrames: boolean): Promise<string>;
  /** measure frames for `ms`; the words to show */
  measure(ms: number): Promise<string>;
  /** WebKitGTK's own GPU page */
  gpuPage(): Promise<void>;
  /** the GPU choice and what runs now, in plain lines */
  gpu(): Promise<{ policy: 'auto' | 'integrated' | 'dedicated'; lines: (chosen: 'auto' | 'integrated' | 'dedicated') => string[]; restart: (chosen: 'auto' | 'integrated' | 'dedicated') => boolean }>;
  setGpu(policy: 'auto' | 'integrated' | 'dedicated'): Promise<void>;
  restart(): Promise<void>;
}

export interface SettingsHost {
  /** the desktop app (its host can be asked) */
  desktop: () => boolean;
  localApi: () => LocalApiBridge | null;
  diagnostics: () => DiagnosticsHost | null;
}

async function realDiagnostics(): Promise<DiagnosticsHost> {
  const m = await import('../../host/renderer');
  let frames: import('../../host/renderer').FrameStats | null = null;
  return {
    async report(withFrames) { return m.reportText(await m.loadReport(), m.displayFacts(), withFrames ? frames : null); },
    async measure(ms) {
      const rate = m.hz((await m.loadReport().catch(() => null))?.frame_rate.refresh_millihertz);
      frames = await m.measureFrames(ms);
      return m.describeFrames(frames, rate) + ': Copy report includes it';
    },
    gpuPage: () => m.openGpuPage(),
    async gpu() {
      const [{ policy }, report] = await Promise.all([m.loadGpuChoice(), m.loadReport()]);
      const g = report.gpu;
      return {
        policy,
        lines: (chosen) => {
          const lines: string[] = [];
          lines.push(g.policy_source === 'environment' ? `BOOPIS_GPU is set (${m.gpuLabel(g.policy)}) and overrides this choice.` : `Running on: ${g.set.length ? 'the dedicated GPU' : 'the integrated GPU'} (${g.rule.replace(/_/g, ' ')}).`);
          if (g.warning === 'may_crash_on_wayland') lines.push('The dedicated GPU on Wayland with this WebKitGTK (before 2.54.2) may crash or show a blank window.');
          if (g.restart_advice) lines.push(`The power source changed: a restart would switch to the ${g.restart_advice === 'to_dedicated' ? 'dedicated' : 'integrated'} GPU.`);
          if (chosen !== g.policy && g.policy_source !== 'environment') lines.push('Saved. It applies after a restart.');
          return lines;
        },
        restart: (chosen) => (chosen !== g.policy && g.policy_source !== 'environment') || !!g.restart_advice
      };
    },
    async setGpu(policy) { const { settings } = await m.loadGpuChoice(); await m.saveGpuChoice(settings, policy); },
    restart: () => m.restartApp()
  };
}

let diag: Promise<DiagnosticsHost> | null = null;
const real: SettingsHost = {
  desktop: inTauri,
  localApi: () => null,
  diagnostics: () => null
};
/** the host as Settings uses it; the desktop app's parts are made once, on first use */
export const settingsHost: SettingsHost = { ...real };
export async function diagnosticsHost(): Promise<DiagnosticsHost | null> {
  const given = settingsHost.diagnostics();
  if (given) return given;
  if (!settingsHost.desktop() || settingsHost.diagnostics !== real.diagnostics) return null;
  diag ??= realDiagnostics();
  return diag;
}
export async function localApiHost(): Promise<LocalApiBridge | null> {
  const given = settingsHost.localApi();
  if (given) return given;
  if (!settingsHost.desktop() || settingsHost.localApi !== real.localApi) return null;
  return (await import('../../host/local-api')).tauriLocalApiBridge();
}
/** the lab and the tests: replace parts of the host (and `resetSettingsHost` after) */
export function setSettingsHost(parts: Partial<SettingsHost>): void { Object.assign(settingsHost, parts); }
export function resetSettingsHost(): void { Object.assign(settingsHost, real); diag = null; }
