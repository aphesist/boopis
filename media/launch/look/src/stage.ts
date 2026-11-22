/* What every style frame shares: the product's fonts, tokens and kit CSS, the orb element and the logo element (each imported
   from apps/desktop/ui, never copied), the film's own CSS, the film cast, and helpers to put orbs, lab marks and grain on a
   stage. A frame's script calls `frame(build)` and the renderer waits for `html[data-ready]`. */
import '@fontsource/libre-franklin/latin-400.css';
import '@fontsource/libre-franklin/latin-500.css';
import '@fontsource/libre-franklin/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './tokens';
/* the kit's stylesheet as kit.css lists it, after the tokens (see tokens.ts for why kit.css itself is not imported) */
import '@ui/src/components/components.css';
import '@ui/src/components/model-mark.css';
import '@ui/src/components/progress.css';
import '@ui/src/components/presence.css';
import '@ui/src/components/signin-button.css';
import '@ui/src/components/mod-view.css';
import './film.css';
import '@ui/vendor/orb-avatar.min.js';
import '@ui/vendor/boopis-logo.js';
import { markOf } from '@ui/src/components/signin-button';
import { lookAttrs } from '@ui/src/components/look';

/* orb2 lowers its own canvas resolution when frames run long (quality "auto"); a film frame is drawn once, at full
   resolution: level 0 is the device pixel ratio capped at 2, exactly what a 4K render (1080p layout at 2x) needs */
(window as unknown as { OrbAvatar: { quality: number | 'auto' } }).OrbAvatar.quality = 0;

/* ── the cast (SC/script/cast.md): four of the app's house bots, with the names, shapes, colours and roles the app ships
   (src/data/mock-data.ts), each on a different lab's plan (truth.md claim 5: shown, never claimed as measured). No other
   bot appears in the film. ── */
export type Lab = 'claude' | 'chatgpt' | 'github' | 'xai';
export interface FilmBot { id: string; name: string; role: string; shape: string; color: string; lab: Lab; plan: string; labName: string }
export const BOTS = {
  kai: { id: 'kai', name: 'kai', role: 'docs and changelog', shape: 'circle', color: '#4fc9a8', lab: 'claude', plan: 'Claude subscription', labName: 'Claude' },
  nina: { id: 'nina', name: 'nina', role: 'deploys', shape: 'triangle', color: '#f23b5a', lab: 'chatgpt', plan: 'ChatGPT subscription', labName: 'ChatGPT' },
  moss: { id: 'moss', name: 'moss', role: 'flaky test hunter', shape: 'squircle', color: '#2fd26a', lab: 'github', plan: 'GitHub Copilot subscription', labName: 'GitHub Copilot' },
  vox: { id: 'vox', name: 'vox', role: 'release notes', shape: 'circle', color: '#6d5cf0', lab: 'xai', plan: 'SuperGrok subscription', labName: 'SuperGrok' }
} satisfies Record<string, FilmBot>;
/** the room "release", its members in the group's order (kai leads) */
export const ROOM = { name: 'release', members: [BOTS.kai, BOTS.nina, BOTS.moss, BOTS.vox] };
/** a cast member by id (a mention, a member of a room), or undefined for a name that is not in the cast */
export const botById = (id: string): FilmBot | undefined => (BOTS as Record<string, FilmBot>)[id];

/* ── the labs' marks inside a film line or on a plan line: the labs' own files as the app's sign-in buttons draw them
   (components/signin-button.ts), never recoloured: Claude keeps #D97757, the others are their white files. Beside a model
   name inside the UI the kit draws its own mono marks (DESIGN-SYSTEM 10.1). ── */
export function labSvg(lab: Lab): string {
  const m = markOf(lab);
  return 'colour' in m ? m.colour : m.white;
}

/* ── elements ── */
export const h = (tag: string, cls?: string, html?: string, style?: Partial<Record<string, string>>): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (style) for (const [k, v] of Object.entries(style)) if (v != null) e.style.setProperty(k, v);
  return e;
};

