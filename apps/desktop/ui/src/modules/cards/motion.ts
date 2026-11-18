/* Card motion from the tokens. preset: 'settle' = layout travel (--dur-3, --spring); 'fade' = menus and fades
   (--dur-2, --ease); 'quick' = hover scale (--dur-1, --ease). Under reduced motion transforms go and durations
   shorten, but state changes still show: reduce, never freeze. */
import { reduced } from '../../core/dom';

const tok = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const ms = (name: string, fallback: number): number => { const v = tok(name, ''); const n = parseFloat(v); return isNaN(n) ? fallback : (/ms$/.test(v) ? n : n * 1000); };
export type Preset = 'settle' | 'fade' | 'quick';
export function motion(preset: Preset): { duration: number; easing: string } {
  if (preset === 'settle') return { duration: ms('--dur-3', 300), easing: tok('--spring', 'ease-out') };
  if (preset === 'quick') return { duration: ms('--dur-1', 150), easing: tok('--ease', 'ease-out') };
  return { duration: ms('--dur-2', 200), easing: tok('--ease', 'ease-out') };
}
const stripMotion = (kf: Keyframe[]): Keyframe[] => kf.map((k) => { const o = { ...k }; delete o.transform; delete o.translate; delete o.scale; return o; });
export interface AnimOpts { preset?: Preset; duration?: number; easing?: string; delay?: number; fill?: FillMode }
export function animate(el: Element | null | undefined, kf: Keyframe[], o: AnimOpts = {}): Animation | null {
  if (!el || !el.animate) return null;
  const m = motion(o.preset ?? 'fade');
  const rm = reduced();
  return el.animate(rm ? stripMotion(kf) : kf, {
    duration: rm ? Math.min(m.duration, 120) : (o.duration || m.duration),
    easing: o.easing || m.easing,
    delay: rm ? 0 : (o.delay || 0),
    fill: o.fill ?? 'none'
  });
}
export const easeToken = (): string => tok('--ease', 'ease-out');
