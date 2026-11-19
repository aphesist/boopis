/* The renderer diagnostics: what the host decided about WebKitGTK's renderer (ADR-0024) and what this page can see of
   the display. The owner copies the text from Settings > General > Diagnostics and sends it when a machine is slow or
   blank; `webkit://gpu` (WebKitGTK's own page) says which buffer path is in use. */
import { commands } from './bindings';
import { orbState } from '../components/orb-worker/host';
import type { AppSettings, GpuPolicy, RendererReport } from './bindings';
import { asHostError } from './bridge';

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

/** the report as plain text, one fact a line, for a message */
export function reportText(r: RendererReport, d: DisplayFacts, f?: FrameStats | null): string {
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
    'hypotaxis renderer report',
    `WebKitGTK: ${w.version ?? 'unknown'}, ${w.origin === 'bundled' ? 'bundled (AppImage)' : w.origin === 'system' ? 'the system\'s' : 'origin unknown'}${w.library ? ` (${w.library})` : ''}`,
    `session: ${r.session}${r.hyprland ? ' (Hyprland)' : ''}`,
    `page: ${d.innerWidth}x${d.innerHeight} CSS px at devicePixelRatio ${d.devicePixelRatio} (${Math.round(d.innerWidth * d.devicePixelRatio)}x${Math.round(d.innerHeight * d.devicePixelRatio)} buffer px)`,
    `display refresh (GDK): ${rate ? `${rate} Hz` : 'unknown'}${fr.monitor ? ` (${fr.monitor})` : ''}`,
    `60 fps preference (HYPOTAXIS_FPS=${fr.policy}): ${pref}${fr.rule ? `; rule ${fr.rule}` : ''}`,
    `power profile: ${fr.power_profile}${fr.platform_profile ? ` (platform_profile ${fr.platform_profile})` : ''}${fr.power_profile === 'power_saver' ? '; WebKit halves its frame rate in power-saver' : ''}`,
    'GPUs:', ...gpus,
    `GPU choice (HYPOTAXIS_GPU, from ${g.policy_source}): ${g.policy}; rule ${g.rule}; set by the host: ${gset}`,
    `GPU display: ${g.display_gpu ?? 'unknown'}; dedicated: ${g.dedicated_gpu ?? 'none'}; power source: ${g.power}`,
    `GL renderer in the page: ${d.glRenderer ?? 'not available'}${d.glVendor ? ` (vendor ${d.glVendor})` : ''}`,
    ...(g.warning === 'may_crash_on_wayland' ? ['warning: the dedicated GPU on Wayland with a WebKitGTK before 2.54.2 may crash or stay blank (the explicit-sync bug)'] : []),
    ...(g.restart_advice ? [`restart would switch to the ${g.restart_advice === 'to_dedicated' ? 'dedicated' : 'integrated'} GPU (the power source changed)`] : []),
    `renderer policy (HYPOTAXIS_RENDERER): ${r.policy}`,
    `renderer rule: ${r.rule}`,
    `set by the host: ${set}`,
    ...(r.note ? [`note: ${r.note}`] : []),
    'environment now:', ...env,
    ...(d.orbs ? [`orbs draw in: ${d.orbs}`] : []),
    `user agent: ${d.userAgent}`,
    'choices: ' + r.choices.map(([k, v]) => `${k} = ${v}`).join('; '),
    ...(f ? [`frames over ${f.seconds} s: ${describeFrames(f, rate)} (p50 ${f.p50} ms, p95 ${f.p95} ms, max ${f.max} ms, ${f.over33} over 33 ms, ${f.frames} frames)`] : [])
  ].join('\n');
}

export async function loadReport(): Promise<RendererReport> {
  try { return await commands.rendererReport(); } catch (e) { throw asHostError(e); }
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
