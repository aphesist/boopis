/* The renderer diagnostics: what the host decided about WebKitGTK's renderer (ADR-0024) and what this page can see of
   the display. The owner copies the text from Settings > General > Diagnostics and sends it when a machine is slow or
   blank; `webkit://gpu` (WebKitGTK's own page) says which buffer path is in use. */
import { engineDetails } from './errors';
import { commands } from './bindings';
import { orbState } from '@boopis/ui';
import type { AppSettings, GpuPolicy, RendererReport } from './bindings';
import { asHostError } from './bridge';
import { currentPlan, planLines } from './free-tier';
import type { PlanView } from './free-tier';

/** what only the page knows; the GL strings are the GPU the web process really draws on (WebGL goes through the same EGL display as the page) */
export interface DisplayFacts { devicePixelRatio: number; innerWidth: number; innerHeight: number; userAgent: string; glRenderer?: string | null; glVendor?: string | null; orbs?: string }

/** the WebGL renderer and vendor strings, or null when the page has no WebGL (never throws) */
export function glInfo(): { renderer: string | null; vendor: string | null } {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return { renderer: null, vendor: null };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const get = (p: number | undefined, fallback: number): string | null => { const v: unknown = gl.getParameter(p ?? fallback); return typeof v === 'string' && v ? v : null; };
    const info = { renderer: get(ext?.UNMASKED_RENDERER_WEBGL, gl.RENDERER), vendor: get(ext?.UNMASKED_VENDOR_WEBGL, gl.VENDOR) };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return info;
  } catch { return { renderer: null, vendor: null }; }
}

export const displayFacts = (): DisplayFacts => {
  const gl = glInfo();
  return { devicePixelRatio: window.devicePixelRatio, innerWidth: window.innerWidth, innerHeight: window.innerHeight, userAgent: navigator.userAgent, glRenderer: gl.renderer, glVendor: gl.vendor, orbs: orbState.mode + (orbState.why ? ` (${orbState.why})` : '') };
};

/** frame timing over a few seconds, from requestAnimationFrame deltas (what the perf harness measures) */
export interface FrameStats { seconds: number; frames: number; fps: number; p50: number; p95: number; p99: number; max: number; over33: number }

/** pure: the statistics of a list of frame deltas in ms */
export function summarizeFrames(deltas: readonly number[]): FrameStats {
  const sorted = [...deltas].sort((a, b) => a - b), n = sorted.length, sum = deltas.reduce((a, b) => a + b, 0);
  const at = (p: number): number => sorted[Math.min(n - 1, Math.floor(p * n))] ?? 0;
  const r1 = (x: number): number => Math.round(x * 10) / 10;
  return { seconds: r1(sum / 1000), frames: n, fps: n && sum ? r1(n / (sum / 1000)) : 0, p50: r1(at(0.5)), p95: r1(at(0.95)), p99: r1(at(0.99)), max: r1(sorted[n - 1] ?? 0), over33: deltas.filter((d) => d > 34.4).length };
}
/** a rate in millihertz as Hz: 120000 -> 120, 59940 -> 59.9 */
export function hz(millihertz: number | null | undefined): number | null {
  return millihertz && millihertz > 0 ? Math.round(millihertz / 100) / 10 : null;
}
/** the measured rate against the display's, for a toast and the report: `118 of 120 fps, p99 9.1 ms` */
export function describeFrames(f: FrameStats, displayHz?: number | null): string {
  const fps = Math.round(f.fps);
  return `${displayHz ? `${fps} of ${displayHz}` : String(fps)} fps, p99 ${f.p99} ms`;
}
/** record `ms` of frames; the person moves the pointer along the dock meanwhile */
export function measureFrames(ms = 5000): Promise<FrameStats> {
  return new Promise((done) => {
    const deltas: number[] = []; let last = 0; const t0 = performance.now();
    const tick = (t: number): void => {
      if (last) deltas.push(t - last);
      last = t;
      if (t - t0 < ms) requestAnimationFrame(tick); else done(summarizeFrames(deltas));
    };
    requestAnimationFrame(tick);
  });
}

