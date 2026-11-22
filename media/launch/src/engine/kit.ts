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

export interface MountOpts {
  /** the kit's real size times this, laid out at that size (CSS zoom: text and corners stay vectors, never a scaled bitmap) */
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
  if (o.zoom && o.zoom !== 1) inner.style.setProperty('zoom', String(o.zoom));
  if (o.width) inner.style.width = o.width + 'px';
  inner.appendChild(component);
  wrap.appendChild(inner);
  neutralise(wrap);
  return wrap;
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