export interface OrbOpts {
  size: number; reaction?: string; gaze?: [number, number]; x?: number; y?: number; shadow?: boolean; flag?: boolean;
  ring?: string; blur?: number; still?: boolean
}
/** an orb on the stage, centred on (x, y). Held still for a style frame: no drift, no idle glances, its gaze set. */
export function orb(bot: FilmBot, o: OrbOpts): HTMLElement {
  const wrap = h('div', 'orb', '', { '--o': o.size + 'px', width: o.size + 'px', height: o.size + 'px' });
  if (o.x != null) wrap.style.left = (o.x - o.size / 2) + 'px';
  if (o.y != null) wrap.style.top = (o.y - o.size / 2) + 'px';
  wrap.dataset['shape'] = bot.shape;
  if (o.shadow !== false) wrap.dataset['shadow'] = '';
  if (o.blur) wrap.style.filter = 'blur(' + o.blur + 'px)';
  const a = document.createElement('orb-avatar');
  const look = lookAttrs({ shape: bot.shape, color: bot.color });
  a.setAttribute('size', String(o.size));
  a.setAttribute('shape', look.shape);
  a.setAttribute('color', look.color);
  if (look['eye-color']) a.setAttribute('eye-color', look['eye-color']);
  a.setAttribute('reaction', o.reaction ?? 'idle');
  a.setAttribute('mode', 'fixed');
  a.setAttribute('idle-motion', 'off');
  a.setAttribute('label', bot.name);
  if (o.gaze) a.setAttribute('gaze', o.gaze.join(' '));
  if (o.still) a.setAttribute('static', '');
  wrap.append(a);
  if (o.flag) { wrap.dataset['flag'] = ''; const f = h('span', 'flag'); if (o.ring) f.style.setProperty('--ring', o.ring); wrap.append(f); }
  return wrap;
}

/** the product's own UI at film scale: an outer box placed in 1080p pixels, an inner one laid out at the product's size and
    zoomed, so text and corners rasterise at their final size. Orbs inside are redrawn at the zoomed size and zoomed back,
    because a canvas is a bitmap: an orb drawn at 20px and zoomed 3x would be soft. `width` is in the product's pixels. */
export function filmUI(content: string | Node, o: { x: number; y: number; scale?: number; width?: number; still?: boolean; cls?: string }): { outer: HTMLElement; inner: HTMLElement } {
  const x = o.scale ?? 3;
  const outer = h('div', 'ui-place' + (o.cls ? ' ' + o.cls : ''), '', { position: 'absolute', left: o.x + 'px', top: o.y + 'px' });
  const inner = h('div', 'ui-film', '', { '--ui-x': String(x), width: o.width ? o.width + 'px' : undefined });
  if (typeof content === 'string') inner.innerHTML = content; else inner.append(content);
  outer.append(inner);
  sharpenOrbs(inner, x, o.still ?? true);
  return { outer, inner };
}
/** redraw every orb under `root` at `x` times its size and zoom it back (see filmUI) */
export function sharpenOrbs(root: ParentNode, x: number, still = true): void {
  for (const a of root.querySelectorAll<HTMLElement>('orb-avatar')) {
    if (a.dataset['film']) continue;
    const s = Number(a.getAttribute('size') || 20);
    a.setAttribute('size', String(Math.round(s * x)));
    a.style.zoom = String(1 / x);
    a.setAttribute('mode', 'fixed'); a.setAttribute('idle-motion', 'off');
    if (still) a.setAttribute('static', '');
    a.dataset['film'] = '1';
  }
}

/** a line of type with lab marks: `[claude]Claude` puts the mark before the word, `{Same}` holds a word in the selection
    with the caret after it, `{{word}}` in the selection without a caret */
export function typeset(text: string): string {
  return text
    .replace(/\{\{([^}]+)\}\}/g, '<span class="sel">$1</span>')
    .replace(/\{([^}]+)\}/g, '<span class="sel" data-caret>$1</span>')
    .replace(/\[(claude|chatgpt|github|xai)\]/g, (_, l: Lab) => '<span class="mark-inline">' + labSvg(l) + '</span>');
}
/** a lab's mark and its name or plan in mono, as a byline */
export const labLine = (b: FilmBot, text: string = b.labName): string => '<span class="lab"><span class="lab__mark">' + labSvg(b.lab) + '</span>' + text + '</span>';

/** a seeded grain canvas over the whole stage (deterministic: the same frame renders the same pixels) */
export function grain(stage: HTMLElement, seed = 7): void {
  const w = stage.offsetWidth, ht = stage.offsetHeight;
  const c = document.createElement('canvas');
  c.className = 'grain'; c.width = w; c.height = ht;
  const g = c.getContext('2d');
  if (!g) return;
  const img = g.createImageData(w, ht);
  let s = seed >>> 0;
  const rnd = (): number => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rnd() + rnd() - 1) * 46;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  stage.append(c);
}

/** build a frame, then say when it is ready to capture: fonts loaded, orbs drawn and their faces settled */
export function frame(build: (stage: HTMLElement) => void | Promise<void>, o: { vertical?: boolean; settle?: number } = {}): void {
  const stage = document.querySelector<HTMLElement>('.stage') ?? document.body.appendChild(h('div', 'stage'));
  if (o.vertical) stage.dataset['format'] = 'vertical';
  if (!stage.querySelector('.ground')) stage.prepend(h('div', 'ground'));
  void (async () => {
    await document.fonts.ready;
    await build(stage);
    grain(stage);
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, o.settle ?? 1600));
    document.documentElement.dataset['ready'] = '1';
  })();
}