const GPU_LABELS: Record<GpuPolicy, string> = { auto: 'Automatic', integrated: 'Integrated', dedicated: 'Dedicated' };
export const gpuLabel = (p: GpuPolicy): string => GPU_LABELS[p];

/** the raw words behind the error sentences of this run (the engine's, ADR-0031, and a failed request's): Diagnostics is the one place they are shown */
export function errorLines(host: readonly { code: string; detail: string; at: number | null }[], ui: readonly { code: string; detail: string; at: number }[]): string[] {
  const all = [...host.map((e) => ({ ...e, at: (e.at ?? 0) * 1000 })), ...ui].sort((a, b) => a.at - b.at);
  if (!all.length) return ['errors behind the messages shown: none this run'];
  return ['errors behind the messages shown (the raw words, kept here only):', ...all.map((e) => `  ${new Date(e.at).toISOString()}  ${e.code}  ${e.detail}`)];
}

type Health = NonNullable<RendererReport['health']>;
type Run = Health['this_run'];
const when = (secs: number): string => new Date(secs * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
function runLines(label: string, r: Run): string[] {
  const head = `${label}: boopis ${r.version}, started ${when(r.started)}; ${r.recoveries} ${r.recoveries === 1 ? 'recovery' : 'recoveries'}; longest page stall ${r.longest_stall_ms} ms; outbox peak ${r.outbox_peak} frames`;
  const beat = r.last_heartbeat != null ? [`  last page heartbeat ${when(r.last_heartbeat)} (${r.last_visible === false ? 'hidden' : r.last_visible ? 'visible' : 'visibility unknown'})`] : [];
  const events = r.events.map((e) => `  ${when(e.at)}  ${e.kind}${e.detail ? ` (${e.detail})` : ''}${e.value != null ? ` ${e.value}` : ''}`);
  return [head, ...beat, ...(events.length ? events : ['  no web view events'])];
}
/** the web view's health (src-tauri/src/webview_health.rs): web-process ends and why, unresponsive periods, recoveries, the
    page's longest stall and the outbox peak, this run and the last */
export function healthLines(h: RendererReport['health']): string[] {
  if (!h) return [];
  return [
    `window watchdog: ${h.watching ? 'watching the web process' : 'not watching (no web view signals here)'}`,
    ...runLines('this run', h.this_run),
    ...(h.last_run ? runLines('last run', h.last_run) : ['last run: no record'])
  ];
}

/** the report as plain text, one fact a line, for a message */
/** the renderer report, with the models plan when the live connection can ask */
export type Report = RendererReport & { plan?: PlanView | null };
export function reportText(r: Report, d: DisplayFacts, f?: FrameStats | null): string {
  const gpus = r.gpus.length
    ? r.gpus.map((g) => `  ${g.card}  vendor ${g.vendor}  driver ${g.driver ?? 'none'}${g.boot_display ? '  (boot display)' : ''}`)
    : ['  none found in /sys/class/drm'];
  const set = r.set.length ? r.set.map(([k, v]) => `${k}=${v}`).join(' ') : 'nothing';
  const env = r.environment.length ? r.environment.map(([k, v]) => `  ${k}=${v}`) : ['  none set'];
  const w = r.webkit, fr = r.frame_rate, g = r.gpu;
  const rate = hz(fr.refresh_millihertz);
  const pref = fr.preference_off == null ? `unknown${fr.refusal ? ` (${fr.refusal})` : ''}` : fr.preference_off ? 'off (WebKit may run at the display rate)' : `on (WebKit keeps near 60 fps${fr.refusal ? `; ${fr.refusal}` : ''})`;
  const gset = g.set.length ? g.set.map(([k, v]) => `${k}=${v}`).join(' ') + (g.env_source ? ` (${g.env_source})` : '') : 'nothing';
  return [
    'boopis renderer report',
    `WebKitGTK: ${w.version ?? 'unknown'}, ${w.origin === 'bundled' ? 'bundled (AppImage)' : w.origin === 'system' ? 'the system\'s' : 'origin unknown'}${w.library ? ` (${w.library})` : ''}`,
    `session: ${r.session}${r.hyprland ? ' (Hyprland)' : ''}`,
    `page: ${d.innerWidth}x${d.innerHeight} CSS px at devicePixelRatio ${d.devicePixelRatio} (${Math.round(d.innerWidth * d.devicePixelRatio)}x${Math.round(d.innerHeight * d.devicePixelRatio)} buffer px)`,
    `display refresh (GDK): ${rate ? `${rate} Hz` : 'unknown'}${fr.monitor ? ` (${fr.monitor})` : ''}`,
    `60 fps preference (BOOPIS_FPS=${fr.policy}): ${pref}${fr.rule ? `; rule ${fr.rule}` : ''}`,
    `power profile: ${fr.power_profile}${fr.platform_profile ? ` (platform_profile ${fr.platform_profile})` : ''}${fr.power_profile === 'power_saver' ? '; WebKit halves its frame rate in power-saver' : ''}`,
    'GPUs:', ...gpus,
    `GPU choice (BOOPIS_GPU, from ${g.policy_source}): ${g.policy}; rule ${g.rule}; set by the host: ${gset}`,
    `GPU display: ${g.display_gpu ?? 'unknown'}; dedicated: ${g.dedicated_gpu ?? 'none'}; power source: ${g.power}`,
    `GL renderer in the page: ${d.glRenderer ?? 'not available'}${d.glVendor ? ` (vendor ${d.glVendor})` : ''}`,
    ...(g.warning === 'may_crash_on_wayland' ? ['warning: the dedicated GPU on Wayland with a WebKitGTK before 2.54.2 may crash or stay blank (the explicit-sync bug)'] : []),
    ...(g.restart_advice ? [`restart would switch to the ${g.restart_advice === 'to_dedicated' ? 'dedicated' : 'integrated'} GPU (the power source changed)`] : []),
    `renderer policy (BOOPIS_RENDERER): ${r.policy}`,
    `renderer rule: ${r.rule}`,
    `set by the host: ${set}`,
    ...(r.note ? [`note: ${r.note}`] : []),
    'environment now:', ...env,
    ...(d.orbs ? [`orbs draw in: ${d.orbs}`] : []),
    `user agent: ${d.userAgent}`,
    'choices: ' + r.choices.map(([k, v]) => `${k} = ${v}`).join('; '),
    ...(r.plan ? planLines(r.plan) : []),
    ...healthLines(r.health),
    ...(f ? [`frames over ${f.seconds} s: ${describeFrames(f, rate)} (p50 ${f.p50} ms, p95 ${f.p95} ms, max ${f.max} ms, ${f.over33} over 33 ms, ${f.frames} frames)`] : []),
    ...errorLines(r.errors ?? [], engineDetails())
  ].join('\n');
}

export async function loadReport(): Promise<Report> {
  let report: RendererReport;
  try { report = await commands.rendererReport(); } catch (e) { throw asHostError(e); }
  return { ...report, plan: await currentPlan() };   /* null where there is no live connection to ask */
}
/** open WebKitGTK's `webkit://gpu` page in its own window */
export async function openGpuPage(): Promise<void> {
  try { await commands.rendererOpenGpuPage(); } catch (e) { throw asHostError(e); }
}

/** the saved GPU choice, and saving it (read at startup: it applies after a restart) */
export async function loadGpuChoice(): Promise<{ settings: AppSettings; policy: GpuPolicy }> {
  try { const settings = await commands.appSettingsGet(); return { settings, policy: settings.gpu ?? 'auto' }; } catch (e) { throw asHostError(e); }
}
export async function saveGpuChoice(settings: AppSettings, policy: GpuPolicy): Promise<void> {
  try { await commands.appSettingsSet({ ...settings, gpu: policy }); } catch (e) { throw asHostError(e); }
}
/** restart the app so the GPU choice applies */
export async function restartApp(): Promise<void> {
  try { await commands.appRestart(); } catch (e) { throw asHostError(e); }
}
