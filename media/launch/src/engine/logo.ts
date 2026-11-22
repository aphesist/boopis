/* The boopis mark and wordmark as geometry, from the vendored <boopis-logo> (apps/desktop/ui/vendor/boopis-logo.js):
   `BoopisLogo.svg()` is the logo's own static export, so the film draws the real mark and never a redrawing of it.
   One colour, no effects (design/v6/brand/logo/README.md). */
import type { Pt } from './orb';

export interface MarkGeometry {
  /** each eye's outline in px, centred on the mark's centre, for a mark `width` px wide */
  eyes: Pt[][];
  width: number;
  height: number;
}

const NUM = /-?\d*\.?\d+(?:e-?\d+)?/gi;

/** the mark's two eyes as polygons (the export's paths sampled along their length), centred on (0, 0) */
export function markGeometry(width: number, state: string | null = null, samples = 160): MarkGeometry {
  const svg = window.BoopisLogo.svg({ mark: true, pad: 0, color: '#fff', ...(state ? { state } : {}) });
  const box = /viewBox="([^"]+)"/.exec(svg)?.[1]?.split(/[\s,]+/).map(Number) ?? [0, 0, 1, 1];
  const [vx = 0, vy = 0, vw = 1, vh = 1] = box;
  const k = width / vw;
  const ds = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]!);
  const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tmp.style.position = 'absolute'; tmp.style.visibility = 'hidden';
  document.body.appendChild(tmp);
  const eyes: Pt[][] = [];
  for (const d of ds) {
    /* a path may hold several closed subpaths: split on M */
    for (const sub of d.split(/(?=[Mm])/).filter((s) => (s.match(NUM) ?? []).length >= 4)) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', sub);
      tmp.appendChild(p);
      const L = p.getTotalLength(), pts: Pt[] = [];
      for (let i = 0; i < samples; i++) {
        const q = p.getPointAtLength((L * i) / samples);
        pts.push([(q.x - vx - vw / 2) * k, (q.y - vy - vh / 2) * k]);
      }
      eyes.push(pts);
    }
  }
  tmp.remove();
  eyes.sort((a, b) => a[0]![0] - b[0]![0]);
  return { eyes, width, height: vh * k };
}

/** the wordmark or mark as an SVG string in one colour (a static frame of the logo) */
export function logoSVG(o: { mark?: boolean; color?: string; state?: string; weight?: 500 | 600 } = {}): string {
  return window.BoopisLogo.svg({ pad: 0, color: o.color ?? 'currentColor', ...(o.mark ? { mark: true } : {}), ...(o.state ? { state: o.state } : {}), ...(o.weight ? { weight: o.weight } : {}) });
}
