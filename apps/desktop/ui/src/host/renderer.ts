/* The renderer diagnostics: what the host decided about WebKitGTK's renderer (ADR-0024) and what this page can see of
   the display. The owner copies the text from Settings > General > Diagnostics and sends it when a machine is slow or
   blank; `webkit://gpu` (WebKitGTK's own page) says which buffer path is in use. */
import { commands } from './bindings';
import { orbState } from '../components/orb-worker/host';
import type { RendererReport } from './bindings';
import { asHostError } from './bridge';

/** what only the page knows */
export interface DisplayFacts { devicePixelRatio: number; innerWidth: number; innerHeight: number; userAgent: string; orbs?: string }

export const displayFacts = (): DisplayFacts => ({ devicePixelRatio: window.devicePixelRatio, innerWidth: window.innerWidth, innerHeight: window.innerHeight, userAgent: navigator.userAgent, orbs: orbState.mode + (orbState.why ? ` (${orbState.why})` : '') });

/** frame timing over a few seconds, from requestAnimationFrame deltas (what the perf harness measures) */
export interface FrameStats { seconds: number; frames: number; fps: number; p50: number; p95: number; max: number; over33: number }

/** pure: the statistics of a list of frame deltas in ms */
export function summarizeFrames(deltas: readonly number[]): FrameStats {
  const sorted = [...deltas].sort((a, b) => a - b), n = sorted.length, sum = deltas.reduce((a, b) => a + b, 0);
  const at = (p: number): number => sorted[Math.min(n - 1, Math.floor(p * n))] ?? 0;
  const r1 = (x: number): number => Math.round(x * 10) / 10;
  return { seconds: r1(sum / 1000), frames: n, fps: n && sum ? r1(n / (sum / 1000)) : 0, p50: r1(at(0.5)), p95: r1(at(0.95)), max: r1(sorted[n - 1] ?? 0), over33: deltas.filter((d) => d > 34.4).length };
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

/** the report as plain text, one fact a line, for a message */
export function reportText(r: RendererReport, d: DisplayFacts, f?: FrameStats | null): string {
  const gpus = r.gpus.length
    ? r.gpus.map((g) => `  ${g.card}  vendor ${g.vendor}  driver ${g.driver ?? 'none'}${g.boot_display ? '  (boot display)' : ''}`)
    : ['  none found in /sys/class/drm'];
  const set = r.set.length ? r.set.map(([k, v]) => `${k}=${v}`).join(' ') : 'nothing';
  const env = r.environment.length ? r.environment.map(([k, v]) => `  ${k}=${v}`) : ['  none set'];
  return [
    'hypotaxis renderer report',
    `session: ${r.session}${r.hyprland ? ' (Hyprland)' : ''}`,
    `page: ${d.innerWidth}x${d.innerHeight} CSS px at devicePixelRatio ${d.devicePixelRatio} (${Math.round(d.innerWidth * d.devicePixelRatio)}x${Math.round(d.innerHeight * d.devicePixelRatio)} buffer px)`,
    'GPUs:', ...gpus,
    `policy (HYPOTAXIS_RENDERER): ${r.policy}`,
    `rule: ${r.rule}`,
    `set by the host: ${set}`,
    'environment now:', ...env,
    ...(d.orbs ? [`orbs draw in: ${d.orbs}`] : []),
    `user agent: ${d.userAgent}`,
    'choices: ' + r.choices.map(([k, v]) => `${k} = ${v}`).join('; '),
    ...(f ? [`frames over ${f.seconds} s: ${f.fps} fps, p50 ${f.p50} ms, p95 ${f.p95} ms, max ${f.max} ms, ${f.over33} over 33 ms (${f.frames} frames)`] : [])
  ].join('\n');
}

export async function loadReport(): Promise<RendererReport> {
  try { return await commands.rendererReport(); } catch (e) { throw asHostError(e); }
}
/** open WebKitGTK's `webkit://gpu` page in its own window */
export async function openGpuPage(): Promise<void> {
  try { await commands.rendererOpenGpuPage(); } catch (e) { throw asHostError(e); }
}
