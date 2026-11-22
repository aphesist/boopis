/* The living ground (craft bible part 6): never flat black. A near-black from the product's tokens, one soft light pool
   that drifts slowly, and a fine monochrome grain that changes every frame (it lights the ground and dithers the
   gradients so the 8-bit encode does not band). The art director's look (look/) decides the final ground; these are
   the engine's defaults, every value a CSS custom property on .film-stage:

     --ground, --ground-edge   the centre and the edges (default: the product's --bg-2 falling to --bg-0, as the script)
     --pool, --pool-strength   the light (default: --brass at 9%; never a flat colour field)
     --pool-x/-y       where the light sits (% of the frame)
     --grain-alpha     the grain's strength (default 0.025: the script's 2.5%)

   Speed: the light is a CSS gradient on its own layer moved by transform (no repaint), and the grain is six small
   pre-drawn tiles picked by frame number (no full-frame canvas fill per frame: the trap the scout measured). In a
   render the page draws no grain (?nograin) and the renderer adds the same tiles to each finished frame. */
import type { Film } from './film';
import type { Stage } from './stage';
import { rng } from './rng';

export interface GroundOpts { grain?: boolean; drift?: [number, number]; seed?: number }

export function ground(film: Film, stage: Stage, o: GroundOpts = {}): void {
  const g = stage.ground;
  g.dataset['depth'] = '0.25';
  g.innerHTML = '<div class="film-ground__base"></div><div class="film-ground__pool"></div>';
  const pool = g.querySelector<HTMLElement>('.film-ground__pool')!;
  const [dx, dy] = o.drift ?? [0.03, 0.015];
  /* the light pool drifts 2 to 4% of the frame width over 10 s: a pure function of t (linear constant drift, allowed) */
  film.onRender((t) => {
    const p = t / 10;
    pool.style.translate = (Math.sin(p * Math.PI * 0.9) * dx * stage.width).toFixed(2) + 'px ' + (Math.sin(p * Math.PI * 0.7 + 1) * dy * stage.height).toFixed(2) + 'px';
  });
  if (o.grain === false) return;
  const seed = o.seed ?? 7, alpha = Number(getComputedStyle(stage.root).getPropertyValue('--grain-alpha')) || 0.025;
  /* the renderer adds the grain itself, after the capture (tools/lib/grain.mjs, the same tiles from the same seed): a
     page without grain captures and compresses about twice as fast. The page draws it for previews and style frames. */
  film.grain = { seed, alpha };
  if (!new URLSearchParams(location.search).has('nograin')) grain(film, stage, seed);
}

/** six seeded 256 px tiles; frame n shows tile n mod 6 at an offset from the same seed (deterministic) */
function grain(film: Film, stage: Stage, seed: number): void {
  const N = 6, S = 256;
  const tiles: string[] = [];
  const r = rng(seed);
  for (let k = 0; k < N; k++) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = r();
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(v * 255);
    }
    ctx.putImageData(img, 0, 0);
    tiles.push('url(' + c.toDataURL('image/png') + ')');
  }
  const el = document.createElement('div');
  el.className = 'film-grain';
  stage.screen.appendChild(el);
  const pos = rng(seed + 1);
  const offsets = Array.from({ length: 64 }, () => [Math.floor(pos() * S), Math.floor(pos() * S)] as const);
  film.onRender((t) => {
    const n = Math.round(t * film.fps);
    el.style.backgroundImage = tiles[n % N]!;
    const o = offsets[n % offsets.length]!;
    el.style.backgroundPosition = o[0] + 'px ' + o[1] + 'px';
  });
}
