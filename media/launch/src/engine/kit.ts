/* The product, on the film's stage: the real kit (@boopis/ui, apps/desktop/ui/src/components), its tokens and CSS, the
   vendored <orb-avatar> and <boopis-logo> elements, and the product's fonts, self-hosted. Nothing here is copied from the
   app: a frame changes when the product does.

   The kit is live UI. On the film's stage nothing may move by itself, so `neutralise()` turns off everything that runs on
   a clock: CSS transitions and keyframes (one stylesheet), Web Animations the kit starts from script (cancelled on every
   seek, see film.ts), and the orbs' own frame loop (every <orb-avatar> is made `static`; a film orb is drawn by its pose,
   see orb.ts). The orb worker is never started: the film does not call the kit's `setupOrbs()`, so no OffscreenCanvas
   worker and no worker clock exist on the page. The glance timers (`startGlance`) and tooltips are never enabled. */
import '@fontsource/libre-franklin/latin-400.css';
import '@fontsource/libre-franklin/latin-500.css';
import '@fontsource/libre-franklin/latin-600.css';
import '@fontsource/libre-franklin/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@ui/src/components/kit.css';
import '@ui/vendor/orb-avatar.min.js';
import '@ui/vendor/boopis-logo.js';

export { ui } from '@boopis/ui';
export type { ComposerOpts } from '@boopis/ui';

const FROZEN = 'film-frozen';

/** stop everything on the page that runs on a clock (idempotent) */
export function neutralise(root: ParentNode = document): void {
  if (!document.getElementById(FROZEN)) {
    const s = document.createElement('style');
    s.id = FROZEN;
    /* every transition and keyframe animation off, the caret hidden (a blinking caret is a clock) */
    s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';
    document.head.appendChild(s);
  }
  freezeOrbs(root);
}

/** every kit orb under root becomes one still frame: its own loop never draws it again (orb2 skips static orbs) */
export function freezeOrbs(root: ParentNode = document): void {
  for (const o of root.querySelectorAll('orb-avatar')) {
    o.setAttribute('static', '');
    o.setAttribute('idle-motion', 'off');
    o.setAttribute('mode', 'fixed');
    o.removeAttribute('data-glance');
  }
}

/** cancel the Web Animations the kit may have started from script (cards' height, the dock's springs) */
export function cancelScriptAnimations(): void {
  for (const a of document.getAnimations()) { try { a.cancel(); } catch { /* already gone */ } }
}

/* The text floor is 28 px at 1080p (craft bible rule 5). The kit's smallest text a frame may need to read is its 11 px
   mono meta: 11 x 2.6 = 28.6 px, so 2.6 is the default zoom (the art director's minimum where 11 px text is read). */
export const TEXT_FLOOR = 28;
export const DEFAULT_ZOOM = 2.6;
const mounted: { el: HTMLElement; zoom: number }[] = [];

export interface MountOpts {
  /** the kit's real size times this (default 2.6), laid out at that size (CSS zoom: text and corners stay vectors) */
  zoom?: number;
  /** a theme preset of the product's tokens (catalog, graphite, typewriter, bone); default the app's own */
  preset?: string;
  /** a width for the component at its real size (before zoom) */
  width?: number;
  className?: string;
}

/** put a kit component on the stage at film scale. Returns the outer wrapper (unzoomed: place it in film px); the
    component sits in an inner box with the zoom, so `left`/`top` on the wrapper are never multiplied by it. */
export function mount(component: HTMLElement, o: MountOpts = {}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'film-ui' + (o.className ? ' ' + o.className : '');
  if (o.preset) wrap.dataset['hxPreset'] = o.preset;
  const inner = document.createElement('div');
  inner.className = 'film-ui__zoom';
  const zoom = o.zoom ?? DEFAULT_ZOOM;
  if (zoom !== 1) inner.style.setProperty('zoom', String(zoom));
  mounted.push({ el: wrap, zoom });
  if (o.width) inner.style.width = o.width + 'px';
  inner.appendChild(component);
  wrap.appendChild(inner);
  neutralise(wrap);
  return wrap;
}

/** every mounted component whose smallest text lands under the floor at its zoom (measured once it is laid out: 1em
    of each run through every zoom, before the camera moves anything); main.ts reports them as warnings */
export function textFloorWarnings(hostScale = 1): string[] {
  const out: string[] = [];
  for (const { el, zoom } of mounted) {
    if (!el.isConnected) continue;
    let min = Infinity, sample = '';
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement, text = (n.textContent ?? '').trim();
      if (!p || !text || getComputedStyle(p).display === 'none') continue;
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:1em;vertical-align:baseline;padding:0;margin:0;border:0';
      p.appendChild(probe);
      const em = probe.getBoundingClientRect().height / hostScale;
      probe.remove();
      if (em > 0 && em < min) { min = em; sample = text.slice(0, 40); }
    }
    if (min < TEXT_FLOOR) out.push('mount(zoom ' + zoom + '): "' + sample + '" is ' + min.toFixed(1) + ' px, under the ' + TEXT_FLOOR + ' px floor; zoom ' + (Math.ceil((zoom * TEXT_FLOOR / min) * 10) / 10) + ' or more draws it at the floor (or draw that text as a grey bar)');
  }
  return out;
}

/** every declared font face loaded now, so no frame is ever drawn in a fallback face (a face used only later in the
    film would otherwise load when its text first shows) */
export async function loadAllFonts(): Promise<void> {
  const faces = [...document.fonts];
  await Promise.all(faces.map((f) => f.load().catch(() => undefined)));
  await document.fonts.ready;
}

/** every <img> and SVG <image> decoded */
export async function decodeImages(root: ParentNode = document): Promise<void> {
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(imgs.map((i) => (i.complete && i.naturalWidth ? i.decode().catch(() => undefined) : new Promise<void>((r) => { i.addEventListener('load', () => r(), { once: true }); i.addEventListener('error', () => r(), { once: true }); }).then(() => i.decode().catch(() => undefined)))));
}
